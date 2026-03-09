// composables/useViewerControls.js
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
import { storeToRefs } from 'pinia'
import { createViewerStore } from '../stores/tsviewer'

/**
 * Provides read and write access to a TSViewer instance's state.
 *
 * @param {string} instanceId - The unique identifier of the TSViewer instance
 * @returns {Object} Control interface for the viewer
 */
export function useViewerControls(instanceId = 'default') {
    const viewerStore = createViewerStore(instanceId)

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
    } = storeToRefs(viewerStore)

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
     * @param {string} channelId
     * @returns {Object|undefined}
     */
    const getChannel = (channelId) => {
        return viewerChannels.value.find(ch => ch.id === channelId)
    }

    /**
     * Get an annotation by ID
     * @param {string} annotationId
     * @returns {Object|undefined}
     */
    const getAnnotation = (annotationId) => {
        return viewerStore.getAnnotationById(annotationId)
    }

    /**
     * Get the currently active annotation layer
     * @returns {Object|null}
     */
    const getActiveLayer = () => {
        return viewerStore.getViewerActiveLayer()
    }

    /**
     * Get visible channels
     * @returns {Array}
     */
    const getVisibleChannels = () => {
        return viewerChannels.value.filter(ch => ch.visible)
    }

    /**
     * Get current viewer state snapshot
     * @returns {Object}
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
     * @param {Array<string>} channelIds - Array of channel IDs to select
     * @param {boolean} append - If true, add to selection; if false, replace selection
     */
    const selectChannels = (channelIds, append = false) => {
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
     * @param {string} channelId
     */
    const toggleChannelVisibility = (channelId) => {
        const channel = viewerChannels.value.find(ch => ch.id === channelId)
        if (channel) {
            viewerStore.updateChannelVisibility(channelId, !channel.visible)
            viewerStore.triggerRerender('channel-visibility')
        }
    }

    /**
     * Set channel visibility
     * @param {string} channelId
     * @param {boolean} visible
     */
    const setChannelVisibility = (channelId, visible) => {
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
     * @param {string} annotationId
     */
    const selectAnnotation = (annotationId) => {
        const annotation = viewerStore.getAnnotationById(annotationId)
        if (annotation) {
            viewerStore.setActiveAnnotation(annotation)
        }
    }

    /**
     * Set the active annotation layer
     * @param {string} layerId
     */
    const setActiveLayer = (layerId) => {
        viewerStore.setActiveAnnotationLayer(layerId)
    }

    /**
     * Toggle annotation layer visibility
     * @param {string} layerId
     */
    const toggleLayerVisibility = (layerId) => {
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
     * @param {'pointer' | 'pan' | 'annotate'} tool
     */
    const setActiveTool = (tool) => {
        viewerStore.setActiveTool(tool)
    }

    // ============================================
    // VIEWER CONTROLS
    // ============================================

    /**
     * Set viewer configuration
     * @param {Object} config
     */
    const setConfig = (newConfig) => {
        viewerStore.setViewerConfig(newConfig)
    }

    /**
     * Set the active viewer data
     * @param {Object} viewerData
     */
    const setActiveViewer = (viewerData) => {
        viewerStore.setActiveViewer(viewerData)
    }

    /**
     * Trigger a re-render
     * @param {string} cause - Reason for the re-render
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
