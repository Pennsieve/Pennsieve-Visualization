import { describe, it, expect } from 'vitest'
import type { EventBatch, Segment } from '@pennsieve/timeseries-zarr-reader'
import { buildContinuousSegm, buildGapSegm, buildNeuralSegm } from './segments'

const CONTINUOUS_KEYS = [
    'chId', 'lastUsed', 'unit', 'samplePeriod', 'requestedSamplePeriod', 'pageStart',
    'pageEnd', 'startTs', 'isMinMax', 'unitM', 'type', 'nrPoints', 'cData', 'parsedData',
    'median', 'sumElem', 'nrValidPoints', 'name', 'label'
]

const NEURAL_KEYS = [
    'chId', 'lastUsed', 'unit', 'samplePeriod', 'requestedSamplePeriod', 'pageStart',
    'pageEnd', 'startTs', 'isMinMax', 'unitM', 'type', 'nrPoints', 'parsedData', 'cData',
    'name', 'label'
]

const identity = { chId: 'ch-1', label: 'Ch 1', clientId: 'ch-1', unit: 'uV' }

const req = (startTime: number, endTime: number) => ({
    session: 'sess',
    packageId: 'pkg',
    startTime,
    endTime,
    pixelWidth: 1000,
    raw: false
})

const rawSegment = (startUs: number, samplePeriodUs: number, values: number[]): Segment => ({
    channel: 'ch-1',
    startUs,
    samplePeriodUs,
    isMinMax: false,
    data: Float64Array.from(values)
})

const minMaxSegment = (startUs: number, samplePeriodUs: number, values: number[]): Segment => ({
    channel: 'ch-1',
    startUs,
    samplePeriodUs,
    isMinMax: true,
    data: Float64Array.from(values)
})

// 512 Hz from a real epoch start: the period is 1953.125 us and the ULP of the timestamp
// is 0.25 us, so any per-sample accumulation in microseconds drifts. A 1000 Hz fixture
// would hide every one of these cases.
const EPOCH = 1704067200000000
const P512 = 1000000 / 512
const PAGE = 15000000
// One ULP of a timestamp this large is 0.25 us, so a bin start that is mathematically a
// multiple of 1953.125 us can only be held to that precision. Seam invariants are stated
// to one ULP; they are still far below one sample period.
const ULP = 0.25

const gridSegment = (firstGlobalBin: number, binCount: number): Segment => ({
    channel: 'ch-1',
    startUs: EPOCH + firstGlobalBin * P512,
    samplePeriodUs: P512,
    isMinMax: false,
    // Sample value == global bin index (negated on the way out), so the assertions can
    // name exactly which bins survived clipping.
    data: Float64Array.from({ length: binCount }, (_, i) => firstGlobalBin + i)
})

describe('buildContinuousSegm', () => {
    it('emits exactly the legacy key set', () => {
        const segm = buildContinuousSegm(rawSegment(0, 1000, [1, 2]), identity, req(0, 2000))
        expect(Object.keys(segm).sort()).toEqual([...CONTINUOUS_KEYS].sort())
    })

    it('carries identity, page bounds and constants through unchanged', () => {
        const segm = buildContinuousSegm(rawSegment(0, 1000, [1, 2]), identity, req(0, 2000))
        expect(segm.chId).toBe('ch-1')
        expect(segm.name).toBe('Ch 1')
        expect(segm.label).toBe('Ch 1')
        expect(segm.unit).toBe('uV')
        expect(segm.lastUsed).toBe(0)
        expect(segm.unitM).toBe(1)
        expect(segm.type).toBe('Continuous')
        expect(segm.samplePeriod).toBe(1000)
    })

    it('sets pageStart to the request startTime exactly (requestedPages key)', () => {
        const request = req(1704067203333333, 1704067218333333)
        const segm = buildContinuousSegm(rawSegment(1704067203333333, 1000, [1]), identity, request)
        expect(segm.pageStart).toBe(request.startTime)
        expect(segm.pageEnd).toBe(request.endTime)
    })

    it('negates y values and lays out raw data on row 1 only', () => {
        const segm = buildContinuousSegm(rawSegment(0, 1000, [1, -2, 3, 4]), identity, req(0, 4000))
        expect(segm.nrPoints).toBe(4)
        expect(segm.isMinMax).toBe(false)
        expect(Array.from(segm.parsedData[0])).toEqual([0, 1000, 2000, 3000])
        expect(Array.from(segm.parsedData[1])).toEqual([-1, 2, -3, -4])
        expect(Array.from(segm.parsedData[2])).toEqual([0, 0, 0, 0])
        expect(segm.sumElem).toBe(-6)
        expect(segm.nrValidPoints).toBe(4)
        expect(segm.startTs).toBe(0)
    })

    it('splits interleaved minMax pairs across rows 1 and 2', () => {
        const segm = buildContinuousSegm(
            minMaxSegment(0, 1000, [1, 2, 3, 4, 5, 6]), identity, req(0, 3000)
        )
        expect(segm.nrPoints).toBe(3)
        expect(segm.isMinMax).toBe(true)
        expect(Array.from(segm.parsedData[0])).toEqual([0, 1000, 2000])
        expect(Array.from(segm.parsedData[1])).toEqual([-1, -3, -5])
        expect(Array.from(segm.parsedData[2])).toEqual([-2, -4, -6])
        // curY + (curY2 - curY) / 2 per pair: -1.5, -3.5, -5.5
        expect(segm.sumElem).toBe(-10.5)
        expect(segm.nrValidPoints).toBe(3)
    })

    it('allocates three zero-filled Float32Array cData rows of nrPoints entries', () => {
        const segm = buildContinuousSegm(rawSegment(0, 1000, [1, 2, 3]), identity, req(0, 3000))
        expect(segm.cData).toHaveLength(3)
        for (const row of segm.cData) {
            expect(row).toBeInstanceOf(Float32Array)
            expect(row).toHaveLength(3)
            expect(Array.from(row)).toEqual([0, 0, 0])
        }
        expect(segm.parsedData[0]).toBeInstanceOf(Float64Array)
    })

    it('skips NaN runs in the raw statistics but keeps them in the row', () => {
        const segm = buildContinuousSegm(
            rawSegment(0, 1000, [1, NaN, 2, NaN, NaN, 3]), identity, req(0, 6000)
        )
        expect(segm.nrPoints).toBe(6)
        expect(segm.nrValidPoints).toBe(3)
        expect(segm.sumElem).toBe(-6)
        expect(Number.isNaN(segm.parsedData[1][1])).toBe(true)
        expect(Number.isNaN(segm.parsedData[1][4])).toBe(true)
        expect(segm.parsedData[1][5]).toBe(-3)
    })

    it('skips NaN pairs in the minMax statistics', () => {
        const segm = buildContinuousSegm(
            minMaxSegment(0, 1000, [NaN, NaN, 1, 2, NaN, NaN, 3, 4]), identity, req(0, 4000)
        )
        expect(segm.nrPoints).toBe(4)
        expect(segm.nrValidPoints).toBe(2)
        expect(segm.sumElem).toBe(-5)
        expect(Number.isNaN(segm.parsedData[1][0])).toBe(true)
        expect(Number.isNaN(segm.parsedData[2][0])).toBe(true)
    })

    it('drops bins before the page and re-anchors startTs', () => {
        const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
        const segm = buildContinuousSegm(rawSegment(0, 1000, values), identity, req(3000, 7000))
        expect(segm.nrPoints).toBe(4)
        expect(segm.startTs).toBe(3000)
        expect(Array.from(segm.parsedData[0])).toEqual([3000, 4000, 5000, 6000])
        expect(Array.from(segm.parsedData[1])).toEqual([-3, -4, -5, -6])
    })

    it('drops the bin that starts exactly at endTime and keeps the one at startTime', () => {
        const values = [0, 1, 2, 3, 4, 5]
        const segm = buildContinuousSegm(rawSegment(0, 1000, values), identity, req(1000, 4000))
        expect(Array.from(segm.parsedData[0])).toEqual([1000, 2000, 3000])
        expect(Array.from(segm.parsedData[1])).toEqual([-1, -2, -3])
    })

    it('clips a segment that starts before the page and overruns its end', () => {
        const values = [0, 1, 2, 3, 4, 5, 6, 7]
        const segm = buildContinuousSegm(rawSegment(-2000, 1000, values), identity, req(0, 3000))
        expect(segm.nrPoints).toBe(3)
        expect(segm.startTs).toBe(0)
        expect(Array.from(segm.parsedData[1])).toEqual([-2, -3, -4])
    })

    it('clips minMax pairs from the correct interleaved offset', () => {
        const segm = buildContinuousSegm(
            minMaxSegment(0, 1000, [1, 2, 3, 4, 5, 6, 7, 8]), identity, req(2000, 4000)
        )
        expect(segm.nrPoints).toBe(2)
        expect(Array.from(segm.parsedData[1])).toEqual([-5, -7])
        expect(Array.from(segm.parsedData[2])).toEqual([-6, -8])
        // -5.5 and -7.5
        expect(segm.sumElem).toBe(-13)
    })

    it('yields the zero-length form for a segment entirely before the page', () => {
        const segm = buildContinuousSegm(rawSegment(0, 1000, [1, 2, 3]), identity, req(50000, 60000))
        expect(segm.nrPoints).toBe(0)
        expect(segm.parsedData[0]).toHaveLength(0)
        expect(segm.parsedData[1]).toHaveLength(0)
        expect(segm.cData[0]).toHaveLength(0)
        expect(segm.sumElem).toBe(0)
        expect(segm.nrValidPoints).toBe(0)
        expect(segm.median).toBe(0)
        expect(Object.keys(segm).sort()).toEqual([...CONTINUOUS_KEYS].sort())
    })

    it('yields the zero-length form for a segment entirely after the page', () => {
        const segm = buildContinuousSegm(rawSegment(90000, 1000, [1, 2, 3]), identity, req(0, 10000))
        expect(segm.nrPoints).toBe(0)
        expect(segm.nrValidPoints).toBe(0)
    })

    it('yields the zero-length form for an empty segment', () => {
        const segm = buildContinuousSegm(rawSegment(0, 1000, []), identity, req(0, 10000))
        expect(segm.nrPoints).toBe(0)
        expect(segm.parsedData[2]).toHaveLength(0)
    })

    it('leaves median at 0 unless useMedian is set', () => {
        const segm = buildContinuousSegm(rawSegment(0, 1000, [1, 2, 3]), identity, req(0, 3000))
        expect(segm.median).toBe(0)
    })

    it('pins the legacy median: lexicographic sort, index round(len/2)', () => {
        // Negated row 1 is [-1, -2, -3, 9, 10]. Lexicographic order is
        // ['-1','-2','-3','10','9'] so index round(5/2) = 3 selects 10; a numeric sort
        // would order [-3,-2,-1,9,10] and select 9. The legacy WebSocket path reports 10,
        // so this path must too.
        const segm = buildContinuousSegm(
            rawSegment(0, 1000, [1, 2, 3, -9, -10]), identity, req(0, 5000), { useMedian: true }
        )
        expect(Array.from(segm.parsedData[1])).toEqual([-1, -2, -3, 9, 10])
        expect(segm.median).toBe(10)
        expect(segm.median).not.toBe(9)
    })

    it('pins the legacy median index on an even-length row', () => {
        // Row 1 is [1, 2, 3, 4]; round(4/2) = 2 selects the third element, not a midpoint.
        const segm = buildContinuousSegm(
            rawSegment(0, 1000, [-1, -2, -3, -4]), identity, req(0, 4000), { useMedian: true }
        )
        expect(segm.median).toBe(3)
    })
})

describe('buildContinuousSegm page seams at 512 Hz', () => {
    const pageA = req(EPOCH, EPOCH + PAGE)
    const pageB = req(EPOCH + PAGE, EPOCH + 2 * PAGE)

    // Page A's reader segment starts on the page and overruns it; page B's starts one bin
    // early (the reader delivers on bin boundaries) and overruns as well.
    const segmA = buildContinuousSegm(gridSegment(0, 7690), identity, pageA)
    const segmB = buildContinuousSegm(gridSegment(7679, 7690), identity, pageB)

    it('keeps every bin of each page and no more', () => {
        expect(segmA.nrPoints).toBe(7680)
        expect(segmB.nrPoints).toBe(7680)
    })

    it('keeps disjoint, contiguous runs of global bins', () => {
        expect(-segmA.parsedData[1][0]).toBe(0)
        expect(-segmA.parsedData[1][segmA.nrPoints - 1]).toBe(7679)
        expect(-segmB.parsedData[1][0]).toBe(7680)
        expect(-segmB.parsedData[1][segmB.nrPoints - 1]).toBe(15359)
    })

    it('places every bin inside its own half-open page window', () => {
        for (const [segm, page] of [[segmA, pageA], [segmB, pageB]] as const) {
            const times = segm.parsedData[0]
            for (let i = 0; i < times.length; i++) {
                expect(times[i]).toBeGreaterThanOrEqual(page.startTime)
                expect(times[i]).toBeLessThan(page.endTime)
            }
        }
    })

    it('resolves a bound that the rounded index alone gets wrong', () => {
        // The bin start EPOCH + 3 * P512 rounds to .5 us while the ratio it implies is
        // 3.000064, so a bare Math.ceil answers 4 and loses the bin from the later page.
        // The exact predicate puts it there: t equals the boundary, so the half-open rule
        // hands it to the page that starts on it.
        const boundary = EPOCH + 3 * P512
        expect(Math.ceil((boundary - EPOCH) / P512)).toBe(4)

        const earlier = buildContinuousSegm(gridSegment(0, 8), identity, req(EPOCH, boundary))
        const later = buildContinuousSegm(
            gridSegment(0, 8), identity, req(boundary, EPOCH + 8 * P512)
        )
        expect(earlier.nrPoints).toBe(3)
        expect(-earlier.parsedData[1][earlier.nrPoints - 1]).toBe(2)
        expect(later.nrPoints).toBe(5)
        expect(-later.parsedData[1][0]).toBe(3)
        expect(later.startTs).toBe(boundary)
    })

    it('shares no timestamp between the two pages', () => {
        const seen = new Set(segmA.parsedData[0])
        for (const t of segmB.parsedData[0]) {
            expect(seen.has(t)).toBe(false)
        }
    })

    it('tiles the seam with no duplicate and no hole wider than one period', () => {
        const lastA = segmA.parsedData[0][segmA.nrPoints - 1]
        const firstB = segmB.parsedData[0][0]
        expect(firstB).toBeGreaterThan(lastA)
        expect(firstB - lastA).toBeLessThanOrEqual(P512 + ULP)
        expect(firstB - lastA).toBeGreaterThanOrEqual(P512 - ULP)
        expect(segmB.startTs).toBe(firstB)
    })

    it('spaces bins by one period throughout, with no accumulated drift', () => {
        const times = segmB.parsedData[0]
        for (let i = 1; i < times.length; i++) {
            expect(Math.abs((times[i] - times[i - 1]) - P512)).toBeLessThanOrEqual(ULP)
        }
        const span = times[times.length - 1] - times[0]
        expect(Math.abs(span - (times.length - 1) * P512)).toBeLessThanOrEqual(ULP)

        // Same grid walked by repeated addition instead: 960 us off by the end of one
        // 15 s page, half a sample period. This is the drift the index-space math avoids.
        let accumulated = times[0]
        for (let i = 1; i < times.length; i++) {
            accumulated += P512
        }
        expect(Math.abs(accumulated - times[times.length - 1])).toBeGreaterThan(100)
    })
})

describe('buildGapSegm', () => {
    it('emits the same key set as a continuous block', () => {
        const segm = buildGapSegm(identity, req(1000, 2000))
        expect(Object.keys(segm).sort()).toEqual([...CONTINUOUS_KEYS].sort())
    })

    it('is empty but fully formed', () => {
        const request = req(1704067200000000, 1704067215000000)
        const segm = buildGapSegm(identity, request)
        expect(segm.nrPoints).toBe(0)
        expect(segm.median).toBe(0)
        expect(segm.sumElem).toBe(0)
        expect(segm.nrValidPoints).toBe(0)
        expect(segm.pageStart).toBe(request.startTime)
        expect(segm.pageEnd).toBe(request.endTime)
        expect(segm.startTs).toBe(request.startTime)
        expect(segm.chId).toBe('ch-1')
        expect(segm.name).toBe('Ch 1')
        expect(segm.label).toBe('Ch 1')
        expect(segm.type).toBe('Continuous')
        expect(segm.unitM).toBe(1)
        expect(segm.lastUsed).toBe(0)
        expect(segm.isMinMax).toBe(false)
        expect(segm.parsedData).toHaveLength(3)
        for (const row of segm.parsedData) {
            expect(row).toBeInstanceOf(Float64Array)
            expect(row).toHaveLength(0)
        }
        for (const row of segm.cData) {
            expect(row).toBeInstanceOf(Float32Array)
            expect(row).toHaveLength(0)
        }
    })
})

describe('buildNeuralSegm', () => {
    const batch = (times: number[]): EventBatch => ({
        channel: 'unitA',
        startUs: 0,
        endUs: 10000,
        samplePeriodUs: 25,
        pointsPerEvent: 0,
        isResampled: false,
        times: Float64Array.from(times),
        data: new Float64Array(0)
    })

    const unitIdentity = { chId: 'unitA', label: 'unitA', clientId: 'unitA', unit: 'uV' }

    it('emits the legacy Neural key set plus name and label', () => {
        const segm = buildNeuralSegm(batch([100, 200]), unitIdentity, req(0, 10000))
        expect(Object.keys(segm).sort()).toEqual([...NEURAL_KEYS].sort())
        expect(segm.name).toBe('unitA')
        expect(segm.label).toBe('unitA')
    })

    it('treats one timestamp as one event (not an interleaved pair)', () => {
        const times = [100, 200, 300]
        const segm = buildNeuralSegm(batch(times), unitIdentity, req(0, 10000))
        expect(segm.nrPoints).toBe(3)
        expect(segm.parsedData).toHaveLength(2)
        expect(Array.from(segm.parsedData[0])).toEqual(times)
        expect(Array.from(segm.parsedData[1])).toEqual(times)
        expect(segm.parsedData[0]).not.toBe(segm.parsedData[1])
    })

    it('sizes cData to nrPoints, which the renderer indexes directly', () => {
        const segm = buildNeuralSegm(batch([1, 2, 3, 4]), unitIdentity, req(0, 10000))
        expect(segm.cData).toHaveLength(3)
        for (const row of segm.cData) {
            expect(row).toBeInstanceOf(Float32Array)
            expect(row).toHaveLength(segm.nrPoints)
        }
        expect(segm.parsedData[0]).toHaveLength(segm.nrPoints)
    })

    it('fixes unit, type and page fields', () => {
        const request = req(1704067200000000, 1704067215000000)
        const segm = buildNeuralSegm(batch([1]), unitIdentity, request)
        expect(segm.unit).toBe('uV')
        expect(segm.type).toBe('Neural')
        expect(segm.unitM).toBe(1)
        expect(segm.lastUsed).toBe(0)
        expect(segm.samplePeriod).toBe(25)
        expect(segm.isMinMax).toBe(false)
        expect(segm.pageStart).toBe(request.startTime)
        expect(segm.pageEnd).toBe(request.endTime)
        expect(segm.startTs).toBe(request.startTime)
    })

    it('echoes isResampled into isMinMax', () => {
        const resampled = { ...batch([1, 2]), isResampled: true }
        expect(buildNeuralSegm(resampled, unitIdentity, req(0, 10000)).isMinMax).toBe(true)
    })

    it('still emits a block for an empty batch so the page can drain', () => {
        const segm = buildNeuralSegm(batch([]), unitIdentity, req(0, 10000))
        expect(segm.nrPoints).toBe(0)
        expect(segm.parsedData[0]).toHaveLength(0)
        expect(segm.cData[2]).toHaveLength(0)
    })
})

describe('regression pins found by adversarial review', () => {
    it('reports pageStart as the requested start even when no bin lands on it', () => {
        // The earlier pageStart assertions all used fixtures where startTs happened to equal
        // req.startTime, so `pageStart: startTs` passed the whole suite. It must not: pageStart
        // is the key of the viewer's requestedPages map, and a mismatch strands the page.
        const segm = buildContinuousSegm(rawSegment(0, 1000, [0, 1, 2, 3, 4, 5, 6, 7]), identity, req(3500, 7000))
        expect(segm.startTs).toBe(4000)
        expect(segm.pageStart).toBe(3500)
        expect(segm.pageEnd).toBe(7000)
    })

    it('reports pageStart for a segment that falls entirely outside the page', () => {
        const before = buildContinuousSegm(rawSegment(3000, 1000, [1, 2]), identity, req(50000, 60000))
        expect(before.nrPoints).toBe(0)
        expect(before.pageStart).toBe(50000)

        const after = buildContinuousSegm(rawSegment(90000, 1000, [1, 2]), identity, req(0, 10000))
        expect(after.nrPoints).toBe(0)
        expect(after.pageStart).toBe(0)
    })

    it('gives cData three independent buffers, not one aliased row', () => {
        // The renderer writes x, y and y2 at the same index in a single pass, so sharing one
        // buffer would silently overwrite every x with its y2.
        const segm = buildContinuousSegm(rawSegment(0, 1000, [1, 2, 3]), identity, req(0, 3000))
        expect(new Set(segm.cData).size).toBe(3)
        segm.cData[0][0] = 42
        expect(segm.cData[1][0]).toBe(0)
        expect(segm.cData[2][0]).toBe(0)

        const neural = buildNeuralSegm(
            { samplePeriodUs: 33, isResampled: false, times: Float64Array.from([10, 20]) },
            identity,
            req(0, 1000)
        )
        expect(new Set(neural.cData).size).toBe(3)
        neural.cData[0][0] = 7
        expect(neural.cData[1][0]).toBe(0)
    })
})
