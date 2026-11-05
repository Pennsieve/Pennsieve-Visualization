// @/composables/streaming/anchoredClient.ts
//
// The reader on the viewer's clock.
//
// A TS-Zarr 1.0 bundle counts every time from its own origin, its time zero, and the
// viewer counts every time from the Unix epoch, as the API's packages do. This wraps a
// reader client so nothing else in the viewer sees bundle time: windows going in lose
// the origin, times coming out gain it. The origin is the bundle's recording.json
// reference_time. A de-identified bundle has none; it is anchored at the epoch and says so once.
import type {
    ChannelInfo,
    DataSpanOptions,
    EventQueryOptions,
    EventWindow,
    QueryOptions,
    RecordingInfo,
    Segment,
    StreamingClient
} from '@pennsieve/timeseries-zarr-reader'

/** The reader surface the viewer uses, with every time in microseconds since the epoch. */
export interface AnchoredClient {
    /** The bundle's origin in microseconds since the epoch, 0 when it records none. */
    originUs(): Promise<number>
    recording(): Promise<RecordingInfo | undefined>
    channelInfo(): Promise<ChannelInfo[]>
    query(options: QueryOptions): AsyncGenerator<Segment, void, undefined>
    queryEvents(options: EventQueryOptions): AsyncGenerator<EventWindow, void, undefined>
    dataSpans(options: DataSpanOptions): Promise<Array<[number, number]>>
}

/**
 * Wraps a reader client so its times are epoch microseconds.
 *
 * The origin is read once, on first use, and cached. A failed read clears the cache so
 * the next call retries instead of replaying the error.
 */
export function anchorClient(client: StreamingClient): AnchoredClient {
    let origin: Promise<number> | null = null

    const originUs = (): Promise<number> => {
        if (origin === null) {
            origin = client
                .recording()
                .then((recording) => {
                    if (recording?.referenceTimeUs === undefined) {
                        console.warn('Bundle records no reference time; its times are shown from the epoch')
                        return 0
                    }
                    return recording.referenceTimeUs
                })
                .catch((error: unknown) => {
                    origin = null
                    throw error
                })
        }
        return origin
    }

    return {
        originUs,

        recording: () => client.recording(),

        async channelInfo() {
            const [infos, shift] = await Promise.all([client.channelInfo(), originUs()])
            return infos.map((info) =>
                info.kind === 'continuous'
                    ? { ...info, startUs: info.startUs + shift, endUs: info.endUs + shift }
                    : info
            )
        },

        async *query(options) {
            const shift = await originUs()
            const window = { ...options, startUs: options.startUs - shift, endUs: options.endUs - shift }
            for await (const segment of client.query(window)) {
                yield { ...segment, startUs: segment.startUs + shift }
            }
        },

        async *queryEvents(options) {
            const shift = await originUs()
            const window = { ...options, startUs: options.startUs - shift, endUs: options.endUs - shift }
            for await (const events of client.queryEvents(window)) {
                yield {
                    ...events,
                    startUs: events.startUs + shift,
                    endUs: events.endUs + shift,
                    times: Float64Array.from(events.times, (time) => time + shift)
                }
            }
        },

        async dataSpans(options) {
            const shift = await originUs()
            const spans = await client.dataSpans({
                ...options,
                startUs: options.startUs - shift,
                endUs: options.endUs - shift
            })
            return spans.map(([start, end]): [number, number] => [start + shift, end + shift])
        }
    }
}
