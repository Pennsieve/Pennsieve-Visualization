// Characterization tests: pin the page-grid walk in generatePoints before the
// architecture refactor. Assertions are plain page-start arrays.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useDataRequests } from './useDataRequests'
import type { RequestedPageInfo } from './useDataRequests'
import { useTimeSeriesData } from './useTimeSeriesData'
import type { ChannelData, ViewData } from './useTimeSeriesData'
import { BASE_PAGE_SIZE } from './streaming/paging'
import type { ContinuousSegmentBlock } from './streaming/segments'

const PAGE = BASE_PAGE_SIZE
const TS_END = 100 * PAGE
const constants = { PREFETCHPAGES: 2 }

const block = (overrides: Partial<ContinuousSegmentBlock> = {}): ContinuousSegmentBlock => ({
    chId: 'ch-1',
    label: 'CH1',
    name: 'CH1',
    samplePeriod: 1000,
    requestedSamplePeriod: 1,
    pageStart: 0,
    pageEnd: PAGE,
    startTs: 0,
    type: 'Continuous',
    nrPoints: 3,
    parsedData: [new Float64Array(3), new Float64Array(3), new Float64Array(3)],
    cData: [new Float32Array(3), new Float32Array(3), new Float32Array(3)],
    nrValidPoints: 3,
    sumElem: 0,
    median: 0,
    isMinMax: true,
    unit: 'uV',
    unitM: 1,
    lastUsed: 0,
    ...overrides
})

const channel = (overrides: Partial<ChannelData> = {}): ChannelData => ({
    id: 'ch-1',
    serverId: 'srv-1',
    label: 'CH1',
    segments: [],
    gaps: [],
    dataSegments: [],
    ...overrides
})

const emptyViewData = (): ViewData => ({ start: 0, duration: 0, channels: [] })

const pageInfo = (): RequestedPageInfo => ({
    count: 1,
    counter: new Map([['ch-1', NaN]]),
    subPageCount: NaN,
    ts: 0,
    inViewport: true
})

const starts = (requests: { start: number }[]) => requests.map(r => r.start)

const setup = () => {
    const dr = useDataRequests()
    const { segmIndexOf } = useTimeSeriesData()
    return { dr, segmIndexOf }
}

// useDataRequests registers onUnmounted outside a component, which logs a Vue warning.
beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('generatePoints', () => {
    it('requests each viewport page and queues PREFETCHPAGES pages behind it', () => {
        const { dr, segmIndexOf } = setup()
        const viewData = emptyViewData()
        const requestedPages = new Map<number, RequestedPageInfo>()

        const result = dr.generatePoints(
            [channel()], 0, 2 * PAGE, viewData, requestedPages, constants, 250.4, TS_END, segmIndexOf
        )

        expect(starts(result.asyncRequests)).toEqual([0, PAGE])
        expect(starts(result.asyncPreRequests)).toEqual([2 * PAGE, 3 * PAGE])
        expect(result.asyncRequests.every(r => r.isInViewport)).toBe(true)
        expect(result.asyncPreRequests.every(r => !r.isInViewport)).toBe(true)
        expect(result.asyncRequests.every(r => r.duration === PAGE)).toBe(true)
        expect(result.asyncRequests[0].pixelWidth).toBe(251)

        expect(viewData.start).toBe(0)
        expect(viewData.duration).toBe(2 * PAGE)
        expect(viewData.channels.map(c => c.id)).toEqual(['ch-1'])
    })

    it('skips pages already in flight', () => {
        const { dr, segmIndexOf } = setup()
        const requestedPages = new Map<number, RequestedPageInfo>()
        requestedPages.set(PAGE, pageInfo())
        requestedPages.set(2 * PAGE, pageInfo())

        const result = dr.generatePoints(
            [channel()], 0, 2 * PAGE, emptyViewData(), requestedPages, constants, 250, TS_END, segmIndexOf
        )

        expect(starts(result.asyncRequests)).toEqual([0])
        expect(starts(result.asyncPreRequests)).toEqual([3 * PAGE])
    })

    it('copies cached segments into the view blocks and requests only the missing pages', () => {
        const { dr, segmIndexOf } = setup()
        const cached = block()
        const ch = channel({ segments: [cached] })
        const viewData = emptyViewData()

        const result = dr.generatePoints(
            [ch], 0, 2 * PAGE, viewData, new Map(), constants, 250, TS_END, segmIndexOf
        )

        expect(viewData.channels[0].blocks).toEqual([cached])
        expect(starts(result.asyncRequests)).toEqual([PAGE])
        expect(starts(result.asyncPreRequests)).toEqual([2 * PAGE, 3 * PAGE])
    })

    it('requests the viewport page when only the page before it is cached', () => {
        const { dr, segmIndexOf } = setup()
        // A block for the page that ends exactly where the viewport's page begins.
        const previous = block({ pageStart: 0, pageEnd: PAGE, startTs: 0 })
        const ch = channel({ segments: [previous] })
        const viewData = emptyViewData()

        const result = dr.generatePoints(
            [ch], PAGE, PAGE, viewData, new Map(), constants, 250, TS_END, segmIndexOf
        )

        expect(starts(result.asyncRequests)).toContain(PAGE)
        expect(viewData.channels[0].blocks).not.toContain(previous)
    })

    it('requests both pages when the viewport straddles a page boundary', () => {
        const { dr, segmIndexOf } = setup()

        const result = dr.generatePoints(
            [channel()], 10000000, 10000000, emptyViewData(), new Map(), constants, 250, TS_END, segmIndexOf
        )

        expect(starts(result.asyncRequests)).toEqual([0, PAGE])
        expect(starts(result.asyncPreRequests)).toEqual([2 * PAGE, 3 * PAGE])
    })

    it('adds a second channel to the pending request for a shared page', () => {
        const { dr, segmIndexOf } = setup()
        const chA = channel()
        const chB = channel({ id: 'ch-2', serverId: 'srv-2', label: 'CH2' })

        const result = dr.generatePoints(
            [chA, chB], 0, PAGE, emptyViewData(), new Map(), constants, 250, TS_END, segmIndexOf
        )

        expect(starts(result.asyncRequests)).toEqual([0])
        expect(result.asyncRequests[0].channels.map(c => c.id)).toEqual(['ch-1', 'ch-2'])
        expect(starts(result.asyncPreRequests)).toEqual([PAGE, 2 * PAGE])
        expect(result.asyncPreRequests[0].channels.map(c => c.id)).toEqual(['ch-1', 'ch-2'])
    })

    it('keeps the prefetch queue when the same viewport renders again', () => {
        const { dr, segmIndexOf } = setup()
        const ch = channel()
        const viewData = emptyViewData()
        const requestedPages = new Map<number, RequestedPageInfo>()

        dr.generatePoints([ch], 0, 2 * PAGE, viewData, requestedPages, constants, 250, TS_END, segmIndexOf)
        const second = dr.generatePoints(
            [ch], 0, 2 * PAGE, viewData, requestedPages, constants, 250, TS_END, segmIndexOf
        )

        expect(starts(second.asyncRequests)).toEqual([0, PAGE])
        expect(starts(second.asyncPreRequests)).toEqual([2 * PAGE, 3 * PAGE])
        expect(second.asyncPreRequests.every(r => r.channels.length === 1)).toBe(true)
    })

    it('rebuilds the prefetch queue when the viewport moves', () => {
        const { dr, segmIndexOf } = setup()
        const ch = channel()
        const viewData = emptyViewData()
        const requestedPages = new Map<number, RequestedPageInfo>()

        dr.generatePoints([ch], 0, 2 * PAGE, viewData, requestedPages, constants, 250, TS_END, segmIndexOf)
        const second = dr.generatePoints(
            [ch], 4 * PAGE, 2 * PAGE, viewData, requestedPages, constants, 250, TS_END, segmIndexOf
        )

        expect(starts(second.asyncRequests)).toEqual([4 * PAGE, 5 * PAGE])
        expect(starts(second.asyncPreRequests)).toEqual([6 * PAGE, 7 * PAGE])
    })

    it('stops queueing pages at the recording end', () => {
        const { dr, segmIndexOf } = setup()
        const tsEnd = PAGE + PAGE / 2

        const result = dr.generatePoints(
            [channel()], 0, PAGE, emptyViewData(), new Map(), constants, 250, tsEnd, segmIndexOf
        )

        expect(starts(result.asyncRequests)).toEqual([0])
        expect(starts(result.asyncPreRequests)).toEqual([PAGE])
    })

    it('keeps cached prefetch pages out of the view blocks', () => {
        const { dr, segmIndexOf } = setup()
        const cached = block({ pageStart: 2 * PAGE, pageEnd: 3 * PAGE, startTs: 2 * PAGE })
        const ch = channel({ segments: [cached] })
        const viewData = emptyViewData()

        const result = dr.generatePoints(
            [ch], 0, PAGE, viewData, new Map(), constants, 250, TS_END, segmIndexOf
        )

        expect(viewData.channels[0].blocks).toEqual([])
        expect(starts(result.asyncRequests)).toEqual([0])
        expect(starts(result.asyncPreRequests)).toEqual([PAGE])
    })
})
