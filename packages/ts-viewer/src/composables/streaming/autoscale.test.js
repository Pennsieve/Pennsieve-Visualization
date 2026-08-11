import { describe, it, expect } from 'vitest'
import {
    peakToPeakByChannel,
    zoomMultForAmplitudes,
    zoomMultToUvPerMm,
    uvPerMmToZoomMult,
    measureAmplitudes
} from './autoscale'

const envelope = (channel, values) => ({
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
        const without = zoomMultForAmplitudes([100, 100, 100], 20, 0.8)
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

    it('accepts a Map of amplitudes by channel', () => {
        const p2p = new Map([['a', 100], ['b', 100]])
        expect(zoomMultForAmplitudes(p2p.values(), 20, 0.8)).toBeCloseTo(0.16, 10)
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
    const clientYielding = (segments) => ({
        calls: [],
        query(options) {
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
