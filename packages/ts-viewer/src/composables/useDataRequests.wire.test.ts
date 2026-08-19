// Characterization tests: pin the typed PageRequest that requestDataFromServer
// hands to the transport, and the page bookkeeping around it. The byte-exact
// legacy wire JSON is pinned in src/transport/websocketTransport.wire.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useDataRequests } from './useDataRequests'
import type { PlannedRequest, RequestedPageInfo } from './useDataRequests'
import type { PageRequest, TimeseriesTransport, TransportStatus } from '@/transport/TimeseriesTransport'
import type { ChannelData } from './useTimeSeriesData'
import { BASE_PAGE_SIZE } from './streaming/paging'

const PAGE = BASE_PAGE_SIZE
const TS_END = 3600000000

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

/** Fake transport: requestPage records the typed request and answers `accept`. */
const makeTransport = (accept = true) => {
    const requestPage = vi.fn<(req: PageRequest) => boolean>(() => accept)
    const transport = {
        status: ref<TransportStatus>(accept ? 'connected' : 'disconnected'),
        requestPage
    } as unknown as TimeseriesTransport
    return { transport, requestPage }
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
    it('builds the PageRequest for a viewport page', () => {
        const { requestDataFromServer } = useDataRequests()
        const { transport, requestPage } = makeTransport()
        const requestedPages = new Map<number, RequestedPageInfo>()

        const ok = requestDataFromServer(
            [plannedRequest()], 0, transport, requestedPages, TS_END
        )

        expect(ok).toBe(true)
        expect(requestPage).toHaveBeenCalledTimes(1)
        expect(requestPage.mock.calls[0][0]).toEqual({
            startTime: 15000000,
            endTime: 30000000,
            pixelWidth: 250,
            minMax: true,
            channels: [{ id: 'N:channel:aaa', name: 'CH1' }]
        })
    })

    it('maps a montaged channel serverId and composite label onto the request id and name', () => {
        const { requestDataFromServer } = useDataRequests()
        const { transport, requestPage } = makeTransport()
        const requestedPages = new Map<number, RequestedPageInfo>()

        requestDataFromServer(
            [plannedRequest({ channels: [montagedChannel()] })],
            0, transport, requestedPages, TS_END
        )

        expect(requestPage.mock.calls[0][0]).toEqual({
            startTime: 15000000,
            endTime: 30000000,
            pixelWidth: 250,
            minMax: true,
            channels: [{ id: 'N:channel:bbb', name: 'F3<->C3' }]
        })
    })

    it('clamps the request end time to the recording end', () => {
        const { requestDataFromServer } = useDataRequests()
        const { transport, requestPage } = makeTransport()
        const requestedPages = new Map<number, RequestedPageInfo>()

        requestDataFromServer(
            [plannedRequest({ start: TS_END - 5000000, duration: PAGE })],
            0, transport, requestedPages, TS_END
        )

        expect(requestPage).toHaveBeenCalledTimes(1)
        expect(requestPage.mock.calls[0][0]).toEqual({
            startTime: 3595000000,
            endTime: 3600000000,
            pixelWidth: 250,
            minMax: true,
            channels: [{ id: 'N:channel:aaa', name: 'CH1' }]
        })
    })

    it('skips a request whose clamped end time does not exceed its start', () => {
        const { requestDataFromServer } = useDataRequests()
        const { transport, requestPage } = makeTransport()
        const requestedPages = new Map<number, RequestedPageInfo>()

        const ok = requestDataFromServer(
            [plannedRequest({ start: TS_END, duration: PAGE })],
            0, transport, requestedPages, TS_END
        )

        expect(requestPage).not.toHaveBeenCalled()
        expect(requestedPages.size).toBe(0)
        // pins current behavior; revisit in the refactor: the skip still reports success
        expect(ok).toBe(true)
    })

    it('returns false and books nothing when requestPage reports not connected', () => {
        const { requestDataFromServer } = useDataRequests()
        const { transport, requestPage } = makeTransport(false)
        const requestedPages = new Map<number, RequestedPageInfo>()

        const ok = requestDataFromServer(
            [plannedRequest()], 0, transport, requestedPages, TS_END
        )

        expect(ok).toBe(false)
        expect(requestPage).toHaveBeenCalledTimes(1)
        expect(requestedPages.size).toBe(0)
    })

    it('returns false for an empty request list', () => {
        const { requestDataFromServer } = useDataRequests()
        const { transport, requestPage } = makeTransport()
        const requestedPages = new Map<number, RequestedPageInfo>()

        const ok = requestDataFromServer(
            [], 0, transport, requestedPages, TS_END
        )

        expect(ok).toBe(false)
        expect(requestPage).not.toHaveBeenCalled()
    })

    it('keys the sent page by request start with one pending counter per channel client id', () => {
        const { requestDataFromServer } = useDataRequests()
        const { transport } = makeTransport()
        const requestedPages = new Map<number, RequestedPageInfo>()

        requestDataFromServer(
            [
                plannedRequest({ channels: [channel(), montagedChannel()] }),
                plannedRequest({ start: 2 * PAGE, isInViewport: false })
            ],
            0, transport, requestedPages, TS_END
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
        const { transport, requestPage } = makeTransport()
        const requestedPages = new Map<number, RequestedPageInfo>()

        requestDataFromServer(
            [
                plannedRequest({ start: 0 }),
                plannedRequest({ start: PAGE }),
                plannedRequest({ start: 2 * PAGE })
            ],
            1, transport, requestedPages, TS_END
        )

        const sentStarts = requestPage.mock.calls.map((call) => call[0].startTime)
        expect(sentStarts).toEqual([PAGE, 0, 2 * PAGE])
    })
})
