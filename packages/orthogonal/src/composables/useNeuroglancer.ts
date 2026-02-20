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
   * Fetch OME-Zarr metadata and build layer configs for each channel.
   * Falls back to a single grayscale layer if metadata is unavailable.
   */
  async function fetchChannelMetadata(source: string) {
    try {
      const [attrsRes, arrayRes] = await Promise.all([
        fetch(`${source}/.zattrs`),
        fetch(`${source}/0/.zarray`).catch(() => null),
      ])
      const zattrs = await attrsRes.json()
      const omeroChannels = zattrs?.omero?.channels as OmeroChannel[] | undefined

      // Determine dtype for fallback range
      let dtypeRange: [number, number] = [0, 10000]
      if (arrayRes?.ok) {
        const zarray = await arrayRes.json()
        const dtype = (zarray?.dtype as string) ?? ''
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

      // Common volume rendering defaults
      const volumeDefaults = {
        volumeRendering: 'on',
        volumeRenderingMode: 'min',
        volumeRenderingGain: -5,
      }

      if (omeroChannels && omeroChannels.length > 0) {
        return omeroChannels.map((ch, i) => {
          const colorHex = ch.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length].replace('#', '')
          const rgb = hexToFloats(colorHex)
          const range: [number, number] = ch.window
            ? [ch.window.start ?? 0, ch.window.end ?? dtypeRange[1]]
            : dtypeRange

          return {
            type: 'image',
            source: `zarr://${source}`,
            name: ch.label || `Channel ${i}`,
            shader: buildColorShader(rgb),
            shaderControls: { normalized: { range } },
            visible: ch.active !== false,
            ...volumeDefaults,
            // Pin this layer to a specific channel index
            localDimensions: { "c'": [1, ''] },
            localPosition: [i],
          }
        })
      }

      // No OMERO metadata — single grayscale layer
      return [{
        type: 'image',
        source: `zarr://${source}`,
        name: 'data',
        shader: '#uicontrol invlerp normalized\nvoid main() { emitGrayscale(normalized()); }',
        shaderControls: { normalized: { range: dtypeRange } },
        ...volumeDefaults,
      }]
    } catch {
      // Metadata fetch failed entirely — single grayscale layer with safe defaults
      return [{
        type: 'image',
        source: `zarr://${source}`,
        name: 'data',
        shader: '#uicontrol invlerp normalized\nvoid main() { emitGrayscale(normalized()); }',
        shaderControls: { normalized: { range: [0, 255] as [number, number] } },
        volumeRendering: 'on',
        volumeRenderingMode: 'min',
        volumeRenderingGain: -5,
      }]
    }
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
      const layers = await fetchChannelMetadata(source)

      const initialState: NeuroglancerStateJSON = {
        layout: initialLayout,
        layers,
      }

      v.state.restoreState(initialState)

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
