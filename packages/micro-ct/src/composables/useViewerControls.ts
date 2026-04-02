/**
 * Composable for external control of OmeViewer instances.
 * Use this in wrapper components or external control panels that need
 * to interact with viewer state.
 *
 * Returns null if Pinia is not available — the core viewer still works,
 * but external control features are disabled.
 *
 * @example
 * import { useViewerControls } from '@pennsieve-viz/micro-ct'
 *
 * const controls = useViewerControls('viewer-1')
 * if (!controls) return // Pinia not available
 *
 * // Read state
 * const channels = controls.channels.value
 * const currentZ = controls.currentZ.value
 *
 * // Control viewer
 * controls.setChannelVisibility(0, false)
 * controls.setCurrentZ(5)
 */

import { computed, readonly } from 'vue'
import { storeToRefs } from 'pinia'
import { createViewerStore } from '../stores/viewerStore'
import type { SourceType } from '../components/ome/types'

/**
 * Provides read and write access to an OmeViewer instance's state.
 *
 * @param instanceId - The unique identifier of the viewer instance
 * @returns Control interface for the viewer, or null if Pinia is not available
 */
export function useViewerControls(instanceId = 'default') {
  const viewerStore = createViewerStore(instanceId)

  if (!viewerStore) return null

  const {
    source,
    sourceType,
    isLoading,
    error,
    isTileLoading,
    currentZ,
    currentT,
    maxZ,
    maxT,
    fluidMode,
    channels,
    hasZSlices,
    hasTSlices,
    channelCount,
    visibleChannels,
  } = storeToRefs(viewerStore)

  // ============================================
  // READ-ONLY STATE
  // ============================================

  const readonlyChannels = readonly(channels)
  const readonlySource = readonly(source)
  const readonlySourceType = readonly(sourceType)
  const readonlyError = readonly(error)

  // ============================================
  // STATE QUERIES
  // ============================================

  const getChannel = (index: number) => {
    return channels.value[index] ?? undefined
  }

  const getVisibleChannels = () => {
    return channels.value.filter(ch => ch.visible)
  }

  const getState = () => ({
    source: source.value,
    sourceType: sourceType.value,
    isLoading: isLoading.value,
    error: error.value,
    currentZ: currentZ.value,
    currentT: currentT.value,
    maxZ: maxZ.value,
    maxT: maxT.value,
    fluidMode: fluidMode.value,
    channels: channels.value,
  })

  // ============================================
  // RETURN PUBLIC API
  // ============================================

  return {
    // Readonly state
    source: readonlySource,
    sourceType: readonlySourceType,
    isLoading: readonly(isLoading),
    error: readonlyError,
    isTileLoading: readonly(isTileLoading),
    currentZ: readonly(currentZ),
    currentT: readonly(currentT),
    maxZ: readonly(maxZ),
    maxT: readonly(maxT),
    fluidMode: readonly(fluidMode),
    channels: readonlyChannels,

    // Computed
    hasZSlices,
    hasTSlices,
    channelCount,
    visibleChannels,

    // State queries
    getChannel,
    getVisibleChannels,
    getState,

    // Source controls
    setSource: (src: string | null, type?: SourceType) => viewerStore.setSource(src, type),

    // Dimension controls
    setCurrentZ: (z: number) => viewerStore.setCurrentZ(z),
    setCurrentT: (t: number) => viewerStore.setCurrentT(t),
    setFluidMode: (fluid: boolean) => viewerStore.setFluidMode(fluid),

    // Channel controls
    setChannelVisibility: (index: number, visible: boolean) => viewerStore.setChannelVisibility(index, visible),
    toggleChannelVisibility: (index: number) => viewerStore.toggleChannelVisibility(index),
    showAllChannels: () => viewerStore.showAllChannels(),
    hideAllChannels: () => viewerStore.hideAllChannels(),

    // Lifecycle
    reset: () => viewerStore.resetStore(),

    // Direct store access (advanced)
    store: viewerStore,
  }
}
