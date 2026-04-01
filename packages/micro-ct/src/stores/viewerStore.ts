import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SourceType } from '../components/ome/types'

// Store instance cache - maps instanceId to store factory function
const storeInstances = new Map<string, any>()

let hasShownDefaultWarning = false

export interface OmeChannelState {
  name: string
  color: [number, number, number]
  visible: boolean
}

/**
 * Factory function to create or retrieve an OmeViewer store instance.
 * Each instanceId gets its own isolated store, enabling multiple
 * independent OmeViewer components on the same page.
 *
 * @param instanceId - Unique identifier for the viewer instance
 * @returns Pinia store instance for this viewer
 */
export function createViewerStore(instanceId = 'default') {
  if (instanceId === 'default' && !hasShownDefaultWarning) {
    hasShownDefaultWarning = true
    console.warn(
      '[micro-ct] Using default store instance. ' +
      'For multi-instance support, pass a unique instanceId. ' +
      'Example: createViewerStore("ome-viewer-1")'
    )
  }

  if (storeInstances.has(instanceId)) {
    return storeInstances.get(instanceId)!()
  }

  const useStore = defineStore(`pennsieve-viz-micro-ct-${instanceId}`, () => {
    // ============= Source State =============
    const source = ref<string | null>(null)
    const sourceType = ref<SourceType>('ome-zarr')

    // ============= Loading State =============
    const isLoading = ref(false)
    const error = ref<string | null>(null)
    const isTileLoading = ref(false)

    // ============= Dimension Navigation =============
    const currentZ = ref(0)
    const currentT = ref(0)
    const maxZ = ref(0)
    const maxT = ref(0)
    const fluidMode = ref(false)

    // ============= Channel State =============
    const channels = ref<OmeChannelState[]>([])

    // ============= Getters =============
    const hasZSlices = computed(() => maxZ.value > 0)
    const hasTSlices = computed(() => maxT.value > 0)
    const channelCount = computed(() => channels.value.length)
    const visibleChannels = computed(() => channels.value.filter(ch => ch.visible))

    // ============= Actions =============
    const setSource = (src: string | null, type: SourceType = 'ome-zarr') => {
      source.value = src
      sourceType.value = type
    }

    const setLoading = (loading: boolean) => {
      isLoading.value = loading
    }

    const setError = (err: string | null) => {
      error.value = err
    }

    const setTileLoading = (loading: boolean) => {
      isTileLoading.value = loading
    }

    const setDimensions = (z: number, t: number) => {
      maxZ.value = z
      maxT.value = t
    }

    const setCurrentZ = (z: number) => {
      currentZ.value = Math.max(0, Math.min(z, maxZ.value))
    }

    const setCurrentT = (t: number) => {
      currentT.value = Math.max(0, Math.min(t, maxT.value))
    }

    const setFluidMode = (fluid: boolean) => {
      fluidMode.value = fluid
    }

    const setChannels = (chs: OmeChannelState[]) => {
      channels.value = chs
    }

    const setChannelVisibility = (index: number, visible: boolean) => {
      if (index >= 0 && index < channels.value.length) {
        channels.value[index].visible = visible
      }
    }

    const toggleChannelVisibility = (index: number) => {
      if (index >= 0 && index < channels.value.length) {
        channels.value[index].visible = !channels.value[index].visible
      }
    }

    const showAllChannels = () => {
      channels.value.forEach(ch => { ch.visible = true })
    }

    const hideAllChannels = () => {
      channels.value.forEach(ch => { ch.visible = false })
    }

    const resetStore = () => {
      source.value = null
      sourceType.value = 'ome-zarr'
      isLoading.value = false
      error.value = null
      isTileLoading.value = false
      currentZ.value = 0
      currentT.value = 0
      maxZ.value = 0
      maxT.value = 0
      fluidMode.value = false
      channels.value = []
    }

    return {
      // State
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

      // Getters
      hasZSlices,
      hasTSlices,
      channelCount,
      visibleChannels,

      // Actions
      setSource,
      setLoading,
      setError,
      setTileLoading,
      setDimensions,
      setCurrentZ,
      setCurrentT,
      setFluidMode,
      setChannels,
      setChannelVisibility,
      toggleChannelVisibility,
      showAllChannels,
      hideAllChannels,
      resetStore,
    }
  })

  storeInstances.set(instanceId, useStore)
  return useStore()
}

/**
 * Clears a specific viewer store instance from the cache.
 * Call this when unmounting a viewer to clean up resources.
 */
export function clearViewerStore(instanceId: string) {
  if (storeInstances.has(instanceId)) {
    const store = storeInstances.get(instanceId)!()
    store.resetStore()
    storeInstances.delete(instanceId)
  }
}

/**
 * Clears all viewer store instances from the cache.
 */
export function clearAllViewerStores() {
  storeInstances.forEach((useStore) => {
    useStore().resetStore()
  })
  storeInstances.clear()
}
