import { describe, it, expect } from 'vitest'
import {
    peakToPeakByChannel,
    zoomMultForAmplitudes,
    rowScalingForAmplitudes,
    zoomMultToUvPerMm,
    uvPerMmToZoomMult,
    measureAmplitudes
} from './autoscale'
import type { QueryOptions } from '@pennsieve/timeseries-zarr-reader'

const envelope = (channel: string, values: number[]) => ({
    channel,
    data: Float64Array.from(values),
    isMinMax: true
})

describe('peakToPeakByChannel', () => {
    it('reports the full swing of each envelope', () => {
        const p2p = peakToPeakByChannel([
            envelope('a', [-10, 10, -4, 4]),
            envelope('b', [0, 3])
        ])
        expect(p2p.get('a')).toBe(20)
        expect(p2p.get('b')).toBe(3)
    })

    it('skips gaps rather than treating them as values', () => {
        const p2p = peakToPeakByChannel([envelope('a', [NaN, NaN, -5, 5, NaN, NaN])])
        expect(p2p.get('a')).toBe(10)
    })

    it('omits a channel that is entirely gap', () => {
        const p2p = peakToPeakByChannel([envelope('a', [NaN, NaN])])
        expect(p2p.has('a')).toBe(false)
    })

    it('omits a channel with no data', () => {
        const p2p = peakToPeakByChannel([envelope('a', [])])
        expect(p2p.has('a')).toBe(false)
    })

    it('tolerates no segments at all', () => {
        expect(peakToPeakByChannel([]).size).toBe(0)
        expect(peakToPeakByChannel(undefined).size).toBe(0)
    })
})

describe('zoomMultForAmplitudes', () => {
    it('fits the median swing to the requested fraction of a row', () => {
        // median 100 uV, 20 px row, 0.8 fill -> 16 px of swing -> 0.16 px per uV
        expect(zoomMultForAmplitudes([100, 100, 100], 20, 0.8)).toBeCloseTo(0.16, 10)
    })

    it('uses the median so one loud channel does not set the scale', () => {
        const withOutlier = zoomMultForAmplitudes([100, 100, 100, 900], 20, 0.8)
        const without = zoomMultForAmplitudes([100, 100, 100], 20, 0.8)!
        expect(withOutlier).toBeCloseTo(without, 10)
    })

    it('ignores channels pinned beyond a trustworthy range', () => {
        expect(zoomMultForAmplitudes([100, 1e9], 20, 0.8)).toBeCloseTo(0.16, 10)
    })

    it('ignores non-positive and non-finite amplitudes', () => {
        expect(zoomMultForAmplitudes([0, -5, NaN, Infinity, 100], 20, 0.8)).toBeCloseTo(0.16, 10)
    })

    it('returns null when nothing is usable', () => {
        expect(zoomMultForAmplitudes([], 20)).toBeNull()
        expect(zoomMultForAmplitudes([0, NaN], 20)).toBeNull()
    })

    it('returns null for a row that has no height yet', () => {
        expect(zoomMultForAmplitudes([100], 0)).toBeNull()
        expect(zoomMultForAmplitudes([100], -5)).toBeNull()
    })

    it('accepts the Map that measureAmplitudes returns', () => {
        const p2p = new Map([['a', 100], ['b', 100]])
        expect(zoomMultForAmplitudes(p2p, 20, 0.8)).toBeCloseTo(0.16, 10)
    })

    it('accepts bare amplitude values', () => {
        const p2p = new Map([['a', 100], ['b', 100]])
        expect(zoomMultForAmplitudes(p2p.values(), 20, 0.8)).toBeCloseTo(0.16, 10)
    })

    it('returns null rather than a scale when handed nothing', () => {
        expect(zoomMultForAmplitudes(null, 20)).toBeNull()
        expect(zoomMultForAmplitudes(new Map(), 20)).toBeNull()
    })
})

describe('rowScalingForAmplitudes', () => {
    const units = (entries: Array<[string, string]>) => new Map(entries)
    const swings = (entries: Array<[string, number]>) => new Map(entries)

    it('shares one scale across microvolt channels of ordinary swing', () => {
        const scaling = rowScalingForAmplitudes(
            swings([['a', 100], ['b', 120], ['c', 90]]),
            units([['a', 'uV'], ['b', 'uV'], ['c', 'uV']]),
            20,
            0.8
        )!
        expect(scaling.referenceUnit).toBe('uV')
        expect(scaling.zoomMult).toBeCloseTo(zoomMultForAmplitudes([100, 120, 90], 20, 0.8)!, 10)
        expect([...scaling.rowScales.values()]).toEqual([1, 1, 1])
    })

    it('fits a microvolt channel swinging far past the median to its own row', () => {
        const scaling = rowScalingForAmplitudes(
            swings([['a', 100], ['b', 100], ['c', 100], ['dc', 47_000]]),
            units([['a', 'uV'], ['b', 'uV'], ['c', 'uV'], ['dc', 'uV']]),
            20
        )!
        expect(scaling.rowScales.get('a')).toBe(1)
        expect(scaling.rowScales.get('dc')).toBeCloseTo(100 / 47_000, 12)
    })

    it('keeps a microvolt channel within the outlier ratio on the shared scale', () => {
        const scaling = rowScalingForAmplitudes(
            swings([['a', 100], ['b', 100], ['c', 100], ['ecg', 700]]),
            units([['a', 'uV'], ['b', 'uV'], ['c', 'uV'], ['ecg', 'uV']]),
            20
        )!
        expect(scaling.rowScales.get('ecg')).toBe(1)
    })

    it('scales channels of another unit as a group by their median swing', () => {
        const scaling = rowScalingForAmplitudes(
            swings([['a', 200], ['b', 200], ['pr', 60], ['pq', 40]]),
            units([['a', 'uV'], ['b', 'uV'], ['pr', 'bpm'], ['pq', 'bpm']]),
            20
        )!
        // bpm median 50: both fill a row the way the 200 uV median does.
        expect(scaling.rowScales.get('pr')).toBeCloseTo(4, 12)
        expect(scaling.rowScales.get('pq')).toBeCloseTo(4, 12)
    })

    it('fits an outlier within another unit on its own', () => {
        const scaling = rowScalingForAmplitudes(
            swings([['a', 200], ['x', 10], ['y', 10], ['z', 10], ['loud', 1000]]),
            units([['a', 'uV'], ['x', 'ms'], ['y', 'ms'], ['z', 'ms'], ['loud', 'ms']]),
            20
        )!
        expect(scaling.rowScales.get('x')).toBeCloseTo(20, 12)
        expect(scaling.rowScales.get('loud')).toBeCloseTo(200 / 1000, 12)
    })

    it('leaves a flat or unmeasured channel unlisted', () => {
        const scaling = rowScalingForAmplitudes(
            swings([['a', 100], ['flat', 0], ['gap', NaN]]),
            units([['a', 'uV'], ['flat', 'uV'], ['gap', 'uV']]),
            20
        )!
        expect(scaling.rowScales.has('flat')).toBe(false)
        expect(scaling.rowScales.has('gap')).toBe(false)
    })

    it('takes the most common unit as the reference when no channel is in microvolts', () => {
        const scaling = rowScalingForAmplitudes(
            swings([['p', 100], ['q', 100], ['r', 5]]),
            units([['p', 'cmH2O'], ['q', 'cmH2O'], ['r', '%']]),
            20
        )!
        expect(scaling.referenceUnit).toBe('cmH2O')
        expect(scaling.zoomMult).toBeCloseTo((20 * 0.8) / 100, 12)
        expect(scaling.rowScales.get('r')).toBeCloseTo(20, 12)
    })

    it('counts a channel with no unit under the empty unit', () => {
        const scaling = rowScalingForAmplitudes(swings([['a', 100], ['n', 10]]), units([['a', 'uV']]), 20)!
        expect(scaling.rowScales.get('n')).toBeCloseTo(10, 12)
    })

    it('ignores a railed microvolt channel when setting the shared scale, and fits it', () => {
        const scaling = rowScalingForAmplitudes(
            swings([['a', 100], ['b', 100], ['rail', 5_000_000]]),
            units([['a', 'uV'], ['b', 'uV'], ['rail', 'uV']]),
            20
        )!
        expect(scaling.zoomMult).toBeCloseTo((20 * 0.8) / 100, 12)
        expect(scaling.rowScales.get('rail')).toBeCloseTo(100 / 5_000_000, 15)
    })

    it('returns null when no reference channel has a usable swing or the row has no height', () => {
        expect(rowScalingForAmplitudes(swings([['a', 0]]), units([['a', 'uV']]), 20)).toBeNull()
        expect(rowScalingForAmplitudes(swings([['a', 5_000_000]]), units([['a', 'uV']]), 20)).toBeNull()
        expect(rowScalingForAmplitudes(swings([['a', 100]]), units([['a', 'uV']]), 0)).toBeNull()
        expect(rowScalingForAmplitudes(swings([]), units([]), 20)).toBeNull()
    })
})

describe('sensitivity conversion', () => {
    it('round-trips a multiplier through uV/mm', () => {
        const mult = uvPerMmToZoomMult(100, 96, 1)
        expect(zoomMultToUvPerMm(mult, 96, 1)).toBeCloseTo(100, 10)
    })

    it('matches the toolbar reading of an unscaled multiplier', () => {
        // The value the toolbar shows when globalZoomMult is 1 at 96 dpi.
        expect(zoomMultToUvPerMm(1, 96, 1)).toBeCloseTo(3.7795, 3)
        expect(zoomMultToUvPerMm(1, 96, 2)).toBeCloseTo(7.5590, 3)
    })

    it('holds sensitivity constant across display densities', () => {
        expect(zoomMultToUvPerMm(uvPerMmToZoomMult(50, 96, 1), 96, 1)).toBeCloseTo(50, 10)
        expect(zoomMultToUvPerMm(uvPerMmToZoomMult(50, 96, 2), 96, 2)).toBeCloseTo(50, 10)
    })
})

describe('measureAmplitudes', () => {
    const clientYielding = (segments: ReturnType<typeof envelope>[]) => ({
        calls: [] as QueryOptions[],
        query(options: QueryOptions) {
            this.calls.push(options)
            return (async function* () {
                for (const s of segments) yield s
            })()
        }
    })

    it('asks for one coarse pass over the whole recording', async () => {
        const client = clientYielding([envelope('a', [-50, 50])])
        const p2p = await measureAmplitudes(client, ['a'], 0, 43_200_000_000)

        expect(p2p.get('a')).toBe(100)
        const [call] = client.calls
        expect(call.channels).toEqual(['a'])
        expect(call.startUs).toBe(0)
        expect(call.endUs).toBe(43_200_000_000)
        // Wide enough that the reader selects its coarsest level.
        expect(call.pixelWidthUs).toBe(21_600_000)
    })

    it('forwards an abort signal when given one', async () => {
        const client = clientYielding([])
        const controller = new AbortController()
        await measureAmplitudes(client, ['a'], 0, 1000, controller.signal)
        expect(client.calls[0].signal).toBe(controller.signal)
    })

    it('omits the signal key when none is given', async () => {
        const client = clientYielding([])
        await measureAmplitudes(client, ['a'], 0, 1000)
        expect('signal' in client.calls[0]).toBe(false)
    })

    it('reads nothing for an empty channel list or an empty window', async () => {
        const client = clientYielding([envelope('a', [0, 1])])
        expect((await measureAmplitudes(client, [], 0, 1000)).size).toBe(0)
        expect((await measureAmplitudes(client, ['a'], 1000, 1000)).size).toBe(0)
        expect((await measureAmplitudes(null, ['a'], 0, 1000)).size).toBe(0)
        expect(client.calls).toHaveLength(0)
    })
})
