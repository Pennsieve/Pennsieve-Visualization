// @/stores/tsviewer.ts
import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import { useToken } from '@/composables/useToken'
import { useChannelDataRequest } from '@/composables/useChannelDataRequest';
import { acquireClient, ensureCatalog, disposeClient } from '@/composables/streaming/clientRegistry'
import { isZarrAssetType } from '@/composables/streaming/assetTypes'
import { sortAnnotations } from '@/utils/annotationUtils'
import type { Annotation, AnnotationLayer } from '@/utils/annotationUtils'
import type { WorkspaceMontage } from '@/composables/useChannelProcessing'
import type { ChannelDetail } from '@/composables/streaming/channelDetails'
import type { CreateStoreOptions } from '@/composables/streaming/createStore'

/**
 * Host-supplied endpoints and settings, merged by `setViewerConfig`. Keys are
 * never dropped on merge; `resetViewer` clears them all.
 */
export interface ViewerConfig {
    apiUrl?: string
    timeseriesDiscoverApi?: string
    timeSeriesApi?: string
    [key: string]: unknown
}

/**
 * One channel row as the viewer renders it. Extra keys survive: legacy code
 * attaches per-channel scratch state directly to the row.
 */
export interface ViewerChannel {
    id: string
    label?: string
    name?: string
    serverId?: string
    channelType?: string
    type?: string
    selected?: boolean
    visible?: boolean
    hover?: boolean
    filter?: Record<string, unknown> | null
    sf?: number
    rate?: number
    rank?: number | string
    rowScale?: number
    rowBaseline?: number | null
    unit?: string
    [key: string]: unknown
}

export interface ActiveViewerContent {
    /** Package node id for API calls (for example /timeseries/{id}/layers). */
    id: string | null
    /** Viewer-asset UUID for the data-streaming WebSocket. */
    viewerAssetId: string | null
    idType: 'viewerAsset' | 'package'
    /** Raw viewer-asset `asset_type`. */
    assetType: string | null
    /** Bundle root URL, signed or not. Zarr path only. */
    url: string | null
    onUrlExpired: CreateStoreOptions['onUrlExpired'] | null
}

export interface ActiveViewer {
    channels?: ChannelDetail[] | null
    content?: ActiveViewerContent
}

export interface ActivateViewerOptions {
    /** Package node id. */
    packageId?: string | null
    /** Viewer-asset UUID; unchanged legacy meaning. */
    viewerAssetId?: string | null
    /** Raw viewer-asset `asset_type`. */
    assetType?: string | null
    /** Bundle root URL, signed or not. Zarr path only. */
    url?: string | null
    /** Renews a signed url. */
    onUrlExpired?: CreateStoreOptions['onUrlExpired'] | null
}

export interface RerenderTrigger {
    timestamp: number
    cause: string
}

// Store instance cache - maps instanceId to store instance
const storeInstances = new Map<string, ViewerStoreHook>()

// Track if we've already shown warnings (to avoid spam)
let hasShownDefaultWarning = false

/**
 * Defines the per-instance store. Split from `createViewerStore` so the
 * instance cache and the public store type can both name the hook type.
 */
function defineViewerStore(instanceId: string) {
    return defineStore(`tsviewer-${instanceId}`, () => {
    const config = reactive<ViewerConfig>({})
    const viewerChannels = ref<ViewerChannel[]>([])
    const viewerMontageScheme = ref('NOT_MONTAGED')
    const customMontageMap = ref<Record<string, unknown>>({})
    const workspaceMontages = ref<WorkspaceMontage[]>([])
    const viewerErrors = ref<unknown>(null)
    const needsRerender = ref<RerenderTrigger | null>(null)
    const activeViewer = ref<ActiveViewer>({})

    // Annotation-related state
    const viewerAnnotations = ref<AnnotationLayer[]>([])
    const activeAnnotationLayer = ref<number | string | object>({})
    const activeAnnotation = ref<Partial<Annotation>>({})
    const viewerActiveTool = ref('pointer')

    const { openConnection } = useChannelDataRequest()

    // Getters (from original Vuex getters)
    const getMontageMessageByName = computed(() => {
        return (name: string) => {
            return workspaceMontages.value.find(montage => montage.name === name)
        }
    })

    const viewerSelectedChannels = computed(() => {
        return viewerChannels.value.filter(channel => channel.selected)
    })

    const getViewerActiveLayer = computed(() => {
        return (): AnnotationLayer | null => {
            const activeLayer = viewerAnnotations.value.find(annotation => annotation.selected)
            if (!activeLayer) {
                console.warn('No active layer found, available layers:', viewerAnnotations.value)
                // Return the first layer if no layer is selected
                return viewerAnnotations.value.length > 0 ? viewerAnnotations.value[0] : null
            }
            return activeLayer
        }
    })

    const validateAnnotationLayers = () => {
        let hasErrors = false

        viewerAnnotations.value.forEach((layer, index) => {
            if (!layer.id && layer.id !== 0) {
                console.error(`Layer at index ${index} missing ID:`, layer)
                hasErrors = true
            }

            if (!layer.annotations) {
                console.warn(`Layer at index ${index} missing annotations array:`, layer)
                layer.annotations = []
            }
        })

        if (hasErrors) {
            console.error('Annotation layer validation failed. Layers:', viewerAnnotations.value)
        }

        return !hasErrors
    }

    const getAnnotationById = computed(() => {
        return (id: number | string) => {
            const allAnnotations = viewerAnnotations.value.flatMap(layer => layer.annotations || [])
            return allAnnotations.find(annotation => annotation.id === id)
        }
    })

    // Actions
    const setActiveViewer = (viewer: ActiveViewer) => {
      activeViewer.value = viewer;
    }

    const setChannels = (channels: ViewerChannel[]) => {
        viewerChannels.value = channels
    }

    const setViewerMontageScheme = (scheme: string) => {
        viewerMontageScheme.value = scheme
    }

    const setCustomMontageMap = (map: Record<string, unknown>) => {
        customMontageMap.value = map
    }

    const setWorkspaceMontages = (montages: WorkspaceMontage[]) => {
        workspaceMontages.value = montages
    }

    const setViewerErrors = (errors: unknown) => {
        viewerErrors.value = errors
    }


    const setNeedsRerender = (renderData: RerenderTrigger | null) => {
        needsRerender.value = renderData
    }

    const setViewerConfig = (newConfig: ViewerConfig) => {
        Object.assign(config, newConfig)
    }

    /**
     * Activates a package.
     *
     * `assetType` is the raw `asset_type` of the package's viewer asset, forwarded by the
     * host app, and it is what selects the data path: `timeseries-zarr` reads the bundle at
     * `url` directly in the browser, anything else (including the pre-existing `timeseries`)
     * goes to the streaming WebSocket. It travels here rather than through `setViewerConfig`
     * because it describes THIS package -- config is merged with Object.assign and never
     * drops keys, so a url left over from a Zarr package would misroute the next one.
     */
    const fetchAndSetActiveViewer = async (data: ActivateViewerOptions) => {
      // Prefer viewer asset UUID; fall back to package node ID. The resulting
      // WebSocket uses `?viewerAsset=` or `?package=` accordingly.
      const viewerAssetId = data.viewerAssetId || null;
      const packageId = data.packageId || null;
      const id = viewerAssetId || packageId;
      const idType = viewerAssetId ? 'viewerAsset' : 'package';
      const assetType = data.assetType || null;
      const url = data.url || null;
      // content.id = packageId for API calls (e.g. /timeseries/{id}/layers)
      // content.viewerAssetId = asset UUID for the data-streaming WebSocket
      const contentId = packageId || id;
      // onUrlExpired is carried through so the plot canvas can rebuild the client after a
      // remount without the host having to re-activate the package. Vue does not proxy
      // function values, so it survives reactive state unchanged.
      const content: ActiveViewerContent = {
        id: contentId, viewerAssetId, idType, assetType, url,
        onUrlExpired: data.onUrlExpired || null
      };

      // Zarr bundle path. The bundle describes its own channels, so this skips both the
      // discovery WebSocket and the Amplify token -- neither is available for a public or
      // locally served bundle. viewerAssetId keeps its existing meaning and is still
      // carried on `content` for the fallback path.
      if (isZarrAssetType(assetType)) {
        if (!url) {
          throw new Error(`A "${assetType}" viewer asset requires a bundle url`)
        }
        const entry = await acquireClient(`tsviewer-${instanceId}`, url, {
          onUrlExpired: data.onUrlExpired ?? undefined
        })
        const catalogIndex = await ensureCatalog(entry)
        setActiveViewer({ channels: catalogIndex.details, content })
        return
      }

      // Activating a non-bundle package is the moment any previously opened bundle becomes
      // unreachable, so its client is released here rather than lingering until the whole
      // viewer store is torn down.
      disposeClient(`tsviewer-${instanceId}`)

      const token = await useToken();
      const urlSegment = config.timeseriesDiscoverApi
      const channelData = await openConnection(urlSegment as string, id as string, token, idType, viewerAssetId ? packageId : null)
      // The discovery socket answers with the same flat channel-detail rows the
      // catalog produces; the transport just cannot express that in its types yet.
      setActiveViewer({ channels: channelData.res as ChannelDetail[] | null, content })
    }

    const isTSFileProcessed = () => {
      return (record?: { content?: { state?: string } }) => {
        const fileState = record?.content?.state;
        return fileState === "READY";
      }
    }

    // Add annotation-related actions
    const setAnnotations = (annotations: AnnotationLayer[]) => {
        // FIX: Validate annotation structure before setting
        const validatedAnnotations = annotations.map(annotation => {
            // Ensure each annotation has required properties
            if (!annotation.id && annotation.id !== 0) {
                console.warn('Annotation layer missing ID:', annotation)
                // Generate a temporary ID if missing
                annotation.id = Math.random().toString(36).substr(2, 9)
            }

            // Ensure annotations array exists
            if (!annotation.annotations) {
                annotation.annotations = []
            }

            // Ensure other required properties exist
            if (!annotation.name) {
                annotation.name = `Layer ${annotation.id}`
            }

            return annotation
        })

        viewerAnnotations.value = validatedAnnotations
    }

    const setActiveAnnotationLayer = (layerId: number | string) => {
        if (!layerId && layerId !== 0) {
            console.error('setActiveAnnotationLayer called with invalid layerId:', layerId)
            return
        }

        activeAnnotationLayer.value = layerId

        // Clear all selected flags first
        viewerAnnotations.value.forEach(annotation => annotation.selected = false)

        // Find and select the target layer
        const layerIndex = viewerAnnotations.value.findIndex(l => l.id === layerId)
        if (layerIndex >= 0) {
            viewerAnnotations.value[layerIndex].selected = true
        } else {
            console.error('Layer with ID not found:', layerId, 'Available layers:', viewerAnnotations.value)
        }
    }

    const setActiveAnnotation = (annotation: Annotation) => {
        // Clear all selected annotations
        viewerAnnotations.value.forEach(layer =>
            layer.annotations?.forEach(ann => ann.selected = false)
        )

        // Set the new active annotation as selected if it has an ID
        if (annotation.id) {
            const layerIndex = viewerAnnotations.value.findIndex(l => l.id === annotation.layer_id)
            if (layerIndex >= 0) {
                const annotationIndex = viewerAnnotations.value[layerIndex].annotations.findIndex(a => a.id === annotation.id)
                if (annotationIndex >= 0) {
                    viewerAnnotations.value[layerIndex].annotations[annotationIndex].selected = true
                }
            }
        }

        activeAnnotation.value = annotation
    }

    const setActiveTool = (tool: string) => {
        viewerActiveTool.value = tool
    }

    const createLayer = (layer: AnnotationLayer) => {
        // FIX: Validate layer structure before creating
        if (!layer.id && layer.id !== 0) {
            console.error('Cannot create layer without ID:', layer)
            return
        }

        // Ensure the layer has required properties; layer's own keys win, as the
        // original object spread did
        const validatedLayer: AnnotationLayer = Object.assign({
            id: layer.id,
            name: layer.name || `Layer ${layer.id}`,
            description: layer.description || '',
            visible: layer.visible !== undefined ? layer.visible : true,
            selected: layer.selected || false,
            annotations: layer.annotations || [],
            color: layer.color,
            hexColor: layer.hexColor,
            bkColor: layer.bkColor,
            selColor: layer.selColor,
            userId: layer.userId,
        }, layer)

        viewerAnnotations.value.push(validatedLayer)
    }


    const updateLayer = (layerData: AnnotationLayer) => {
        const index = viewerAnnotations.value.findIndex(l => l.id === layerData.id)
        if (index >= 0) {
            const updatedLayer = Object.assign(viewerAnnotations.value[index], layerData)
            viewerAnnotations.value[index] = updatedLayer
        }
    }

    const deleteLayer = (layerData: Pick<AnnotationLayer, 'id'>) => {
        const index = viewerAnnotations.value.findIndex(l => l.id === layerData.id)
        if (index >= 0) {
            viewerAnnotations.value.splice(index, 1)
        }
    }

    const createAnnotation = (annotation: Annotation) => {
        const layerIndex = viewerAnnotations.value.findIndex(l => l.id === annotation.layer_id)
        if (layerIndex >= 0) {
            if (!viewerAnnotations.value[layerIndex].annotations) {
                viewerAnnotations.value[layerIndex].annotations = []
            }
            viewerAnnotations.value[layerIndex].annotations.push(annotation)
            setActiveAnnotation(annotation)
        }
    }

    const updateAnnotation = (annotation: Annotation) => {
        // layer_id names the layer the annotation belongs to after the edit, which is
        // not always the layer it currently sits in: an edit can move it.
        const sourceLayer = viewerAnnotations.value.find(
            l => l.annotations.some(a => a.id === annotation.id)
        )
        if (!sourceLayer) {
            return
        }

        const targetLayer = viewerAnnotations.value.find(l => l.id === annotation.layer_id)
        // An unknown target layer keeps the stored copy: moving the annotation
        // nowhere would drop it out of the viewer.
        if (!targetLayer) {
            return
        }

        const annotationIndex = sourceLayer.annotations.findIndex(a => a.id === annotation.id)
        if (targetLayer === sourceLayer) {
            sourceLayer.annotations[annotationIndex] = annotation
            return
        }

        sourceLayer.annotations.splice(annotationIndex, 1)
        targetLayer.annotations.push(annotation)
        // A layer is ordered by start time, which annIndexOf binary searches, and no
        // caller re-sorts after a move.
        sortAnnotations(targetLayer.annotations)
    }

    const deleteAnnotation = (annotation: Annotation) => {
        const layerIndex = viewerAnnotations.value.findIndex(l => l.id === annotation.layer_id)
        if (layerIndex >= 0) {
            const annotations = viewerAnnotations.value[layerIndex].annotations
            const annotationIndex = annotations.findIndex(a => a.id === annotation.id)
            if (annotationIndex >= 0) {
                annotations.splice(annotationIndex, 1)
            }
        }
    }

    const updateChannelProperty = (channelId: string, property: string, value: unknown) => {
        const channel = viewerChannels.value.find(ch => ch.id === channelId)
        if (channel) {
            channel[property] = value
        }

    }

    const updateChannelVisibility = (channelId: string, visible: boolean) => {
        updateChannelProperty(channelId, 'visible', visible)
    }

    const updateChannelSelection = (channelId: string, selected: boolean) => {
        updateChannelProperty(channelId, 'selected', selected)
    }

    const updateChannelFilter = (channelId: string, filter: Record<string, unknown> | null) => {
        updateChannelProperty(channelId, 'filter', filter)
    }

    // Reset all state
    const resetViewer = () => {
        viewerChannels.value = []
        viewerMontageScheme.value = 'NOT_MONTAGED'
        customMontageMap.value = {}
        workspaceMontages.value = []
        viewerErrors.value = null
        viewerAnnotations.value = []
        activeAnnotationLayer.value = {}
        activeAnnotation.value = {}
        viewerActiveTool.value = 'pointer'
        activeViewer.value = {}
        Object.keys(config).forEach(key => {
          delete config[key]
        })
    }

    const triggerRerender = (cause: string) => {
        setNeedsRerender({
            timestamp: Date.now(),
            cause: cause
        })
    }

    const resetRerenderTrigger = () => {
        needsRerender.value = null
    }

    return {
        // State
        viewerChannels,
        viewerMontageScheme,
        customMontageMap,
        workspaceMontages,
        viewerErrors,
        needsRerender,
        viewerAnnotations,
        activeAnnotationLayer,
        activeAnnotation,
        activeViewer,
        viewerActiveTool,
        config,

        // Getters
        getMontageMessageByName,
        viewerSelectedChannels,
        getViewerActiveLayer,
        getAnnotationById,

        // Actions
        setChannels,
        setViewerMontageScheme,
        setCustomMontageMap,
        setWorkspaceMontages,
        setViewerErrors,
        setAnnotations,
        setActiveAnnotationLayer,
        setActiveAnnotation,
        setActiveTool,
        createLayer,
        updateLayer,
        deleteLayer,
        createAnnotation,
        updateAnnotation,
        deleteAnnotation,
        updateChannelProperty,
        updateChannelVisibility,
        updateChannelSelection,
        updateChannelFilter,
        validateAnnotationLayers,
        resetViewer,
        triggerRerender,
        resetRerenderTrigger,
        isTSFileProcessed,
        fetchAndSetActiveViewer,
        setActiveViewer,
        setViewerConfig
    }
    })
}

type ViewerStoreHook = ReturnType<typeof defineViewerStore>

/** The per-instance viewer store, as returned by `createViewerStore`. */
export type ViewerStore = ReturnType<ViewerStoreHook>

/**
 * Factory function to create or retrieve a viewer store instance.
 * Each instanceId gets its own isolated store, enabling multiple
 * independent TSViewer components on the same page.
 *
 * @param instanceId Unique identifier for the viewer instance
 */
export function createViewerStore(instanceId = 'default'): ViewerStore {
    // Warn once if using default instanceId
    if (instanceId === 'default' && !hasShownDefaultWarning) {
        hasShownDefaultWarning = true
        console.warn(
            '[TSViewer] Using default store instance. ' +
            'For multi-instance support, pass a unique instanceId prop to TSViewer. ' +
            'Example: <TSViewer instance-id="viewer-1" />'
        )
    }

    // Return cached instance if it exists
    const cached = storeInstances.get(instanceId)
    if (cached) {
        return cached()
    }

    // Create a new store with a unique ID
    const useStore = defineViewerStore(instanceId)

    // Cache the store factory function
    storeInstances.set(instanceId, useStore)

    // Return the store instance
    return useStore()
}

/**
 * Clears a specific viewer store instance from the cache.
 * Call this when unmounting a TSViewer to clean up resources.
 *
 * @param instanceId The instance ID to clear
 */
export function clearViewerStore(instanceId: string) {
    const cached = storeInstances.get(instanceId)
    if (cached) {
        const store = cached()
        store.resetViewer()
        storeInstances.delete(instanceId)
    }
    // Tearing down the store is the point at which a Zarr client can no longer be reached,
    // so this is where it is disposed; a plain disconnect keeps it, so that reconnecting to
    // the same bundle reuses the already-loaded catalog.
    disposeClient(`tsviewer-${instanceId}`)
}

/**
 * Clears all viewer store instances from the cache.
 */
export function clearAllViewerStores() {
    storeInstances.forEach((useStore, instanceId) => {
        const store = useStore()
        store.resetViewer()
        disposeClient(`tsviewer-${instanceId}`)
    })
    storeInstances.clear()
}
