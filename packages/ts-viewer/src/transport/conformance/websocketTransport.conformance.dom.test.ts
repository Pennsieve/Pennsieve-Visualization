// Conformance run for the websocket transport against a scripted fake socket
// that plays the legacy pennsieve-streaming server: it answers the montage
// handshake with a channelDetails catalog and answers each data request with
// one protobuf-encoded TimeSeriesMessage frame per channel. Lives in the dom
// project because the transport decodes binary frames through FileReader and
// Blob, which the node environment does not provide.
import { describe, it, expect } from 'vitest'
import protobuf from 'protobufjs'
import { runTransportConformance } from './transportConformance'
import type { TransportHarness } from './transportConformance'
import { createWebsocketTransport, timeSeriesProto } from '../websocketTransport'
import type { TransportOpenOptions, VirtualChannelRef } from '../TimeseriesTransport'
import type { ChannelDetail } from '@/composables/streaming/channelDetails'

// In a browser protobufjs cannot require('long'), so uint64 fields decode to
// plain numbers (composables/wire.ts). Vitest runs in node, where the require
// succeeds and uint64 would decode to Long objects instead. Drop Long and
// reconfigure so frames decode as they do in the shipped viewer. Vitest
// isolates test files, so the mutation stays inside this file's run.
;(protobuf.util as { Long?: unknown }).Long = undefined
protobuf.configure()

const PAGE_START = 15000000
const PAGE_END = 30000000
const PIXEL_WIDTH = 250

const channels: VirtualChannelRef[] = [
    { id: 'N:channel:aaa', name: 'CH1' },
    { id: 'N:channel:bbb', name: 'CH2' },
]

// The legacy server sends nothing for a channel with no data in the page; the
// suite skips its drain assertion through drainsEmptyChannel: false.
const emptyChannel: VirtualChannelRef = { id: 'N:channel:empty', name: 'CH3' }

const detailRows: ChannelDetail[] = [...channels, emptyChannel].map((channel) => ({
    id: channel.id,
    name: channel.name,
    channelType: 'CONTINUOUS',
    rate: 250,
    unit: 'uV',
    start: 0,
    end: 3600000000,
    properties: [],
}))

const wireRoot = protobuf.Root.fromJSON(timeSeriesProto)
const timeSeriesMessageType = wireRoot.lookupType('TimeSeriesMessage')

interface DataRequestMessage {
    session: string | null
    minMax: boolean
    startTime: number
    endTime: number
    packageId: string
    pixelWidth: number
    virtualChannels: Array<{ id: string; name: string }>
}

function encodeSegmentFrame(
    channel: { id: string; name: string },
    req: DataRequestMessage,
    totalResponses: number,
): Blob {
    const message = timeSeriesMessageType.create({
        segment: {
            startTs: req.startTime,
            source: channel.id,
            lastUsed: 0,
            unit: 'uV',
            samplePeriod: 1000,
            requestedSamplePeriod: req.pixelWidth,
            pageStart: req.startTime,
            isMinMax: req.minMax,
            unitM: 1,
            segmentType: 'Continuous',
            nrPoints: 2,
            data: [1, 2, 3, 4],
            pageEnd: req.endTime,
            channelName: channel.name,
        },
        totalResponses,
    })
    const bytes = timeSeriesMessageType.encode(message).finish()
    // Copy off the writer's pooled buffer before wrapping it in a Blob.
    return new Blob([new Uint8Array(bytes)])
}

class FakeServerSocket {
    readyState = 0
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onmessage: ((msg: MessageEvent) => void) | null = null
    onerror: ((error: unknown) => void) | null = null
    sent: string[] = []
    private pendingFrames: Array<ReturnType<typeof setTimeout>> = []

    constructor(public readonly url: string) {
        setTimeout(() => {
            if (this.readyState !== 0) {
                return
            }
            this.readyState = 1
            this.onopen?.()
        }, 0)
    }

    send(json: string): void {
        this.sent.push(json)
        if (this.readyState !== 1) {
            return
        }
        const message = JSON.parse(json) as Record<string, unknown>

        if (typeof message.montage === 'string') {
            setTimeout(() => {
                this.dispatch(JSON.stringify({ channelDetails: detailRows }))
            }, 0)
            return
        }

        if (message.requestType === 'DumpBufferRequest') {
            for (const timer of this.pendingFrames) {
                clearTimeout(timer)
            }
            this.pendingFrames = []
            return
        }

        if (typeof message.startTime === 'number') {
            const req = message as unknown as DataRequestMessage
            const withData = req.virtualChannels.filter((channel) => channel.id !== emptyChannel.id)
            for (const channel of withData) {
                const frame = encodeSegmentFrame(channel, req, withData.length)
                const timer = setTimeout(() => {
                    this.dispatch(frame)
                }, 0)
                this.pendingFrames.push(timer)
            }
        }
    }

    close(): void {
        if (this.readyState === 3) {
            return
        }
        this.readyState = 3
        this.onclose?.()
    }

    private dispatch(data: unknown): void {
        if (this.readyState !== 1) {
            return
        }
        this.onmessage?.({ data } as MessageEvent)
    }
}

function makeOpenOptions(): TransportOpenOptions {
    return {
        packageId: 'N:package:pkg-1',
        viewerAssetId: 'viewer-asset-1',
        url: null,
        timeseriesDiscoverApi: 'wss://streaming.test/ts/query',
        timeSeriesApi: 'https://api.test/timeseries',
        getToken: async () => 'session-token-1',
    }
}

function makeHarness(): Promise<TransportHarness> {
    const transport = createWebsocketTransport({
        createSocket: (url: string) => new FakeServerSocket(url) as unknown as WebSocket,
    })
    return Promise.resolve({
        transport,
        openOptions: makeOpenOptions(),
        channels,
        emptyChannel,
        drainsEmptyChannel: false,
        page: { startTime: PAGE_START, endTime: PAGE_END, pixelWidth: PIXEL_WIDTH },
        dispose: async () => {
            await transport.close()
        },
    })
}

runTransportConformance('websocket', makeHarness)

describe('websocket transport dataSpans', () => {
    const makeFetchStub = (responses: Array<Array<[number, number]>>) => {
        const calls: string[] = []
        const fetchImpl = (async (input: RequestInfo | URL) => {
            calls.push(String(input))
            const body = responses[calls.length - 1] ?? []
            return {
                ok: true,
                status: 200,
                json: async () => body,
            } as Response
        }) as typeof fetch
        return { calls, fetchImpl }
    }

    const openTransport = async (fetchImpl: typeof fetch) => {
        const transport = createWebsocketTransport({
            createSocket: (url: string) => new FakeServerSocket(url) as unknown as WebSocket,
            fetchImpl,
        })
        await transport.open(makeOpenOptions())
        return transport
    }

    it('walks the recording in SEGMENTSPAN chunks, trims the boundary overlap, and bridges gaps under the threshold', async () => {
        const { calls, fetchImpl } = makeFetchStub([
            [[0, 500000000000], [600000000000, 1300000000000]],
            [[1250000000000, 1500000000000], [1600000000000, 1900000000000]],
        ])
        const transport = await openTransport(fetchImpl)

        const spans = await transport.dataSpans({
            channel: 'N:channel:aaa',
            startUs: 0,
            endUs: 2000000000000,
            gapThresholdUs: 150000000000,
        })

        expect(calls).toEqual([
            'https://api.test/timeseries/ts/retrieve/segments?session=session-token-1&channel=N:channel:aaa&start=0&end=1209600000000',
            'https://api.test/timeseries/ts/retrieve/segments?session=session-token-1&channel=N:channel:aaa&start=1209600000000&end=2419200000000',
        ])
        // [0, 5e11] and [6e11, 1.3e12] merge across the 1e11 gap; the second
        // chunk's first pair falls to the overlap trim; [1.6e12, 1.9e12] sits
        // past the threshold and stays separate.
        expect(spans).toEqual([
            [0, 1300000000000],
            [1600000000000, 1900000000000],
        ])
        await transport.close()
    })

    it('queries the lead channel for a montaged client id', async () => {
        const { calls, fetchImpl } = makeFetchStub([[[0, 400000]]])
        const transport = await openTransport(fetchImpl)

        const spans = await transport.dataSpans({
            channel: 'N:channel:bbb_F3<->C3',
            startUs: 0,
            endUs: 1000000,
            gapThresholdUs: 1,
        })

        expect(calls).toEqual([
            'https://api.test/timeseries/ts/retrieve/segments?session=session-token-1&channel=N:channel:bbb&start=0&end=1000000',
        ])
        expect(spans).toEqual([[0, 400000]])
        await transport.close()
    })
})
