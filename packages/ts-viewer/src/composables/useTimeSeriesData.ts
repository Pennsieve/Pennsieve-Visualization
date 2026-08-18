// @/composables/useTimeSeriesData.ts
import {reactive, ref} from 'vue'
import type { SegmentBlock, SegmentBlockBase } from './streaming/segments'
import type { RequestedPageInfo } from './useDataRequests'
import type { VirtualChannel, VirtualChannelContent } from './useChannelProcessing'
import type { ViewerStore } from '../stores/tsviewer'

/** Per-channel cache entry held in `chData`. `segments` stays sorted by `startTs`. */
export interface ChannelData {
    id: string
    serverId: string
    label: string
    name?: string
    displayName?: string
    type?: string
    selected?: boolean
    visible?: boolean
    segments: SegmentBlock[]
    start?: number
    end?: number
    sampleFreq?: number
    unit?: string
    gaps: number[][]
    dataSegments: number[]
}

/** Fields the renderer writes onto a block when it lands in the viewport. */
export type ViewBlock = SegmentBlock & {
    renderStartIndex?: number
    renderEndIndex?: number
}

export interface ViewDataChannel {
    id: string
    mean?: number | null
    median?: number | null
    firstRenderedIndex?: number
    lastRenderedIndex?: number
    blocks: ViewBlock[]
}

/** Render input: the viewport window and the cached blocks that fall inside it. */
export interface ViewData {
    start: number
    duration: number
    channels: ViewDataChannel[]
}

/** Block payload of a transport message; a legacy gap notice carries only these required fields. */
export interface SegmentMessageData extends Partial<SegmentBlockBase> {
    startTs: number
    pageStart: number
    nrPoints: number
    source?: string
}

export interface SegmentMessage {
    pageStart?: number
    type: 'Continuous' | 'Neural' | 'gap' | 'realtime'
    nrResponses?: number
    data: SegmentMessageData
}

type ChannelStore = Pick<ViewerStore, 'setChannels'>

export const useTimeSeriesData = () => {
    // Data structures from original
    const chData = ref<ChannelData[]>([])
    const requestedPages = ref(new Map<number, RequestedPageInfo>())
    const viewData: ViewData = reactive({
        start: 0,
        duration: 0,
        channels: []
    })

    // State from original
    const channelsReady = ref(false)
    const autoScale = ref(0)
    const globalGaps = ref<number[] | null>(null)
    const currentRequestedSamplePeriod = ref(1)
    const isSwitchingMontage = ref(false)

    // Configuration from original
    const pageSize = 15000000
    const prefetchPages = 3

    // Binary search function from original
    const segmIndexOf = (segmArray: SegmentBlock[], val: number, first: boolean, startAtIndex?: number) => {
        if (!startAtIndex) {
            startAtIndex = 0
        }
        let index = indexOfStart(segmArray, val, startAtIndex, segmArray.length - 1, first)

        if (index === -1) {
            index = 0
        } else if (index < 0) {
            index = -index - 2
        }
        return index
    }

    const indexOfStart = (segmArray: SegmentBlock[], val: number, min: number, max: number, firstIndex: boolean): number => {
        if (max < min) {
            let pred
            if (max >= 0) {
                pred = max
            } else {
                pred = -max - 2
            }
            if (pred === -1) {
                return pred
            }
            const predVal = segmArray[pred].pageStart
            while (pred >= 0 && segmArray[pred].pageStart === predVal) {
                pred--
            }
            pred++
            return -pred - 2
        }

        const mid = parseInt(((min + max) / 2) as unknown as string)

        if (segmArray[mid].pageStart > val) {
            return indexOfStart(segmArray, val, min, mid - 1, firstIndex)
        } else if (segmArray[mid].pageStart < val) {
            return indexOfStart(segmArray, val, mid + 1, max, firstIndex)
        } else {
            let index = mid
            if (firstIndex) {
                while (index >= 0 && segmArray[index].pageStart === val) {
                    index--
                }
                index++
            } else {
                while (index < segmArray.length && segmArray[index].pageStart === val) {
                    index++
                }
                index--
            }
            return index
        }
    }

    // Initialize channels (from original) - now accepts getChannelIdFn as parameter
    const initChannels = (channels: VirtualChannel[] | null | undefined, store: ChannelStore | null | undefined, getChannelIdFn?: (channel: VirtualChannelContent) => string) => {
        if (!channels) {
            return Promise.resolve()
        }

        const chObjects: ChannelData[] = []
        if (channels.length > 0) {
            const channelConfig = []

            for (let ic = 0; ic < channels.length; ic++) {
                const curC = channels[ic].content
                const curId = getChannelIdFn ? getChannelIdFn(curC) : curC.id

                const curChannel = {
                    id: curId,
                    serverId: curC.serverId,
                    label: curC.name,
                    displayName: curC.displayName,
                    type: curC.channelType,
                    segments: [],
                    start: curC.start,
                    end: curC.end,
                    sampleFreq: curC.rate,
                    unit: curC.unit,
                    gaps: [],
                    dataSegments: []
                }

                const label = curChannel.label.split("<->", 3)
                const label_prefix = label[0]
                let label_value: string | number = (label.length > 1) ? parseFloat(label[1]) : 0
                label_value = (isNaN(label_value) ? label[1] : label_value)

                channelConfig.push({
                    id: curChannel.id,
                    serverId: curChannel.serverId,
                    type: curChannel.type,
                    label: curChannel.label,
                    displayName: curChannel.displayName,
                    label_split: label,
                    label_prefix: label_prefix,
                    label_value: label_value,
                    dataSegments: [],
                    rank: ic,
                    visible: true,
                    plotAgainst: null,
                    rowBaseline: null,
                    rowScale: 1,
                    rowAdjust: 0,
                    selected: false,
                    hover: false,
                    unit: curC.unit,
                    sf: curC.rate,
                    filter: {},
                    hideFilter: true,
                    isEditing: false,
                })

                chObjects.push(curChannel)
            }

            // Return channelConfig to be set in store by caller
            if (store) {
                store.setChannels(channelConfig)
            }
        }

        computeSummary(chObjects)
        chData.value = chObjects
        autoScale.value = channels.length
        channelsReady.value = true

        return Promise.resolve()
    }

    // Compute summary (from original)
    const computeSummary = (channels: ChannelData[]) => {
        if (channels.length === 0) {
            globalGaps.value = null
            return
        }
        globalGaps.value = channels[0]?.gaps?.[0] || null
    }

    // Data callback (from original)
    const dataCallback = (obj: SegmentMessage) => {
        // During montage transitions, silently discard stale data from previous config
        if (isSwitchingMontage.value) {
            return
        }

        let curChData: ChannelData | null | undefined = null
        const serverResponseId = obj.data.chId || obj.data.source
        const serverResponseName = obj.data.label || obj.data.name

        // Find an exact match first (serverId + label)
        curChData = chData.value.find(channel =>
            channel.serverId === serverResponseId &&
            channel.label === serverResponseName
        )

        if (!curChData) {
            // Stale response from a previous channel config: discard silently
            return
        }

        switch (obj.type) {
            case 'gap':
            case 'Neural':
            case 'Continuous':
                // Check if data already exists
                let addData = false
                let curSegments = curChData && curChData.segments

                // An empty block with the full block shape is cached like a data block:
                // it records that the page was answered, so the next request pass does
                // not request the same empty span again on every render. A gap notice
                // without a block shape is still skipped.
                const cacheable = obj.type !== 'gap' || (obj.data && Array.isArray(obj.data.parsedData))

                if (curSegments && cacheable) {
                    addData = true
                    if (curSegments.length > 0) {
                        let fIndex = segmIndexOf(curSegments, obj.data.startTs, true, 0)

                        while (curSegments[fIndex] && curSegments[fIndex].pageStart === obj.data.pageStart) {
                            if (curSegments[fIndex].startTs === obj.data.startTs) {
                                // A cached empty block yields to a data block for the same span.
                                if (curSegments[fIndex].nrPoints === 0 && obj.data.nrPoints > 0) {
                                    curSegments.splice(fIndex, 1)
                                } else {
                                    addData = false
                                }
                                break
                            }
                            fIndex++
                        }
                    }
                }

                // Update the request counter for this channel
                let requestedPage = requestedPages.value.get(obj.data.pageStart)
                if (requestedPage) {
                    let countForChannel = requestedPage.counter.get(curChData.id) as number

                    if (isNaN(countForChannel)) {
                        // Handle missing nrResponses field - default to 1 if not provided
                        const expectedResponses = obj.nrResponses !== undefined ? obj.nrResponses : 1
                        countForChannel = expectedResponses
                        requestedPage.counter.set(curChData.id, countForChannel)
                    }

                    if (countForChannel > 0) {
                        countForChannel = countForChannel - 1
                        requestedPage.counter.set(curChData.id, countForChannel)
                    }

                    // Check if page is complete
                    if (countForChannel === 0) {
                        let isComplete = true
                        for (let [chId, count] of requestedPage.counter.entries()) {
                            if (count > 0 || isNaN(count)) {
                                isComplete = false
                                break
                            }
                        }

                        if (isComplete) {
                            requestedPages.value.delete(obj.data.pageStart)
                        }
                    }
                }

                // Add data to cache
                if (addData) {
                    curSegments.push(obj.data as SegmentBlock)
                    curSegments.sort((a, b) => {
                        if (a.startTs < b.startTs) return -1
                        if (a.startTs > b.startTs) return 1
                        return 0
                    })
                }
                break

            case 'realtime':
                break
        }
    }

    // Invalidate cache (from original)
    const invalidate = () => {
        globalGaps.value = []
        requestedPages.value.clear()
        for (let i = 0; i < chData.value.length; i++) {
            chData.value[i].segments = []
        }
        for (let i = 0; i < viewData.channels.length; i++) {
            viewData.channels[i].blocks = []
        }
    }

    // Auto scale (from original) - now accepts cHeight as parameter
    const autoScaleViewData = (cHeight: number) => {
        let sumMedian = 0
        let nrSeg = 0
        let allChannels = viewData.channels

        for (let i = 0; i < allChannels.length; i++) {
            let curBlocks = allChannels[i].blocks
            for (let j = 0; j < curBlocks.length; j++) {
                if (curBlocks[j].type !== 'Continuous') {
                    continue
                }
                // An empty block has no deviation and would turn the average into NaN.
                if (!curBlocks[j].parsedData || curBlocks[j].parsedData[1].length === 0) {
                    continue
                }
                sumMedian += standardDeviation(curBlocks[j].parsedData[1])
                nrSeg++
            }
        }

        const avgStd = sumMedian / nrSeg
        if (!isNaN(avgStd) && cHeight) {
            return (cHeight / allChannels.length) / (2 * avgStd)
        }
        return 1
    }

    // Helper functions from original
    const standardDeviation = (values: Float64Array) => {
        const avg = average(values)
        const squareDiffs = values.map(function(value) {
            const diff = value - avg
            const sqrDiff = diff * diff
            return sqrDiff
        })
        const avgSquareDiff = average(squareDiffs)
        const stdDev = Math.sqrt(avgSquareDiff)
        return stdDev
    }

    const average = (data: Float64Array) => {
        const sum = data.reduce(function(sum, value) {
            return sum + value
        }, 0)
        const avg = sum / data.length
        return avg
    }

    const updateCurrentRequestedSamplePeriod = (rsPeriod: number) => {
        currentRequestedSamplePeriod.value = Math.ceil(rsPeriod)
    }

    /**
     * Whether a block was produced for the viewport's current resolution.
     *
     * `requestedSamplePeriod` echoes the pixelWidth of the request that produced the
     * block. A block from before a zoom changed the resolution is rejected here so it
     * cannot park in the segment cache at the wrong level, where the request pass would
     * treat its page as fulfilled and never replace it. A block without a positive value
     * is accepted: the legacy streaming server does not always fill the field.
     */
    const isDataCurrentForViewport = (segmentData: { requestedSamplePeriod?: number } | null | undefined) => {
        if (!segmentData) {
            return false
        }
        const requested = Number(segmentData.requestedSamplePeriod)
        if (Number.isFinite(requested) && requested > 0 && requested !== currentRequestedSamplePeriod.value) {
            return false
        }
        return true
    }


    return {
        // State
        chData,
        requestedPages,
        viewData,
        channelsReady,
        autoScale,
        globalGaps,

        // Constants
        pageSize,
        prefetchPages,
        currentRequestedSamplePeriod,
        isSwitchingMontage,

        // Methods
        initChannels,
        computeSummary,
        dataCallback,
        invalidate,
        autoScaleViewData,
        segmIndexOf,
        updateCurrentRequestedSamplePeriod,
        isDataCurrentForViewport,

        // Helpers
        standardDeviation,
        average
    }
}