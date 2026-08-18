// composables/useViewerControls.ts
/**
 * Composable for external control of TSViewer instances.
 * Use this in wrapper components or external control panels that need
 * to interact with viewer state.
 *
 * @example
 * // In an external control panel component
 * import { useViewerControls } from '@pennsieve-viz/tsviewer'
 *
 * const controls = useViewerControls('viewer-1')
 *
 * // Read state
 * const channels = controls.channels.value
 * const selectedChannels = controls.selectedChannels.value
 *
 * // Control viewer
 * controls.selectChannels(['channel-1', 'channel-2'])
 * controls.setActiveTool('annotate')
 */

import { computed, readonly } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { StoreGeneric } from 'pinia'
import { createViewerStore } from '../stores/tsviewer'

// TODO(ts-3c): replace with the store type once stores/tsviewer converts
interface ViewerChannel {
    id: string
    selected: boolean
    visible: boolean
    [key: string]: unknown
}

interface LayerAnnotation {
    id: string | number
    [key: string]: unknown
}

interface AnnotationLayer {
    id: string | number
    visible: boolean
    selected: boolean
    annotations: LayerAnnotation[]
    [key: string]: unknown
}

interface ViewerStoreRefs {
    viewerChannels: Ref<ViewerChannel[]>
    viewerAnnotations: Ref<AnnotationLayer[]>
    viewerActiveTool: Ref<string>
    viewerSelectedChannels: ComputedRef<ViewerChannel[]>
    activeAnnotation: Ref<unknown>
    activeAnnotationLayer: Ref<unknown>
    viewerMontageScheme: Ref<string>
    viewerErrors: Ref<unknown>
    config: Ref<Record<string, unknown>>
    activeViewer: Ref<Record<string, unknown>>
}

interface ViewerControlsStore {
    getAnnotationById(id: string): LayerAnnotation | undefined
    getViewerActiveLayer(): AnnotationLayer | null
    setChannels(channels: ViewerChannel[]): void
    updateChannelVisibility(channelId: string, visible: boolean): void
    triggerRerender(cause: string): void
    setActiveAnnotation(annotation: LayerAnnotation): void
    setActiveAnnotationLayer(layerId: string): void
    updateLayer(layer: AnnotationLayer): void
    setActiveTool(tool: string): void
    setViewerConfig(config: Record<string, unknown>): void
    setActiveViewer(viewerData: Record<string, unknown>): void
    resetViewer(): void
}

/**
 * Provides read and write access to a TSViewer instance's state.
 *
 * @param instanceId - The unique identifier of the TSViewer instance
 * @returns Control interface for the viewer
 */
export function useViewerControls(instanceId = 'default') {
    const viewerStore = createViewerStore(instanceId) as ViewerControlsStore

    const {
        viewerChannels,
        viewerAnnotations,
        viewerActiveTool,
        viewerSelectedChannels,
        activeAnnotation,
        activeAnnotationLayer,
        viewerMontageScheme,
        viewerErrors,
        config,
        activeViewer
    } = storeToRefs(viewerStore as unknown as StoreGeneric) as unknown as ViewerStoreRefs

    // ============================================
    // READ-ONLY STATE (for external consumption)
    // ============================================

    /**
     * All channels in the viewer (readonly)
     */
    const channels = readonly(viewerChannels)

    /**
     * Currently selected channels (readonly computed)
     */
    const selectedChannels = computed(() => viewerSelectedChannels.value)

    /**
     * All annotation layers (readonly)
     */
    const annotations = readonly(viewerAnnotations)

    /**
     * Currently active tool (readonly)
     */
    const activeTool = readonly(viewerActiveTool)

    /**
     * Current montage scheme (readonly)
     */
    const montageScheme = readonly(viewerMontageScheme)

    /**
     * Current viewer errors (readonly)
     */
    const errors = readonly(viewerErrors)

    /**
     * Current viewer configuration (readonly)
     */
    const viewerConfig = readonly(config)

    /**
     * Current active viewer data (readonly)
     */
    const viewer = readonly(activeViewer)

    // ============================================
    // STATE QUERIES
    // ============================================

    /**
     * Get a channel by ID
     */
    const getChannel = (channelId: string) => {
        return viewerChannels.value.find(ch => ch.id === channelId)
    }

    /**
     * Get an annotation by ID
     */
    const getAnnotation = (annotationId: string): LayerAnnotation | undefined => {
        return viewerStore.getAnnotationById(annotationId)
    }

    /**
     * Get the currently active annotation layer
     */
    const getActiveLayer = (): AnnotationLayer | null => {
        return viewerStore.getViewerActiveLayer()
    }

    /**
     * Get visible channels
     */
    const getVisibleChannels = () => {
        return viewerChannels.value.filter(ch => ch.visible)
    }

    /**
     * Get current viewer state snapshot
     */
    const getState = () => ({
        channels: viewerChannels.value,
        selectedChannels: viewerSelectedChannels.value,
        annotations: viewerAnnotations.value,
        activeLayer: viewerStore.getViewerActiveLayer(),
        activeTool: viewerActiveTool.value,
        montageScheme: viewerMontageScheme.value,
        errors: viewerErrors.value
    })

    // ============================================
    // CHANNEL CONTROLS
    // ============================================

    /**
     * Select channels by ID
     * @param channelIds - Array of channel IDs to select
     * @param append - If true, add to selection; if false, replace selection
     */
    const selectChannels = (channelIds: string[], append = false) => {
        const channels = viewerChannels.value.map(channel => ({
            ...channel,
            selected: append ? channel.selected : false
        }))

        channels.forEach(channel => {
            if (channelIds.includes(channel.id)) {
                channel.selected = true
            }
        })

        viewerStore.setChannels(channels)
    }

    /**
     * Clear all channel selections
     */
    const clearChannelSelection = () => {
        const channels = viewerChannels.value.map(channel => ({
            ...channel,
            selected: false
        }))
        viewerStore.setChannels(channels)
    }

    /**
     * Toggle channel visibility
     */
    const toggleChannelVisibility = (channelId: string) => {
        const channel = viewerChannels.value.find(ch => ch.id === channelId)
        if (channel) {
            viewerStore.updateChannelVisibility(channelId, !channel.visible)
            viewerStore.triggerRerender('channel-visibility')
        }
    }

    /**
     * Set channel visibility
     */
    const setChannelVisibility = (channelId: string, visible: boolean) => {
        viewerStore.updateChannelVisibility(channelId, visible)
        viewerStore.triggerRerender('channel-visibility')
    }

    /**
     * Show all channels
     */
    const showAllChannels = () => {
        viewerChannels.value.forEach(channel => {
            viewerStore.updateChannelVisibility(channel.id, true)
        })
        viewerStore.triggerRerender('channel-visibility')
    }

    /**
     * Hide all channels
     */
    const hideAllChannels = () => {
        viewerChannels.value.forEach(channel => {
            viewerStore.updateChannelVisibility(channel.id, false)
        })
        viewerStore.triggerRerender('channel-visibility')
    }

    // ============================================
    // ANNOTATION CONTROLS
    // ============================================

    /**
     * Select an annotation by ID
     */
    const selectAnnotation = (annotationId: string) => {
        const annotation = viewerStore.getAnnotationById(annotationId)
        if (annotation) {
            viewerStore.setActiveAnnotation(annotation)
        }
    }

    /**
     * Set the active annotation layer
     */
    const setActiveLayer = (layerId: string) => {
        viewerStore.setActiveAnnotationLayer(layerId)
    }

    /**
     * Toggle annotation layer visibility
     */
    const toggleLayerVisibility = (layerId: string) => {
        const layer = viewerAnnotations.value.find(l => l.id === layerId)
        if (layer) {
            layer.visible = !layer.visible
            viewerStore.updateLayer(layer)
            viewerStore.triggerRerender('layer-visibility')
        }
    }

    // ============================================
    // TOOL CONTROLS
    // ============================================

    /**
     * Set the active tool
     */
    const setActiveTool = (tool: 'pointer' | 'pan' | 'annotate') => {
        viewerStore.setActiveTool(tool)
    }

    // ============================================
    // VIEWER CONTROLS
    // ============================================

    /**
     * Set viewer configuration
     */
    const setConfig = (newConfig: Record<string, unknown>) => {
        viewerStore.setViewerConfig(newConfig)
    }

    /**
     * Set the active viewer data
     */
    const setActiveViewer = (viewerData: Record<string, unknown>) => {
        viewerStore.setActiveViewer(viewerData)
    }

    /**
     * Trigger a re-render
     * @param cause - Reason for the re-render
     */
    const triggerRerender = (cause = 'external') => {
        viewerStore.triggerRerender(cause)
    }

    /**
     * Reset the viewer state
     */
    const reset = () => {
        viewerStore.resetViewer()
    }

    // ============================================
    // RETURN PUBLIC API
    // ============================================

    return {
        // Readonly state
        channels,
        selectedChannels,
        annotations,
        activeTool,
        montageScheme,
        errors,
        viewerConfig,
        viewer,

        // State queries
        getChannel,
        getAnnotation,
        getActiveLayer,
        getVisibleChannels,
        getState,

        // Channel controls
        selectChannels,
        clearChannelSelection,
        toggleChannelVisibility,
        setChannelVisibility,
        showAllChannels,
        hideAllChannels,

        // Annotation controls
        selectAnnotation,
        setActiveLayer,
        toggleLayerVisibility,

        // Tool controls
        setActiveTool,

        // Viewer controls
        setConfig,
        setActiveViewer,
        triggerRerender,
        reset,

        // Direct store access (for advanced use cases)
        store: viewerStore
    }
}
