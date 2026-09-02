// How the plot canvas plans against the viewport it can measure: no page before the
// viewport has a width, and no dump for the stale blocks of one page.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref, shallowRef } from 'vue'
import TSPlotCanvas from '@/components/TSViewer/TSPlotCanvas.vue'
import { ViewerTransportKey } from '@/state/viewerTransportContext'
import { BASE_PAGE_SIZE } from '@/composables/streaming/paging'
import type { PageRequest, TimeseriesTransport, TransportSegmentEnvelope } from '@/transport/TimeseriesTransport'
import type { ChannelDetail } from '@/composables/streaming/channelDetails'

const TS_START = 0
const TS_END = 60_000_000

const CHANNELS: ChannelDetail[] = [
    { id: 'ch-1', name: 'CH1', channelType: 'CONTINUOUS', rate: 250, unit: 'uV', start: TS_START, end: TS_END, properties: [] },
    { id: 'ch-2', name: 'CH2', channelType: 'CONTINUOUS', rate: 250, unit: 'uV', start: TS_START, end: TS_END, properties: [] }
]

/** A connected transport that records every page it is asked for and every dump. */
function fakeTransport(): {
    transport: TimeseriesTransport
    pages: PageRequest[]
    dumps: { count: number }
    emitSegment(envelope: TransportSegmentEnvelope): void
} {
    const pages: PageRequest[] = []
    const dumps = { count: 0 }
    const sets: Record<string, Set<(payload: unknown) => void>> = {
        segment: new Set(), event: new Set(), channelDetails: new Set(), error: new Set()
    }
    const transport = {
        kind: 'zarr' as const,
        status: ref<'disconnected' | 'connecting' | 'connected'>('connected'),
        capabilities: {
            maxDurationUs: null,
            pageSizeFor: () => BASE_PAGE_SIZE,
            prefetchPages: 2,
            postDumpDelayMs: 0,
            supportsAmplitudeSurvey: false
        },
        async open() {},
        async close() {},
        requestPage(req: PageRequest) {
            pages.push(req)
            return true
        },
        setMontage: () => {},
        setFilter: () => {},
        dumpBuffer: () => {
            dumps.count++
            return true
        },
        dataSpans: async () => [],
        on(event: string, handler: (payload: unknown) => void) {
            sets[event].add(handler)
            if (event === 'channelDetails') {
                queueMicrotask(() => {
                    if (sets[event].has(handler)) handler(CHANNELS)
                })
            }
            return () => { sets[event].delete(handler) }
        }
    } as unknown as TimeseriesTransport
    const emitSegment = (envelope: TransportSegmentEnvelope) => {
        for (const handler of sets.segment) handler(envelope)
    }
    return { transport, pages, dumps, emitSegment }
}

/** A block answered at another resolution, which the canvas must reject as stale. */
function staleBlock(pageStart: number, chId: string): TransportSegmentEnvelope {
    return {
        pageStart,
        type: 'Continuous',
        nrResponses: 1,
        data: {
            chId,
            label: chId === 'ch-1' ? 'CH1' : 'CH2',
            name: chId === 'ch-1' ? 'CH1' : 'CH2',
            requestedSamplePeriod: 999,
            pageStart,
            pageEnd: pageStart + BASE_PAGE_SIZE,
            startTs: pageStart,
            samplePeriod: 999,
            nrPoints: 0,
            parsedData: [new Float64Array(0), new Float64Array(0), new Float64Array(0)]
        }
    } as unknown as TransportSegmentEnvelope
}

describe('plot canvas planning before layout', () => {
    let wrapper: VueWrapper | null = null

    afterEach(() => {
        wrapper?.unmount()
        wrapper = null
        document.body.innerHTML = ''
    })

    it('requests no page until the viewport has a width, then requests at the measured resolution', async () => {
        setActivePinia(createPinia())
        const { transport, pages } = fakeTransport()
        wrapper = mount(TSPlotCanvas, {
            props: {
                cHeight: 400,
                cWidth: 0,
                start: TS_START,
                duration: 15_000_000,
                constants: { XOFFSET: 0, USEMEDIAN: false, PREFETCHPAGES: 2 },
                rsPeriod: 0,
                ts_start: TS_START,
                ts_end: TS_END,
                globalZoomMult: 1,
                activeViewer: { channels: CHANNELS.map((channel) => ({ ...channel })) }
            },
            global: { provide: { [ViewerTransportKey as symbol]: shallowRef(transport) } },
            attachTo: document.body
        })
        await flushPromises()
        await new Promise((resolve) => setTimeout(resolve, 250))
        expect(pages).toHaveLength(0)

        await wrapper.setProps({ cWidth: 900, rsPeriod: 1000 })
        await flushPromises()
        await vi.waitFor(() => {
            if (pages.length === 0) throw new Error('no page requested after layout')
        }, { timeout: 2000 })
        for (const page of pages) {
            expect(page.pixelWidth).toBe(1000)
        }
    })

    it('does not dump the buffer for many stale blocks that belong to one page', async () => {
        setActivePinia(createPinia())
        const { transport, pages, dumps, emitSegment } = fakeTransport()
        wrapper = mount(TSPlotCanvas, {
            props: {
                cHeight: 400,
                cWidth: 900,
                start: TS_START,
                duration: 15_000_000,
                constants: { XOFFSET: 0, USEMEDIAN: false, PREFETCHPAGES: 2 },
                rsPeriod: 1000,
                ts_start: TS_START,
                ts_end: TS_END,
                globalZoomMult: 1,
                activeViewer: { channels: CHANNELS.map((channel) => ({ ...channel })) }
            },
            global: { provide: { [ViewerTransportKey as symbol]: shallowRef(transport) } },
            attachTo: document.body
        })
        await flushPromises()
        await vi.waitFor(() => {
            if (pages.length === 0) throw new Error('no page requested')
        }, { timeout: 2000 })

        // One page answered at a stale resolution, 103 channels' worth of blocks.
        for (let i = 0; i < 103; i++) {
            emitSegment(staleBlock(TS_START, i % 2 === 0 ? 'ch-1' : 'ch-2'))
        }

        // The next planning pass, as a start change in the parent would run it.
        await (wrapper.vm as unknown as { planRequests(): Promise<void> }).planRequests()

        expect(dumps.count).toBe(0)
    })
})
