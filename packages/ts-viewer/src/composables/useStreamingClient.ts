import { ref, readonly, markRaw, inject, onUnmounted } from 'vue'
import { createViewerStore, type ViewerStore } from '@/stores/tsviewer'
import { acquireClient, ensureCatalog, abortInflight } from '@/composables/streaming/clientRegistry'
import { synthesizeMontageDetails } from '@/composables/streaming/channelDetails'
import { legacyFilterToSpec, validateSpecForRate } from '@/composables/streaming/filters'
import { parseRequest, partitionRequest, filterKey } from '@/composables/streaming/translate'
import { buildContinuousSegm, buildGapSegm, buildNeuralSegm } from '@/composables/streaming/segments'
import type { StreamingClientEntry } from '@/composables/streaming/clientRegistry'
import type { CatalogIndex, ChannelDetail } from '@/composables/streaming/channelDetails'
import type { LegacyFilterMessage, SpecValidation } from '@/composables/streaming/filters'
import type { ParsedRequest, QueryGroup, TraceIdentity } from '@/composables/streaming/translate'
import type { NeuralSegmentBlock, SegmentBlock, SegmentEnvelope } from '@/composables/streaming/segments'
import type { CreateStoreOptions } from '@/composables/streaming/createStore'
import type { FilterSpec, MontagePair } from '@pennsieve/timeseries-zarr-reader'

import type { WireSocket } from './useDataRequests'

type ErrorPayload = { error: string; requestedBytes?: number; maxBytes?: number }

type ChannelDetailsPayload = ChannelDetail[] | Array<{ id: string; name: string }> | null

/** JSON message shapes the dispatcher routes on. */
interface DispatchMessage {
    requestType?: unknown
    virtualChannels?: unknown
    filter?: unknown
    channelFiltersToClear?: unknown
    montage?: unknown
    montageMap?: readonly unknown[]
}

/**
 * Reads timeseries data from a Zarr bundle behind the exact surface of `useWebSocket()`.
 *
 * Every legacy interaction funnels through `websocket.value.send(jsonString)` -- not only
 * this composable's own senders, but `useDataRequests.requestDataFromServer`, which is handed
 * the raw socket object and calls `send` on it directly. So the substitute socket is a plain
 * `{readyState, send}` object and one JSON dispatcher reproduces the whole protocol; the
 * exported senders stay the same thin wrappers the legacy composable had.
 *
 * Two invariants hold the viewer's page bookkeeping together:
 *
 * - **No handler ever fires synchronously inside `send()`.** The caller registers its
 *   `requestedPages` entry *after* `send()` returns, so a synchronous response would find no
 *   entry and strand the page counter. Every dispatch path awaits before emitting.
 * - **Exactly one callback per (page, channel), always.** A reader query yields one segment
 *   per trace, and any trace that yields nothing or fails is drained with a `gap` block. That
 *   makes `nrResponses` the constant 1 and lets a page complete without waiting for the
 *   viewer's stuck-request sweeper.
 *
 * @returns The same 15 members `useWebSocket()` returns.
 */
export function useStreamingClient() {
    const viewerStore = inject<ViewerStore>('viewerStore', () => createViewerStore('default'), true)

    const websocket = ref<WireSocket | null>(null)
    const connectionStatus = ref<'connected' | 'disconnected'>('disconnected')

    let onSegmentHandler: ((envelope: SegmentEnvelope) => void) | null = null
    let onEventHandler: ((envelope: SegmentEnvelope) => void) | null = null
    let onChannelDetailsHandler: ((details: ChannelDetailsPayload) => void) | null = null
    let onErrorHandler: ((payload: ErrorPayload) => void) | null = null

    let clearChannelsCallback: (() => void) | null = null
    let activeId: string | null = null
    let activePackageId: string | null = null
    let useMedian = false

    let entry: StreamingClientEntry | null = null
    let catalogIndex: CatalogIndex | null = null
    let baseDetails: ChannelDetail[] | null = null
    let connectionPromise: Promise<void> | null = null

    /**
     * Bumped by every open and every disconnect. Async work captures the value current when
     * it started and re-checks before touching a handler, so a response that outlives its
     * connection is dropped instead of reaching a viewer that has moved on.
     */
    let generation = 0

    /** Serializes filtered queries per filter spec, so the reader's stateful filter advances in send order. */
    const filterChains = new Map<string, Promise<void>>()

    const isAbort = (error: unknown) => (error as { name?: string } | null)?.name === 'AbortError'

    const reportError = (payload: ErrorPayload) => {
        onErrorHandler?.(payload)
    }

    const describeError = (error: unknown): ErrorPayload => {
        // Matched by name rather than `instanceof`: the reader is code-split and loaded
        // dynamically, so this module never holds a reference to its error classes.
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

    /**
     * Emits one segment block. `type` mirrors the legacy envelope: the block's own type when
     * it carries points, `gap` when it does not.
     */
    const emitSegment = (block: SegmentBlock, req: ParsedRequest) => {
        onSegmentHandler?.({
            pageStart: req.startTime,
            data: block,
            type: block.nrPoints > 0 ? block.type : 'gap',
            nrResponses: 1
        })
    }

    const emitEvent = (block: NeuralSegmentBlock, req: ParsedRequest) => {
        onEventHandler?.({
            pageStart: req.startTime,
            data: block,
            type: 'Neural',
            nrResponses: 1
        })
    }

    /**
     * Runs one continuous query group and emits a block per trace.
     *
     * Traces are matched to yields by position: the reader yields one segment per requested
     * trace in request order, and the compound key it puts on a montaged segment is not what
     * the viewer matches on, so identity comes from the request-side table.
     */
    const runContinuousGroup = async (group: QueryGroup, req: ParsedRequest, signal: AbortSignal, gen: number, activeEntry: StreamingClientEntry) => {
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
                emitSegment(buildContinuousSegm(segment, identity, req, { useMedian }), req)
            }
        } catch (error) {
            if (isAbort(error) || gen !== generation) {
                return
            }
            reportError(describeError(error))
        } finally {
            // An aborted group is deliberately left undrained: whoever aborted (a dump-buffer
            // request or a disconnect) has already cleared the page bookkeeping.
            if (gen === generation && !signal.aborted) {
                for (const identity of group.traces) {
                    if (!delivered.has(identity)) {
                        emitSegment(buildGapSegm(identity, req), req)
                    }
                }
            }
        }
    }

    const runUnitGroup = async (traces: TraceIdentity[], req: ParsedRequest, signal: AbortSignal, gen: number, activeEntry: StreamingClientEntry) => {
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
                // Emitted even when the batch is empty; unlike the legacy path, which dropped
                // empty event frames, this shim must respond or the page never completes.
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

    const handleDataRequest = async (message: unknown) => {
        const gen = generation
        const req = parseRequest(message)

        // Captured up front: a disconnect can null the shared state while queries are still
        // scheduled, and a filtered group may not start until an earlier one has drained.
        const activeEntry = entry
        const activeCatalog = catalogIndex
        if (!activeEntry || !activeCatalog) {
            return
        }

        const { groups, unitTraces, invalid } = partitionRequest(req, activeCatalog, activeEntry.filterRegistry)

        // Yield before emitting anything. Everything above is synchronous, so without this
        // the invalid-trace gaps below would fire inside `ws.send()` -- before the caller has
        // run `requestedPages.set()` -- and their page counters would never be initialized,
        // leaving the page stuck until the ten-second sweeper evicts it.
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
     * Answers a montage switch with fresh channel details, the way the legacy server did.
     * Without this reply the viewer's `isSwitchingMontage` latch never clears and it discards
     * every subsequent segment as stale.
     */
    const handleMontageMessage = async (message: DispatchMessage) => {
        const gen = generation
        await Promise.resolve()
        if (gen !== generation || !catalogIndex) {
            return
        }

        if (message.montage !== 'CUSTOM_MONTAGE') {
            onChannelDetailsHandler?.(baseDetails)
            return
        }

        const { details, dropped } = synthesizeMontageDetails(message.montageMap, catalogIndex)
        for (const drop of dropped) {
            console.warn(`Montage pair dropped: ${drop.message}`)
        }
        if (details.length === 0) {
            reportError({ error: 'No montage pair could be resolved against this bundle; showing unmontaged channels.' })
            onChannelDetailsHandler?.(baseDetails)
            return
        }
        onChannelDetailsHandler?.(details)
    }

    const handleFilterMessage = (message: unknown) => {
        if (!entry) {
            return
        }
        const parsed = legacyFilterToSpec(message)
        if (parsed.kind === 'ignore') {
            reportError({ error: `Filter not applied: ${parsed.reason}` })
            return
        }

        for (const clientId of parsed.channels) {
            // The UI addresses channels by the client id it minted; the registry is keyed by
            // server id + label, which the request side can compute without guessing.
            const channel = viewerChannelFor(clientId)
            if (!channel) {
                continue
            }
            const key = filterKey(channel.serverId ?? channel.id, channel.label ?? channel.name)

            if (parsed.kind === 'clear') {
                entry.filterRegistry.delete(key)
                continue
            }

            const rateHz = channel.sf ?? channel.rate ?? rateForServerChannel(channel.serverId ?? channel.id)
            const check: SpecValidation = rateHz ? validateSpecForRate(parsed.spec, rateHz) : { ok: true }
            if (!check.ok) {
                reportError({ error: `Filter not applied to ${channel.label ?? clientId}: ${check.reason}` })
                continue
            }
            entry.filterRegistry.set(key, parsed.spec)
        }
    }

    /** The viewer's own record for a client channel id, which carries serverId and label. */
    const viewerChannelFor = (clientId: string) =>
        (viewerStore.viewerChannels || []).find((channel) => channel.id === clientId) ?? null

    /** Native sample rate straight from the bundle catalog, or null when unknown. */
    const rateForServerChannel = (serverId: string) => catalogIndex?.byId.get(serverId)?.rateHz ?? null

    const handleDumpBuffer = () => {
        abortInflight(entry ?? undefined)
    }

    /** The single entry point for every legacy message, standing in for the socket's wire. */
    const dispatch = (payload: unknown) => {
        let message: DispatchMessage | null
        try {
            message = typeof payload === 'string' ? JSON.parse(payload) : (payload as DispatchMessage | null)
        } catch {
            reportError({ error: 'JSON Parse Error' })
            return
        }
        if (message === null || typeof message !== 'object') {
            return
        }

        if (message.requestType === 'DumpBufferRequest') {
            handleDumpBuffer()
            return
        }
        if (Array.isArray(message.virtualChannels)) {
            void handleDataRequest(message)
            return
        }
        if (message.filter !== undefined || message.channelFiltersToClear !== undefined) {
            handleFilterMessage(message)
            return
        }
        if (message.montage !== undefined) {
            void handleMontageMessage(message)
            return
        }
        console.warn('useStreamingClient: ignoring unrecognized message', message)
    }

    const disconnect = async () => {
        abortInflight(entry ?? undefined)
        if (entry) {
            entry.filterRegistry.clear()
        }
        filterChains.clear()
        websocket.value = null
        connectionStatus.value = 'disconnected'
        connectionPromise = null
        entry = null
        catalogIndex = null
        baseDetails = null
        generation++
    }

    /**
     * Opens a bundle. Every discovery-WebSocket argument is accepted and ignored: the bundle
     * URL comes from the viewer config, so the call site in `initPlotCanvas` needs no change.
     */
    const openWebsocket = async (timeseriesDiscoverApi: string, id: string, userToken: string | null, paramName = 'viewerAsset', packageId: string | null = null) => {
        if (connectionPromise) {
            await connectionPromise
        }
        if (websocket.value) {
            await disconnect()
        }

        activeId = id
        activePackageId = packageId
        generation++
        const gen = generation

        connectionPromise = (async () => {
            // The bundle url rides on the active viewer, not on config, because it describes
            // this package; see fetchAndSetActiveViewer.
            const content = viewerStore.activeViewer?.content
            const url = content?.url
            if (!url) {
                throw new Error('useStreamingClient: the active viewer carries no bundle url')
            }

            const opened = await acquireClient(viewerStore.$id, url, {
                onUrlExpired: content?.onUrlExpired ?? undefined
            })
            const index = await ensureCatalog(opened)
            if (gen !== generation) {
                return
            }

            entry = opened
            catalogIndex = index
            baseDetails = index.details
            websocket.value = markRaw({ readyState: 1, send: dispatch })
            connectionStatus.value = 'connected'

            clearChannelsCallback?.()
            dispatch({ montage: 'NOT_MONTAGED' })
        })()

        try {
            await connectionPromise
        } catch (error) {
            connectionStatus.value = 'disconnected'
            connectionPromise = null
            reportError({ error: `Failed to open timeseries bundle: ${(error as { message?: string } | null)?.message ?? error}` })
            throw error
        }
    }

    const send = (message: unknown) => {
        if (websocket.value && websocket.value.readyState === 1) {
            websocket.value.send(JSON.stringify(message))
            return true
        }
        return false
    }

    const sendMontageMessage = (montageScheme: unknown) => {
        let payload
        switch (montageScheme) {
            case 'NOT_MONTAGED':
                payload = { montage: 'NOT_MONTAGED', packageId: activePackageId || activeId }
                break
            default:
                payload = { montage: 'CUSTOM_MONTAGE', packageId: activePackageId || activeId, montageMap: montageScheme }
        }
        send(payload)
    }

    const sendFilterMessage = (msg: LegacyFilterMessage) => {
        if (websocket.value && websocket.value.readyState === 1) {
            websocket.value.send(JSON.stringify(msg))
        } else {
            setTimeout(() => sendFilterMessage(msg), 200)
        }
    }

    const sendDumpBufferRequest = () => {
        if (websocket.value && websocket.value.readyState === 1) {
            websocket.value.send(JSON.stringify({ requestType: 'DumpBufferRequest' }))
            return true
        }
        console.warn('Cannot send dump buffer request - streaming client not connected')
        return false
    }

    const onSegment = (handler: (envelope: SegmentEnvelope) => void) => { onSegmentHandler = handler }
    const onEvent = (handler: (envelope: SegmentEnvelope) => void) => { onEventHandler = handler }
    const onChannelDetails = (handler: (details: ChannelDetailsPayload) => void) => { onChannelDetailsHandler = handler }
    const onError = (handler: (payload: ErrorPayload) => void) => { onErrorHandler = handler }

    onUnmounted(async () => {
        await disconnect()
    })

    const setClearChannelsCallback = (callback: () => void) => { clearChannelsCallback = callback }
    const setActiveId = (id: string) => { activeId = id }
    const setUseMedian = (value: boolean) => { useMedian = value }

    return {
        websocket: readonly(websocket),
        connectionStatus: readonly(connectionStatus),
        openWebsocket,
        send,
        sendMontageMessage,
        sendFilterMessage,
        sendDumpBufferRequest,
        disconnect,
        setClearChannelsCallback,
        setActiveId,
        setUseMedian,
        onSegment,
        onEvent,
        onChannelDetails,
        onError
    }
}
