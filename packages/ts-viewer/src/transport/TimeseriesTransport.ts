// The typed boundary between the viewer's request loop and a data backend.
//
// Two implementations exist: the legacy pennsieve-streaming WebSocket and the
// browser-side Zarr reader. The viewer holds exactly one at a time and talks
// to it only through this interface; nothing above the transport may branch
// on which backend is active. Backend differences the request loop must know
// about travel through `capabilities`.
import type { Ref } from 'vue'
import type { SegmentEnvelope } from '@/composables/streaming/segments'
import type { ChannelDetail } from '@/composables/streaming/channelDetails'
import type { LegacyFilterMessage } from '@/composables/streaming/filters'
import type { CreateStoreOptions } from '@/composables/streaming/createStore'
import type { WebSocketSegmentEnvelope, WebSocketEventEnvelope } from './websocketTransport'

export type TransportStatus = 'disconnected' | 'connecting' | 'connected'

/** One channel as the wire names it: server id plus display label. */
export interface VirtualChannelRef {
    /** Server channel id (for a montaged trace, the lead's id). */
    id: string
    /** Channel label; a montaged trace carries the composite lead<->secondary label. */
    name: string
}

/** One page of data for a set of channels. */
export interface PageRequest {
    /** Page key, microseconds. Every resulting block echoes it as `pageStart`. */
    startTime: number
    /** Microseconds, already clamped to the recording end by the caller. */
    endTime: number
    /** Microseconds per pixel column. Echoed as `requestedSamplePeriod`. */
    pixelWidth: number
    /** true requests envelope decimation; false requests raw samples. */
    minMax: boolean
    /**
     * How early the backend should admit this page. Omitted means the viewport is
     * waiting on it. A backend that does not order its reads ignores this.
     */
    priority?: 'viewport' | 'prefetch'
    channels: VirtualChannelRef[]
}

/** Envelopes as the two backends deliver them today. */
export type TransportSegmentEnvelope =
    | SegmentEnvelope
    | WebSocketSegmentEnvelope
    | WebSocketEventEnvelope

export interface TransportError {
    error: string
    requestedBytes?: number
    maxBytes?: number
}

/** The legacy montage wire message, as `createMontagePayload` builds it. */
export interface MontageMessage {
    montage: string
    packageId?: string | null
    montageMap: Array<[string, string]> | []
}

export interface DataSpanQuery {
    /** Client channel id; transports normalize montage leads internally. */
    channel: string
    startUs: number
    endUs: number
    /** A gap narrower than this is bridged when merging spans. */
    gapThresholdUs: number
}

export interface TransportEvents {
    segment: TransportSegmentEnvelope
    event: TransportSegmentEnvelope
    channelDetails: ChannelDetail[]
    error: TransportError
}

/** Backend differences the request loop is allowed to know about. */
export interface TransportCapabilities {
    /** Longest viewable window, microseconds. null: bounded only by the recording. */
    readonly maxDurationUs: number | null
    /** Page span for a viewport duration, microseconds. */
    pageSizeFor(durationUs: number): number
    /** Pages to read ahead of the viewport. Counted in whatever span pageSizeFor returns. */
    readonly prefetchPages: number
    /** Wait after dumpBuffer before rebuilding requests, milliseconds. */
    readonly postDumpDelayMs: number
    /** Whether measureAmplitudes is available. */
    readonly supportsAmplitudeSurvey: boolean
}

export interface TransportOpenOptions {
    /** Package node id, used in request payloads and API paths. */
    packageId: string | null
    /** Viewer-asset UUID (legacy WebSocket `?viewerAsset=`); null on the Zarr path. */
    viewerAssetId: string | null
    /** Bundle root URL, signed or not. Zarr path only. */
    url: string | null
    onUrlExpired?: CreateStoreOptions['onUrlExpired'] | null
    /** Legacy discovery endpoint. WebSocket path only. */
    timeseriesDiscoverApi?: string
    /** Legacy segment-span REST endpoint base. WebSocket path only. */
    timeSeriesApi?: string
    /** Token source. The WebSocket path appends it as a query ticket. */
    getToken?: () => Promise<string | null>
}

export interface TimeseriesTransport {
    readonly kind: 'websocket' | 'zarr'
    readonly status: Readonly<Ref<TransportStatus>>
    readonly capabilities: TransportCapabilities

    /**
     * Connects and loads the channel catalog. Emits `channelDetails` once with
     * the flat channel rows. Resolves when the transport can accept requests.
     */
    open(opts: TransportOpenOptions): Promise<void>

    /** Idempotent. A closed transport can be opened again. */
    close(): Promise<void>

    /**
     * Requests one page. Returns false when not connected; the caller rolls
     * back its own bookkeeping for a false return.
     *
     * Contract, enforced by the conformance suite:
     * 1. Returns synchronously; no event handler fires before the microtask
     *    after it returns.
     * 2. Exactly one `segment` or `event` envelope per (startTime, channel)
     *    eventually arrives; a channel with no data in the page is drained
     *    with a gap envelope. dumpBuffer() or close() voids the promise: after
     *    either, the transport may emit nothing for outstanding pages.
     * 3. Every envelope echoes `pageStart === startTime`, and every block
     *    echoes `requestedSamplePeriod === pixelWidth`.
     */
    requestPage(req: PageRequest): boolean

    /**
     * Switches the montage. The transport answers with a `channelDetails`
     * emission describing the new traces; the request loop treats that reply
     * as the end of the montage transition.
     */
    setMontage(message: MontageMessage): void

    /** Applies or clears per-channel filters, legacy wire semantics. */
    setFilter(message: LegacyFilterMessage): void

    /** Aborts all in-flight page work. Returns false when not connected. */
    dumpBuffer(): boolean

    /** Availability spans for the scrubber, [startUs, endUs] pairs. */
    dataSpans(query: DataSpanQuery): Promise<Array<[number, number]>>

    /** Peak amplitude per channel. Guarded by capabilities.supportsAmplitudeSurvey. */
    measureAmplitudes?(
        channels: string[],
        startUs: number,
        endUs: number,
        signal?: AbortSignal,
    ): Promise<number[]>

    /** Registers a handler; returns the unsubscribe function. */
    on<K extends keyof TransportEvents>(
        event: K,
        handler: (payload: TransportEvents[K]) => void,
    ): () => void
}
