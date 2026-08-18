// Characterization tests: pin the legacy wire JSON that requestDataFromServer
// emits today, before the architecture refactor. Snapshots are the contract.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useDataRequests } from './useDataRequests'
import type { PlannedRequest, RequestedPageInfo, WireSocket } from './useDataRequests'
import type { ChannelData } from './useTimeSeriesData'
import { BASE_PAGE_SIZE } from './streaming/paging'

const PAGE = BASE_PAGE_SIZE
const TS_END = 3600000000
const viewer = { content: { id: 'N:package:pkg-1' } }

const channel = (overrides: Partial<ChannelData> = {}): ChannelData => ({
    id: 'N:channel:aaa',
    serverId: 'N:channel:aaa',
    label: 'CH1',
    segments: [],
    gaps: [],
    dataSegments: [],
    ...overrides
})

const montagedChannel = (): ChannelData => channel({
    id: 'N:channel:bbb_F3<->C3',
    serverId: 'N:channel:bbb',
    label: 'F3<->C3'
})

const plannedRequest = (overrides: Partial<PlannedRequest> = {}): PlannedRequest => ({
    channels: [channel()],
    start: PAGE,
    duration: PAGE,
    isInViewport: true,
    pixelWidth: 250,
    ...overrides
})

const makeSocket = (readyState = 1) => {
    const send = vi.fn<(data: string) => void>()
    const socket: WireSocket = { readyState, send }
    return { socket, send }
}

// useDataRequests registers onUnmounted outside a component and the skip paths
// log through the console; both spam the test output.
beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('requestDataFromServer', () => {
    it('sends the legacy request JSON for a viewport page', () => {
        const { requestDataFromServer } = useDataRequests()
        const { socket, send } = makeSocket()
        const requestedPages = new Map<number, RequestedPageInfo>()

        // rsPeriod 999 does not reach the wire; pixelWidth comes from the request.
        const ok = requestDataFromServer(
            [plannedRequest()], 0, socket, 'session-token-1', viewer, 999, requestedPages, TS_END
        )

        expect(ok).toBe(true)
        expect(send).toHaveBeenCalledTimes(1)
        expect(send.mock.calls[0][0]).toMatchInlineSnapshot(`"{"session":"session-token-1","minMax":true,"startTime":15000000,"endTime":30000000,"packageId":"N:package:pkg-1","pixelWidth":250,"virtualChannels":[{"id":"N:channel:aaa","name":"CH1"}]}"`)
    })

    it('maps a montaged channel serverId and composite label onto the wire id and name', () => {
        const { requestDataFromServer } = useDataRequests()
        const { socket, send } = makeSocket()
        const requestedPages = new Map<number, RequestedPageInfo>()

        requestDataFromServer(
            [plannedRequest({ channels: [montagedChannel()] })],
            0, socket, 'session-token-1', viewer, 250, requestedPages, TS_END
        )

        expect(send.mock.calls[0][0]).toMatchInlineSnapshot(`"{"session":"session-token-1","minMax":true,"startTime":15000000,"endTime":30000000,"packageId":"N:package:pkg-1","pixelWidth":250,"virtualChannels":[{"id":"N:channel:bbb","name":"F3<->C3"}]}"`)
    })

    it('clamps the request end time to the recording end', () => {
        const { requestDataFromServer } = useDataRequests()
        const { socket, send } = makeSocket()
        const requestedPages = new Map<number, RequestedPageInfo>()

        requestDataFromServer(
            [plannedRequest({ start: TS_END - 5000000, duration: PAGE })],
            0, socket, 'session-token-1', viewer, 250, requestedPages, TS_END
        )

        expect(send).toHaveBeenCalledTimes(1)
        expect(send.mock.calls[0][0]).toMatchInlineSnapshot(`"{"session":"session-token-1","minMax":true,"startTime":3595000000,"endTime":3600000000,"packageId":"N:package:pkg-1","pixelWidth":250,"virtualChannels":[{"id":"N:channel:aaa","name":"CH1"}]}"`)
    })

    it('skips a request whose clamped end time does not exceed its start', () => {
        const { requestDataFromServer } = useDataRequests()
        const { socket, send } = makeSocket()
        const requestedPages = new Map<number, RequestedPageInfo>()

        const ok = requestDataFromServer(
            [plannedRequest({ start: TS_END, duration: PAGE })],
            0, socket, 'session-token-1', viewer, 250, requestedPages, TS_END
        )

        expect(send).not.toHaveBeenCalled()
        expect(requestedPages.size).toBe(0)
        // pins current behavior; revisit in the refactor: the skip still reports success
        expect(ok).toBe(true)
    })

    it('returns false and sends nothing when the socket is not ready', () => {
        const { requestDataFromServer } = useDataRequests()
        const { socket, send } = makeSocket(0)
        const requestedPages = new Map<number, RequestedPageInfo>()

        const ok = requestDataFromServer(
            [plannedRequest()], 0, socket, 'session-token-1', viewer, 250, requestedPages, TS_END
        )

        expect(ok).toBe(false)
        expect(send).not.toHaveBeenCalled()
        expect(requestedPages.size).toBe(0)
    })

    it('returns false for an empty request list', () => {
        const { requestDataFromServer } = useDataRequests()
        const { socket, send } = makeSocket()
        const requestedPages = new Map<number, RequestedPageInfo>()

        const ok = requestDataFromServer(
            [], 0, socket, 'session-token-1', viewer, 250, requestedPages, TS_END
        )

        expect(ok).toBe(false)
        expect(send).not.toHaveBeenCalled()
    })

    it('keys the sent page by request start with one pending counter per channel client id', () => {
        const { requestDataFromServer } = useDataRequests()
        const { socket } = makeSocket()
        const requestedPages = new Map<number, RequestedPageInfo>()

        requestDataFromServer(
            [
                plannedRequest({ channels: [channel(), montagedChannel()] }),
                plannedRequest({ start: 2 * PAGE, isInViewport: false })
            ],
            0, socket, 'session-token-1', viewer, 250, requestedPages, TS_END
        )

        const viewportInfo = requestedPages.get(PAGE)
        expect(viewportInfo).toBeDefined()
        expect(viewportInfo!.count).toBe(2)
        expect([...viewportInfo!.counter.keys()]).toEqual(['N:channel:aaa', 'N:channel:bbb_F3<->C3'])
        expect(Number.isNaN(viewportInfo!.counter.get('N:channel:aaa')!)).toBe(true)
        expect(Number.isNaN(viewportInfo!.counter.get('N:channel:bbb_F3<->C3')!)).toBe(true)
        expect(Number.isNaN(viewportInfo!.subPageCount)).toBe(true)
        expect(viewportInfo!.ts).toBeTypeOf('number')
        expect(viewportInfo!.inViewport).toBe(true)

        const prefetchInfo = requestedPages.get(2 * PAGE)
        expect(prefetchInfo).toBeDefined()
        expect(prefetchInfo!.inViewport).toBe(false)
    })

    it('sends the request at firstRequest before the rest', () => {
        const { requestDataFromServer } = useDataRequests()
        const { socket, send } = makeSocket()
        const requestedPages = new Map<number, RequestedPageInfo>()

        requestDataFromServer(
            [
                plannedRequest({ start: 0 }),
                plannedRequest({ start: PAGE }),
                plannedRequest({ start: 2 * PAGE })
            ],
            1, socket, 'session-token-1', viewer, 250, requestedPages, TS_END
        )

        const sentStarts = send.mock.calls.map(
            call => (JSON.parse(call[0]) as { startTime: number }).startTime
        )
        expect(sentStarts).toEqual([PAGE, 0, 2 * PAGE])
    })
})
