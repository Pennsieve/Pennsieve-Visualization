// @/composables/useWebSocket.ts
import { ref, onUnmounted, readonly } from 'vue'
import protobuf from 'protobufjs'
import { useToken } from "@/composables/useToken"
import type { TimeSeriesMessage } from '@/composables/wire'
import type { LegacyFilterMessage } from '@/composables/streaming/filters'

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

export const useWebSocket = () => {
    const websocket = ref<WebSocket | null>(null)
    const connectionStatus = ref<'connected' | 'disconnected'>('disconnected')
    const initWebsocket = ref(true)

    // Protocol buffer definition from original
    const proto = {
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

    // Initialize protobuf
    const protobufInstance = protobuf.Root.fromJSON(proto)
    const timeSeriesMessage = (protobufInstance as protobuf.Root & { TimeSeriesMessage: protobuf.Type }).TimeSeriesMessage

    // Message handlers
    let onSegmentHandler: ((envelope: WebSocketSegmentEnvelope) => void) | null = null
    let onEventHandler: ((envelope: WebSocketEventEnvelope) => void) | null = null
    let onChannelDetailsHandler: ((details: unknown) => void) | null = null
    let onErrorHandler: ((payload: Record<string, unknown>) => void) | null = null

    let clearChannelsCallback: (() => void) | null = null
    // `activeId` holds whichever ID type the caller provided: a viewer-asset
    // UUID or a package node ID. `idParamName` tracks which it is so the
    // WebSocket URL uses the matching query param.
    let activeId: string | null = null
    let activePackageId: string | null = null
    let idParamName = 'viewerAsset'

    // Configuration - can be set from outside
    let useMedian = false

    let connectionPromise: Promise<WebSocket | null> | null = null

    const waitForWebSocketToClose = (ws: WebSocket, timeout = 2000) => {
        return new Promise<void>((resolve) => {
            if (!ws || ws.readyState === WebSocket.CLOSED) {
                resolve()
                return
            }

            const startTime = Date.now()
            const checkState = () => {
                if (ws.readyState === WebSocket.CLOSED || Date.now() - startTime > timeout) {
                    resolve()
                } else {
                    setTimeout(checkState, 50)
                }
            }

            checkState()
        })
    }

    const disconnect = async () => {
        if (websocket.value) {
            const ws = websocket.value
            websocket.value = null
            connectionStatus.value = 'disconnected'

            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close()
                // Wait for WebSocket to actually close
                await waitForWebSocketToClose(ws)
            }
        }

        // Reset connection promise
        connectionPromise = null
    }

    const openWebsocket = async (timeseriesDiscoverApi: string, id: string, userToken: string | null, paramName = 'viewerAsset', packageId: string | null = null) => {
        // If there's already a connection in progress, wait for it
        if (connectionPromise) {
            await connectionPromise
        }

        // Handle all WebSocket states, including CLOSING
        if (websocket.value) {
            const currentState = websocket.value.readyState

            if (currentState === WebSocket.CONNECTING ||
                currentState === WebSocket.OPEN ||
                currentState === WebSocket.CLOSING) {

                await disconnect()

                // Small delay so the old socket closes before the new one opens
                await new Promise(resolve => setTimeout(resolve, 100))
            }
        }

        activeId = id
        activePackageId = packageId
        idParamName = paramName

        initWebsocket.value = true

        // A shared promise so concurrent open calls wait on one connection
        connectionPromise = new Promise((resolve, reject) => {
            void (async () => {
            try {
                const token = userToken || await useToken()
                let url = timeseriesDiscoverApi + '?session=' + token + '&' + idParamName + '=' + activeId
                if (activePackageId && idParamName !== 'package') {
                    url += '&package=' + activePackageId
                }

                const ws = new WebSocket(url)
                websocket.value = ws

                ws.onopen = () => {
                    onWebsocketOpen()
                    resolve(ws)
                }

                ws.onclose = () => {
                    onWebsocketClose()
                    resolve(null)
                }

                ws.onmessage = onWebsocketMessage

                ws.onerror = (error) => {
                    console.error('WebSocket error:', error)
                    connectionStatus.value = 'disconnected'
                    reject(error)
                }

                setTimeout(() => {
                    if (ws.readyState === WebSocket.CONNECTING) {
                        ws.close()
                        reject(new Error('WebSocket connection timeout'))
                    }
                }, 10000) // 10 second timeout

            } catch (error) {
                console.error('Failed to create WebSocket:', error)
                reject(error)
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

    const onWebsocketOpen = () => {
        connectionStatus.value = 'connected'

        if (initWebsocket.value) {
            // Clear filters on initial connection
            if (clearChannelsCallback) {
                clearChannelsCallback()
            }

            // Clear montage
            if (activeId) {
                const payload = { montage: 'NOT_MONTAGED', packageId: activePackageId || activeId }
                websocket.value!.send(JSON.stringify(payload))
            }
            initWebsocket.value = false
        }
    }

    const onWebsocketClose = () => {
        connectionStatus.value = 'disconnected'
        // Don't auto-reconnect here - let the component handle it
    }

    const onWebsocketMessage = (msg: MessageEvent) => {
        // Process JSON messages
        if (typeof msg.data === 'string') {
            let data: Record<string, unknown> = {}
            try {
                data = JSON.parse(msg.data)
            } catch (e) {
                onErrorHandler?.({ error: 'JSON Parse Error' })
                return
            }

            if (data.channelDetails) {
                onChannelDetailsHandler?.(data.channelDetails)
            } else if (data.error) {
                onErrorHandler?.(data)
            }
            return
        }

        // Process protobuf messages
        const myReader = new FileReader()
        myReader.addEventListener('loadend', function(e) {
            const buffer = (e.target as FileReader).result as ArrayBuffer
            const barray = new Uint8Array(buffer)

            const timeSeriesMsg = timeSeriesMessage.decode(barray) as unknown as TimeSeriesMessage
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

                let cData: Float32Array[] = new Array(3)
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

                onEventHandler?.({
                    pageStart: tsEvent.pageStart,
                    data: segm,
                    type: 'Neural',
                    nrResponses: timeSeriesMsg.totalResponses
                })
            }

            // Handle Regular Timeseries data
            if (segment !== null) {
                let nrVal: number | null = null
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
                        let curY = -segment.data[curI]
                        let curY2 = -segment.data[curI + 1]
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
                        let curY = -segment.data[i]
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
                    elemMedian = sortedYvals[Math.round(sortedYvals.length / 2)]
                }

                let cData: Float32Array[] = new Array(3)
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
                    onSegmentHandler?.({
                        pageStart: segment.pageStart,
                        data: segm,
                        type: segment.segmentType,
                        nrResponses: timeSeriesMsg.totalResponses
                    })
                } else {
                    onSegmentHandler?.({
                        pageStart: segment.pageStart,
                        data: segm,
                        nrResponses: timeSeriesMsg.totalResponses,
                        type: 'gap'
                    })
                }
            }
        })

        myReader.readAsArrayBuffer(msg.data)
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
            case "NOT_MONTAGED":
                payload = { montage: "NOT_MONTAGED", packageId: activePackageId || activeId }
                break
            default:
                payload = { montage: "CUSTOM_MONTAGE", packageId: activePackageId || activeId, montageMap: montageScheme }
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
            const message = {
                requestType: 'DumpBufferRequest',
            }
            websocket.value.send(JSON.stringify(message))
            return true
        }
        console.warn('Cannot send dump buffer request: WebSocket not connected')
        return false
    }

    // Event handler setters
    const onSegment = (handler: (envelope: WebSocketSegmentEnvelope) => void) => { onSegmentHandler = handler }
    const onEvent = (handler: (envelope: WebSocketEventEnvelope) => void) => { onEventHandler = handler }
    const onChannelDetails = (handler: (details: unknown) => void) => { onChannelDetailsHandler = handler }
    const onError = (handler: (payload: Record<string, unknown>) => void) => { onErrorHandler = handler }

    onUnmounted(async () => {
        await disconnect()
    })

    // Configuration setters
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