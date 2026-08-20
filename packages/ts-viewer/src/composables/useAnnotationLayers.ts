// composables/useAnnotationLayers.ts
import { ref, inject } from 'vue'
import { createViewerStore, type ViewerStore } from '../stores/tsviewer'
import { useToken } from "@/composables/useToken"
import { useHandleXhrError, useSendXhr } from "@/mixins/request/request_composable"
import { useViewerEmitter } from '@/events/emitter'
import { hexToRgbA } from '@/utils/annotationUtils'
import type { AnnotationLayer } from '@/utils/annotationUtils'

interface ActiveViewer {
    content?: { id?: string }
}

interface NewLayer {
    name: string
    color: string
    description?: string
}

interface LayerResult {
    id: number | string
    name?: string
    description?: string
    color?: string
}

interface LayersResponse {
    results?: LayerResult[]
}

interface CreatedLayerResponse {
    id: number | string
    name: string
    color: string
    description?: string
}

type LayersEmit = (event: 'annLayersInitialized' | 'closeAnnotationLayerWindow') => void

/**
 * Composable for annotation layer management.
 * @param storeInstance - Optional store instance. If not provided, will inject from parent or use default.
 */
export function useAnnotationLayers(storeInstance: ViewerStore | null = null) {
    // Use provided store, inject from parent, or fall back to default
    const viewerStore = storeInstance || inject<ViewerStore | null>('viewerStore', null) || createViewerStore('default')

    // Resolved here, while a component is still current: the emits below run in
    // async functions, where inject cannot reach the owning viewer.
    const emitter = useViewerEmitter()

    const annLayerInfo = ref<LayerResult[] | undefined>([])
    const defaultColors = ref([
        '#18BA62', '#FFBC27', '#E94B4B', '#0D4EFF', '#FF4FFF', '#50FFFF', '#FFFF4E', '#512BAF',
        '#8A6ECF', '#389BAD', '#187D46', '#B12800', '#0C2475', '#FF5321', '#FF99CC', '#DCC180',
        '#FF6C21', '#000000', '#9B9B9B', '#00FF00', '#FA8072', '#808000', '#A0522D', '#2760FF'
    ])

    const initializeLayers = async (response: LayersResponse, activeViewer: ActiveViewer | null, emit: LayersEmit) => {
        const annLayers: AnnotationLayer[] = []

        // If no layers exist, create a default layer
        if (!response?.results || response.results.length === 0) {
            const payload = {
                name: 'Default',
                color: '#18BA62',
                description: 'Default Annotation Layer'
            }
            // createAnnotationLayer is not given the emit: it would close a layer
            // window that no one opened during the initial load.
            const created = await createAnnotationLayer(payload, activeViewer)
            if (created) {
                emit('annLayersInitialized')
            }
        } else {
            // Process existing layers
            for (let i = 0; i < response.results.length; i++) {
                const result = response.results[i]
                let layerColor = result.color || defaultColors.value[i % defaultColors.value.length]

                const layer = {
                    id: result.id,
                    name: result.name,
                    description: result.description,
                    visible: true,
                    selected: i === 0, // First layer is selected by default
                    annotations: [],
                    color: hexToRgbA(layerColor, 0.7),
                    hexColor: layerColor,
                    bkColor: hexToRgbA(layerColor, 0.15),
                    selColor: hexToRgbA(layerColor, 0.9)
                }

                annLayers.push(layer)
            }

            viewerStore.setAnnotations(annLayers)
            emit('annLayersInitialized')
        }

        annLayerInfo.value = response.results
    }

    const createAnnotationLayer = async (newLayer: NewLayer, activeViewer: ActiveViewer | null, emit?: LayersEmit) => {
        // Guard: ensure activeViewer has required properties
        if (!activeViewer?.content?.id) {
            return null
        }

        try {
            const token = await useToken()
            const url = `${viewerStore.config.apiUrl}/timeseries/${activeViewer.content.id}/layers?api_key=${token}`

            const response = await useSendXhr(url, {
                method: "POST",
                body: {
                    name: newLayer.name,
                    color: newLayer.color,
                    description: newLayer.description || newLayer.name
                }
            }) as CreatedLayerResponse

            // Process the created layer
            const layer = {
                ...response,
                annotations: [],
                hexColor: response.color,
                color: hexToRgbA(response.color, 0.7),
                bkColor: hexToRgbA(response.color, 0.15),
                selColor: hexToRgbA(response.color, 0.9),
                visible: true,
                selected: true
            }

            viewerStore.createLayer(layer)
            viewerStore.setActiveAnnotationLayer(layer.id)

            emitter.emit('toast', {
                detail: {
                    msg: `'${layer.name}' Layer Created`
                }
            })

            return layer
        } catch (error) {
            useHandleXhrError(error)
            throw error
        } finally {
            if (emit) {
                emit('closeAnnotationLayerWindow')
            }
        }
    }

    const updateLayerVisibility = (layerId: number | string, visible: boolean) => {
        const layer = viewerStore.viewerAnnotations.find(l => l.id === layerId)

        if (layer) {
            layer.visible = visible
            viewerStore.updateLayer(layer)
        }
    }

    const selectLayer = (layerId: number | string) => {
        // Deselect all layers
        viewerStore.viewerAnnotations.forEach(layer => {
            layer.selected = false
            viewerStore.updateLayer(layer)
        })

        // Select the target layer
        const layer = viewerStore.viewerAnnotations.find(l => l.id === layerId)
        if (layer) {
            layer.selected = true
            viewerStore.updateLayer(layer)
            viewerStore.setActiveAnnotationLayer(layerId)
        }
    }

    const deleteLayer = async (layerId: number | string, activeViewer: ActiveViewer | null) => {
        if (!activeViewer?.content?.id) {
            return null
        }

        try {
            const token = await useToken()
            const url = `${viewerStore.config.apiUrl}/timeseries/${activeViewer.content.id}/layers/${layerId}?api_key=${token}`

            await useSendXhr(url, { method: "DELETE" })

            // Remove from store. The store action is deleteLayer; the previous
            // removeLayer call named an action that has never existed.
            viewerStore.deleteLayer({ id: layerId })

            emitter.emit('toast', {
                detail: {
                    msg: 'Layer deleted successfully'
                }
            })
        } catch (error) {
            useHandleXhrError(error)
            throw error
        }
    }

    const updateLayerColor = async (layerId: number | string, newColor: string, activeViewer: ActiveViewer | null) => {
        if (!activeViewer?.content?.id) {
            return null
        }

        try {
            const token = await useToken()
            const url = `${viewerStore.config.apiUrl}/timeseries/${activeViewer.content.id}/layers/${layerId}?api_key=${token}`

            const response = await useSendXhr(url, {
                method: "PUT",
                body: { color: newColor }
            })

            // Update in store
            const layer = viewerStore.viewerAnnotations.find(l => l.id === layerId)
            if (layer) {
                layer.hexColor = newColor
                layer.color = hexToRgbA(newColor, 0.7)
                layer.bkColor = hexToRgbA(newColor, 0.15)
                layer.selColor = hexToRgbA(newColor, 0.9)
                viewerStore.updateLayer(layer)
            }

            return response
        } catch (error) {
            useHandleXhrError(error)
            throw error
        }
    }

    const loadLayers = async (activeViewer: ActiveViewer | null, emit: LayersEmit) => {
        // Guard: ensure activeViewer has required properties
        if (!activeViewer?.content?.id) {
            return null
        }

        let response: LayersResponse
        try {
            const token = await useToken()
            const url = `${viewerStore.config.apiUrl}/timeseries/${activeViewer.content.id}/layers?api_key=${token}`
            response = await useSendXhr(url) as LayersResponse
        } catch (error) {
            useHandleXhrError(error)
            throw error
        }

        // Deliberately outside the catch above. A default-layer creation reports its
        // own failure, and one failure must not raise two messages.
        await initializeLayers(response, activeViewer, emit)
        return response
    }

    return {
        annLayerInfo,
        defaultColors,
        initializeLayers,
        createAnnotationLayer,
        updateLayerVisibility,
        selectLayer,
        deleteLayer,
        updateLayerColor,
        loadLayers
    }
}
