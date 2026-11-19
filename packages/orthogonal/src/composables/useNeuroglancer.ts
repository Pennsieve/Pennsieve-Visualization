import { ref, shallowRef, onUnmounted } from 'vue'
import type {
  ChannelConfig,
  LayoutMode,
  ViewerState,
  NeuroglancerStateJSON,
} from '../types'

/** Meters per OME-Zarr axis unit (OME's default unit is micrometer). */
function unitToMeters(unit?: string): number {
  switch ((unit ?? 'micrometer').toLowerCase()) {
    case 'nanometer': return 1e-9
    case 'millimeter': return 1e-3
    case 'centimeter': return 1e-2
    case 'meter': return 1
    default: return 1e-6
  }
}

/**
 * Spatial axis test. "type" is recommended but optional in OME-Zarr 0.4, so an
 * axis without one counts as spatial when it is named x, y or z.
 */
function isSpatialAxis(a: { name: string; type?: string }): boolean {
  return a.type ? a.type === 'space' : ['x', 'y', 'z'].includes(a.name.toLowerCase())
}

// Brightness slider range, in stops (each stop doubles or halves brightness)
export const BRIGHTNESS_MAX_STOPS = 2

// Black level slider range, as a share of each layer's opened display range:
// 0 = the range the viewer opened with, 0.5 = start halfway up, -0.5 = bring
// back values below the opened start.
export const BLACK_LEVEL_MIN = -0.5
export const BLACK_LEVEL_MAX = 0.9

// Values sampled per channel from the smallest pyramid level for the display
// range and background level; enough for stable percentiles, light on memory.
const SAMPLE_PER_CHANNEL = 1_000_000

/**
 * Background (black) level of one channel: its most common non-zero value,
 * capped at the 5th percentile of non-zero values so at most ~5% of real
 * pixels can go black. For fluorescence the most common value is the glow of
 * the mounting medium or the camera offset; showing it black removes the wash
 * of channel color. Zeros are left out because they are usually stitching
 * padding. Same rule as the TIFF converter's background_level(), so assets
 * made before the converter used it look the same as new ones.
 */
export function backgroundLevel(values: ArrayLike<number>): number | null {
  const nz: number[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v !== 0 && Number.isFinite(v)) nz.push(v)
  }
  if (nz.length === 0) return null
  nz.sort((a, b) => a - b)
  const p5 = nz[Math.floor((nz.length - 1) * 0.05)]
  const lo = nz[0]
  const hi = nz[nz.length - 1]

  let mode = lo
  if (nz.every(Number.isInteger) && hi - lo < 1 << 20) {
    const counts = new Uint32Array(hi - lo + 1)
    for (const v of nz) counts[v - lo]++
    let best = 0
    for (let i = 0; i < counts.length; i++) if (counts[i] > counts[best]) best = i
    mode = lo + best
  } else if (hi > lo) {
    const bins = 1024
    const counts = new Uint32Array(bins)
    const w = (hi - lo) / bins
    for (const v of nz) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++
    let best = 0
    for (let i = 0; i < bins; i++) if (counts[i] > counts[best]) best = i
    mode = lo + best * w
  }
  return Math.min(mode, p5)
}

// Default colors for channels when none detected
const DEFAULT_COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff']

interface OmeroChannel {
  label?: string
  color?: string
  active?: boolean
  coefficient?: number
  family?: string
  window?: { start?: number; end?: number; min?: number; max?: number }
}

/**
 * Convert a hex color string (e.g. "FF0000") to normalized RGB floats.
 */
function hexToFloats(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16) / 255
  const g = parseInt(clean.substring(2, 4), 16) / 255
  const b = parseInt(clean.substring(4, 6), 16) / 255
  return [r, g, b]
}

/**
 * Build a neuroglancer shader that maps data values through invlerp
 * and tints the output with a given color.
 */
function buildColorShader(rgb: [number, number, number]): string {
  const [r, g, b] = rgb.map((v) => v.toFixed(4))
  return [
    '#uicontrol invlerp normalized',
    'void main() {',
    `  float v = normalized();`,
    `  emitRGB(vec3(${r}, ${g}, ${b}) * v);`,
    '}',
  ].join('\n')
}

/**
 * Build a shader that composites 3 bundled channels as RGB.
 * RGB has no invlerp range, so the brightness slider scales it through the
 * "brightness" control instead.
 */
function buildRGBShader(): string {
  return [
    `#uicontrol float brightness slider(min=${2 ** -BRIGHTNESS_MAX_STOPS}, max=${2 ** BRIGHTNESS_MAX_STOPS}, default=1)`,
    'void main() {',
    '  emitRGB(brightness * vec3(',
    '    toNormalized(getDataValue(0)),',
    '    toNormalized(getDataValue(1)),',
    '    toNormalized(getDataValue(2))',
    '  ));',
    '}',
  ].join('\n')
}


/**
 * Composable that manages Neuroglancer viewer lifecycle and
 * bridges imperative viewer state to Vue reactivity via rAF polling.
 */
export function useNeuroglancer() {
  // Use shallowRef to prevent Vue from deep-proxying WebGL handles
  const viewer = shallowRef<any>(null)
  const container = ref<HTMLElement | null>(null)
  const isLoading = ref(true)
  const error = ref<Error | null>(null)

  // Reactive Vue state synced from neuroglancer
  const position = ref<[number, number, number]>([0, 0, 0])
  const channels = ref<ChannelConfig[]>([])
  const layout = ref<LayoutMode>('4panel')
  // Brightness in stops: 0 = the range the viewer opened with, +1 = twice as bright
  const brightness = ref(0)
  // Black level as a share of each layer's opened range: 0 = as opened
  const blackLevel = ref(0)
  // False for RGB images, which have no display range for the black level to move
  const hasDisplayRange = ref(true)
  // Each layer's invlerp range before any brightness or black level change, by layer name.
  // Keyed by name because restoreState (layout/visibility changes) can rebuild layers.
  let baseRanges = new Map<string, [number, number]>()

  let rafId: number | null = null

  /**
   * Parse the neuroglancer state JSON and extract Vue-friendly state.
   */
  function syncFromViewer() {
    if (!viewer.value) return

    try {
      const state = viewer.value.state.toJSON() as NeuroglancerStateJSON

      // Extract position (neuroglancer serializes it as a plain array in the order
      // of state.dimensions, which follows the file: z, y, x for OME-Zarr). Pick
      // x, y and z by name so the readout isn't swapped.
      const pos = state.position as number[] | undefined
      if (Array.isArray(pos) && pos.length > 0) {
        const names = Object.keys((state.dimensions as Record<string, unknown> | undefined) ?? {})
          .map(n => n.toLowerCase())
        const at = (axis: string, fallback: number) => {
          const i = names.indexOf(axis)
          return i >= 0 && i < pos.length ? pos[i] : (names.length ? 0 : pos[fallback] ?? 0)
        }
        position.value = [at('x', 0), at('y', 1), at('z', 2)]
      }

      // Extract layout
      const stateLayout = state.layout as string | undefined
      if (stateLayout && ['4panel', '3d', 'xy', 'xz', 'yz'].includes(stateLayout)) {
        layout.value = stateLayout as LayoutMode
      }

      // Extract channels from layers
      const layers = state.layers as Array<Record<string, unknown>> | undefined
      if (layers && layers.length > 0) {
        channels.value = layers.map((layer, i) => ({
          name: (layer.name as string) || `Channel ${i}`,
          visible: layer.visible !== false,
          color: extractColorFromLayer(layer, i),
          opacity: typeof layer.opacity === 'number' ? layer.opacity : 1,
        }))
      }
    } catch {
      // Silently ignore transient state read errors
    }
  }

  /**
   * Extract a CSS color from a neuroglancer layer's shader or use a default.
   */
  function extractColorFromLayer(layer: Record<string, unknown>, index: number): string {
    const shader = layer.shader as string | undefined
    if (shader) {
      const match = shader.match(/vec3\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/)
      if (match) {
        const r = Math.round(parseFloat(match[1]) * 255)
        const g = Math.round(parseFloat(match[2]) * 255)
        const b = Math.round(parseFloat(match[3]) * 255)
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
      }
    }
    return DEFAULT_COLORS[index % DEFAULT_COLORS.length]
  }

  /**
   * Polling loop: reads neuroglancer state into Vue refs every animation frame.
   */
  function startPolling() {
    function poll() {
      syncFromViewer()
      rafId = requestAnimationFrame(poll)
    }
    rafId = requestAnimationFrame(poll)
  }

  function stopPolling() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  /**
   * Fetch a zarr chunk, decompress with blosc, and return a typed array.
   * Falls back to raw bytes if blosc import fails.
   */
  async function fetchAndDecodeChunk(
    url: string,
    dtype: string,
  ): Promise<ArrayBufferView | null> {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const compressed = new Uint8Array(await res.arrayBuffer())

      const { default: Blosc } = await import('numcodecs/blosc')
      const codec = Blosc.fromConfig({ id: 'blosc' })
      const decompressed: Uint8Array = await codec.decode(compressed)

      if (dtype.includes('f4') || dtype.includes('float32')) {
        return new Float32Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength / 4)
      } else if (dtype.includes('u2') || dtype.includes('uint16')) {
        return new Uint16Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength / 2)
      } else if (dtype.includes('i2') || dtype.includes('int16')) {
        return new Int16Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength / 2)
      } else if (dtype.includes('u1') || dtype.includes('uint8')) {
        return decompressed
      }
      // Default: treat as float32
      return new Float32Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength / 4)
    } catch (e) {
      console.warn('[useNeuroglancer] chunk decode failed:', e)
      return null
    }
  }

  /**
   * Fetch the smallest pyramid level's chunks and compute the 1-99% data range
   * (all channels together) and each channel's background level.
   * Returns nulls if fetching/decoding fails.
   */
  async function fetchLevelStats(
    source: string,
    dtype: string,
    multiscales: any,
  ): Promise<{ range: [number, number] | null, background: (number | null)[] }> {
    const none = { range: null, background: [] as (number | null)[] }
    try {
      const base = source.replace(/\/+$/, '')
      const datasets = multiscales?.[0]?.datasets as Array<{ path: string }> | undefined
      if (!datasets || datasets.length === 0) return none

      // Use the smallest (last) pyramid level
      const smallestPath = datasets[datasets.length - 1].path
      const axisNames = ((multiscales?.[0]?.axes ?? []) as Array<{ name: string }>).map(a => a.name)
      const cAxis = axisNames.indexOf('c')

      // Fetch array metadata to get chunk layout
      let arrayMeta: any = null
      const v2Res = await fetch(`${base}/${smallestPath}/.zarray`).catch(() => null)
      const v3Res = await fetch(`${base}/${smallestPath}/zarr.json`).catch(() => null)

      if (v2Res?.ok) {
        arrayMeta = await v2Res.json()
      } else if (v3Res?.ok) {
        arrayMeta = await v3Res.json()
      }
      if (!arrayMeta) return none

      // Determine shape and chunk shape
      const shape: number[] = arrayMeta.shape
      const chunkShape: number[] = arrayMeta.chunks
        ?? arrayMeta.chunk_grid?.configuration?.chunk_shape
      if (!shape || !chunkShape) return none

      // Determine chunk key separator
      const separator = arrayMeta.chunk_key_encoding?.configuration?.separator
        ?? (arrayMeta.dimension_separator || '/')

      // Zarr v3 chunks live under "c/" prefix, v2 don't
      const isV3 = arrayMeta.zarr_format === 3
      const chunkPrefix = isV3 ? 'c/' : ''

      // Compute number of chunks along each dimension
      const numChunks = shape.map((s: number, i: number) => Math.ceil(s / chunkShape[i]))

      // Fetch all chunks (smallest level should be small)
      const chunkIndices: number[][] = []

      function buildChunkIndices(dimIndex: number, indices: number[]) {
        if (dimIndex === shape.length) {
          chunkIndices.push(indices)
          return
        }
        for (let i = 0; i < numChunks[dimIndex]; i++) {
          buildChunkIndices(dimIndex + 1, [...indices, i])
        }
      }
      buildChunkIndices(0, [])

      const chunkResults = await Promise.all(
        chunkIndices.map(idx =>
          fetchAndDecodeChunk(`${base}/${smallestPath}/${chunkPrefix}${idx.join(separator)}`, dtype))
      )

      // Sample values per channel. A chunk holds the full chunk shape (edge chunks
      // are padded with the fill value), so the channel of element k comes from the
      // chunk's position along "c" plus k's offset along that axis.
      const nChannels = cAxis >= 0 ? shape[cAxis] : 1
      const total = shape.reduce((a, b) => a * b, 1)
      const step = Math.max(1, Math.floor(total / nChannels / SAMPLE_PER_CHANNEL))
      const perChannel: number[][] = Array.from({ length: nChannels }, () => [])
      const chunkC = cAxis >= 0 ? chunkShape[cAxis] : 1
      const strideC = cAxis >= 0 ? chunkShape.slice(cAxis + 1).reduce((a, b) => a * b, 1) : 1

      chunkResults.forEach((chunk, n) => {
        if (!chunk) return
        const arr = chunk as unknown as ArrayLike<number>
        const c0 = cAxis >= 0 ? chunkIndices[n][cAxis] * chunkC : 0
        for (let k = 0; k < arr.length; k += step) {
          const v = arr[k]
          if (!Number.isFinite(v)) continue
          const c = cAxis >= 0 ? c0 + (Math.floor(k / strideC) % chunkC) : 0
          if (c < nChannels) perChannel[c].push(v)
        }
      })

      const allValues = perChannel.flat()
      if (allValues.length === 0) return none

      allValues.sort((a, b) => a - b)
      const last = allValues.length - 1
      let p01 = allValues[Math.floor(last * 0.01)]
      let p99 = allValues[Math.ceil(last * 0.99)]
      if (p99 <= p01) {
        // Mostly one value (e.g. empty background): fall back to the full min/max
        p01 = allValues[0]
        p99 = allValues[last]
      }
      return { range: [p01, p99], background: perChannel.map(backgroundLevel) }
    } catch (e) {
      console.warn('[useNeuroglancer] fetchLevelStats failed:', e)
      return none
    }
  }

  /**
   * Raise a display range's start to the channel's background level, when that
   * sits inside the range. Never lowers the start.
   */
  function withBackground(range: [number, number], bg: number | null | undefined): [number, number] {
    if (bg == null || !(bg > range[0] && bg < range[1])) return range
    return [bg, range[1]]
  }

  /**
   * Fetch OME-Zarr metadata and build layer configs for each channel.
   * Falls back to a single grayscale layer if metadata is unavailable.
   */
  async function fetchChannelMetadata(source: string): Promise<{ layers: any[], isVolumetric: boolean, dataRange: [number, number] | null, displayDimensions?: string[], dimensions?: Record<string, [number, string]> }> {
    try {
      // Try Zarr v2 (.zattrs) first, fall back to Zarr v3 (zarr.json)
      let zattrs: Record<string, any> | undefined
      let dtype = ''

      const base = source.replace(/\/+$/, '')
      const [v2AttrsRes, v2ArrayRes, v3RootRes, v3ArrayRes] = await Promise.all([
        fetch(`${base}/.zattrs`).catch(() => null),
        fetch(`${base}/0/.zarray`).catch(() => null),
        fetch(`${base}/zarr.json`).catch(() => null),
        fetch(`${base}/0/zarr.json`).catch(() => null),
      ])

      if (v2AttrsRes?.ok) {
        zattrs = await v2AttrsRes.json()
      } else if (v3RootRes?.ok) {
        const root = await v3RootRes.json()
        zattrs = root?.attributes
      }

      if (v2ArrayRes?.ok) {
        const zarray = await v2ArrayRes.json()
        dtype = (zarray?.dtype as string) ?? ''
      } else if (v3ArrayRes?.ok) {
        const zarray = await v3ArrayRes.json()
        dtype = (zarray?.data_type as string) ?? ''
      }

      const omeroChannels = zattrs?.omero?.channels as OmeroChannel[] | undefined
      const colorModel = zattrs?.omero?.rdefs?.model as string | undefined

      // Check if the data has a Z axis (volumetric vs 2D)
      const multiscales = zattrs?.multiscales
      const axes = multiscales?.[0]?.axes as Array<{ name: string; type?: string; unit?: string }> | undefined
      const isVolumetric = axes ? axes.some(a => a.name === 'z') : false

      // OME-Zarr stores axes slowest-first (c, z, y, x), and neuroglancer takes the
      // first spatial dimensions as its display order, so without this the panel
      // labeled "xy" shows the Z-Y plane and "yz" shows the real X-Y plane.
      // Matched by name, case-insensitively, wherever the axes sit in the file.
      const spatialAxes = (axes ?? []).filter(isSpatialAxis)
      const displayDimensions = ['x', 'y', 'z']
        .map(n => spatialAxes.find(a => a.name.toLowerCase() === n)?.name)
        .filter((n): n is string => !!n)
      // displayDimensions alone is dropped: restoreState applies it before the
      // zarr source has loaded, when the global coordinate space has no names
      // yet, and neuroglancer falls back to the default order. Declaring the
      // global dimensions (restored first) in x, y, z order with the level-0
      // voxel size makes the names exist up front, and orders them too.
      const level0Scale = (multiscales?.[0]?.datasets?.[0]?.coordinateTransformations as
        Array<{ type: string; scale?: number[] }> | undefined)?.find(t => t.type === 'scale')?.scale
      const dimensions: Record<string, [number, string]> = {}
      for (const name of displayDimensions) {
        const i = (axes ?? []).findIndex(a => a.name === name)
        const sc = level0Scale?.[i]
        dimensions[name] = [
          (typeof sc === 'number' && sc > 0 ? sc : 1) * unitToMeters((axes ?? [])[i]?.unit),
          'm',
        ]
      }

      // Detect RGB: 3 channels with color model
      const isRGB = colorModel === 'color' && omeroChannels?.length === 3

      // Compute actual data range and per-channel background from the smallest pyramid level
      const { range: dataRange, background } = await fetchLevelStats(source, dtype, multiscales)

      // Determine dtype for fallback range
      let dtypeRange: [number, number] = [0, 10000]
      if (dtype) {
        if (dtype.includes('u1') || dtype.includes('uint8')) {
          dtypeRange = [0, 255]
        } else if (dtype.includes('u2') || dtype.includes('uint16')) {
          dtypeRange = [0, 10000]
        } else if (dtype.includes('i2') || dtype.includes('int16')) {
          // Signed int16 — common for CT and microscopy
          dtypeRange = [-1151, 14353]
        } else if (dtype.includes('f4') || dtype.includes('float32')) {
          dtypeRange = [0, 1]
        }
      }

      // Use computed range if available, otherwise fall back to dtype range
      const displayRange: [number, number] = dataRange ?? dtypeRange

      // Common volume rendering defaults
      const volumeDefaults = {
        volumeRendering: 'on',
        volumeRenderingMode: 'min',
        volumeRenderingGain: -5,
      }

      if (isRGB) {
        // RGB brightfield: single layer with c^ channel dimension and RGB shader.
        // Source transform overrides the OME-Zarr parser's default c' → c^.
        // Spatial dimensions keep the level-0 voxel size from the multiscales, so
        // Z spacing and the scale bar stay right (a fixed 1 µm made every voxel a cube).
        const outputDimensions: Record<string, [number, string]> = { "c^": [1, ''] }
        if (axes) {
          const level0 = multiscales?.[0]?.datasets?.[0]?.coordinateTransformations as
            Array<{ type: string; scale?: number[] }> | undefined
          const scale = level0?.find(t => t.type === 'scale')?.scale
          axes.forEach((a: { name: string; type?: string; unit?: string }, i: number) => {
            if (!isSpatialAxis(a)) return
            const s = typeof scale?.[i] === 'number' && scale[i] > 0 ? scale[i] : 1
            outputDimensions[a.name] = [s * unitToMeters(a.unit), 'm']
          })
        }
        return {
          dataRange,
          isVolumetric,
          displayDimensions,
          dimensions,
          layers: [{
            type: 'image',
            source: {
              url: `zarr://${source}`,
              transform: { outputDimensions },
            },
            name: 'RGB',
            shader: buildRGBShader(),
            channelDimensions: { "c^": [1, ''] },
            ...(isVolumetric ? volumeDefaults : {}),
          }],
        }
      }

      if (omeroChannels && omeroChannels.length > 0) {
        // Multi-channel (fluorescence): one layer per channel, each pinned to a channel index.
        // Each layer starts with its own omero window (or the computed range when it has
        // none), so dataRange is not returned: applying one shared range afterwards would
        // overwrite the per-channel windows the converter measured.
        return {
          dataRange: null,
          isVolumetric,
          displayDimensions,
          dimensions,
          layers: omeroChannels.map((ch, i) => {
            const colorHex = ch.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length].replace('#', '')
            const rgb = hexToFloats(colorHex)
            // The background level fixes assets whose window starts below it (made
            // before the converter set it), e.g. a glowing mounting medium that
            // otherwise shows as a wash of the channel color.
            const range = withBackground(ch.window
              ? [ch.window.start ?? 0, ch.window.end ?? displayRange[1]]
              : displayRange, background[i])

            return {
              type: 'image',
              source: `zarr://${source}`,
              name: ch.label || `Channel ${i}`,
              shader: buildColorShader(rgb),
              shaderControls: { normalized: { range } },
              // Add channels at full strength, like a fluorescence overlay.
              // Neuroglancer's defaults (opacity 0.5, alpha blending) draw each
              // layer at half strength over the previous ones, so with 4 channels
              // the first one contributes only ~6%.
              opacity: 1,
              blend: 'additive',
              visible: ch.active !== false,
              ...volumeDefaults,
              // Fluorescence is bright signal on a black background, so the 3D view
              // uses a maximum intensity projection. Neuroglancer reads the mode from
              // "volumeRendering" ("off" | "on" | "max" | "min"); "volumeRenderingMode"
              // is not a state key and is ignored. With the shared default ("on",
              // gain -5) each voxel is drawn at ~0.7% opacity and the volume looks empty.
              volumeRendering: 'max',
              volumeRenderingGain: 0,
              localDimensions: { "c'": [1, ''] },
              localPosition: [i],
            }
          }),
        }
      }

      // No OMERO metadata — single grayscale layer
      return {
        dataRange: dataRange ? withBackground(dataRange, background[0]) : null,
        isVolumetric,
        displayDimensions,
        dimensions,
        layers: [{
          type: 'image',
          source: `zarr://${source}`,
          name: 'data',
          shader: '#uicontrol invlerp normalized\nvoid main() { emitGrayscale(normalized()); }',
          shaderControls: { normalized: { range: withBackground(displayRange, background[0]) } },
          ...volumeDefaults,
        }],
      }
    } catch {
      // Metadata fetch failed entirely — single grayscale layer with safe defaults
      return {
        dataRange: null,
        isVolumetric: false,
        layers: [{
          type: 'image',
          source: `zarr://${source}`,
          name: 'data',
          shader: '#uicontrol invlerp normalized\nvoid main() { emitGrayscale(normalized()); }',
          shaderControls: { normalized: { range: [0, 255] as [number, number] } },
          volumeRendering: 'on',
          volumeRenderingMode: 'min',
          volumeRenderingGain: -5,
        }],
      }
    }
  }

  /**
   * Apply a computed data range to all invlerp shader controls on the viewer.
   * Polls briefly because layers may not be fully initialized right after restoreState.
   */
  function applyDataRange(v: any, range: [number, number]) {
    let attempts = 0
    const maxAttempts = 20
    const intervalMs = 300

    const tryApply = () => {
      const managedLayers = v.layerManager?.managedLayers
      if (!managedLayers || managedLayers.length === 0) {
        if (++attempts < maxAttempts) setTimeout(tryApply, intervalMs)
        return
      }

      let allReady = true
      for (const ml of managedLayers) {
        const layer = ml.layer
        if (!layer?.shaderControlState) { allReady = false; continue }
        const state = layer.shaderControlState.state
        if (!state || state.size === 0) { allReady = false; continue }
        for (const [, entry] of state) {
          const trackable = entry.trackable
          if (trackable?.value && 'range' in trackable.value) {
            trackable.value = { ...trackable.value, range, window: range }
          }
        }
      }

      if (!allReady && ++attempts < maxAttempts) {
        setTimeout(tryApply, intervalMs)
      }
    }

    setTimeout(tryApply, intervalMs)
  }

  /**
   * Initialize the neuroglancer viewer in the given container.
   */
  async function init(el: HTMLElement, source: string, initialLayout: LayoutMode = '4panel') {
    container.value = el
    isLoading.value = true
    error.value = null
    brightness.value = 0
    blackLevel.value = 0
    hasDisplayRange.value = true
    baseRanges = new Map()

    try {
      // Clear URL hash so stale neuroglancer state from a previous
      // dataset doesn't override our initial view (zoom, position, etc.)
      history.replaceState(null, '', window.location.pathname)

      // Import main module first — side effects register data source providers
      // (zarr://, precomputed://, etc.) on the global registry.
      await import('neuroglancer')

      const { setupDefaultViewer } = await import(
        'neuroglancer/unstable/ui/default_viewer_setup.js'
      )

      const v = setupDefaultViewer({
        target: el,
      })

      viewer.value = v

      // Build per-channel layers from OME-Zarr metadata
      const { layers, isVolumetric, dataRange, displayDimensions, dimensions } = await fetchChannelMetadata(source)

      const initialState: NeuroglancerStateJSON = {
        ...(displayDimensions?.length ? { dimensions, displayDimensions } : {}),
        layout: isVolumetric ? initialLayout : 'xy',
        layers,
      }

      v.state.restoreState(initialState)
      hasDisplayRange.value = !layers.some((l: any) => typeof l.shader === 'string' && !l.shader.includes('invlerp'))

      // If we computed a data range from the actual zarr data, apply it
      // to each layer's invlerp control after restoreState
      if (dataRange) {
        applyDataRange(v, dataRange)
      }

      isLoading.value = false
      startPolling()
    } catch (e) {
      error.value = e instanceof Error ? e : new Error(String(e))
      isLoading.value = false
      throw error.value
    }
  }

  /**
   * Apply the brightness and black level sliders to every layer, from each
   * layer's opened range. For invlerp layers (grayscale and colored channels):
   * - brightness moves the top of the range: brighter lowers it, so more of the
   *   data reaches full intensity; darker raises it, bringing back detail in
   *   saturated areas.
   * - black level moves the bottom: up hides more background (it shows black),
   *   down brings back faint values below the opened start.
   * RGB layers have no range; brightness scales them through their
   * "brightness" shader control, and black level does not apply.
   */
  function applyDisplayAdjustments() {
    const v = viewer.value
    const managedLayers = v?.layerManager?.managedLayers
    if (!managedLayers) return
    const gain = Math.pow(2, brightness.value)
    const black = blackLevel.value

    for (const ml of managedLayers) {
      const controls = ml.layer?.shaderControlState?.state
      if (!controls) continue

      const normalized = controls.get('normalized')?.trackable
      if (normalized?.value?.range) {
        const name = ml.name as string
        if (!baseRanges.has(name)) {
          baseRanges.set(name, [Number(normalized.value.range[0]), Number(normalized.value.range[1])])
        }
        const [lo, hi] = baseRanges.get(name)!
        const span = hi - lo
        let start = lo + black * span
        let end = lo + span / gain
        // Integer data: keep whole-number bounds
        if (Number.isInteger(lo) && Number.isInteger(hi)) {
          start = Math.round(start)
          end = Math.round(end)
        }
        // Never collapse or invert the range
        const minSpan = Number.isInteger(lo) && Number.isInteger(hi) ? 1 : span * 0.01 || 1e-6
        if (end < start + minSpan) end = start + minSpan
        normalized.value = { ...normalized.value, range: [start, end] }
      }

      const rgbBrightness = controls.get('brightness')?.trackable
      if (rgbBrightness) rgbBrightness.value = gain
    }
  }

  /**
   * Brighten or darken every layer, in stops (see applyDisplayAdjustments).
   */
  function setBrightness(stops: number) {
    brightness.value = stops
    applyDisplayAdjustments()
  }

  /**
   * Move every layer's black level, as a share of its opened range (see
   * applyDisplayAdjustments). 0 = as opened.
   */
  function setBlackLevel(share: number) {
    blackLevel.value = Math.min(BLACK_LEVEL_MAX, Math.max(BLACK_LEVEL_MIN, share))
    applyDisplayAdjustments()
  }

  /**
   * Set visibility for a channel by index.
   */
  function setChannelVisibility(index: number, visible: boolean) {
    if (!viewer.value) return
    // Change only this layer. Exporting the whole state and restoring it
    // rebuilds every layer, and the global dimensions come back in the file's
    // order (z, y, x) while the position stays in x, y, z order, so the view
    // lands outside the data (a gray screen).
    viewer.value.layerManager?.managedLayers?.[index]?.setVisible(visible)
  }

  /**
   * Set the viewer layout mode.
   */
  function setLayout(mode: LayoutMode) {
    if (!viewer.value) return
    // Change only the layout (see setChannelVisibility for why not a full restore).
    viewer.value.layout.restoreState(mode)
    layout.value = mode
  }

  /**
   * Set the crosshair position.
   */
  function setPosition(pos: [number, number, number]) {
    if (!viewer.value) return
    // pos is [x, y, z]; neuroglancer's position follows its global dimension
    // order, so place each value by axis name.
    const names: string[] = viewer.value.coordinateSpace?.value?.names ?? []
    const current: Float32Array | undefined = viewer.value.position?.value
    if (!current || current.length !== names.length) return
    const byName: Record<string, number> = { x: pos[0], y: pos[1], z: pos[2] }
    viewer.value.position.value = Float32Array.from(
      names.map((n, i) => byName[n.toLowerCase()] ?? current[i]))
  }

  /**
   * Get the current viewer state snapshot.
   */
  function getState(): ViewerState {
    return {
      position: [...position.value] as [number, number, number],
      channels: channels.value.map((c) => ({ ...c })),
      layout: layout.value,
    }
  }

  /**
   * Dispose viewer and clean up.
   */
  function dispose() {
    stopPolling()
    if (viewer.value) {
      try {
        viewer.value.dispose()
      } catch {
        // Viewer may already be disposed
      }
      viewer.value = null
    }
  }

  onUnmounted(dispose)

  return {
    // State (reactive)
    viewer,
    container,
    isLoading,
    error,
    position,
    channels,
    layout,
    brightness,
    blackLevel,
    hasDisplayRange,

    // Actions
    init,
    dispose,
    setChannelVisibility,
    setLayout,
    setPosition,
    setBrightness,
    setBlackLevel,
    getState,
  }
}
