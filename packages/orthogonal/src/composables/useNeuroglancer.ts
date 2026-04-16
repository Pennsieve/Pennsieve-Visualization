import { ref, shallowRef, onUnmounted } from 'vue'
import type {
  ChannelConfig,
  LayoutMode,
  ViewerState,
  NeuroglancerStateJSON,
} from '../types'

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
 */
function buildRGBShader(): string {
  return [
    'void main() {',
    '  emitRGB(vec3(',
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

  let rafId: number | null = null

  /**
   * Parse the neuroglancer state JSON and extract Vue-friendly state.
   */
  function syncFromViewer() {
    if (!viewer.value) return

    try {
      const state = viewer.value.state.toJSON() as NeuroglancerStateJSON

      // Extract position (neuroglancer serializes as a plain array)
      const pos = state.position as number[] | undefined
      if (Array.isArray(pos) && pos.length >= 3) {
        position.value = [pos[0], pos[1], pos[2]]
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
   * Fetch the smallest pyramid level's chunks and compute the 1-99% data range.
   * Returns null if fetching/decoding fails.
   */
  async function fetchDataRange(
    source: string,
    dtype: string,
    multiscales: any,
  ): Promise<[number, number] | null> {
    try {
      const base = source.replace(/\/+$/, '')
      const datasets = multiscales?.[0]?.datasets as Array<{ path: string }> | undefined
      if (!datasets || datasets.length === 0) return null

      // Use the smallest (last) pyramid level
      const smallestPath = datasets[datasets.length - 1].path

      // Fetch array metadata to get chunk layout
      let arrayMeta: any = null
      const v2Res = await fetch(`${base}/${smallestPath}/.zarray`).catch(() => null)
      const v3Res = await fetch(`${base}/${smallestPath}/zarr.json`).catch(() => null)

      if (v2Res?.ok) {
        arrayMeta = await v2Res.json()
      } else if (v3Res?.ok) {
        arrayMeta = await v3Res.json()
      }
      if (!arrayMeta) return null

      // Determine shape and chunk shape
      const shape: number[] = arrayMeta.shape
      const chunkShape: number[] = arrayMeta.chunks
        ?? arrayMeta.chunk_grid?.configuration?.chunk_shape
      if (!shape || !chunkShape) return null

      // Determine chunk key separator
      const separator = arrayMeta.chunk_key_encoding?.configuration?.separator
        ?? (arrayMeta.dimension_separator || '/')

      // Zarr v3 chunks live under "c/" prefix, v2 don't
      const isV3 = arrayMeta.zarr_format === 3
      const chunkPrefix = isV3 ? 'c/' : ''

      // Compute number of chunks along each dimension
      const numChunks = shape.map((s: number, i: number) => Math.ceil(s / chunkShape[i]))

      // Fetch all chunks (smallest level should be small)
      const allValues: number[] = []
      const chunkUrls: string[] = []

      function buildChunkUrls(dimIndex: number, indices: number[]) {
        if (dimIndex === shape.length) {
          chunkUrls.push(`${base}/${smallestPath}/${chunkPrefix}${indices.join(separator)}`)
          return
        }
        for (let i = 0; i < numChunks[dimIndex]; i++) {
          buildChunkUrls(dimIndex + 1, [...indices, i])
        }
      }
      buildChunkUrls(0, [])

      const chunkResults = await Promise.all(
        chunkUrls.map(url => fetchAndDecodeChunk(url, dtype))
      )

      for (const chunk of chunkResults) {
        if (chunk) {
          const arr = chunk instanceof Float32Array ? chunk
            : chunk instanceof Uint16Array ? chunk
            : chunk instanceof Int16Array ? chunk
            : chunk instanceof Uint8Array ? chunk
            : new Float32Array((chunk as any).buffer)
          for (let i = 0; i < arr.length; i++) {
            if (Number.isFinite(arr[i])) allValues.push(arr[i])
          }
        }
      }

      if (allValues.length === 0) return null

      allValues.sort((a, b) => a - b)
      const p01 = allValues[Math.floor(allValues.length * 0.01)]
      const p99 = allValues[Math.ceil(allValues.length * 0.99) - 1]
      console.log(`[useNeuroglancer] computed data range from ${allValues.length} values: [${p01}, ${p99}]`)
      return [p01, p99]
    } catch (e) {
      console.warn('[useNeuroglancer] fetchDataRange failed:', e)
      return null
    }
  }

  /**
   * Fetch OME-Zarr metadata and build layer configs for each channel.
   * Falls back to a single grayscale layer if metadata is unavailable.
   */
  async function fetchChannelMetadata(source: string): Promise<{ layers: any[], isVolumetric: boolean, dataRange: [number, number] | null }> {
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
      const axes = multiscales?.[0]?.axes as Array<{ name: string; type?: string }> | undefined
      const isVolumetric = axes ? axes.some(a => a.name === 'z') : false

      // Detect RGB: 3 channels with color model
      const isRGB = colorModel === 'color' && omeroChannels?.length === 3

      // Compute actual data range from smallest pyramid level
      const dataRange = await fetchDataRange(source, dtype, multiscales)

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
        const outputDimensions: Record<string, [number, string]> = { "c^": [1, ''] }
        if (axes) {
          for (const a of axes) {
            if (a.type === 'space') outputDimensions[a.name] = [0.000001, 'm']
          }
        }
        return {
          dataRange,
          isVolumetric,
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
        // Multi-channel (fluorescence): one layer per channel, each pinned to a channel index
        return {
          dataRange,
          isVolumetric,
          layers: omeroChannels.map((ch, i) => {
            const colorHex = ch.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length].replace('#', '')
            const rgb = hexToFloats(colorHex)
            const range: [number, number] = ch.window
              ? [ch.window.start ?? 0, ch.window.end ?? displayRange[1]]
              : displayRange

            return {
              type: 'image',
              source: `zarr://${source}`,
              name: ch.label || `Channel ${i}`,
              shader: buildColorShader(rgb),
              shaderControls: { normalized: { range } },
              visible: ch.active !== false,
              ...volumeDefaults,
              localDimensions: { "c'": [1, ''] },
              localPosition: [i],
            }
          }),
        }
      }

      // No OMERO metadata — single grayscale layer
      return {
        dataRange,
        isVolumetric,
        layers: [{
          type: 'image',
          source: `zarr://${source}`,
          name: 'data',
          shader: '#uicontrol invlerp normalized\nvoid main() { emitGrayscale(normalized()); }',
          shaderControls: { normalized: { range: displayRange } },
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
      const { layers, isVolumetric, dataRange } = await fetchChannelMetadata(source)

      const initialState: NeuroglancerStateJSON = {
        layout: isVolumetric ? initialLayout : 'xy',
        layers,
      }

      v.state.restoreState(initialState)

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
   * Set visibility for a channel by index.
   */
  function setChannelVisibility(index: number, visible: boolean) {
    if (!viewer.value) return
    const state = viewer.value.state.toJSON() as NeuroglancerStateJSON
    const layers = state.layers as Array<Record<string, unknown>> | undefined
    if (layers && layers[index]) {
      layers[index].visible = visible
      viewer.value.state.restoreState(state)
    }
  }

  /**
   * Set the viewer layout mode.
   */
  function setLayout(mode: LayoutMode) {
    if (!viewer.value) return
    const state = viewer.value.state.toJSON() as NeuroglancerStateJSON
    state.layout = mode
    viewer.value.state.restoreState(state)
  }

  /**
   * Set the crosshair position.
   */
  function setPosition(pos: [number, number, number]) {
    if (!viewer.value) return
    const state = viewer.value.state.toJSON() as NeuroglancerStateJSON
    state.position = [...pos]
    viewer.value.state.restoreState(state)
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

    // Actions
    init,
    dispose,
    setChannelVisibility,
    setLayout,
    setPosition,
    getState,
  }
}
