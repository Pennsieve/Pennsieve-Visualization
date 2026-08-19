// Wire parity: for equivalent inputs, requestPage sends the same JSON strings
// that requestDataFromServer sends. The expected literals are copied from the
// inline snapshots in composables/useDataRequests.wire.test.ts, which pin the
// legacy payloads.
import { describe, it, expect } from 'vitest'
import { createWebsocketTransport } from './websocketTransport'
import type { TransportOpenOptions } from './TimeseriesTransport'
import { BASE_PAGE_SIZE } from '@/composables/streaming/paging'

const PAGE = BASE_PAGE_SIZE
const TS_END = 3600000000

class RecordingSocket {
    readyState = 0
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onmessage: ((msg: MessageEvent) => void) | null = null
    onerror: ((error: unknown) => void) | null = null
    sent: string[] = []

    constructor(public readonly url: string) {
        setTimeout(() => {
            this.readyState = 1
            this.onopen?.()
        }, 0)
    }

    send(data: string): void {
        this.sent.push(data)
    }

    close(): void {
        this.readyState = 3
        this.onclose?.()
    }
}

const openOptions: TransportOpenOptions = {
    packageId: 'N:package:pkg-1',
    viewerAssetId: 'viewer-asset-1',
    url: null,
    timeseriesDiscoverApi: 'wss://streaming.test/ts/query',
    getToken: async () => 'session-token-1',
}

const openTransport = async () => {
    const sockets: RecordingSocket[] = []
    const transport = createWebsocketTransport({
        createSocket: (url: string) => {
            const socket = new RecordingSocket(url)
            sockets.push(socket)
            return socket as unknown as WebSocket
        },
    })
    await transport.open(openOptions)
    const socket = sockets[0]
    // sent[0] is the NOT_MONTAGED handshake; page requests follow it.
    expect(socket.sent).toHaveLength(1)
    return { transport, socket }
}

describe('websocket transport requestPage wire parity', () => {
    it('sends the legacy request JSON for a viewport page', async () => {
        const { transport, socket } = await openTransport()

        const ok = transport.requestPage({
            startTime: PAGE,
            endTime: 2 * PAGE,
            pixelWidth: 250,
            minMax: true,
            channels: [{ id: 'N:channel:aaa', name: 'CH1' }],
        })

        expect(ok).toBe(true)
        expect(socket.sent[1]).toBe(
            '{"session":"session-token-1","minMax":true,"startTime":15000000,"endTime":30000000,"packageId":"N:package:pkg-1","pixelWidth":250,"virtualChannels":[{"id":"N:channel:aaa","name":"CH1"}]}'
        )
        await transport.close()
    })

    it('sends the montaged serverId and composite label as the wire id and name', async () => {
        const { transport, socket } = await openTransport()

        // The caller resolves serverId and label into the VirtualChannelRef;
        // these values match the montagedChannel fixture in
        // useDataRequests.wire.test.ts after that resolution.
        transport.requestPage({
            startTime: PAGE,
            endTime: 2 * PAGE,
            pixelWidth: 250,
            minMax: true,
            channels: [{ id: 'N:channel:bbb', name: 'F3<->C3' }],
        })

        expect(socket.sent[1]).toBe(
            '{"session":"session-token-1","minMax":true,"startTime":15000000,"endTime":30000000,"packageId":"N:package:pkg-1","pixelWidth":250,"virtualChannels":[{"id":"N:channel:bbb","name":"F3<->C3"}]}'
        )
        await transport.close()
    })

    it('sends the end time the caller clamped to the recording end', async () => {
        const { transport, socket } = await openTransport()

        transport.requestPage({
            startTime: TS_END - 5000000,
            endTime: TS_END,
            pixelWidth: 250,
            minMax: true,
            channels: [{ id: 'N:channel:aaa', name: 'CH1' }],
        })

        expect(socket.sent[1]).toBe(
            '{"session":"session-token-1","minMax":true,"startTime":3595000000,"endTime":3600000000,"packageId":"N:package:pkg-1","pixelWidth":250,"virtualChannels":[{"id":"N:channel:aaa","name":"CH1"}]}'
        )
        await transport.close()
    })

    it('returns false and sends nothing before open', () => {
        const transport = createWebsocketTransport({
            createSocket: () => {
                throw new Error('requestPage before open must not dial a socket')
            },
        })

        const ok = transport.requestPage({
            startTime: PAGE,
            endTime: 2 * PAGE,
            pixelWidth: 250,
            minMax: true,
            channels: [{ id: 'N:channel:aaa', name: 'CH1' }],
        })

        expect(ok).toBe(false)
    })

    it('returns false after close', async () => {
        const { transport, socket } = await openTransport()
        await transport.close()

        const ok = transport.requestPage({
            startTime: PAGE,
            endTime: 2 * PAGE,
            pixelWidth: 250,
            minMax: true,
            channels: [{ id: 'N:channel:aaa', name: 'CH1' }],
        })

        expect(ok).toBe(false)
        expect(socket.sent).toHaveLength(1)
    })
})
