import { describe, it, expect } from 'vitest'
import { useTimeSeriesData } from './useTimeSeriesData'
import type { ContinuousSegmentBlock } from './streaming/segments'

const block = (overrides: Partial<ContinuousSegmentBlock> = {}): ContinuousSegmentBlock => ({
    chId: 'ch-1',
    label: 'Ch 1',
    name: 'Ch 1',
    samplePeriod: 1000,
    requestedSamplePeriod: 1,
    pageStart: 0,
    pageEnd: 15000000,
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

const setup = () => {
    const ts = useTimeSeriesData()
    ts.chData.value = [{
        id: 'ch-1',
        serverId: 'ch-1',
        label: 'Ch 1',
        segments: [],
        gaps: [],
        dataSegments: []
    }]
    return ts
}

describe('dataCallback', () => {
    it('caches an empty block so its span reads as answered', () => {
        const ts = setup()
        ts.dataCallback({ pageStart: 0, type: 'gap', nrResponses: 1, data: emptyBlock() })
        expect(ts.chData.value[0].segments).toHaveLength(1)
        expect(ts.chData.value[0].segments[0].nrPoints).toBe(0)
    })

    it('does not cache a gap notice without a block shape', () => {
        const ts = setup()
        ts.dataCallback({
            pageStart: 0,
            type: 'gap',
            nrResponses: 1,
            data: { chId: 'ch-1', label: 'Ch 1', startTs: 0, pageStart: 0, nrPoints: 0 }
        })
        expect(ts.chData.value[0].segments).toHaveLength(0)
    })

    it('replaces a cached empty block when data arrives for the same span', () => {
        const ts = setup()
        ts.dataCallback({ pageStart: 0, type: 'gap', nrResponses: 1, data: emptyBlock() })
        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 1, data: block() })
        expect(ts.chData.value[0].segments).toHaveLength(1)
        expect(ts.chData.value[0].segments[0].nrPoints).toBe(3)
    })

    it('keeps the cached data block when an empty block arrives for the same span', () => {
        const ts = setup()
        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 1, data: block() })
        ts.dataCallback({ pageStart: 0, type: 'gap', nrResponses: 1, data: emptyBlock() })
        expect(ts.chData.value[0].segments).toHaveLength(1)
        expect(ts.chData.value[0].segments[0].nrPoints).toBe(3)
    })

    it('drops a duplicate block for a span already cached', () => {
        const ts = setup()
        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 1, data: block() })
        ts.dataCallback({ pageStart: 0, type: 'Continuous', nrResponses: 1, data: block() })
        expect(ts.chData.value[0].segments).toHaveLength(1)
    })
})

describe('isDataCurrentForViewport', () => {
    it('accepts a block whose requested resolution matches the viewport', () => {
        const ts = setup()
        ts.updateCurrentRequestedSamplePeriod(250)
        expect(ts.isDataCurrentForViewport(block({ requestedSamplePeriod: 250 }))).toBe(true)
    })

    it('rejects a block requested at a superseded resolution', () => {
        const ts = setup()
        ts.updateCurrentRequestedSamplePeriod(250)
        expect(ts.isDataCurrentForViewport(block({ requestedSamplePeriod: 251 }))).toBe(false)
    })

    it('accepts a block without a requested resolution', () => {
        const ts = setup()
        ts.updateCurrentRequestedSamplePeriod(250)
        expect(ts.isDataCurrentForViewport(block({ requestedSamplePeriod: undefined }))).toBe(true)
        expect(ts.isDataCurrentForViewport(block({ requestedSamplePeriod: 0 }))).toBe(true)
    })

    it('rejects a missing block', () => {
        const ts = setup()
        expect(ts.isDataCurrentForViewport(null)).toBe(false)
    })
})

describe('autoScaleViewData', () => {
    it('ignores empty blocks when averaging channel deviation', () => {
        const ts = setup()
        ts.viewData.channels.push({
            id: 'ch-1',
            blocks: [
                emptyBlock(),
                block({
                    parsedData: [
                        Float64Array.from([0, 1000, 2000]),
                        Float64Array.from([-1, 1, -1]),
                        Float64Array.from([0, 0, 0])
                    ]
                })
            ]
        })
        const zoom = ts.autoScaleViewData(400)
        expect(Number.isFinite(zoom)).toBe(true)
        expect(zoom).toBeGreaterThan(0)
    })
})
