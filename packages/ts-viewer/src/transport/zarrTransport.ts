// The Zarr implementation of TimeseriesTransport.
//
// requestPage() hands the typed request straight to partitionRequest and the
// group runners, with no JSON round trip. The generation counter, the
// pre-emission microtask yield, the per-spec filter chains, the gap draining,
// and the synthesized montage reply preserve the legacy wire behavior.
//
// Not a Vue composable: no inject, no onUnmounted. The bundle url and its
// renewal callback come in through open(). Filter targets and scrubber spans
// are resolved against the bundle catalog, which carries the same ids, names,
// and rates as the viewer's channel rows.
import { ref, readonly } from 'vue'
import { acquireClient, ensureCatalog, abortInflight } from '@/composables/streaming/clientRegistry'
import { synthesizeMontageDetails } from '@/composables/streaming/channelDetails'
import { legacyFilterToSpec, validateSpecForRate } from '@/composables/streaming/filters'
import { partitionRequest, filterKey } from '@/composables/streaming/translate'
import { buildContinuousSegm, buildGapSegm, buildNeuralSegm } from '@/composables/streaming/segments'
import { measureAmplitudes as surveyAmplitudes } from '@/composables/streaming/autoscale'
import { adaptivePageSize } from '@/composables/streaming/paging'
import type { StreamingClientEntry } from '@/composables/streaming/clientRegistry'
import type { CatalogIndex, ChannelDetail } from '@/composables/streaming/channelDetails'
import type { LegacyFilterMessage, SpecValidation } from '@/composables/streaming/filters'
import type { ParsedRequest, QueryGroup, TraceIdentity } from '@/composables/streaming/translate'
import type { NeuralSegmentBlock, SegmentBlock } from '@/composables/streaming/segments'
import type { ChannelInfo, FilterSpec, MontagePair } from '@pennsieve/timeseries-zarr-reader'
import type {
    DataSpanQuery,
    MontageMessage,
    PageRequest,
    TimeseriesTransport,
    TransportCapabilities,
    TransportError,
    TransportEvents,
    TransportOpenOptions,
    TransportStatus,
} from './TimeseriesTransport'

export interface ZarrTransportDeps {
    /** Client-registry key. The registry memoizes one client per key. */
    registryKey: string
    /** Injectable for tests; forwarded to store construction. */
    fetchImpl?: (request: Request) => Promise<Response>
}

const isAbort = (error: unknown) => (error as { name?: string } | null)?.name === 'AbortError'

/**
 * Maps a reader failure onto the transport error payload. Matched by name
 * rather than `instanceof`: the reader is code-split and loaded dynamically,
 * so this module never holds a reference to its error classes.
 */
const describeError = (error: unknown): TransportError => {
    const raw = error as { name?: string; message?: string; requestedBytes?: number; maxBytes?: number } | null
    if (raw?.name === 'RawReadTooLargeError') {
        return {
            error:
                `Cannot render this view: it needs ${raw.requestedBytes} bytes of raw signal, ` +
                `over the ${raw.maxBytes}-byte limit. Zoom in, or clear the filter or montage.`,
            requestedBytes: raw.requestedBytes,
            maxBytes: raw.maxBytes
        }
    }
    return { error: raw?.message ?? String(error) }
}

/** Builds one Zarr-backed transport bound to a client-registry key. */
export function createZarrTransport(deps: ZarrTransportDeps): TimeseriesTransport {
    const status = ref<TransportStatus>('disconnected')

    const listeners: { [K in keyof TransportEvents]: Set<(payload: TransportEvents[K]) => void> } = {
        segment: new Set(),
        event: new Set(),
        channelDetails: new Set(),
        error: new Set()
    }

    const emit = <K extends keyof TransportEvents>(event: K, payload: TransportEvents[K]): void => {
        for (const handler of listeners[event]) {
            handler(payload)
        }
    }

    const on = <K extends keyof TransportEvents>(
        event: K,
        handler: (payload: TransportEvents[K]) => void
    ): (() => void) => {
        listeners[event].add(handler)
        return () => {
            listeners[event].delete(handler)
        }
    }

    const reportError = (payload: TransportError) => {
        emit('error', payload)
    }

    let entry: StreamingClientEntry | null = null
    let catalogIndex: CatalogIndex | null = null
    let baseDetails: ChannelDetail[] | null = null
    let connectionPromise: Promise<void> | null = null
    let activePackageId: string | null = null

    /**
     * Bumped by every open and every close. Async work captures the value
     * current when it started and re-checks before emitting, so a response
     * that outlives its connection is dropped instead of reaching a viewer
     * that has moved on.
     */
    let generation = 0

    /** Serializes filtered queries per filter spec, so the reader's stateful filter advances in send order. */
    const filterChains = new Map<string, Promise<void>>()

    /**
     * Emits one segment block. `type` mirrors the legacy envelope: the block's
     * own type when it carries points, `gap` when it does not.
     */
    const emitSegment = (block: SegmentBlock, req: ParsedRequest) => {
        emit('segment', {
            pageStart: req.startTime,
            data: block,
            type: block.nrPoints > 0 ? block.type : 'gap',
            nrResponses: 1
        })
    }

    const emitEvent = (block: NeuralSegmentBlock, req: ParsedRequest) => {
        emit('event', {
            pageStart: req.startTime,
            data: block,
            type: 'Neural',
            nrResponses: 1
        })
    }

    /**
     * Resolves a viewer client channel id to its catalog channel and display
     * label. The catalog carries the same ids, names, and native rates as
     * `viewerStore.viewerChannels`, so the transport derives them here instead
     * of holding a store.
     *
     * A plain client id is a catalog id. A montaged client id is
     * `${leadId}_${leadName}<->${secondaryName}` (createVirtualChannel's
     * uniqueId), and the composite has no unambiguous split point because
     * Pennsieve ids can contain underscores. The lead is therefore found as
     * the catalog channel whose `${id}_${name}<->` prefixes the client id.
     */
    const resolveClientChannel = (clientId: string): { info: ChannelInfo; label: string } | null => {
        if (!catalogIndex) {
            return null
        }
        const direct = catalogIndex.byId.get(clientId)
        if (direct) {
            return { info: direct, label: direct.name }
        }
        if (!clientId.includes('<->')) {
            return null
        }
        for (const info of catalogIndex.byId.values()) {
            if (clientId.startsWith(`${info.id}_${info.name}<->`)) {
                return { info, label: clientId.slice(info.id.length + 1) }
            }
        }
        return null
    }

    /**
     * Runs one continuous query group and emits a block per trace.
     *
     * Traces are matched to yields by position: the reader yields one segment
     * per requested trace in request order, and the compound key it puts on a
     * montaged segment is not what the viewer matches on, so identity comes
     * from the request-side table.
     */
    const runContinuousGroup = async (
        group: QueryGroup,
        req: ParsedRequest,
        signal: AbortSignal,
        gen: number,
        activeEntry: StreamingClientEntry
    ) => {
        const delivered = new Set<TraceIdentity>()
        try {
            const options: {
                startUs: number
                endUs: number
                pixelWidthUs: number
                raw: boolean
                signal: AbortSignal
                montage?: MontagePair[]
                channels?: string[]
                filter?: FilterSpec
            } = {
                startUs: req.startTime,
                endUs: req.endTime,
                pixelWidthUs: req.pixelWidth,
                raw: req.raw,
                signal
            }
            if (group.isMontage) {
                options.montage = group.montage
            } else {
                options.channels = group.channels
            }
            if (group.filterSpec) {
                options.filter = group.filterSpec
            }

            let index = 0
            for await (const segment of activeEntry.client.query(options)) {
                const identity = group.traces[index]
                index++
                if (!identity || gen !== generation || signal.aborted) {
                    continue
                }
                delivered.add(identity)
                // The legacy useMedian toggle stays at its default: nothing in
                // the package sets it and the transport interface has no setter.
                emitSegment(buildContinuousSegm(segment, identity, req), req)
            }
        } catch (error) {
            if (isAbort(error) || gen !== generation) {
                return
            }
            reportError(describeError(error))
        } finally {
            // An aborted group is left undrained: whoever aborted (a dumpBuffer
            // call or a close) has already cleared the page bookkeeping.
            if (gen === generation && !signal.aborted) {
                for (const identity of group.traces) {
                    if (!delivered.has(identity)) {
                        emitSegment(buildGapSegm(identity, req), req)
                    }
                }
            }
        }
    }

    const runUnitGroup = async (
        traces: TraceIdentity[],
        req: ParsedRequest,
        signal: AbortSignal,
        gen: number,
        activeEntry: StreamingClientEntry
    ) => {
        const delivered = new Set<TraceIdentity>()
        try {
            const options = {
                channels: traces.map((trace) => trace.chId),
                startUs: req.startTime,
                endUs: req.endTime,
                pixelWidthUs: req.pixelWidth,
                signal
            }
            let index = 0
            for await (const batch of activeEntry.client.queryUnits(options)) {
                const identity = traces[index]
                index++
                if (!identity || gen !== generation || signal.aborted) {
                    continue
                }
                delivered.add(identity)
                // Emitted even when the batch is empty; unlike the legacy path,
                // which dropped empty event frames, the transport must respond
                // or the page never completes.
                emitEvent(buildNeuralSegm(batch, identity, req), req)
            }
        } catch (error) {
            if (isAbort(error) || gen !== generation) {
                return
            }
            reportError(describeError(error))
        } finally {
            if (gen === generation && !signal.aborted) {
                for (const identity of traces) {
                    if (!delivered.has(identity)) {
                        emitSegment(buildGapSegm(identity, req), req)
                    }
                }
            }
        }
    }

    const handleDataRequest = async (page: PageRequest) => {
        const gen = generation
        // `raw` is the inverse of the request's `minMax`: the viewer asks for
        // min/max decimation, the reader takes a flag that forces raw samples.
        const req: ParsedRequest = {
            session: null,
            packageId: activePackageId,
            startTime: page.startTime,
            endTime: page.endTime,
            pixelWidth: page.pixelWidth,
            raw: !page.minMax,
            virtualChannels: page.channels
        }

        // Captured up front: a close can null the shared state while queries are
        // still scheduled, and a filtered group may not start until an earlier
        // one has drained.
        const activeEntry = entry
        const activeCatalog = catalogIndex
        if (!activeEntry || !activeCatalog) {
            return
        }

        const { groups, unitTraces, invalid } = partitionRequest(req, activeCatalog, activeEntry.filterRegistry)

        // Yield before emitting anything. Everything above is synchronous, so
        // without this the invalid-trace gaps below would fire inside
        // requestPage(), before the caller has run `requestedPages.set()`, and
        // their page counters would never be initialized, leaving the page
        // stuck until the ten-second sweeper evicts it.
        await Promise.resolve()
        if (gen !== generation) {
            return
        }

        for (const { identity, reason } of invalid) {
            emitSegment(buildGapSegm(identity, req), req)
            reportError({ error: `Cannot read channel ${identity.label}: ${reason}` })
        }

        if (groups.length === 0 && unitTraces.length === 0) {
            return
        }

        const controller = new AbortController()
        activeEntry.inflight.add(controller)
        const signal = controller.signal

        const pending: Promise<void>[] = []
        for (const group of groups) {
            const run = () => runContinuousGroup(group, req, signal, gen, activeEntry)
            if (group.filterSpec) {
                const previous = filterChains.get(group.key) ?? Promise.resolve()
                const next = previous.then(run, run)
                filterChains.set(group.key, next)
                pending.push(next)
            } else {
                pending.push(run())
            }
        }
        if (unitTraces.length > 0) {
            pending.push(runUnitGroup(unitTraces, req, signal, gen, activeEntry))
        }

        try {
            await Promise.all(pending)
        } finally {
            activeEntry.inflight.delete(controller)
        }
    }

    /**
     * Answers a montage switch with fresh channel details, the way the legacy
     * server did. Without this reply the viewer's `isSwitchingMontage` latch
     * never clears and it discards every subsequent segment as stale.
     */
    const handleMontageMessage = async (message: MontageMessage) => {
        const gen = generation
        await Promise.resolve()
        if (gen !== generation || !catalogIndex || !baseDetails) {
            return
        }

        if (message.montage !== 'CUSTOM_MONTAGE') {
            emit('channelDetails', baseDetails)
            return
        }

        const { details, dropped } = synthesizeMontageDetails(message.montageMap, catalogIndex)
        for (const drop of dropped) {
            console.warn(`Montage pair dropped: ${drop.message}`)
        }
        if (details.length === 0) {
            reportError({ error: 'No montage pair could be resolved against this bundle; showing unmontaged channels.' })
            emit('channelDetails', baseDetails)
            return
        }
        // The montage reply carries only id and name, exactly as the legacy
        // reply did; the viewer's montage transition reads only those fields.
        emit('channelDetails', details as ChannelDetail[])
    }

    const open = async (opts: TransportOpenOptions): Promise<void> => {
        if (connectionPromise) {
            // A concurrent open settles on its own; its failure was already
            // reported and must not fail this call before it even starts.
            await connectionPromise.catch(() => undefined)
        }
        if (status.value !== 'disconnected') {
            await close()
        }

        activePackageId = opts.packageId ?? null
        generation++
        const gen = generation
        status.value = 'connecting'

        connectionPromise = (async () => {
            const url = opts.url
            if (!url) {
                throw new Error('createZarrTransport: open() requires a bundle url')
            }

            const opened = await acquireClient(deps.registryKey, url, {
                onUrlExpired: opts.onUrlExpired ?? undefined,
                fetchImpl: deps.fetchImpl
            })
            const index = await ensureCatalog(opened)
            if (gen !== generation) {
                return
            }

            entry = opened
            catalogIndex = index
            baseDetails = index.details
            status.value = 'connected'
            emit('channelDetails', index.details)
        })()

        try {
            await connectionPromise
        } catch (error) {
            if (gen === generation) {
                status.value = 'disconnected'
            }
            connectionPromise = null
            reportError({ error: `Failed to open timeseries bundle: ${(error as { message?: string } | null)?.message ?? error}` })
            throw error
        }
    }

    /**
     * Aborts in-flight work and drops this transport's view of the connection.
     * The registry entry itself stays alive: the catalog is reused across
     * remounts, and disposal belongs to `clearViewerStore`.
     */
    const close = async (): Promise<void> => {
        abortInflight(entry ?? undefined)
        if (entry) {
            entry.filterRegistry.clear()
        }
        filterChains.clear()
        status.value = 'disconnected'
        connectionPromise = null
        entry = null
        catalogIndex = null
        baseDetails = null
        generation++
    }

    const requestPage = (req: PageRequest): boolean => {
        if (status.value !== 'connected' || !entry || !catalogIndex) {
            return false
        }
        void handleDataRequest(req)
        return true
    }

    const setMontage = (message: MontageMessage): void => {
        void handleMontageMessage(message)
    }

    const setFilter = (message: LegacyFilterMessage): void => {
        const activeEntry = entry
        if (!activeEntry) {
            return
        }
        const parsed = legacyFilterToSpec(message)
        if (parsed.kind === 'ignore') {
            reportError({ error: `Filter not applied: ${parsed.reason}` })
            return
        }

        for (const clientId of parsed.channels) {
            const resolved = resolveClientChannel(clientId)
            if (!resolved) {
                continue
            }
            // The UI addresses channels by the client id it minted; the registry
            // is keyed by server id + label, which both sides hold directly.
            const key = filterKey(resolved.info.id, resolved.label)

            if (parsed.kind === 'clear') {
                activeEntry.filterRegistry.delete(key)
                continue
            }

            // A montaged pair has equal rates by construction, so the lead's
            // native rate stands in for the pair.
            const check: SpecValidation = validateSpecForRate(parsed.spec, resolved.info.rateHz)
            if (!check.ok) {
                reportError({ error: `Filter not applied to ${resolved.label}: ${check.reason}` })
                continue
            }
            activeEntry.filterRegistry.set(key, parsed.spec)
        }
    }

    const dumpBuffer = (): boolean => {
        if (status.value !== 'connected') {
            return false
        }
        abortInflight(entry ?? undefined)
        return true
    }

    /**
     * Availability spans from the bundle's coarsest pyramid level, matching the
     * scrubber's Zarr branch: a montaged id resolves to its lead channel, and a
     * unit channel answers no spans because it has no pyramid and would make
     * the reader throw.
     */
    const dataSpans = async (query: DataSpanQuery): Promise<Array<[number, number]>> => {
        const activeEntry = entry
        const resolved = resolveClientChannel(query.channel)
        if (!activeEntry || !resolved || resolved.info.kind === 'unit') {
            return []
        }
        return await activeEntry.client.dataSpans({
            channel: resolved.info.id,
            startUs: query.startUs,
            endUs: query.endUs,
            gapThresholdUs: query.gapThresholdUs
        })
    }

    const measureAmplitudes = async (
        channels: string[],
        startUs: number,
        endUs: number,
        signal?: AbortSignal
    ): Promise<number[]> => {
        const activeEntry = entry
        if (!activeEntry) {
            return channels.map(() => Number.NaN)
        }
        const amplitudes = await surveyAmplitudes(activeEntry.client, channels, startUs, endUs, signal ?? null)
        // The survey omits channels with no finite samples. NaN keeps the result
        // parallel to `channels`, and the autoscale consumer skips non-finite
        // values.
        return channels.map((id) => amplitudes.get(id) ?? Number.NaN)
    }

    const capabilities: TransportCapabilities = {
        maxDurationUs: null,
        pageSizeFor: adaptivePageSize,
        postDumpDelayMs: 0,
        supportsAmplitudeSurvey: true
    }

    return {
        kind: 'zarr',
        status: readonly(status),
        capabilities,
        open,
        close,
        requestPage,
        setMontage,
        setFilter,
        dumpBuffer,
        dataSpans,
        measureAmplitudes,
        on
    }
}
