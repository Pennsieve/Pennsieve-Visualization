import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StreamingClient } from '@pennsieve/timeseries-zarr-reader'
import { anchorClient } from './anchoredClient'

const ORIGIN = 1704067200000000

/** A reader whose times count from its own origin, as a bundle's do. `null` records no origin. */
function fakeReader(referenceTimeUs: number | null = ORIGIN) {
    const calls: Record<string, unknown>[] = []
    const reader = {
        recording: vi.fn(async () => (referenceTimeUs === null ? {} : { referenceTimeUs })),
        channelInfo: async () => [
            { kind: 'continuous', index: 0, id: 'a', name: 'A', unit: 'uV', rateHz: 1000, startUs: 0, endUs: 30000000, runs: 1 },
            { kind: 'event', index: 1, id: 'm', name: 'Marks', eventCount: 1, columns: [], hasWaveformMean: false, countLevels: 0 }
        ],
        query: async function* (options: Record<string, unknown>) {
            calls.push(options)
            yield { channel: 'a', startUs: 7000, samplePeriodUs: 1000, isMinMax: false, data: new Float64Array([1]) }
        },
        queryEvents: async function* (options: Record<string, unknown>) {
            calls.push(options)
            yield { channel: 'm', startUs: options.startUs, endUs: options.endUs, times: Float64Array.from([10, 20]) }
        },
        dataSpans: async (options: Record<string, unknown>) => {
            calls.push(options)
            return [[0, 5000] as [number, number]]
        }
    }
    return { reader: reader as unknown as StreamingClient, calls }
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('anchorClient', () => {
    it('shifts continuous channel extents onto the epoch and leaves event channels alone', async () => {
        const { reader } = fakeReader()
        const infos = await anchorClient(reader).channelInfo()
        expect(infos[0]).toMatchObject({ startUs: ORIGIN, endUs: ORIGIN + 30000000 })
        expect(infos[1]).toMatchObject({ kind: 'event', id: 'm' })
    })

    it('reads the origin once for every call', async () => {
        const { reader } = fakeReader()
        const client = anchorClient(reader)
        await client.channelInfo()
        await client.dataSpans({ channel: 'a', startUs: ORIGIN, endUs: ORIGIN + 1 })
        expect(reader.recording).toHaveBeenCalledTimes(1)
        expect(await client.originUs()).toBe(ORIGIN)
    })

    it('moves a query window into bundle time and its segments back out', async () => {
        const { reader, calls } = fakeReader()
        const segments = []
        for await (const segment of anchorClient(reader).query({
            channels: ['a'], startUs: ORIGIN + 5000, endUs: ORIGIN + 9000, pixelWidthUs: 1000
        })) {
            segments.push(segment)
        }
        expect(calls[0]).toMatchObject({ channels: ['a'], startUs: 5000, endUs: 9000, pixelWidthUs: 1000 })
        expect(segments[0].startUs).toBe(ORIGIN + 7000)
        expect(Array.from(segments[0].data)).toEqual([1])
    })

    it('shifts event windows and their times', async () => {
        const { reader, calls } = fakeReader()
        const windows = []
        for await (const window of anchorClient(reader).queryEvents({
            channels: ['m'], startUs: ORIGIN, endUs: ORIGIN + 100
        })) {
            windows.push(window)
        }
        expect(calls[0]).toMatchObject({ startUs: 0, endUs: 100 })
        expect(windows[0]).toMatchObject({ startUs: ORIGIN, endUs: ORIGIN + 100 })
        expect(Array.from(windows[0].times)).toEqual([ORIGIN + 10, ORIGIN + 20])
    })

    it('shifts availability spans', async () => {
        const { reader, calls } = fakeReader()
        const spans = await anchorClient(reader).dataSpans({ channel: 'a', startUs: ORIGIN, endUs: ORIGIN + 9000 })
        expect(calls[0]).toMatchObject({ startUs: 0, endUs: 9000 })
        expect(spans).toEqual([[ORIGIN, ORIGIN + 5000]])
    })

    it('anchors a bundle with no wall-clock start at the epoch, and warns once', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { reader } = fakeReader(null)
        const client = anchorClient(reader)
        expect(await client.originUs()).toBe(0)
        expect((await client.channelInfo())[0]).toMatchObject({ startUs: 0 })
        expect(warn).toHaveBeenCalledTimes(1)
    })

    it('retries the origin after a failed read', async () => {
        const { reader } = fakeReader()
        const recording = reader.recording as unknown as ReturnType<typeof vi.fn>
        recording.mockRejectedValueOnce(new Error('offline'))
        const client = anchorClient(reader)
        await expect(client.originUs()).rejects.toThrow('offline')
        expect(await client.originUs()).toBe(ORIGIN)
    })
})
