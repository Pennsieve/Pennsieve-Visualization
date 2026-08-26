// The legacy pennsieve-streaming WebSocket behind the TimeseriesTransport
// interface. Socket lifecycle, protobuf decode, and wire JSON carry the
// pre-transport viewer behavior forward unchanged; the wire test pins the
// request JSON byte for byte. The segment-span walk is ported from
// components/TSViewer/TSScrubber.vue.
import { ref } from 'vue'
import protobuf from 'protobufjs'
import { useToken } from '@/composables/useToken'
import { BASE_PAGE_SIZE } from '@/composables/streaming/paging'
import type { TimeSeriesMessage } from '@/composables/wire'
import type { ChannelDetail } from '@/composables/streaming/channelDetails'
import type { LegacyFilterMessage } from '@/composables/streaming/filters'
import type {
    TimeseriesTransport,
    TransportOpenOptions,
    TransportStatus,
    TransportCapabilities,
    TransportEvents,
    TransportError,
    PageRequest,
    MontageMessage,
    DataSpanQuery,
} from './TimeseriesTransport'

/** Continuous block built from one decoded wire segment; `type` echoes the wire's `segmentType`. */
export interface WebSocketSegmentBlock {
    chId: string
    lastUsed: number
    unit: string
    samplePeriod: number
    requestedSamplePeriod: number
    pageStart: number
    pageEnd: number
    startTs: number
    isMinMax: boolean
    unitM: number
    type: string
    nrPoints: number
    cData: Float32Array[]
    parsedData: Float64Array[]
    median: number
    sumElem: number
    nrValidPoints: number
    name: string
    label: string
}

/** Neural block built from one decoded wire event; rows of `parsedData` hold event start and end times. */
export interface WebSocketNeuralBlock {
    chId: string
    lastUsed: number
    unit: string
    samplePeriod: number
    pageStart: number
    pageEnd: number
    startTs: number
    isMinMax: boolean
    unitM: number
    type: 'Neural'
    nrPoints: number
    parsedData: number[][]
    cData: Float32Array[]
}

export interface WebSocketSegmentEnvelope {
    pageStart: number
    data: WebSocketSegmentBlock
    type: string
    nrResponses: number
}

export interface WebSocketEventEnvelope {
    pageStart: number
    data: WebSocketNeuralBlock
    type: 'Neural'
    nrResponses: number
}

// Values from the constants object in components/TSViewer/TSViewer.vue
// (MAXDURATION, SEGMENTSPAN, MAXRECURSION); the component keeps them in a
// local literal and exports nothing.
const MAX_DURATION_US = 600000000
const SEGMENT_SPAN_US = 1209600000000
const MAX_RECURSION = 20

// WHATWG readyState values, named locally so this module never reads statics
// off a global WebSocket constructor that a node test runtime may not define.
const SOCKET_CONNECTING = 0
const SOCKET_OPEN = 1
const SOCKET_CLOSING = 2
const SOCKET_CLOSED = 3

/**
 * Wire schema for the streaming service's binary frames. Exported so tests
 * encode frames with the same schema.
 */
export const timeSeriesProto: protobuf.INamespace = {
    'nested': {
        'Event': {
            'fields': {
                'source': { 'type': 'string', 'id': 1 },
                'pageStart': { 'type': 'uint64', 'id': 2 },
                'pageEnd': { 'type': 'uint64', 'id': 3 },
                'samplePeriod': { 'type': 'double', 'id': 4 },
                'pointsPerEvent': { 'type': 'uint64', 'id': 5 },
                'isResampled': { 'type': 'bool', 'id': 6 },
                'data': { 'rule': 'repeated', 'type': 'double', 'id': 7 },
                'times': { 'rule': 'repeated', 'type': 'uint64', 'id': 8 },
                'spikeGroup': { 'rule': 'repeated', 'type': 'uint32', 'id': 9 }
            }
        },
        'Instruction': {
            'fields': {
                'command': { 'type': 'string', 'id': 1 },
                'argument': { 'type': 'string', 'id': 2 }
            }
        },
        'Segment': {
            'fields': {
                'startTs': { 'type': 'uint64', 'id': 1 },
                'source': { 'type': 'string', 'id': 2 },
                'lastUsed': { 'type': 'uint64', 'id': 3 },
                'unit': { 'type': 'string', 'id': 4 },
                'samplePeriod': { 'type': 'double', 'id': 5 },
                'requestedSamplePeriod': { 'type': 'double', 'id': 6 },
                'pageStart': { 'type': 'uint64', 'id': 7 },
                'isMinMax': { 'type': 'bool', 'id': 8 },
                'unitM': { 'type': 'uint64', 'id': 9 },
                'segmentType': { 'type': 'string', 'id': 10 },
                'nrPoints': { 'type': 'uint64', 'id': 11 },
                'data': { 'rule': 'repeated', 'type': 'double', 'id': 12 },
                'pageEnd': { 'type': 'uint64', 'id': 13 },
                'channelName': { 'type': 'string', 'id': 14 }
            }
        },
        'IngestSegment': {
            'fields': {
                'channelId': { 'type': 'string', 'id': 1 },
                'startTime': { 'type': 'uint64', 'id': 2 },
                'samplePeriod': { 'type': 'double', 'id': 3 },
                'data': { 'rule': 'repeated', 'type': 'double', 'id': 4 }
            }
        },
        'TimeSeriesMessage': {
            'fields': {
                'segment': { 'type': 'Segment', 'id': 3 },
                'event': { 'rule': 'repeated', 'type': 'Event', 'id': 4 },
                'instruction': { 'type': 'Instruction', 'id': 5 },
                'ingestSegment': { 'type': 'IngestSegment', 'id': 6 },
                'totalResponses': { 'type': 'uint64', 'id': 7 },
                'responseSequenceId': { 'type': 'uint64', 'id': 8 }
            }
        }
    }
}

const wireRoot = protobuf.Root.fromJSON(timeSeriesProto)
const timeSeriesMessageType = wireRoot.lookupType('TimeSeriesMessage')

// TSViewer ships USEMEDIAN: false and nothing flips it; the transport fixes
// the same default.
const useMedian = false

export interface WebsocketTransportDeps {
    createSocket?: (url: string) => WebSocket
    fetchImpl?: typeof fetch
}

/**
 * Lead channel id for a montaged client id. A montaged trace's client id is
 * `${leadId}_${lead<->secondary}` and Pennsieve channel ids contain no
 * underscore, so the first underscore before the montage marker separates the
 * lead id from the composite label.
 */
function leadChannelId(channel: string): string {
    const marker = channel.indexOf('<->')
    if (marker < 0) {
        return channel
    }
    const separator = channel.indexOf('_')
    if (separator < 0 || separator > marker) {
        return channel
    }
    return channel.slice(0, separator)
}

/** Merges ordered spans, bridging a gap narrower than `gapThresholdUs`. */
function mergeSpans(
    spans: Array<[number, number]>,
    gapThresholdUs: number,
): Array<[number, number]> {
    const merged: Array<[number, number]> = []
    for (const [startUs, endUs] of spans) {
        const last = merged[merged.length - 1]
        if (last && startUs - last[1] < gapThresholdUs) {
            if (endUs > last[1]) {
                last[1] = endUs
            }
        } else {
            merged.push([startUs, endUs])
        }
    }
    return merged
}

type HandlerSets = {
    [K in keyof TransportEvents]: Set<(payload: TransportEvents[K]) => void>
}

export function createWebsocketTransport(deps: WebsocketTransportDeps = {}): TimeseriesTransport {
    const createSocket = deps.createSocket ?? ((url: string) => new WebSocket(url))
    // Wrapped so an injected implementation is used as given while the global
    // fetch keeps its required globalThis receiver.
    const fetchImpl: typeof fetch =
        deps.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))

    const status = ref<TransportStatus>('disconnected')

    let websocket: WebSocket | null = null
    let connectionPromise: Promise<WebSocket | null> | null = null
    let initSocket = true
    /** Whether a catalog has arrived on this transport before, across reconnects. */
    let hasReceivedDetails = false

    // `activeId` holds whichever id the open options provide: a viewer-asset
    // UUID or a package node id. `idParamName` tracks which it is so the
    // WebSocket URL uses the matching query param.
    let activeId: string | null = null
    let activePackageId: string | null = null
    let idParamName = 'viewerAsset'
    let packageId: string | null = null
    let timeSeriesApi: string | null = null
    let sessionToken: string | null = null
    let getToken: () => Promise<string | null> = useToken

    const handlers: HandlerSets = {
        segment: new Set(),
        event: new Set(),
        channelDetails: new Set(),
        error: new Set(),
    }

    // The catalog is emitted once per connection, but subscribers arrive on
    // their own schedule: the viewer's canvases are async components, so one
    // can mount after open() has already answered. Latching the last catalog
    // and replaying it on subscribe keeps a late subscriber from waiting
    // forever for an event that has already happened.
    let lastChannelDetails: ChannelDetail[] | null = null

    function emit<K extends keyof TransportEvents>(event: K, payload: TransportEvents[K]): void {
        if (event === 'channelDetails') {
            lastChannelDetails = payload as ChannelDetail[]
        }
        for (const handler of handlers[event]) {
            handler(payload)
        }
    }

    function on<K extends keyof TransportEvents>(
        event: K,
        handler: (payload: TransportEvents[K]) => void,
    ): () => void {
        handlers[event].add(handler)

        if (event === 'channelDetails' && lastChannelDetails) {
            const latched = lastChannelDetails
            // Delivered asynchronously so subscribing never runs a handler
            // inside the caller's own registration.
            queueMicrotask(() => {
                if (handlers[event].has(handler) && lastChannelDetails === latched) {
                    (handler as (payload: ChannelDetail[]) => void)(latched)
                }
            })
        }

        return () => {
            handlers[event].delete(handler)
        }
    }

    const waitForWebSocketToClose = (ws: WebSocket, timeout = 2000): Promise<void> => {
        return new Promise<void>((resolve) => {
            if (!ws || ws.readyState === SOCKET_CLOSED) {
                resolve()
                return
            }

            const startTime = Date.now()
            const checkState = () => {
                if (ws.readyState === SOCKET_CLOSED || Date.now() - startTime > timeout) {
                    resolve()
                } else {
                    setTimeout(checkState, 50)
                }
            }

            checkState()
        })
    }

    const close = async (): Promise<void> => {
        // The catalog belongs to the connection that produced it.
        lastChannelDetails = null

        if (websocket) {
            const ws = websocket
            websocket = null
            status.value = 'disconnected'

            if (ws.readyState === SOCKET_OPEN || ws.readyState === SOCKET_CONNECTING) {
                ws.close()
                await waitForWebSocketToClose(ws)
            }
        }

        connectionPromise = null
    }

    const onSocketOpen = () => {
        status.value = 'connected'

        if (initSocket) {
            // Same initial payload the discovery path (useChannelDataRequest)
            // sends; the server answers it with the channelDetails catalog.
            if (activeId) {
                const payload = { montage: 'NOT_MONTAGED', packageId: activePackageId || activeId }
                websocket?.send(JSON.stringify(payload))
            }
            initSocket = false
        }
    }

    const onSocketClose = () => {
        status.value = 'disconnected'
        // No auto-reconnect here; the caller decides when to reopen.
    }

    const onSocketMessage = (msg: MessageEvent) => {
        // Process JSON messages
        if (typeof msg.data === 'string') {
            let data: Record<string, unknown> = {}
            try {
                data = JSON.parse(msg.data) as Record<string, unknown>
            } catch {
                emit('error', { error: 'JSON Parse Error' })
                return
            }

            if (data.channelDetails) {
                const details = data.channelDetails as ChannelDetail[]
                // A reconnect inherits whatever filters the server still holds for
                // this session, so the first catalog after a reconnect clears them.
                // The very first connection has nothing to clear.
                if (hasReceivedDetails && details.length > 0) {
                    websocket?.send(JSON.stringify({
                        channelFiltersToClear: details.map((detail) => detail.id)
                    }))
                }
                hasReceivedDetails = true
                emit('channelDetails', details)
            } else if (data.error) {
                emit('error', data as unknown as TransportError)
            }
            return
        }

        // Process protobuf messages
        const myReader = new FileReader()
        myReader.addEventListener('loadend', function (e) {
            const buffer = (e.target as FileReader).result as ArrayBuffer
            const barray = new Uint8Array(buffer)

            const timeSeriesMsg = timeSeriesMessageType.decode(barray) as unknown as TimeSeriesMessage
            const segment = timeSeriesMsg.segment

            // Handle Neural Data
            if (timeSeriesMsg.event && timeSeriesMsg.event.length > 0 && timeSeriesMsg.event[0].pageStart) {
                const tsEvent = timeSeriesMsg.event[0]
                const dataPoints: number[][] = [[], []]
                const nrVal = tsEvent.times.length / 2

                let curI = 0
                for (let i = 0; i < nrVal; i++) {
                    dataPoints[0].push(tsEvent.times[curI])
                    dataPoints[1].push(tsEvent.times[curI + 1])
                    curI += 2
                }

                const cData: Float32Array[] = new Array(3)
                let k = 0
                while (k < 3) {
                    cData[k] = new Float32Array(dataPoints[0].length)
                    k++
                }

                const segm: WebSocketNeuralBlock = {
                    chId: tsEvent.source,
                    lastUsed: 0,
                    unit: 'uV',
                    samplePeriod: tsEvent.samplePeriod,
                    pageStart: tsEvent.pageStart,
                    pageEnd: tsEvent.pageEnd,
                    startTs: tsEvent.pageStart,
                    isMinMax: tsEvent.isResampled,
                    unitM: 1,
                    type: 'Neural',
                    nrPoints: nrVal,
                    parsedData: dataPoints,
                    cData: cData
                }

                const envelope: WebSocketEventEnvelope = {
                    pageStart: tsEvent.pageStart,
                    data: segm,
                    type: 'Neural',
                    nrResponses: timeSeriesMsg.totalResponses
                }
                emit('event', envelope)
            }

            // Handle Regular Timeseries data
            if (segment !== null) {
                let nrVal: number
                if (segment.isMinMax) {
                    nrVal = segment.data.length / 2
                } else {
                    nrVal = segment.data.length
                }

                const parsedData: Float64Array[] = new Array(3)
                const startTs = segment.startTs

                let sumElem = 0
                let nrValidPoints = 0
                let i = 0
                while (i < 3) {
                    parsedData[i] = new Float64Array(nrVal)
                    i++
                }

                if (segment.isMinMax) {
                    let curI = 0
                    for (let i = 0; i < nrVal; i++) {
                        const curY = -segment.data[curI]
                        const curY2 = -segment.data[curI + 1]
                        parsedData[0][i] = startTs + (i * segment.samplePeriod)
                        parsedData[1][i] = curY
                        parsedData[2][i] = curY2
                        if (!isNaN(curY)) {
                            nrValidPoints++
                            sumElem += curY + (curY2 - curY) / 2
                        }
                        curI += 2
                    }
                } else {
                    for (let i = 0; i < nrVal; i++) {
                        const curY = -segment.data[i]
                        parsedData[0][i] = startTs + (i * segment.samplePeriod)
                        parsedData[1][i] = curY
                        if (!isNaN(curY)) {
                            nrValidPoints++
                            sumElem += curY
                        }
                    }
                }

                let elemMedian = 0
                if (useMedian) {
                    const sortedYvals = Array.prototype.slice.call(parsedData[1]).sort()
                    elemMedian = sortedYvals[Math.round(sortedYvals.length / 2)] as number
                }

                const cData: Float32Array[] = new Array(3)
                let k = 0
                while (k < 3) {
                    cData[k] = new Float32Array(parsedData[0].length)
                    k++
                }

                const segm: WebSocketSegmentBlock = {
                    chId: segment.source,
                    lastUsed: segment.lastUsed,
                    unit: segment.unit,
                    samplePeriod: segment.samplePeriod,
                    // Zero when the server leaves the field unset; the viewer treats a
                    // non-positive value as unknown and accepts the block.
                    requestedSamplePeriod: segment.requestedSamplePeriod,
                    pageStart: segment.pageStart,
                    pageEnd: segment.pageEnd,
                    startTs: startTs,
                    isMinMax: segment.isMinMax,
                    unitM: segment.unitM,
                    type: segment.segmentType,
                    nrPoints: nrVal,
                    cData: cData,
                    parsedData: parsedData,
                    median: elemMedian,
                    sumElem: sumElem,
                    nrValidPoints: nrValidPoints,
                    name: segment.channelName,
                    label: segment.channelName,
                }

                if (segm.nrPoints > 0) {
                    const envelope: WebSocketSegmentEnvelope = {
                        pageStart: segment.pageStart,
                        data: segm,
                        type: segment.segmentType,
                        nrResponses: timeSeriesMsg.totalResponses
                    }
                    emit('segment', envelope)
                } else {
                    const envelope: WebSocketSegmentEnvelope = {
                        pageStart: segment.pageStart,
                        data: segm,
                        nrResponses: timeSeriesMsg.totalResponses,
                        type: 'gap'
                    }
                    emit('segment', envelope)
                }
            }
        })

        myReader.readAsArrayBuffer(msg.data as Blob)
    }

    const open = async (opts: TransportOpenOptions): Promise<void> => {
        // If a connection is already in progress, wait for it
        if (connectionPromise) {
            await connectionPromise
        }

        // Handle all WebSocket states, including CLOSING
        if (websocket) {
            const currentState = websocket.readyState

            if (currentState === SOCKET_CONNECTING ||
                currentState === SOCKET_OPEN ||
                currentState === SOCKET_CLOSING) {

                await close()

                // Small delay so the old socket closes before the new one opens
                await new Promise((resolve) => setTimeout(resolve, 100))
            }
        }

        const discoverApi = opts.timeseriesDiscoverApi
        if (!discoverApi) {
            throw new Error('open needs timeseriesDiscoverApi in the open options for the websocket transport')
        }

        // Same id selection as TSPlotCanvas.initPlotCanvas: the viewer-asset
        // UUID rides `?viewerAsset=` with the package id alongside; without a
        // viewer asset the package id itself is the socket id.
        if (opts.viewerAssetId) {
            activeId = opts.viewerAssetId
            idParamName = 'viewerAsset'
            activePackageId = opts.packageId
        } else {
            activeId = opts.packageId
            idParamName = 'package'
            activePackageId = null
        }
        packageId = opts.packageId
        timeSeriesApi = opts.timeSeriesApi ?? null
        getToken = opts.getToken ?? useToken

        initSocket = true
        status.value = 'connecting'

        // A shared promise so concurrent open calls wait on one connection
        connectionPromise = new Promise((resolve, reject) => {
            void (async () => {
                try {
                    const token = await getToken()
                    sessionToken = token
                    let url = discoverApi + '?session=' + token + '&' + idParamName + '=' + activeId
                    if (activePackageId && idParamName !== 'package') {
                        url += '&package=' + activePackageId
                    }

                    const ws = createSocket(url)
                    websocket = ws

                    ws.onopen = () => {
                        onSocketOpen()
                        resolve(ws)
                    }

                    ws.onclose = () => {
                        onSocketClose()
                        resolve(null)
                    }

                    ws.onmessage = onSocketMessage

                    ws.onerror = (error) => {
                        console.error('WebSocket error:', error)
                        status.value = 'disconnected'
                        reject(error as unknown as Error)
                    }

                    setTimeout(() => {
                        if (ws.readyState === SOCKET_CONNECTING) {
                            ws.close()
                            reject(new Error('WebSocket connection timeout'))
                        }
                    }, 10000) // 10 second timeout

                } catch (error) {
                    console.error('Failed to create WebSocket:', error)
                    reject(error as Error)
                }
            })()
        })

        try {
            await connectionPromise
        } catch (error) {
            console.error('WebSocket connection failed:', error)
            connectionPromise = null
        }
    }

    const requestPage = (req: PageRequest): boolean => {
        if (!websocket || websocket.readyState !== SOCKET_OPEN) {
            return false
        }

        const virtualChannels = req.channels.map((channel) => {
            return {
                id: channel.id,
                name: channel.name
            }
        })

        // Field order matches the retired legacy sender so the serialized
        // JSON is byte-identical; websocketTransport.wire.test.ts pins it.
        const payload = {
            session: sessionToken,
            minMax: req.minMax,
            startTime: req.startTime,
            endTime: req.endTime,
            packageId: packageId,
            pixelWidth: req.pixelWidth,
            virtualChannels
        }

        websocket.send(JSON.stringify(payload))
        return true
    }

    const setMontage = (message: MontageMessage): void => {
        if (websocket && websocket.readyState === SOCKET_OPEN) {
            websocket.send(JSON.stringify(message))
        }
    }

    const setFilter = (message: LegacyFilterMessage): void => {
        if (websocket && websocket.readyState === SOCKET_OPEN) {
            websocket.send(JSON.stringify(message))
        } else {
            // Filters can arrive while the socket is still dialing; retry
            // until it is open, as sendFilterMessage does.
            setTimeout(() => setFilter(message), 200)
        }
    }

    const dumpBuffer = (): boolean => {
        if (websocket && websocket.readyState === SOCKET_OPEN) {
            const message = {
                requestType: 'DumpBufferRequest',
            }
            websocket.send(JSON.stringify(message))
            return true
        }
        console.warn('Cannot send dump buffer request: WebSocket not connected')
        return false
    }

    const dataSpans = async (query: DataSpanQuery): Promise<Array<[number, number]>> => {
        if (!timeSeriesApi) {
            throw new Error('dataSpans needs timeSeriesApi in the open options for the websocket transport')
        }

        const token = await getToken()
        const channel = leadChannelId(query.channel)
        const spans: Array<[number, number]> = []

        // One SEGMENTSPAN-sized request per chunk, MAXRECURSION chunks at
        // most, as TSScrubber._requestSegmentSpan walks the recording.
        const chunkSpan = Math.min(SEGMENT_SPAN_US, query.endUs - query.startUs)
        let start = query.startUs
        let end = start + chunkSpan

        for (let ix = 0; ; ix++) {
            const url = `${timeSeriesApi}/ts/retrieve/segments?session=${token}&channel=${channel}&start=${start}&end=${end}`
            const response = await fetchImpl(url)
            if (!response.ok) {
                throw new Error(`segment span request failed with HTTP status ${response.status}`)
            }
            const pairs = (await response.json()) as Array<[number, number]>

            // Adjacent chunks can return the same span at the boundary; the
            // scrubber drops the repeated first pair the same way.
            if (pairs.length > 0 && spans.length > 0 && pairs[0][0] < spans[spans.length - 1][1]) {
                pairs.shift()
            }
            for (const pair of pairs) {
                spans.push([pair[0], pair[1]])
            }

            const span = end - start
            if ((start + span) < query.endUs && ix < MAX_RECURSION) {
                start = end
                end = end + span
            } else {
                break
            }
        }

        return mergeSpans(spans, query.gapThresholdUs)
    }

    const capabilities: TransportCapabilities = {
        maxDurationUs: MAX_DURATION_US,
        pageSizeFor: () => BASE_PAGE_SIZE,
        prefetchPages: 5,
        postDumpDelayMs: 50,
        supportsAmplitudeSurvey: false,
    }

    return {
        kind: 'websocket',
        status,
        capabilities,
        open,
        close,
        requestPage,
        setMontage,
        setFilter,
        dumpBuffer,
        dataSpans,
        on,
    }
}
