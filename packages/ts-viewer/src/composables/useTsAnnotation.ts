// composables/useTsAnnotation.ts

import { computed, inject } from 'vue'
import type { Ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { StoreGeneric } from 'pinia'
import { useHandleXhrError } from '@/mixins/request/request_composable'
import { useToken } from '@/composables/useToken'
import { createViewerStore } from '../stores/tsviewer'
import type { Annotation, AnnotationLayer } from '@/utils/annotationUtils'

interface ViewerChannel {
    id?: string
    selected?: boolean
    visible?: boolean
}

// TODO(ts-3c): replace with the store type once stores/tsviewer converts
interface ViewerStore {
    activeViewer: { channels: ViewerChannel[]; content: { id: string } }
    config: { apiUrl: string }
    createAnnotation(annotation: Annotation): void
    updateAnnotation(annotation: Annotation): void
    deleteAnnotation(annotation: Annotation): void
}

interface AnnotationApiResult {
    id: number | string
    label: string
    description?: string
    start: number
    end: number
    channelIds?: string[]
    userId?: number | string
    linkedPackage?: string
}

/**
 * Composable for annotation CRUD operations.
 * @param storeInstance - Optional store instance. If not provided, will inject from parent or use default.
 */
export function useTsAnnotation(storeInstance: ViewerStore | null = null) {
    // Use provided store, inject from parent, or fall back to default
    const viewerStore = (storeInstance || inject<ViewerStore | null>('viewerStore', null) || createViewerStore('default')) as unknown as ViewerStore
    const { viewerChannels, viewerAnnotations, activeAnnotation } = storeToRefs(viewerStore as unknown as StoreGeneric) as unknown as {
        viewerChannels: Ref<ViewerChannel[]>
        viewerAnnotations: Ref<AnnotationLayer[]>
        activeAnnotation: Ref<Partial<Annotation>>
    }

    // Helper function to get channel ID
    const getChannelId = (channel: ViewerChannel) => {
        let id = channel.id || ''
        return id
    }

    // Sort annotations helper
    const sortAnns = (annArray: Annotation[]) => {
        annArray.sort(function Comparator(a, b) {
            if (a.start < b.start) return -1
            if (a.start > b.start) return 1
            return 0
        })
    }

    // Add annotation function with Pinia store usage
    const addAnnotation = async (annotation: Partial<Annotation> | null = null) => {
        // Use passed annotation or fall back to store
        const annotationData = annotation || activeAnnotation.value

        // Validate annotation data
        if (!annotationData || !annotationData.layer_id) {
            // @ts-expect-error lib ES2020 omits the TypeError options parameter
            throw new TypeError("Missing annotation data or layer_id", annotationData)
        }

        // Assert that we only call this function on annotations without an existing ID
        if (annotationData.id) {
            // @ts-expect-error lib ES2020 omits the TypeError options parameter
            throw new TypeError("Trying to create an annotation that already exists", annotationData.id)
        }

        let start = annotationData.start
        let duration = annotationData.duration || (annotationData.end! - annotationData.start!)
        const label = annotationData.label
        const description = annotationData.description
        const layer_id = annotationData.layer_id

        // Validate required fields
        if (!label) {
            throw new Error("Annotation label is required")
        }
        if (start === undefined || start === null) {
            throw new Error("Annotation start time is required")
        }

        // Correct negative durations
        if (duration < 0) {
            duration = -duration
            start = start - duration
        }

        // FIX: Use Pinia store for channelIds logic
        let channelIds: string[] = []

        if (annotationData.allChannels) {
            // When allChannels is true, include all channels (even if they are currently not visible)
            const allChannels = viewerStore.activeViewer.channels
            for (let ch = 0; ch < allChannels.length; ch++) {
                const curChannel = allChannels[ch]
                const id = getChannelId(curChannel)
                channelIds.push(id)
            }
        } else if (annotationData.channelIds && Array.isArray(annotationData.channelIds) && annotationData.channelIds.length > 0) {
            // Use provided channelIds if they exist and are not empty
            channelIds = annotationData.channelIds
        } else {
            // Fallback: compute from selected channels
            for (let ch = 0; ch < viewerChannels.value.length; ch++) {
                const curChannelView = viewerChannels.value[ch]
                if (curChannelView.selected && curChannelView.visible) {
                    const id = getChannelId(curChannelView)
                    channelIds.push(id)
                }
            }
        }

        // Create API payload that matches server expectations
        const apiPayload = {
            label: label,
            name: label,
            description: description || '',
            start: Math.floor(start),
            end: Math.floor(start + duration),
            channelIds: channelIds
        }

        // Use correct property for timeseries ID
        const timeseriesId = viewerStore.activeViewer.content.id
        const url = `${viewerStore.config.apiUrl}/timeseries/${timeseriesId}/layers/${layer_id}/annotations`

        try {
            // Use useToken() directly
            const token = await useToken()

            const response = await fetch(`${url}?api_key=${token}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(apiPayload)
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`HTTP ${response.status}: ${errorText}`)
            }

            const result = await response.json() as AnnotationApiResult

            const newAnn: Annotation = {
                name: '',
                id: result.id,
                label: result.label,
                description: result.description,
                start: result.start,
                duration: result.end - result.start,
                end: result.end,
                cStart: null,
                cEnd: null,
                selected: true,
                channelIds: result.channelIds || channelIds,
                allChannels: channelIds.length === 0 || channelIds.length >= viewerChannels.value.length, // Use Pinia
                layer_id: layer_id,
                userId: result.userId
            }

            if (result.linkedPackage) {
                newAnn.linkedPackage = result.linkedPackage
            }

            // Find layer and add annotation - Use Pinia store
            let curLIndex = 0
            for (let i = 0; i < viewerAnnotations.value.length; i++) {
                if (viewerAnnotations.value[i].id === layer_id) {
                    curLIndex = i
                    break
                }
            }

            // Use Pinia store methods
            viewerStore.createAnnotation(newAnn)
            if (viewerAnnotations.value[curLIndex] && viewerAnnotations.value[curLIndex].annotations) {
                sortAnns(viewerAnnotations.value[curLIndex].annotations)
            }

            return newAnn
        } catch (error) {
            console.error('Error creating annotation:', error)
            useHandleXhrError(error)
            throw error
        }
    }

    // Update annotation function with Pinia store usage
    const updateAnnotation = async (annotation: Partial<Annotation> | null = null) => {
        // Use passed annotation or fall back to store
        const annotationData = annotation || activeAnnotation.value

        if (!annotationData.id) {
            // @ts-expect-error lib ES2020 omits the TypeError options parameter
            throw new TypeError("Trying to update an annotation that doesn't exist on server", annotationData.id)
        }

        if (!annotationData.layer_id) {
            // @ts-expect-error lib ES2020 omits the TypeError options parameter
            throw new TypeError("Missing layer_id for annotation update", annotationData)
        }

        let start = annotationData.start
        let duration = annotationData.duration || (annotationData.end! - annotationData.start!)

        // Correct negative durations
        if (duration < 0) {
            duration = -duration
            start = start! - duration
        }

        // Create API payload that matches server expectations
        const apiPayload = {
            name: annotationData.label,
            label: annotationData.label,
            description: annotationData.description || '',
            start: Math.floor(start!),
            end: Math.floor(start! + duration),
            channelIds: annotationData.channelIds || []
        }

        const timeseriesId = viewerStore.activeViewer.content.id
        const url = `${viewerStore.config.apiUrl}/timeseries/${timeseriesId}/layers/${annotationData.layer_id}/annotations/${annotationData.id}`

        try {
            const token = await useToken()

            const response = await fetch(`${url}?api_key=${token}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(apiPayload)
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`HTTP ${response.status}: ${errorText}`)
            }

            const result = await response.json() as AnnotationApiResult

            // Update the annotation with server response
            const updatedAnnotation = {
                ...annotationData,
                ...result,
                duration: result.end - result.start
            }

            // Use Pinia store method
            viewerStore.updateAnnotation(updatedAnnotation)
            return result
        } catch (error) {
            console.error('Error updating annotation:', error)
            useHandleXhrError(error)
            throw error
        }
    }

    // Remove annotation function with Pinia store usage
    const removeAnnotation = async (annotation: Annotation) => {
        if (!annotation || !annotation.id) {
            // @ts-expect-error lib ES2020 omits the TypeError options parameter
            throw new TypeError("Invalid annotation for deletion", annotation)
        }

        let annLayerId: number | string | undefined = ''
        if (annotation.layer) {
            annLayerId = annotation.layer.id
        } else {
            annLayerId = annotation.layer_id
        }

        if (!annLayerId) {
            // @ts-expect-error lib ES2020 omits the TypeError options parameter
            throw new TypeError("Missing layer_id for annotation deletion", annotation)
        }

        const timeseriesId = viewerStore.activeViewer.content.id
        const url = `${viewerStore.config.apiUrl}/timeseries/${timeseriesId}/layers/${annLayerId}/annotations/${annotation.id}`

        try {
            const token = await useToken()

            const response = await fetch(`${url}?api_key=${token}`, {
                method: 'DELETE',
                headers: {
                    'Accept': 'application/json'
                }
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`HTTP ${response.status}: ${errorText}`)
            }

            // Use Pinia store method
            viewerStore.deleteAnnotation(annotation)
            return true
        } catch (error) {
            console.error('Error deleting annotation:', error)
            useHandleXhrError(error)
            throw error
        }
    }

    // Return the public API
    return {
        // Computed properties
        viewerChannels, // Now from Pinia
        viewerAnnotations, // Now from Pinia

        // Methods
        addAnnotation,
        updateAnnotation,
        removeAnnotation,
        sortAnns,
        getChannelId
    }
}
