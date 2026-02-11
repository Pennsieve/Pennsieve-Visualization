// @/stores/tsviewer.js
import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import { propEq, findIndex } from 'ramda'
import { useToken } from '@/composables/useToken'
import { useChannelDataRequest } from '@/composables/useChannelDataRequest';

// Store instance cache - maps instanceId to store instance
const storeInstances = new Map()

// Track if we've already shown warnings (to avoid spam)
let hasShownDefaultWarning = false
let hasShownDeprecationWarning = false

/**
 * Factory function to create or retrieve a viewer store instance.
 * Each instanceId gets its own isolated store, enabling multiple
 * independent TSViewer components on the same page.
 *
 * @param {string} instanceId - Unique identifier for the viewer instance
 * @returns {Object} Pinia store instance for this viewer
 */
export function createViewerStore(instanceId = 'default') {
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
    if (storeInstances.has(instanceId)) {
        return storeInstances.get(instanceId)()
    }

    // Create a new store with a unique ID
    const useStore = defineStore(`tsviewer-${instanceId}`, () => {
    const config = reactive({})
    const viewerChannels = ref([])
    const viewerMontageScheme = ref('NOT_MONTAGED')
    const customMontageMap = ref({})
    const workspaceMontages = ref([])
    const viewerErrors = ref(null)
    const needsRerender = ref(null)
    const activeViewer = ref({})

    // Annotation-related state
    const viewerAnnotations = ref([])
    const activeAnnotationLayer = ref({})
    const activeAnnotation = ref({})
    const viewerActiveTool = ref('POINTER')

    const { openConnection } = useChannelDataRequest()

    // Getters (from original Vuex getters)
    const getMontageMessageByName = computed(() => {
        return (name) => {
            return workspaceMontages.value.find(montage => montage.name === name)
        }
    })

    const viewerSelectedChannels = computed(() => {
        return viewerChannels.value.filter(channel => channel.selected)
    })

    const getViewerActiveLayer = computed(() => {
        return () => {
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
        return (id) => {
            const allAnnotations = viewerAnnotations.value.flatMap(layer => layer.annotations || [])
            return allAnnotations.find(annotation => annotation.id === id)
        }
    })

    // Actions
    const setActiveViewer = (viewer) => {
      activeViewer.value = viewer;
    }

    const setChannels = (channels) => {
        viewerChannels.value = channels
    }

    const setViewerMontageScheme = (scheme) => {
        viewerMontageScheme.value = scheme
    }

    const setCustomMontageMap = (map) => {
        customMontageMap.value = map
    }

    const setWorkspaceMontages = (montages) => {
        workspaceMontages.value = montages
    }

    const setViewerErrors = (errors) => {
        viewerErrors.value = errors
    }


    const setNeedsRerender = (renderData) => {
        needsRerender.value = renderData
    }

    const setViewerConfig = (newConfig) => {
        Object.assign(config, newConfig)
    }

    const fetchAndSetActiveViewer = async (data) => {
      const id = data.packageId;
      const token = await useToken();
      let urlSegment = config.timeseriesDiscoverApi
      let channelData = null;
      channelData = await openConnection(urlSegment, id, token)
      setActiveViewer({channels: channelData.res, content : { id: id}})
    }

    const isTSFileProcessed = () => {
      return (record) => {
        const fileState = record?.content?.state;
        return fileState === "READY";
      }
    }

    // Add annotation-related actions
    const setAnnotations = (annotations) => {
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

    const setActiveAnnotationLayer = (layerId) => {
        if (!layerId && layerId !== 0) {
            console.error('setActiveAnnotationLayer called with invalid layerId:', layerId)
            return
        }

        activeAnnotationLayer.value = layerId

        // Clear all selected flags first
        viewerAnnotations.value.forEach(annotation => annotation.selected = false)

        // Find and select the target layer
        const layerIndex = findIndex(propEq('id', layerId), viewerAnnotations.value)
        if (layerIndex >= 0) {
            viewerAnnotations.value[layerIndex].selected = true
        } else {
            console.error('Layer with ID not found:', layerId, 'Available layers:', viewerAnnotations.value)
        }
    }

    const setActiveAnnotation = (annotation) => {
        // Clear all selected annotations
        viewerAnnotations.value.forEach(layer =>
            layer.annotations?.forEach(ann => ann.selected = false)
        )

        // Set the new active annotation as selected if it has an ID
        if (annotation.id) {
            const layerIndex = findIndex(propEq('id', annotation.layer_id), viewerAnnotations.value)
            if (layerIndex >= 0) {
                const annotationIndex = findIndex(propEq('id', annotation.id), viewerAnnotations.value[layerIndex].annotations)
                if (annotationIndex >= 0) {
                    viewerAnnotations.value[layerIndex].annotations[annotationIndex].selected = true
                }
            }
        }

        activeAnnotation.value = annotation
    }

    const setActiveTool = (tool) => {
        viewerActiveTool.value = tool
    }

    const createLayer = (layer) => {
        // FIX: Validate layer structure before creating
        if (!layer.id && layer.id !== 0) {
            console.error('Cannot create layer without ID:', layer)
            return
        }

        // Ensure the layer has required properties
        const validatedLayer = {
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
            ...layer // Spread any additional properties
        }

        viewerAnnotations.value.push(validatedLayer)
    }


    const updateLayer = (layerData) => {
        const index = findIndex(propEq('id', layerData.id), viewerAnnotations.value)
        if (index >= 0) {
            const updatedLayer = Object.assign(viewerAnnotations.value[index], layerData)
            viewerAnnotations.value[index] = updatedLayer
        }
    }

    const deleteLayer = (layerData) => {
        const index = findIndex(propEq('id', layerData.id), viewerAnnotations.value)
        if (index >= 0) {
            viewerAnnotations.value.splice(index, 1)
        }
    }

    const createAnnotation = (annotation) => {
        const layerIndex = findIndex(propEq('id', annotation.layer_id), viewerAnnotations.value)
        if (layerIndex >= 0) {
            if (!viewerAnnotations.value[layerIndex].annotations) {
                viewerAnnotations.value[layerIndex].annotations = []
            }
            viewerAnnotations.value[layerIndex].annotations.push(annotation)
            setActiveAnnotation(annotation)
        }
    }

    const updateAnnotation = (annotation) => {
        const layerIndex = findIndex(propEq('id', annotation.layer_id), viewerAnnotations.value)
        if (layerIndex >= 0) {
            const annotations = viewerAnnotations.value[layerIndex].annotations
            const annotationIndex = findIndex(propEq('id', annotation.id), annotations)
            if (annotationIndex >= 0) {
                annotations[annotationIndex] = annotation
            }
        }
    }

    const deleteAnnotation = (annotation) => {
        const layerIndex = findIndex(propEq('id', annotation.layer_id), viewerAnnotations.value)
        if (layerIndex >= 0) {
            const annotations = viewerAnnotations.value[layerIndex].annotations
            const annotationIndex = findIndex(propEq('id', annotation.id), annotations)
            if (annotationIndex >= 0) {
                annotations.splice(annotationIndex, 1)
            }
        }
    }

    const updateChannelProperty = (channelId, property, value) => {
        const channel = viewerChannels.value.find(ch => ch.id === channelId)
        if (channel) {
            channel[property] = value
        }

    }

    const updateChannelVisibility = (channelId, visible) => {
        updateChannelProperty(channelId, 'visible', visible)
    }

    const updateChannelSelection = (channelId, selected) => {
        updateChannelProperty(channelId, 'selected', selected)
    }

    const updateChannelFilter = (channelId, filter) => {
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
        viewerActiveTool.value = 'POINTER'
        activeViewer.value = {}
        Object.keys(config).forEach(key => {
          delete config[key]
        })
    }

    const triggerRerender = (cause) => {
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

    // Cache the store factory function
    storeInstances.set(instanceId, useStore)

    // Return the store instance
    return useStore()
}

/**
 * Clears a specific viewer store instance from the cache.
 * Call this when unmounting a TSViewer to clean up resources.
 *
 * @param {string} instanceId - The instance ID to clear
 */
export function clearViewerStore(instanceId) {
    if (storeInstances.has(instanceId)) {
        const store = storeInstances.get(instanceId)()
        store.resetViewer()
        storeInstances.delete(instanceId)
    }
}

/**
 * Clears all viewer store instances from the cache.
 */
export function clearAllViewerStores() {
    storeInstances.forEach((useStore, instanceId) => {
        const store = useStore()
        store.resetViewer()
    })
    storeInstances.clear()
}

/**
 * @deprecated Use createViewerStore(instanceId) instead for multi-instance support.
 * This export is kept for backwards compatibility with existing code.
 * Returns the default singleton store instance.
 */
export function useViewerStore() {
    if (!hasShownDeprecationWarning) {
        hasShownDeprecationWarning = true
        console.warn(
            '[TSViewer] useViewerStore() is deprecated. ' +
            'Use createViewerStore(instanceId) for multi-instance support.'
        )
    }
    return createViewerStore('default')
}