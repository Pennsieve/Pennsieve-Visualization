// @/composables/useDataRequests.ts
import { ref, onUnmounted, readonly } from 'vue'
import type { Ref } from 'vue'
import { BASE_PAGE_SIZE } from '@/composables/streaming/paging'
import type { SegmentBlock } from './streaming/segments'
import type { ChannelData, ViewData, ViewDataChannel } from './useTimeSeriesData'
import type { PageRequest, TimeseriesTransport } from '@/transport/TimeseriesTransport'

/** One page request planned for the transport. */
export interface PlannedRequest {
    channels: ChannelData[]
    start: number
    duration: number
    isInViewport: boolean
    pixelWidth: number
}

/** Bookkeeping for a sent page, keyed by page start in `requestedPages`. */
export interface RequestedPageInfo {
    count: number
    counter: Map<string, number>
    subPageCount: number
    ts: number
    inViewport: boolean
}

interface RequestConstants {
    PREFETCHPAGES: number
}

type GetChannelIdFn = (channel: ChannelData | ViewDataChannel) => string

type SegmIndexOfFn = (segmArray: SegmentBlock[], val: number, first: boolean, startAtIndex?: number) => number

export const useDataRequests = () => {
    // State from original
    const aSyncRequests = ref<PlannedRequest[]>([])
    const aSyncPreRequests = ref<PlannedRequest[]>([])
    const prefetchTimer = ref<ReturnType<typeof setInterval> | null>(null)
    const isPrefetching = ref(false)
    const lastViewPageRequest = ref<PlannedRequest | null>(null)

    // Persistent state for viewport tracking (from original)
    const prevStart = ref(0)
    const prevDuration = ref(0)

    // Prefetch function from original
    let preFetchRequestFnc: (() => void) | null = null

    const initializePrefetch = (requestDataFromServer: (requests: PlannedRequest[]) => boolean, requestedPagesRef: Ref<Map<number, RequestedPageInfo>>) => {
        preFetchRequestFnc = function() {
            const nrPending = aSyncPreRequests.value.length
            if (nrPending > 0) {
                const maxPendingPages = 5
                const currentPendingSize = requestedPagesRef.value?.size || 0

                if (currentPendingSize < maxPendingPages) {
                    const success = requestDataFromServer([aSyncPreRequests.value[0]])
                    if (success) {
                        aSyncPreRequests.value.splice(0, 1)
                    } else {
                        console.warn('Prefetch request failed')
                        // Stop prefetching if requests are failing
                        clearInterval(prefetchTimer.value!)
                        isPrefetching.value = false
                    }
                }
            } else {
                clearInterval(prefetchTimer.value!)
                isPrefetching.value = false
            }
        }
    }

    // Generate points (from original requestData logic)
    const generatePoints = (showChannels: ChannelData[], start: number, duration: number, viewData: ViewData, requestedPages: Map<number, RequestedPageInfo>, constants: RequestConstants, rsPeriod: number, ts_end: number, segmIndexOf: SegmIndexOfFn, getChannelIdFn?: GetChannelIdFn, pageSize = BASE_PAGE_SIZE) => {
        viewData.start = start
        viewData.duration = duration

        // Get IDS from viewData channels
        const viewDataChIds = []
        for (let i = 0; i < viewData.channels.length; i++) {
            const channelId = getChannelIdFn ? getChannelIdFn(viewData.channels[i]) : viewData.channels[i].id
            viewDataChIds.push(channelId)
        }

        // Get viewDataChannels
        for (let i = 0; i < showChannels.length; i++) {
            const curShowChannel = showChannels[i]
            const showChannelId = getChannelIdFn ? getChannelIdFn(curShowChannel) : curShowChannel.id
            const idx = viewDataChIds.indexOf(showChannelId)
            if (idx < 0) {
                viewData.channels.push({
                    id: showChannelId,
                    mean: null,
                    firstRenderedIndex: 0,
                    lastRenderedIndex: 0,
                    blocks: []
                })
            }
        }

        return requestData(showChannels, start, duration, viewData, requestedPages, constants, rsPeriod, ts_end, segmIndexOf, getChannelIdFn, pageSize)
    }

    // Request data (from original)
    const requestData = (showChannels: ChannelData[], start: number, duration: number, viewData: ViewData, requestedPages: Map<number, RequestedPageInfo>, constants: RequestConstants, rsPeriod: number, ts_end: number, segmIndexOf: SegmIndexOfFn, getChannelIdFn?: GetChannelIdFn, pageSize = BASE_PAGE_SIZE) => {
        // Init async requests for viewport pages
        aSyncRequests.value = []

        // If we rerender the same viewport --> don't change prefetch
        let updatePrefetchPages = false
        if (prevStart.value !== start || prevDuration.value !== duration) {
            aSyncPreRequests.value = []
            updatePrefetchPages = true
        }

        // Update previous values for next comparison
        prevStart.value = start
        prevDuration.value = duration

        // Timestamp of first value in viewport
        const viewDataChIds = []
        for (let i = 0; i < viewData.channels.length; i++) {
            viewDataChIds.push(viewData.channels[i])
        }

        // Iterate over channels and populate aSyncRequests
        for (let iChan = 0; iChan < showChannels.length; iChan++) {
            let continuationSegment = false
            const curChan = showChannels[iChan]
            const chDataSegments = curChan.segments
            const curChanId = getChannelIdFn ? getChannelIdFn(curChan) : curChan.id

            // Get dataView - find the channel in viewData
            const idx = viewDataChIds.findIndex(ch => {
                const chId = getChannelIdFn ? getChannelIdFn(ch) : ch.id
                return chId === curChanId
            })

            if (idx === -1) {
                continue // Skip this channel if not found in viewData
            }

            const chanViewData = viewData.channels[idx]
            if (!chanViewData) {
                continue // Skip if channel data not found
            }
            chanViewData.blocks = []

            // Populate chanViewData until all data in scope is added
            let curTime = Math.floor(start / pageSize) * pageSize
            if (curTime < 0) {
                curTime = 0
            }

            let firstSegment = 0
            let segmOffset = 0
            if (chDataSegments.length > 0) {
                firstSegment = segmIndexOf(chDataSegments, curTime, true, 0)
            }

            // Iterate over blocks in viewport
            let endRequestTime = start + duration + constants.PREFETCHPAGES * pageSize
            if (endRequestTime > ts_end) {
                endRequestTime = ts_end
            }

            let curSegm: SegmentBlock | undefined
            if (chDataSegments.length > 0) {
                curSegm = chDataSegments[firstSegment]
            }

            while ((curTime < endRequestTime) || continuationSegment) {
                continuationSegment = false

                // Check if current time matches cached page. pageEnd is the exclusive
                // end, and curTime is always a page boundary, so an inclusive test here
                // matches the block of the page before this one and skips requesting it.
                let inRange = false
                if (curSegm) {
                    inRange = curTime >= curSegm.pageStart && curTime < curSegm.pageEnd
                }

                if (inRange) {
                    // Process ALL segments with the same pageStart
                    const currentPageStart = curSegm!.pageStart
                    let processedAnySegment = false
                    
                    // Process all segments in this page
                    while (curSegm && curSegm.pageStart === currentPageStart) {
                        let isViewPage = curSegm.startTs < start + duration
                        
                        // Only add to viewData if segment is not a prefetch page
                        if (isViewPage) {
                            chanViewData.blocks.push(curSegm)
                            processedAnySegment = true
                        }

                        // Move to next segment
                        segmOffset += 1
                        curSegm = chDataSegments[firstSegment + segmOffset]
                    }

                    // Move to next page
                    curTime += pageSize
                    
                    // If we have more segments and they're from the same page, continue processing
                    if (curSegm && curSegm.pageStart === currentPageStart) {
                        continuationSegment = true
                    }
                } else {
                    // Data needs to be requested from server

                    // Check if already being requested
                    if (requestedPages.get(curTime)) {
                        curTime += pageSize
                        if (curSegm && curTime >= curSegm.pageEnd) {
                            while (curSegm && curSegm.pageEnd < curTime) {
                                segmOffset += 1
                                curSegm = chDataSegments[firstSegment + segmOffset]
                                if (!curSegm) {
                                    break
                                }
                            }
                        }
                        continue
                    }

                    // Skip if this page would start after dataset end
                    if (curTime >= ts_end) {
                        curTime += pageSize
                        continue
                    }

                    let isViewPage = curTime < start + duration

                    // Check if requested range is already requested by other channel
                    let isAdded = false
                    if (isViewPage) {
                        // Remove from pre-request
                        for (let iA in aSyncPreRequests.value) {
                            if (aSyncPreRequests.value[iA as unknown as number].start === curTime) {
                                aSyncPreRequests.value.splice(iA as unknown as number, 1)
                                break
                            }
                        }

                        for (let iA in aSyncRequests.value) {
                            if (aSyncRequests.value[iA as unknown as number].start === curTime) {
                                aSyncRequests.value[iA as unknown as number].channels.push(curChan)
                                isAdded = true
                            }
                        }
                        if (!isAdded) {
                            aSyncRequests.value.push({
                                channels: [curChan],
                                start: curTime,
                                duration: pageSize,
                                isInViewport: true,
                                pixelWidth: Math.ceil(rsPeriod)
                            })
                        }
                    } else {
                        if (updatePrefetchPages) {
                            for (let iA in aSyncPreRequests.value) {
                                if (aSyncPreRequests.value[iA as unknown as number].start === curTime) {
                                    aSyncPreRequests.value[iA as unknown as number].channels.push(curChan)
                                    isAdded = true
                                }
                            }
                            if (!isAdded) {
                                aSyncPreRequests.value.push({
                                    channels: [curChan],
                                    start: curTime,
                                    duration: pageSize,
                                    isInViewport: false,
                                    pixelWidth: Math.ceil(rsPeriod)
                                })
                            }
                        }
                    }

                    curTime += pageSize
                    if (curSegm && curTime >= curSegm.pageEnd) {
                        while (curSegm && curSegm.pageEnd < curTime) {
                            segmOffset += 1
                            curSegm = chDataSegments[firstSegment + segmOffset]
                            if (!curSegm) {
                                break
                            }
                        }
                    }
                }
            }

            // Sort the ChannelView pages
            chanViewData.blocks.sort(viewSegmComparator)
        }

        return {
            asyncRequests: aSyncRequests.value,
            asyncPreRequests: aSyncPreRequests.value
        }
    }

    // View segment comparator from original
    const viewSegmComparator = (a: SegmentBlock, b: SegmentBlock) => {
        if (a.startTs < b.startTs) return -1
        if (a.startTs > b.startTs) return 1
        return 0
    }

    // Request data from server (from original) - now accepts ts_end as parameter
    const requestDataFromServer = (requests: PlannedRequest[], firstRequest = 0, transport: TimeseriesTransport, requestedPages: Map<number, RequestedPageInfo>, ts_end: number) => {
        if (requests.length === 0) {
            return false
        }

        const datasetEndTime = ts_end

        for (let i = 0; i < requests.length; i++) {
            let curRequest
            if (i === 0) {
                curRequest = requests[firstRequest]
            } else if (i === firstRequest) {
                curRequest = requests[0]
            } else {
                curRequest = requests[i]
            }

            // Clamp to the recording end
            let requestEndTime = curRequest.start + curRequest.duration

            if (curRequest.start >= datasetEndTime) {
                console.error('Request start time is beyond dataset end:', {
                    requestStart: curRequest.start,
                    datasetEndTime: datasetEndTime
                })
            }

            if (requestEndTime > datasetEndTime) {
                requestEndTime = datasetEndTime
            }

            // An invalid request closes the websocket on the server side; skip it
            if (requestEndTime <= curRequest.start) {
                console.error('Invalid request, endTime <= startTime, skipping:', {
                    startTime: curRequest.start,
                    endTime: requestEndTime,
                    datasetEndTime: datasetEndTime
                })
                continue
            }

            const virtualChannels = curRequest.channels.map(channel => {
                return {
                    // The server expects the serverId; montaged traces keep
                    // their composite label
                    id: channel.serverId || channel.id,
                    name: channel.label || channel.name || ''
                }
            })

            const req: PageRequest = {
                startTime: curRequest.start,
                endTime: requestEndTime,
                pixelWidth: curRequest.pixelWidth,
                minMax: true,
                channels: virtualChannels
            }

            if (transport.requestPage(req)) {
                // Track the request with client channel IDs
                const nrChannels = curRequest.channels.length
                const channelCounter = new Map()
                for (let j = 0; j < nrChannels; j++) {
                    const channelId = curRequest.channels[j].id  // Use unique client id
                    channelCounter.set(channelId, NaN)
                }

                const requestInfo = {
                    count: nrChannels,
                    counter: channelCounter,
                    subPageCount: NaN,
                    ts: Date.now(),
                    inViewport: curRequest.isInViewport
                }

                requestedPages.set(curRequest.start, requestInfo)
            } else {
                console.error('Transport not ready for sending requests:', {
                    status: transport.status.value
                })
                return false
            }
        }

        aSyncRequests.value = []
        return true
    }

    // Start prefetching (from original)
    const startPrefetching = () => {
        if (aSyncPreRequests.value.length > 0) {
            if (!isPrefetching.value) {
                prefetchTimer.value = setInterval(preFetchRequestFnc!, 150)
                isPrefetching.value = true
            }
        }
    }

    // Stop prefetching
    const stopPrefetching = () => {
        if (prefetchTimer.value) {
            clearInterval(prefetchTimer.value)
            prefetchTimer.value = null
        }
        isPrefetching.value = false
    }

    // Clear all requests
    const clearRequests = () => {
        aSyncRequests.value = []
        aSyncPreRequests.value = []
        prevStart.value = 0
        prevDuration.value = 0
        stopPrefetching()
    }

    // Get viewport requests
    const getViewportRequests = () => {
        const requests = aSyncRequests.value.slice()
        aSyncRequests.value = []
        return requests
    }

    // Re-request pages (from original)
    const reRequestPages = (requestedPages: Map<number, RequestedPageInfo>, pageSize: number, rsPeriod: number) => {
        const requestPages: { channels: string[]; start: number; duration: number; isInViewport: boolean; pixelWidth: number }[] = []
        requestedPages.forEach(function(value, key) {
            // Only rerequest pages where we already have partial return
            if (!isNaN(value.subPageCount)) {
                // Only include channels with partial return
                const channels: string[] = []
                value.counter.forEach(function(count, chId) {
                    if (!isNaN(count) && count > 0) {
                        channels.push(chId)
                    }
                })

                if (channels.length > 0) {
                    requestPages.push({
                        channels: channels,
                        start: key,
                        duration: pageSize,
                        isInViewport: true,
                        pixelWidth: Math.ceil(rsPeriod)
                    })
                }
            }
        })

        // Clear requestedPages
        requestedPages.clear()
        return requestPages
    }

    onUnmounted(() => {
        stopPrefetching()
    })

    return {
        // State
        aSyncRequests: readonly(aSyncRequests),
        aSyncPreRequests: readonly(aSyncPreRequests),
        isPrefetching: readonly(isPrefetching),
        lastViewPageRequest: readonly(lastViewPageRequest),

        // Methods
        initializePrefetch,
        generatePoints,
        requestData,
        requestDataFromServer,
        startPrefetching,
        stopPrefetching,
        clearRequests,
        getViewportRequests,
        reRequestPages
    }
}