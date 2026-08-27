// DOM-mounted characterization tests for the TSViewer component tree. The transport is
// the only mocked seam: the real store, canvases, and request pipeline run against a
// recorder, and each test pins one piece of transport-facing behavior ahead of the
// architecture refactor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// Records every call the mounted tree makes against the transport, and holds the
// handlers the tree registers so tests can push canned envelopes back through them.
const harness = vi.hoisted(() => ({
    /** Typed page requests handed to `transport.requestPage`. */
    pageRequests: [] as Array<Record<string, unknown>>,
    filterMessages: [] as unknown[],
    /** Payloads handed to `transport.setMontage`. */
    montageMessages: [] as unknown[],
    dumpBufferRequests: 0,
    openCalls: [] as unknown[],
    segmentHandlers: [] as Array<(envelope: unknown) => void>,
    eventHandlers: [] as Array<(envelope: unknown) => void>,
    channelDetailsHandlers: [] as Array<(details: unknown) => void>,
    errorHandlers: [] as Array<(payload: unknown) => void>,
    reset() {
        this.pageRequests.length = 0
        this.filterMessages.length = 0
        this.montageMessages.length = 0
        this.dumpBufferRequests = 0
        this.openCalls.length = 0
        this.segmentHandlers.length = 0
        this.eventHandlers.length = 0
        this.channelDetailsHandlers.length = 0
        this.errorHandlers.length = 0
    }
}))

// The token is transport-internal now and the transport is mocked whole, but the
// store still imports useToken, and Amplify is not configured under test.
vi.mock('@/composables/useToken', () => ({
    useToken: vi.fn(async () => 'test-token'),
    useLogout: vi.fn(async () => {})
}))

vi.mock('@/transport/createTransport', async () => {
    const { ref } = await import('vue')
    const { BASE_PAGE_SIZE } = await import('@/composables/streaming/paging')
    const status = ref<'disconnected' | 'connecting' | 'connected'>('disconnected')
    const handlerSets: Record<string, Array<(payload: unknown) => void>> = {
        segment: harness.segmentHandlers,
        event: harness.eventHandlers,
        channelDetails: harness.channelDetailsHandlers,
        error: harness.errorHandlers
    }
    const transport = {
        kind: 'websocket' as const,
        status,
        capabilities: {
            maxDurationUs: null,
            pageSizeFor: () => BASE_PAGE_SIZE,
            prefetchPages: 5,
            postDumpDelayMs: 0,
            supportsAmplitudeSurvey: false
        },
        open: async (opts: unknown) => {
            harness.openCalls.push(opts)
            status.value = 'connected'
        },
        close: async () => {
            status.value = 'disconnected'
        },
        requestPage(req: Record<string, unknown>) {
            harness.pageRequests.push(req)
            return true
        },
        setMontage(message: unknown) {
            harness.montageMessages.push(message)
        },
        setFilter(msg: unknown) {
            harness.filterMessages.push(msg)
        },
        dumpBuffer() {
            harness.dumpBufferRequests += 1
            return true
        },
        dataSpans: async () => [],
        on(event: string, handler: (payload: unknown) => void) {
            handlerSets[event].push(handler)
            return () => {}
        }
    }
    return { createTransport: () => transport }
})

import TSPlotCanvas from '@/components/TSViewer/TSPlotCanvas.vue'
import TSViewer from '@/components/TSViewer/TSViewer.vue'
import TSViewerCanvas from '@/components/TSViewer/TSViewerCanvas.vue'
import TSViewerToolbar from '@/components/TSViewer/TSViewerToolbar.vue'
import { createViewerStore } from '@/stores/tsviewer'
import type { ViewerStore } from '@/stores/tsviewer'
import type { ChannelDetail } from '@/composables/streaming/channelDetails'
import { buildContinuousSegm } from '@/composables/streaming/segments'
import type { SegmentEnvelope } from '@/composables/streaming/segments'
import { contextFor } from '@/test/setup-canvas'

// TS_START sits on a BASE_PAGE_SIZE boundary so the first viewport page starts exactly
// at the recording start and the page-request snapshot carries round numbers.
const TS_START = 15_000_000
const TS_END = 60_000_000

const CHANNEL_DETAILS: ChannelDetail[] = [
    { id: 'ch-1', name: 'CH1', channelType: 'CONTINUOUS', rate: 250, unit: 'uV', start: TS_START, end: TS_END, properties: [] },
    { id: 'ch-2', name: 'CH2', channelType: 'CONTINUOUS', rate: 250, unit: 'uV', start: TS_START, end: TS_END, properties: [] }
]

// assetType 'timeseries' selects the legacy streaming path, which the mocked transport
// absorbs entirely; the zarr client registry is never touched.
const CONTENT = {
    id: 'pkg-1',
    viewerAssetId: null,
    idType: 'package' as const,
    assetType: 'timeseries',
    url: null,
    onUrlExpired: null
}

interface FilterPayload {
    filterType: string
    selChannels: string[]
    input0?: number | string
    input1?: number | string
    notchFreq?: number
}

interface PageRequestWindow {
    startTime: number
    endTime: number
    pixelWidth: number
}

type ReaderSegment = Parameters<typeof buildContinuousSegm>[0]

/**
 * Builds the envelope `segment` handlers expect, answering `req` with a minMax
 * segment of 100 ms bins.
 */
function makeSegmentEnvelope(chId: string, label: string, req: PageRequestWindow): SegmentEnvelope {
    const samplePeriodUs = 100_000
    const binCount = Math.floor((req.endTime - req.startTime) / samplePeriodUs)
    const data = new Float32Array(binCount * 2)
    for (let i = 0; i < binCount; i++) {
        data[2 * i] = -10
        data[2 * i + 1] = 10
    }
    const segment = { startUs: req.startTime, samplePeriodUs, isMinMax: true, data } as unknown as ReaderSegment
    const block = buildContinuousSegm(segment, { chId, label, clientId: chId, unit: 'uV' }, req)
    return { pageStart: req.startTime, data: block, type: 'Continuous', nrResponses: 1 }
}

/**
 * The plot canvas element. TSPlotCanvas renders the blur canvas first and the plot
 * canvas last; neither carries an id, while the slotted axis and annotation canvases do.
 */
function plotCanvasElement(): HTMLCanvasElement {
    const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('.timeseries-plot-canvas canvas'))
    const unnamed = canvases.filter((canvas) => !canvas.id)
    expect(unnamed.length).toBeGreaterThanOrEqual(2)
    return unnamed[unnamed.length - 1]
}

function drawCallCount(canvas: HTMLCanvasElement): number {
    const ctx = contextFor(canvas)
    const spies = ['beginPath', 'moveTo', 'lineTo', 'stroke', 'fill'] as const
    return spies.reduce((total, name) => total + (ctx[name] as ReturnType<typeof vi.fn>).mock.calls.length, 0)
}

function pageRequestsFor(startTime: number): Array<Record<string, unknown>> {
    return harness.pageRequests.filter((message) => message.startTime === startTime)
}

/**
 * Runs the render scheduler's pending animation frame and lets its work settle.
 *
 * Two frames, because a draw can schedule another, with a flush after each for the
 * planning pass, which is async.
 */
async function settleFrame(): Promise<void> {
    for (let i = 0; i < 2; i++) {
        await flushPromises()
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
    await flushPromises()
}

describe('TSViewer mounted against a recorded transport', () => {
    let wrapper: VueWrapper | null = null

    beforeEach(() => {
        harness.reset()
        // TSAnnotationCanvas loads annotation layers over HTTP on mount. One canned layer
        // satisfies it without a server; every other HTTP path is guarded off by leaving
        // apiUrl and timeSeriesApi out of the config.
        vi.stubGlobal('fetch', vi.fn(async () => ({
            status: 200,
            json: async () => ({ results: [{ id: 1, name: 'Default', color: '#18BA62', description: 'Default' }] })
        })))
    })

    afterEach(async () => {
        wrapper?.unmount()
        wrapper = null
        await flushPromises()
        vi.unstubAllGlobals()
        document.body.innerHTML = ''
    })

    /**
     * Mounts the full tree, seeds the store directly (no discovery socket), and waits for
     * the plot canvas to open the mocked transport.
     */
    async function mountViewer(instanceId: string, channels: ChannelDetail[] = CHANNEL_DETAILS): Promise<{ store: ViewerStore }> {
        const pinia = createPinia()
        setActivePinia(pinia)
        const store = createViewerStore(instanceId)
        store.setViewerConfig({ timeseriesDiscoverApi: 'wss://discover.example' })

        wrapper = mount(TSViewer, {
            props: { instanceId },
            global: { plugins: [pinia] },
            attachTo: document.body
        })
        await flushPromises()

        store.setActiveViewer({
            channels: channels.map((channel) => ({ ...channel })),
            content: { ...CONTENT }
        })
        await flushPromises()
        await vi.waitFor(() => {
            expect(harness.openCalls.length).toBeGreaterThan(0)
            // TSViewer owns the transport, so an open call no longer implies the
            // plot canvas has mounted. Wait for its subscription instead: the
            // tests below push the catalog by hand and need a live handler.
            expect(harness.channelDetailsHandlers.length).toBeGreaterThan(0)
        }, { timeout: 3000 })
        await flushPromises()
        return { store }
    }

    /**
     * Pushes the channel-details reply the legacy server sends after connect, then waits
     * for the request pipeline to settle.
     *
     * One page request covers the first viewport. The channel-count watcher re-measures
     * the plot area 20 ms later and reads the same numbers, so the sample period holds
     * and the page is not requested again.
     */
    async function initializeChannels(): Promise<void> {
        const details = CHANNEL_DETAILS.map(({ id, name }) => ({ id, name }))
        harness.channelDetailsHandlers.forEach((handler) => handler(details))
        await vi.waitFor(() => {
            expect(pageRequestsFor(TS_START).length).toBeGreaterThanOrEqual(1)
        }, { timeout: 3000 })
    }

    it('renders a label for each seeded channel', async () => {
        await mountViewer('dom-test-labels')
        await initializeChannels()

        await vi.waitFor(() => {
            const labels = wrapper!.findAll('#channelLabels .labelDiv').map((label) => label.text())
            expect(labels).toEqual(['CH1', 'CH2'])
        }, { timeout: 3000 })
    })

    it('requests the viewport page with both channels in one typed PageRequest', async () => {
        await mountViewer('dom-test-requests')
        await initializeChannels()

        const pageRequest = pageRequestsFor(TS_START)[0]
        expect(pageRequest).toBeDefined()
        // The typed PageRequest carries no session or packageId: the token and the
        // package id are transport-internal. The byte-exact legacy wire JSON is
        // pinned in src/transport/websocketTransport.wire.test.ts. pixelWidth is 1
        // because the unlaid-out canvas reports a non-positive width and rsPeriod
        // falls back to 1. pins current behavior; revisit in the refactor
        expect(pageRequest).toMatchInlineSnapshot(`
          {
            "channels": [
              {
                "id": "ch-1",
                "name": "CH1",
              },
              {
                "id": "ch-2",
                "name": "CH2",
              },
            ],
            "endTime": 30000000,
            "minMax": true,
            "pixelWidth": 1,
            "priority": "viewport",
            "startTime": 15000000,
          }
        `)
    })

    it('draws on the plot canvas when a segment envelope answers a page request', async () => {
        await mountViewer('dom-test-segments')
        await initializeChannels()

        const wireRequest = pageRequestsFor(TS_START)[0]
        const req: PageRequestWindow = {
            startTime: wireRequest.startTime as number,
            endTime: wireRequest.endTime as number,
            pixelWidth: wireRequest.pixelWidth as number
        }

        const canvas = plotCanvasElement()
        const baseline = drawCallCount(canvas)

        harness.segmentHandlers.forEach((handler) => {
            handler(makeSegmentEnvelope('ch-1', 'CH1', req))
            handler(makeSegmentEnvelope('ch-2', 'CH2', req))
        })

        await vi.waitFor(() => {
            expect(drawCallCount(canvas)).toBeGreaterThan(baseline)
        }, { timeout: 3000 })
    })

    /**
     * Empties the plot canvas's pending-page bookkeeping.
     *
     * A planning pass skips a page that is already pending, so the viewport page has to
     * be unrequested for a stray plan to send anything.
     */
    function clearPendingPages(): void {
        const plot = wrapper!.findComponent(TSPlotCanvas)
        const exposed = plot.vm as unknown as { requestedPages: Map<number, unknown> }
        exposed.requestedPages.clear()
    }

    it('sends no page request when only the vertical zoom changes', async () => {
        await mountViewer('dom-test-repaint-only')
        await initializeChannels()
        clearPendingPages()

        const canvas = wrapper!.findComponent(TSViewerCanvas)
        const before = pageRequestsFor(TS_START).length
        canvas.vm.$emit('setGlobalZoom', (canvas.props('globalZoomMult') as number) * 2)
        await settleFrame()

        expect(pageRequestsFor(TS_START).length).toBe(before)
    })

    it('sends the viewport page again when the start moves', async () => {
        await mountViewer('dom-test-plan-on-start')
        await initializeChannels()
        clearPendingPages()

        const before = pageRequestsFor(TS_START).length
        wrapper!.findComponent(TSViewerCanvas).vm.$emit('setStart', TS_START + 1_000_000)
        await settleFrame()

        expect(pageRequestsFor(TS_START).length).toBeGreaterThan(before)
    })

    it('sends no page request until the duration stops changing', async () => {
        await mountViewer('dom-test-settle-requests')
        await initializeChannels()
        clearPendingPages()

        const canvas = wrapper!.findComponent(TSViewerCanvas)
        const before = pageRequestsFor(TS_START).length

        let duration = canvas.props('duration') as number
        for (let tick = 0; tick < 5; tick++) {
            duration = duration / 1.1
            canvas.vm.$emit('setDuration', duration)
            await flushPromises()
        }

        expect(pageRequestsFor(TS_START).length).toBe(before)

        await vi.waitFor(() => {
            expect(pageRequestsFor(TS_START).length).toBeGreaterThan(before)
        }, { timeout: 3000 })
    })

    it('requests the viewport again once the resolution settles', async () => {
        await mountViewer('dom-test-settle-refetch')
        await initializeChannels()

        const wireRequest = pageRequestsFor(TS_START)[0]
        const req: PageRequestWindow = {
            startTime: wireRequest.startTime as number,
            endTime: wireRequest.endTime as number,
            pixelWidth: wireRequest.pixelWidth as number
        }
        harness.segmentHandlers.forEach((handler) => {
            handler(makeSegmentEnvelope('ch-1', 'CH1', req))
            handler(makeSegmentEnvelope('ch-2', 'CH2', req))
        })
        await flushPromises()

        const canvas = wrapper!.findComponent(TSViewerCanvas)
        const before = pageRequestsFor(TS_START).length

        // The mounted canvas has no width, so the sample period the viewport implies
        // always falls back to 1. Writing the period TSViewerCanvas owns is what a zoom
        // does once the canvas is laid out.
        ;(canvas.vm as unknown as { rsPeriod: number }).rsPeriod = 2000
        await flushPromises()

        // The request walk reads no resolution off a cached block, so the page it covers
        // is asked for again only after the settle drops it.
        await vi.waitFor(() => {
            expect(pageRequestsFor(TS_START).length).toBeGreaterThan(before)
        }, { timeout: 3000 })
    })

    it('keeps drawing the cached blocks while the duration changes', async () => {
        await mountViewer('dom-test-settle-paint')
        await initializeChannels()

        const wireRequest = pageRequestsFor(TS_START)[0]
        const req: PageRequestWindow = {
            startTime: wireRequest.startTime as number,
            endTime: wireRequest.endTime as number,
            pixelWidth: wireRequest.pixelWidth as number
        }
        harness.segmentHandlers.forEach((handler) => {
            handler(makeSegmentEnvelope('ch-1', 'CH1', req))
            handler(makeSegmentEnvelope('ch-2', 'CH2', req))
        })

        const canvasElement = plotCanvasElement()
        await vi.waitFor(() => {
            expect(drawCallCount(canvasElement)).toBeGreaterThan(0)
        }, { timeout: 3000 })

        const baseline = drawCallCount(canvasElement)
        const canvas = wrapper!.findComponent(TSViewerCanvas)
        canvas.vm.$emit('setDuration', (canvas.props('duration') as number) / 1.1)
        await settleFrame()

        expect(drawCallCount(canvasElement)).toBeGreaterThan(baseline)
    })

    it('sends the legacy filter wire message for lowpass, highpass, bandpass, bandstop, and clear', async () => {
        await mountViewer('dom-test-filters')

        const viewer = wrapper!.vm as unknown as { setTimeseriesFilters: (payload: FilterPayload) => void }
        const selChannels = ['ch-1', 'ch-2']

        // Every filter message hardcodes order 4 as the first parameter.
        // pins current behavior; revisit in the refactor
        viewer.setTimeseriesFilters({ filterType: 'lowpass', selChannels, input0: 30 })
        expect(harness.filterMessages[0]).toMatchInlineSnapshot(`
          {
            "channels": [
              "ch-1",
              "ch-2",
            ],
            "filter": "lowpass",
            "filterParameters": [
              4,
              30,
            ],
          }
        `)

        viewer.setTimeseriesFilters({ filterType: 'highpass', selChannels, input0: 0.5 })
        expect(harness.filterMessages[1]).toMatchInlineSnapshot(`
          {
            "channels": [
              "ch-1",
              "ch-2",
            ],
            "filter": "highpass",
            "filterParameters": [
              4,
              0.5,
            ],
          }
        `)

        // Bandpass sends [order, center, halfWidth]: center is (low + high) / 2 and
        // halfWidth is |high - low| / 2, so 1..70 Hz becomes 35.5 and 34.5.
        viewer.setTimeseriesFilters({ filterType: 'bandpass', selChannels, input0: 1, input1: 70 })
        expect(harness.filterMessages[2]).toMatchInlineSnapshot(`
          {
            "channels": [
              "ch-1",
              "ch-2",
            ],
            "filter": "bandpass",
            "filterParameters": [
              4,
              35.5,
              34.5,
            ],
          }
        `)

        // Bandstop ignores input0/input1 and always sends width 10 around notchFreq.
        // pins current behavior; revisit in the refactor
        viewer.setTimeseriesFilters({ filterType: 'bandstop', selChannels, notchFreq: 60 })
        expect(harness.filterMessages[3]).toMatchInlineSnapshot(`
          {
            "channels": [
              "ch-1",
              "ch-2",
            ],
            "filter": "bandstop",
            "filterParameters": [
              4,
              60,
              10,
            ],
          }
        `)

        viewer.setTimeseriesFilters({ filterType: 'clear', selChannels })
        expect(harness.filterMessages[4]).toMatchInlineSnapshot(`
          {
            "channelFiltersToClear": [
              "ch-1",
              "ch-2",
            ],
          }
        `)
    })

    it('sends no filter message and writes no channel filter for a bandstop without a notch frequency', async () => {
        const { store } = await mountViewer('dom-test-filter-refused')
        await initializeChannels()

        const viewer = wrapper!.vm as unknown as { setTimeseriesFilters: (payload: FilterPayload) => void }
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        viewer.setTimeseriesFilters({ filterType: 'bandstop', selChannels: ['ch-1'] })

        expect(harness.filterMessages).toEqual([])
        expect(store.viewerChannels.find((channel) => channel.id === 'ch-1')?.filter).toEqual({})
        expect(warn).toHaveBeenCalledTimes(1)
        expect(String(warn.mock.calls[0][0])).toContain('notchFreq')

        warn.mockRestore()
    })

    it('leaves the viewport where it is when the active annotation layer holds no annotations', async () => {
        await mountViewer('dom-test-annotation-paging')
        await initializeChannels()

        const canvas = wrapper!.findComponent(TSViewerCanvas)
        const toolbar = wrapper!.findComponent(TSViewerToolbar)
        const startBefore = canvas.props('start')

        toolbar.vm.$emit('nextAnnotation')
        toolbar.vm.$emit('previousAnnotation')
        await flushPromises()

        expect(canvas.props('start')).toBe(startBefore)
    })

    it('sends the montage payload through transport setMontage when the montage scheme changes', async () => {
        const { store } = await mountViewer('dom-test-montage')

        store.setWorkspaceMontages([
            { name: 'TEST_MONTAGE', channelPairs: [{ name: 'CH1-CH2', channels: ['CH1', 'CH2'] }] }
        ])
        store.setViewerMontageScheme('TEST_MONTAGE')
        await vi.waitFor(() => {
            expect(harness.montageMessages.length).toBe(1)
        }, { timeout: 3000 })
        expect(harness.montageMessages[0]).toMatchInlineSnapshot(`
          {
            "montage": "CUSTOM_MONTAGE",
            "montageMap": [
              [
                "CH1",
                "CH2",
              ],
            ],
            "packageId": "pkg-1",
          }
        `)

        store.setViewerMontageScheme('NOT_MONTAGED')
        await vi.waitFor(() => {
            expect(harness.montageMessages.length).toBe(2)
        }, { timeout: 3000 })
        expect(harness.montageMessages[1]).toMatchInlineSnapshot(`
          {
            "montage": "NOT_MONTAGED",
            "montageMap": [],
            "packageId": "pkg-1",
          }
        `)
    })

    it('bounds the duration window by the recording length when the transport reports no ceiling', async () => {
        const LONG_END = TS_START + 7_200_000_000
        const longChannels: ChannelDetail[] = CHANNEL_DETAILS.map((channel) => ({ ...channel, end: LONG_END }))
        await mountViewer('dom-test-max-duration', longChannels)

        const toolbar = wrapper!.findComponent(TSViewerToolbar)
        expect(toolbar.props('maxDuration')).toBe(LONG_END - TS_START)

        const canvas = wrapper!.findComponent(TSViewerCanvas)
        canvas.vm.$emit('setDuration', 1_800_000_000)
        await flushPromises()
        expect(canvas.props('duration')).toBe(1_800_000_000)
    })

    it('holds the duration window at the recording length when asked for more', async () => {
        const LONG_END = TS_START + 7_200_000_000
        const longChannels: ChannelDetail[] = CHANNEL_DETAILS.map((channel) => ({ ...channel, end: LONG_END }))
        await mountViewer('dom-test-max-duration-clamp', longChannels)

        const canvas = wrapper!.findComponent(TSViewerCanvas)
        canvas.vm.$emit('setDuration', 9_000_000_000)
        await flushPromises()
        expect(canvas.props('duration')).toBe(LONG_END - TS_START)
    })
})
