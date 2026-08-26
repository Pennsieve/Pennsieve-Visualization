// Characterization tests: pin the response loop in dataCallback before the
// architecture refactor. Envelopes match on serverId plus label; the page
// counters key on the client channel id.
import { describe, it, expect } from 'vitest'
import { useTimeSeriesData } from './useTimeSeriesData'
import type { SegmentMessageData } from './useTimeSeriesData'
import type { RequestedPageInfo } from './useDataRequests'
import type { ContinuousSegmentBlock } from './streaming/segments'

const PAGE = 15000000

const block = (overrides: Partial<ContinuousSegmentBlock> = {}): ContinuousSegmentBlock => ({
    chId: 'srv-1',
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

const emptyBlock = (overrides: Partial<ContinuousSegmentBlock> = {}) => block({
    nrPoints: 0,
    nrValidPoints: 0,
    samplePeriod: 0,
    parsedData: [new Float64Array(0), new Float64Array(0), new Float64Array(0)],
    cData: [new Float32Array(0), new Float32Array(0), new Float32Array(0)],
    ...overrides
})

const pageInfo = (channelIds: string[]): RequestedPageInfo => ({
    count: channelIds.length,
    counter: new Map(channelIds.map(id => [id, NaN])),
    subPageCount: NaN,
    ts: 0,
    inViewport: true
})

const setup = () => {
    const ts = useTimeSeriesData()
    ts.chData.value = [
        { id: 'ch-1', serverId: 'srv-1', label: 'CH1', segments: [], gaps: [], dataSegments: [] },
        { id: 'ch-2', serverId: 'srv-2', label: 'CH2', segments: [], gaps: [], dataSegments: [] }
    ]
    return ts
}

describe('dataCallback', () => {
    it('inserts arriving blocks sorted by startTs', () => {
        const ts = setup()
        ts.dataCallback({
            pageStart: PAGE, type: 'Continuous', nrResponses: 1,
            data: block({ pageStart: PAGE, pageEnd: 2 * PAGE, startTs: PAGE })
        })
        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 1, data: block({ startTs: 5000000 }) })
        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 1, data: block({ startTs: 0 }) })

        expect(ts.chData.value[0].segments.map(s => s.startTs)).toEqual([0, 5000000, PAGE])
    })

    it('places a block carrying a cached startTs after the block already held', () => {
        const ts = setup()
        ts.dataCallback({
            pageStart: 0, type: 'Continuous', nrResponses: 1,
            data: block({ pageStart: 0, pageEnd: PAGE, startTs: PAGE })
        })
        ts.dataCallback({
            pageStart: PAGE, type: 'Continuous', nrResponses: 1,
            data: block({ pageStart: PAGE, pageEnd: 2 * PAGE, startTs: PAGE })
        })

        expect(ts.chData.value[0].segments.map(s => s.pageStart)).toEqual([0, PAGE])
    })

    it('drops a duplicate block for a span already cached', () => {
        const ts = setup()
        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 1, data: block() })
        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 1, data: block() })

        expect(ts.chData.value[0].segments).toHaveLength(1)
    })

    it('counts down per channel and removes the page entry when every channel drains', () => {
        const ts = setup()
        ts.requestedPages.value.set(0, pageInfo(['ch-1', 'ch-2']))

        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 2, data: block({ startTs: 0 }) })
        expect(ts.requestedPages.value.get(0)!.counter.get('ch-1')).toBe(1)

        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 2, data: block({ startTs: 5000000 }) })
        expect(ts.requestedPages.value.get(0)!.counter.get('ch-1')).toBe(0)
        expect(ts.requestedPages.value.has(0)).toBe(true)

        ts.dataCallback({
            pageStart: 0, type: 'Continuous', nrResponses: 1,
            data: block({ chId: 'srv-2', label: 'CH2', name: 'CH2' })
        })
        expect(ts.requestedPages.value.has(0)).toBe(false)
    })

    it('treats a missing nrResponses as one expected response', () => {
        const ts = setup()
        ts.requestedPages.value.set(0, pageInfo(['ch-1']))

        ts.dataCallback({ pageStart: 0, type: 'Continuous', data: block() })

        expect(ts.requestedPages.value.has(0)).toBe(false)
    })

    it('caches a full-shape gap envelope and drains its page counter', () => {
        const ts = setup()
        ts.requestedPages.value.set(0, pageInfo(['ch-1']))

        ts.dataCallback({ pageStart: 0, type: 'gap', nrResponses: 1, data: emptyBlock() })

        expect(ts.chData.value[0].segments).toHaveLength(1)
        expect(ts.chData.value[0].segments[0].nrPoints).toBe(0)
        expect(ts.requestedPages.value.has(0)).toBe(false)
    })

    it('drains the counter for a bare gap notice without caching it', () => {
        const ts = setup()
        ts.requestedPages.value.set(0, pageInfo(['ch-1']))

        // pins current behavior; revisit in the refactor
        ts.dataCallback({
            pageStart: 0, type: 'gap', nrResponses: 1,
            data: { chId: 'srv-1', label: 'CH1', startTs: 0, pageStart: 0, nrPoints: 0 }
        })

        expect(ts.chData.value[0].segments).toHaveLength(0)
        expect(ts.requestedPages.value.has(0)).toBe(false)
    })

    it('discards a response that matches no channel and leaves the counter untouched', () => {
        const ts = setup()
        ts.requestedPages.value.set(0, pageInfo(['ch-1']))

        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 1, data: block({ chId: 'srv-9' }) })

        expect(ts.chData.value[0].segments).toHaveLength(0)
        expect(Number.isNaN(ts.requestedPages.value.get(0)!.counter.get('ch-1')!)).toBe(true)
    })

    it('matches a response through the source and name fallback fields', () => {
        const ts = setup()
        const data: SegmentMessageData = { ...block({ chId: '', label: '' }), source: 'srv-1' }

        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 1, data })

        expect(ts.chData.value[0].segments).toHaveLength(1)
    })

    it('discards responses while a montage switch is in progress', () => {
        const ts = setup()
        ts.requestedPages.value.set(0, pageInfo(['ch-1']))
        ts.isSwitchingMontage.value = true

        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 1, data: block() })

        expect(ts.chData.value[0].segments).toHaveLength(0)
        expect(Number.isNaN(ts.requestedPages.value.get(0)!.counter.get('ch-1')!)).toBe(true)
    })
})

describe('dataCallback channel matching', () => {
    it('routes to the row whose label matches when two rows share a server id', () => {
        const ts = useTimeSeriesData()
        ts.chData.value = [
            { id: 'ch-1', serverId: 'srv-1', label: 'Fp1<->F7', segments: [], gaps: [], dataSegments: [] },
            { id: 'ch-2', serverId: 'srv-1', label: 'Fp1<->F3', segments: [], gaps: [], dataSegments: [] }
        ]

        ts.dataCallback({
            pageStart: 0, type: 'Continuous', nrResponses: 1,
            data: block({ chId: 'srv-1', label: 'Fp1<->F3', name: 'Fp1<->F3' })
        })

        expect(ts.chData.value[0].segments).toHaveLength(0)
        expect(ts.chData.value[1].segments).toHaveLength(1)
    })

    it('routes to the replacement rows after the channel set is rebuilt', () => {
        const ts = setup()
        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 1, data: block() })
        expect(ts.chData.value[0].segments).toHaveLength(1)

        // Same length, different channels: a montage switch replaces the array.
        ts.chData.value = [
            { id: 'ch-3', serverId: 'srv-3', label: 'CH3', segments: [], gaps: [], dataSegments: [] },
            { id: 'ch-4', serverId: 'srv-4', label: 'CH4', segments: [], gaps: [], dataSegments: [] }
        ]

        ts.dataCallback({
            pageStart: 0, type: 'Continuous', nrResponses: 1,
            data: block({ chId: 'srv-4', label: 'CH4', name: 'CH4' })
        })

        expect(ts.chData.value[1].segments).toHaveLength(1)
    })

    it('keeps the first row when two rows carry the same server id and label', () => {
        const ts = useTimeSeriesData()
        ts.chData.value = [
            { id: 'ch-1', serverId: 'srv-1', label: 'CH1', segments: [], gaps: [], dataSegments: [] },
            { id: 'ch-2', serverId: 'srv-1', label: 'CH1', segments: [], gaps: [], dataSegments: [] }
        ]

        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 1, data: block() })

        expect(ts.chData.value[0].segments).toHaveLength(1)
        expect(ts.chData.value[1].segments).toHaveLength(0)
    })
})

describe('isDataCurrentForViewport after a resolution change', () => {
    it('rejects a block requested at a superseded sample period', () => {
        const ts = setup()
        ts.updateCurrentRequestedSamplePeriod(250)
        ts.updateCurrentRequestedSamplePeriod(500)

        expect(ts.isDataCurrentForViewport(block({ requestedSamplePeriod: 250 }))).toBe(false)
        expect(ts.isDataCurrentForViewport(block({ requestedSamplePeriod: 500 }))).toBe(true)
    })

    it('matches blocks against the ceiling of the updated sample period', () => {
        const ts = setup()
        ts.updateCurrentRequestedSamplePeriod(250.4)

        expect(ts.isDataCurrentForViewport(block({ requestedSamplePeriod: 251 }))).toBe(true)
        expect(ts.isDataCurrentForViewport(block({ requestedSamplePeriod: 250 }))).toBe(false)
    })
})
