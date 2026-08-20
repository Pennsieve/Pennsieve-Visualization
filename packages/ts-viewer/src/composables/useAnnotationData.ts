// composables/useAnnotationData.ts
import { ref, inject } from 'vue'
import type { Ref } from 'vue'
import { createViewerStore, type ViewerStore } from '../stores/tsviewer'
import { storeToRefs } from 'pinia'
import { useToken } from "@/composables/useToken"
import { useHandleXhrError } from "@/mixins/request/request_composable"
import { annIndexOf } from '@/utils/annotationUtils'
import type { Annotation, AnnotationLayer, LinkedPackageDTO } from '@/utils/annotationUtils'

interface ViewerChannel {
    id?: string
}

interface ActiveViewer {
    content: { id: string }
}

interface TimeRange {
    start: number
    end: number
}

interface AnnotationResult {
    id: number | string
    label: string
    description?: string
    start: number
    end: number
    channelIds: string[]
    layerId: number | string
    userId?: number | string
    linkedPackage?: string
}

interface AnnotationsResponse {
    annotations?: { results?: AnnotationResult[] }
    linkedPackages?: Record<string, LinkedPackageDTO>
}

interface DataProps {
    tsEnd: number
    constants: { LIMITANNFETCH: number }
}

type DataEmit = (event: 'annotationsReceived') => void

/**
 * Composable for annotation data management.
 * @param storeInstance - Optional store instance. If not provided, will inject from parent or use default.
 */
export function useAnnotationData(storeInstance: ViewerStore | null = null) {
    // Use provided store, inject from parent, or fall back to default
    const viewerStore = storeInstance || inject<ViewerStore | null>('viewerStore', null) || createViewerStore('default')
    const { viewerChannels, viewerAnnotations, viewerMontageScheme } = storeToRefs(viewerStore)

    // Reactive state
    const cachedAnnRange = ref<TimeRange[]>([])
    const annLayerInfo = ref<unknown[]>([])

    const getChannelId = (channel: ViewerChannel) => {
        const isViewingMontage = viewerMontageScheme.value !== 'NOT_MONTAGED'
        let id = channel?.id ?? ''
        if (isViewingMontage) {
            const list = id.split('_')
            id = list.length ? list[0] : id
        }
        return id
    }

    const checkAnnotationRange = async (RStart: number, REnd: number, props: DataProps, activeViewer: ActiveViewer, emit: DataEmit) => {
        const reqRange: TimeRange[] = []
        reqRange.push({ start: RStart, end: props.tsEnd })

        // Check if viewport is cached
        let firstIndex = 0
        for (let i = 0; i < cachedAnnRange.value.length; i++) {
            const curBlock = cachedAnnRange.value[i]
            if (RStart >= curBlock.start && REnd <= curBlock.end) {
                return // annotations in current viewport are cached
            } else if (reqRange[0].start > REnd) {
                break
            } else if (curBlock.start <= reqRange[0].start && curBlock.end >= RStart) {
                firstIndex = i + 1
                reqRange[0].start = curBlock.end
            } else if (curBlock.start > reqRange[0].start) {
                firstIndex = i
                break
            }
        }

        // Check if layers have annotations
        const annotationsTotal = viewerAnnotations.value.reduce((acc, li) => acc + li.annotations.length, 0)

        // If all in memory, return
        if (reqRange[0].start >= reqRange[0].end && annotationsTotal > 0) {
            return
        }

        // Find ranges to request
        const curRequestIndex = 0
        for (let i = firstIndex; i < cachedAnnRange.value.length; i++) {
            if (cachedAnnRange.value[i].start >= reqRange[curRequestIndex].start) {
                reqRange[curRequestIndex].end = cachedAnnRange.value[i].start
                if (cachedAnnRange.value[i].end < REnd) {
                    reqRange.push({ start: cachedAnnRange.value[i].end, end: props.tsEnd })
                } else {
                    break
                }
            }
        }

        if (reqRange[0].start >= reqRange[0].end && annotationsTotal > 0) {
            return
        }

        // Request annotations from server
        if (reqRange.length > 0) {
            const channelIds = viewerChannels.value.map(channel => getChannelId(channel))

            for (const curRange of reqRange) {
                let answered = 0
                let failed = 0

                for (const curLayer of viewerAnnotations.value) {
                    if (!curLayer.id) {
                        console.warn('Layer ID is undefined, skipping annotation request for layer:', curLayer)
                        continue
                    }

                    const endTime = Math.floor(curRange.end)
                    const params = {
                        id: activeViewer.content.id,
                        start: Math.floor(curRange.start),
                        end: endTime,
                        layerId: curLayer.id,
                        limit: props.constants.LIMITANNFETCH
                    }

                    try {
                        const token = await useToken()
                        const apiUrl = viewerStore.config.apiUrl
                        const baseUrl = `${apiUrl}/timeseries/${activeViewer.content.id}/layers/${curLayer.id}/annotations?api_key=${token}`
                        const urlParams = (Object.keys(params) as (keyof typeof params)[]).map(k => `&${k}=${params[k]}`).join('')
                        const url = `${baseUrl}${urlParams}`

                        const response = await fetch(url, {
                            method: 'GET',
                            headers: { 'Content-type': 'application/json' }
                        })

                        if (response.status >= 400) {
                            throw new Error(response.status as unknown as string)
                        }

                        const data = await response.json() as AnnotationsResponse
                        await processAnnotationResponse(data, emit)
                        answered++
                    } catch (err) {
                        useHandleXhrError(err)
                        failed++
                    }
                }

                // A cached span is never requested again. Caching one whose layers
                // failed, or that had no layer to request, would leave its annotations
                // permanently missing.
                if (answered > 0 && failed === 0) {
                    cachedAnnRange.value.push({
                        start: Math.floor(curRange.start),
                        end: Math.floor(curRange.end)
                    })
                }
            }

            // Sort cached ranges
            cachedAnnRange.value.sort((a, b) => {
                if (a.start < b.start) return -1
                if (a.start > b.start) return 1
                return 0
            })
        }
    }

    const processAnnotationResponse = async (response: AnnotationsResponse, emit: DataEmit) => {
        const linkedPackages = response?.linkedPackages ?? {}
        let resp = response?.annotations?.results ?? []

        // Handle pagination limit
        if (resp.length >= 500) {
            let maxStart = 0
            for (const annotation of resp) {
                if (annotation.start > maxStart) {
                    maxStart = annotation.start
                }
            }

            for (const range of cachedAnnRange.value) {
                if (range.end > maxStart && range.start < maxStart) {
                    range.end = maxStart
                    break
                }
            }
        }

        const isViewingMontage = viewerMontageScheme.value !== 'NOT_MONTAGED'

        if (resp.length > 0) {
            const annotations = resp.map(curAnn => {
                const newAnn: Annotation = {
                    name: '',
                    id: curAnn.id,
                    label: curAnn.label,
                    description: curAnn.description,
                    start: curAnn.start,
                    duration: curAnn.end - curAnn.start,
                    end: curAnn.end,
                    cStart: null,
                    cEnd: null,
                    selected: false,
                    channelIds: curAnn.channelIds,
                    allChannels: false,
                    layer_id: curAnn.layerId,
                    userId: curAnn.userId
                }

                if (curAnn.linkedPackage) {
                    const pkgId = curAnn.linkedPackage
                    newAnn.linkedPackage = linkedPackages[pkgId]?.content?.id ?? ''
                    newAnn.linkedPackageDTO = linkedPackages[pkgId]
                }

                // Check if all channels are selected
                if (!isViewingMontage && newAnn.channelIds!.length === viewerChannels.value.length) {
                    newAnn.allChannels = true
                } else if (isViewingMontage && newAnn.channelIds!.length > viewerChannels.value.length) {
                    newAnn.allChannels = true
                }

                return newAnn
            })

            // Update layers with new annotations
            viewerAnnotations.value.forEach(layer => {
                const layerAnns = layer.annotations
                const filteredAnns = annotations.filter(ann => layer.id === ann.layer_id)
                layer.annotations = layerAnns.concat(filteredAnns)
                viewerStore.updateLayer(layer)
            })
        }

        emit('annotationsReceived')
    }

    /** The first annotation starting after `curTime`, or null past the last one. */
    const findNextAnnotation = (curTime: number) => {
        const annLayer = viewerStore.getViewerActiveLayer()
        if (!annLayer?.annotations?.length) return null
        // The last index at or before curTime, so the next one starts after it.
        // A negative index means every annotation starts later, and -1 + 1 is 0.
        const index = annIndexOf(annLayer.annotations, curTime, false)
        return annLayer.annotations[index + 1] ?? null
    }

    /** The last annotation starting before `curTime`, or null before the first one. */
    const findPreviousAnnotation = (curTime: number) => {
        const annLayer = viewerStore.getViewerActiveLayer()
        if (!annLayer?.annotations?.length) return null
        const index = annIndexOf(annLayer.annotations, curTime, true)
        if (index < 0) return null

        // A miss lands on the preceding annotation; an exact hit lands on the
        // first of the annotations starting at curTime, so step back off the run.
        if (annLayer.annotations[index].start < curTime) {
            return annLayer.annotations[index]
        }
        return index > 0 ? annLayer.annotations[index - 1] : null
    }

    return {
        cachedAnnRange,
        annLayerInfo,
        checkAnnotationRange,
        findNextAnnotation,
        findPreviousAnnotation,
        getChannelId
    }
}
