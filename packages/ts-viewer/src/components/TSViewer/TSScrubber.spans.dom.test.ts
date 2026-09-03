// Characterization tests for the scrubber's availability bitmap: which spans it asks
// for, and what reaches the render input.
//
// The legacy tests drive the real websocket transport, and the global fetch is stubbed
// with the same recorder the transport gets, so the pinned url sequence holds wherever
// the request is built.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref, shallowRef } from 'vue'

// The legacy url carries a session token, and Amplify is not configured under test.
vi.mock('@/composables/useToken', () => ({
    useToken: vi.fn(async () => 'test-token'),
    useLogout: vi.fn(async () => {})
}))

import TSScrubber from '@/components/TSViewer/TSScrubber.vue'
import { ViewerTransportKey } from '@/state/viewerTransportContext'
import { createWebsocketTransport } from '@/transport/websocketTransport'
import type {
    DataSpanQuery,
    TimeseriesTransport,
    TransportStatus
} from '@/transport/TimeseriesTransport'
import { createViewerStore } from '@/stores/tsviewer'
import type { ActiveViewerContent, ViewerChannel, ViewerStore } from '@/stores/tsviewer'
import { contextFor } from '@/test/setup-canvas'

// The constants object TSViewer passes: one week per segment-span request, at most
// 20 requests. The websocket transport holds the same two values.
const CONSTANTS = { SEGMENTSPAN: 1209600000000, MAXRECURSION: 20 }

// A 5 s recording. The bitmap has 5000 cells, so one cell is 1000 us and every span
// below lands on a cell boundary.
const TS_START = 1000000
const TS_END = 6000000
const CELL_US = 1000

const DAY_US = 86400000000
const TIME_SERIES_API = 'https://api.test/timeseries'

/** State the component keeps for the bitmap, reachable through the setup state. */
interface ScrubberInternals {
    segments: number[]
    segmentSpans: number[]
    initSegmentSpans: () => void
    renderSegments: () => void
}

function contentFor(assetType: string): ActiveViewerContent {
    return {
        id: 'pkg-1',
        viewerAssetId: null,
        idType: 'package',
        assetType,
        url: null,
        onUrlExpired: null
    }
}

function makeChannels(ids: string[]): ViewerChannel[] {
    return ids.map((id, rank) => ({ id, label: id, name: id, rank, dataSegments: [] as number[] }))
}

function dataSegmentsFor(store: ViewerStore, id: string): number[] {
    const channel = store.viewerChannels.find((row) => row.id === id)
    return (channel?.dataSegments ?? []) as number[]
}

/** Records dataSpans queries and answers them from `spansFor`. */
function makeSpanRecorder(spansFor: (query: DataSpanQuery) => Array<[number, number]>) {
    const queries: DataSpanQuery[] = []
    const transport: TimeseriesTransport = {
        kind: 'zarr',
        status: ref<TransportStatus>('connected'),
        capabilities: {
            maxDurationUs: null,
            pageSizeFor: () => 0,
            prefetchPages: 0,
            postDumpDelayMs: 0,
            supportsAmplitudeSurvey: false
        },
        open: async () => {},
        close: async () => {},
        requestPage: () => true,
        setMontage: () => {},
        setFilter: () => {},
        dumpBuffer: () => true,
        dataSpans: async (query: DataSpanQuery) => {
            queries.push({ ...query })
            return spansFor(query)
        },
        on: () => () => {}
    }
    return { queries, transport }
}

/** Records the signal of each dataSpans query and leaves the query pending. */
function makePendingSpanRecorder() {
    const signals: AbortSignal[] = []
    const base = makeSpanRecorder(() => [])
    const transport: TimeseriesTransport = {
        ...base.transport,
        dataSpans: (query: DataSpanQuery) => {
            signals.push(query.signal!)
            return new Promise<Array<[number, number]>>(() => {})
        }
    }
    return { signals, transport }
}

/** Records the queries a transport is asked, and forwards each to it. */
function recordQueries(transport: TimeseriesTransport) {
    const queries: DataSpanQuery[] = []
    const recording: TimeseriesTransport = {
        ...transport,
        dataSpans: async (query: DataSpanQuery) => {
            queries.push({ ...query })
            return await transport.dataSpans(query)
        }
    }
    return { queries, transport: recording }
}

/** Records segment-span urls and answers each from the `start` it requests. */
function makeRestRecorder(bodyFor: (start: number) => Array<[number, number]>) {
    const urls: string[] = []
    const impl = async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input)
        urls.push(url)
        const start = Number(new URL(url).searchParams.get('start'))
        const body = bodyFor(start)
        return {
            ok: true,
            status: 200,
            json: async () => body
        } as Response
    }
    return { urls, impl: impl as unknown as typeof fetch }
}

/** Opens with the transport's connect handshake and nothing else. */
class OpenOnlySocket {
    readyState = 0
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onmessage: ((msg: MessageEvent) => void) | null = null
    onerror: ((err: unknown) => void) | null = null

    constructor() {
        setTimeout(() => {
            this.readyState = 1
            this.onopen?.()
        }, 0)
    }

    send(): void {}

    close(): void {
        this.readyState = 3
        this.onclose?.()
    }
}

async function openWebsocketTransport(
    fetchImpl: typeof fetch,
    timeSeriesApi: string | null = TIME_SERIES_API
): Promise<TimeseriesTransport> {
    const transport = createWebsocketTransport({
        createSocket: () => new OpenOnlySocket() as unknown as WebSocket,
        fetchImpl
    })
    await transport.open({
        packageId: 'pkg-1',
        viewerAssetId: null,
        url: null,
        timeseriesDiscoverApi: 'wss://streaming.test/ts/query',
        timeSeriesApi: timeSeriesApi ?? undefined,
        getToken: async () => 'test-token'
    })
    return transport
}

interface MountOptions {
    instanceId: string
    assetType: string
    channelIds: string[]
    transport: TimeseriesTransport | null
    timeSeriesApi?: string
    tsStart?: number
    tsEnd?: number
}

interface MountedScrubber {
    wrapper: VueWrapper
    store: ViewerStore
    internals: ScrubberInternals
    transportRef: { value: TimeseriesTransport | null }
}

describe('TSScrubber availability spans', () => {
    let mounted: MountedScrubber | null = null
    let openTransport: TimeseriesTransport | null = null

    beforeEach(() => {
        setActivePinia(createPinia())
    })

    afterEach(async () => {
        mounted?.wrapper.unmount()
        mounted = null
        await openTransport?.close()
        openTransport = null
        await flushPromises()
        vi.unstubAllGlobals()
        document.body.innerHTML = ''
    })

    async function mountScrubber(options: MountOptions): Promise<MountedScrubber> {
        const pinia = createPinia()
        setActivePinia(pinia)
        const store = createViewerStore(options.instanceId)
        store.resetViewer()
        if (options.timeSeriesApi) {
            store.setViewerConfig({ timeSeriesApi: options.timeSeriesApi })
        }
        // Seeded before mount so the channel watcher does not race a second
        // initSegmentSpans against the one each test calls.
        store.setChannels(makeChannels(options.channelIds))

        const transportRef = shallowRef<TimeseriesTransport | null>(options.transport)

        const wrapper = mount(TSScrubber, {
            props: {
                ts_start: options.tsStart ?? TS_START,
                ts_end: options.tsEnd ?? TS_END,
                cWidth: 1000,
                constants: CONSTANTS,
                start: options.tsStart ?? TS_START,
                duration: 1000000,
                cursorLoc: 0,
                labelWidth: 100,
                activeViewer: { content: contentFor(options.assetType) }
            },
            global: {
                plugins: [pinia],
                provide: {
                    viewerStore: store,
                    [ViewerTransportKey as symbol]: transportRef
                }
            },
            attachTo: document.body
        })
        await flushPromises()

        mounted = {
            wrapper,
            store,
            internals: wrapper.vm as unknown as ScrubberInternals,
            transportRef
        }
        return mounted
    }

    /** Hatch rectangles the segments canvas draws for the current spans. */
    async function hatchRectCount(scrubber: MountedScrubber): Promise<number> {
        const canvas = scrubber.wrapper.find('#segmentsCanvas').element as HTMLCanvasElement
        const fillRect = contextFor(canvas).fillRect as ReturnType<typeof vi.fn>
        fillRect.mockClear()
        scrubber.internals.renderSegments()
        await flushPromises()
        return fillRect.mock.calls.length
    }

    it('asks the transport once per channel for the whole recording', async () => {
        const spans: Array<[number, number]> = [
            [TS_START + 500 * CELL_US, TS_START + 1000 * CELL_US],
            [TS_START + 2000 * CELL_US, TS_END]
        ]
        const recorder = makeSpanRecorder((query) => (query.channel === 'ch-1' ? spans : []))
        const scrubber = await mountScrubber({
            instanceId: 'scrubber-spans-zarr',
            assetType: 'timeseries-zarr',
            channelIds: ['ch-1', 'unit-1'],
            transport: recorder.transport
        })

        scrubber.internals.initSegmentSpans()
        await vi.waitFor(() => {
            expect(recorder.queries.length).toBe(2)
            expect(scrubber.internals.segmentSpans.length).toBeGreaterThan(0)
        }, { timeout: 3000 })
        await flushPromises()

        // gapThresholdUs is one bitmap cell: (6000000 - 1000000) / 5000.
        expect(recorder.queries).toEqual([
            { channel: 'ch-1', startUs: TS_START, endUs: TS_END, gapThresholdUs: CELL_US, signal: expect.any(AbortSignal) },
            { channel: 'unit-1', startUs: TS_START, endUs: TS_END, gapThresholdUs: CELL_US, signal: expect.any(AbortSignal) }
        ])

        // Cells 500..999 and 2000..4999 carry data. The span walk stops one cell
        // short of the array end, so the last pair closes at 4999 and the trailing
        // 5000 closes the list.
        expect(scrubber.internals.segmentSpans).toEqual([500, 1000, 2000, 4999, 5000])

        // Two hatch rectangles: the 1000..2000 gap and the 4999..5000 remainder.
        // The 0..500 gap before the first span is not drawn; the render loop starts
        // at the first span's end.
        expect(await hatchRectCount(scrubber)).toBe(2)

        expect(dataSegmentsFor(scrubber.store, 'ch-1')).toEqual([1500000, 2000000, 3000000, 6000000])
        // The zarr transport answers a unit channel with no spans.
        expect(dataSegmentsFor(scrubber.store, 'unit-1')).toEqual([])
    })

    it('applies a scan in one pass once every channel has answered', async () => {
        const spans: Array<[number, number]> = [[TS_START + 1000 * CELL_US, TS_START + 2000 * CELL_US]]
        const base = makeSpanRecorder(() => spans)
        // One slow channel: applying answers as they arrive would draw the fast
        // channel's spans while this one is still pending.
        const transport: TimeseriesTransport = {
            ...base.transport,
            dataSpans: async (query: DataSpanQuery) => {
                if (query.channel === 'ch-2') {
                    await new Promise((resolve) => setTimeout(resolve, 40))
                }
                return base.transport.dataSpans(query)
            }
        }
        const scrubber = await mountScrubber({
            instanceId: 'scrubber-spans-one-pass',
            assetType: 'timeseries-zarr',
            channelIds: ['ch-1', 'ch-2'],
            transport
        })
        const canvas = scrubber.wrapper.find('#segmentsCanvas').element as HTMLCanvasElement
        const clearRect = contextFor(canvas).clearRect as ReturnType<typeof vi.fn>
        clearRect.mockClear()

        scrubber.internals.initSegmentSpans()
        await vi.waitFor(() => {
            expect(scrubber.internals.segmentSpans.length).toBeGreaterThan(0)
        }, { timeout: 3000 })

        // The slow channel's row landed in the same pass as the fast one's.
        expect(dataSegmentsFor(scrubber.store, 'ch-2')).toEqual([TS_START + 1000 * CELL_US, TS_START + 2000 * CELL_US])
        expect(scrubber.internals.segmentSpans).toEqual([1000, 2000, 5000])

        // One draw for the whole scan.
        await flushPromises()
        expect(clearRect).toHaveBeenCalledTimes(1)
    })

    it('requests one legacy segment-span url for a recording shorter than SEGMENTSPAN', async () => {
        // The middle gap is 500 us, half a bitmap cell.
        const recorder = makeRestRecorder(() => [
            [TS_START, TS_START + 1000 * CELL_US],
            [TS_START + 1000 * CELL_US + 500, TS_START + 2000 * CELL_US],
            [TS_START + 3000 * CELL_US, TS_END]
        ])
        vi.stubGlobal('fetch', vi.fn(recorder.impl))
        openTransport = await openWebsocketTransport(recorder.impl)
        const spans = recordQueries(openTransport)

        const scrubber = await mountScrubber({
            instanceId: 'scrubber-spans-legacy',
            assetType: 'timeseries',
            channelIds: ['ch-1'],
            transport: spans.transport,
            timeSeriesApi: TIME_SERIES_API
        })

        scrubber.internals.initSegmentSpans()
        await vi.waitFor(() => {
            expect(recorder.urls.length).toBe(1)
            expect(scrubber.internals.segmentSpans.length).toBeGreaterThan(0)
        }, { timeout: 3000 })
        await flushPromises()

        expect(spans.queries).toEqual([
            { channel: 'ch-1', startUs: TS_START, endUs: TS_END, gapThresholdUs: CELL_US, signal: expect.any(AbortSignal) }
        ])
        expect(recorder.urls).toEqual([
            `${TIME_SERIES_API}/ts/retrieve/segments?session=test-token&channel=ch-1&start=1000000&end=6000000`
        ])

        // Cells 0..1999 and 3000..4999. The sub-cell gap at 2000500 falls inside
        // cell 1000, which the span before it already marks, so bridging it leaves
        // the bitmap and the hatch rectangles exactly as the raw spans drew them.
        expect(scrubber.internals.segmentSpans).toEqual([0, 2000, 3000, 4999, 5000])
        expect(await hatchRectCount(scrubber)).toBe(2)

        // The bridged gap does show here: the transport returns [1000000, 3000000]
        // as one span, where the raw REST answer carried two.
        expect(dataSegmentsFor(scrubber.store, 'ch-1')).toEqual([
            1000000, 3000000, 4000000, 6000000
        ])
    })

    it('walks a recording longer than SEGMENTSPAN in one-week requests', async () => {
        const tsStart = DAY_US
        const tsEnd = tsStart + 30 * DAY_US
        // One cell of a 30-day recording.
        const cell = (30 * DAY_US) / 5000
        const firstSpan: [number, number] = [tsStart, tsStart + 2500 * cell]
        const recorder = makeRestRecorder((start) => {
            if (start === tsStart) {
                // Crosses into the second week, reported unclipped.
                return [firstSpan]
            }
            if (start === tsStart + CONSTANTS.SEGMENTSPAN) {
                // The repeated first pair is the boundary overlap.
                return [firstSpan, [tsStart + 3600 * cell, tsStart + 3800 * cell]]
            }
            return [[tsStart + 4800 * cell, tsEnd]]
        })
        vi.stubGlobal('fetch', vi.fn(recorder.impl))
        openTransport = await openWebsocketTransport(recorder.impl)
        const spans = recordQueries(openTransport)

        const scrubber = await mountScrubber({
            instanceId: 'scrubber-spans-legacy-walk',
            assetType: 'timeseries',
            channelIds: ['ch-1'],
            transport: spans.transport,
            timeSeriesApi: TIME_SERIES_API,
            tsStart,
            tsEnd
        })

        scrubber.internals.initSegmentSpans()
        await vi.waitFor(() => {
            expect(recorder.urls.length).toBe(3)
            expect(dataSegmentsFor(scrubber.store, 'ch-1').length).toBe(6)
        }, { timeout: 3000 })
        await flushPromises()

        // One query for the whole recording, and the transport's own walk turns it
        // into the same three chunks the component used to request one at a time.
        expect(spans.queries).toEqual([
            { channel: 'ch-1', startUs: tsStart, endUs: tsEnd, gapThresholdUs: cell, signal: expect.any(AbortSignal) }
        ])
        // Three one-week chunks. The last one runs past the recording end.
        expect(recorder.urls).toEqual([
            `${TIME_SERIES_API}/ts/retrieve/segments?session=test-token&channel=ch-1&start=86400000000&end=1296000000000`,
            `${TIME_SERIES_API}/ts/retrieve/segments?session=test-token&channel=ch-1&start=1296000000000&end=2505600000000`,
            `${TIME_SERIES_API}/ts/retrieve/segments?session=test-token&channel=ch-1&start=2505600000000&end=3715200000000`
        ])

        expect(scrubber.internals.segmentSpans).toEqual([0, 2500, 3600, 3800, 4800, 4999, 5000])
        expect(await hatchRectCount(scrubber)).toBe(3)

        // The overlap trim drops the repeated pair, so it appears once.
        expect(dataSegmentsFor(scrubber.store, 'ch-1')).toEqual([
            86400000000, 1382400000000, 1952640000000, 2056320000000, 2574720000000, 2678400000000
        ])
    })

    it('requests nothing for a legacy transport opened without timeSeriesApi', async () => {
        const recorder = makeRestRecorder(() => [[TS_START, TS_END]])
        vi.stubGlobal('fetch', vi.fn(recorder.impl))
        openTransport = await openWebsocketTransport(recorder.impl, null)

        const scrubber = await mountScrubber({
            instanceId: 'scrubber-spans-unconfigured',
            assetType: 'timeseries',
            channelIds: ['ch-1'],
            transport: openTransport
        })
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})

        scrubber.internals.initSegmentSpans()
        await flushPromises()
        await flushPromises()

        // The transport refuses the query, so no url is built and nothing is drawn.
        expect(recorder.urls).toEqual([])
        expect(scrubber.internals.segmentSpans).toEqual([])
        expect(error).toHaveBeenCalled()
        error.mockRestore()
    })

    it('requests nothing when no transport is provided yet', async () => {
        const recorder = makeRestRecorder(() => [[TS_START, TS_END]])
        vi.stubGlobal('fetch', vi.fn(recorder.impl))
        const scrubber = await mountScrubber({
            instanceId: 'scrubber-spans-no-transport',
            assetType: 'timeseries-zarr',
            channelIds: ['ch-1'],
            transport: null,
            timeSeriesApi: TIME_SERIES_API
        })
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        scrubber.internals.initSegmentSpans()
        await flushPromises()

        expect(recorder.urls).toEqual([])
        expect(scrubber.internals.segmentSpans).toEqual([])
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })
    it('cancels the scan in flight when the channel set changes', async () => {
        const recorder = makePendingSpanRecorder()
        const scrubber = await mountScrubber({
            instanceId: 'scrubber-spans-abort-channels',
            assetType: 'timeseries-zarr',
            channelIds: ['ch-1'],
            transport: recorder.transport
        })

        scrubber.internals.initSegmentSpans()
        await vi.waitFor(() => {
            expect(recorder.signals).toHaveLength(1)
        })
        expect(recorder.signals[0].aborted).toBe(false)

        scrubber.store.setChannels(makeChannels(['ch-9', 'ch-10']))
        await flushPromises()

        expect(recorder.signals[0].aborted).toBe(true)
    })

    it('cancels the scan in flight when the transport is replaced', async () => {
        const recorder = makePendingSpanRecorder()
        const scrubber = await mountScrubber({
            instanceId: 'scrubber-spans-abort-transport',
            assetType: 'timeseries-zarr',
            channelIds: ['ch-1'],
            transport: recorder.transport
        })

        scrubber.internals.initSegmentSpans()
        await vi.waitFor(() => {
            expect(recorder.signals).toHaveLength(1)
        })

        scrubber.transportRef.value = makePendingSpanRecorder().transport
        await flushPromises()

        expect(recorder.signals[0].aborted).toBe(true)
    })

    it('cancels the scan in flight on unmount', async () => {
        const recorder = makePendingSpanRecorder()
        const scrubber = await mountScrubber({
            instanceId: 'scrubber-spans-abort-unmount',
            assetType: 'timeseries-zarr',
            channelIds: ['ch-1'],
            transport: recorder.transport
        })

        scrubber.internals.initSegmentSpans()
        await vi.waitFor(() => {
            expect(recorder.signals).toHaveLength(1)
        })

        scrubber.wrapper.unmount()
        mounted = null

        expect(recorder.signals[0].aborted).toBe(true)
    })

    it('gives every channel of one scan the same signal', async () => {
        const recorder = makePendingSpanRecorder()
        const scrubber = await mountScrubber({
            instanceId: 'scrubber-spans-one-signal',
            assetType: 'timeseries-zarr',
            channelIds: ['ch-1', 'ch-2', 'ch-3'],
            transport: recorder.transport
        })

        scrubber.internals.initSegmentSpans()
        await vi.waitFor(() => {
            expect(recorder.signals).toHaveLength(3)
        })

        expect(new Set(recorder.signals).size).toBe(1)
    })

})
