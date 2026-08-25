// The host may activate a package before TSViewer mounts, which means the
// transport can open, and answer with its catalog, before the plot canvas
// exists to hear it: the canvases are async components and mount after their
// parent. This mounts the real tree against a transport that follows the
// interface contract (emit the catalog during open, replay it to a late
// subscriber) and asserts the viewer still learns its channels.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const harness = vi.hoisted(() => ({
    openCalls: 0,
    /** Subscribers that registered before the catalog was emitted. */
    earlySubscribers: 0,
    reset() {
        this.openCalls = 0
        this.earlySubscribers = 0
    }
}))

vi.mock('@/composables/useToken', () => ({
    useToken: vi.fn(async () => 'test-token'),
    useLogout: vi.fn(async () => {})
}))

vi.mock('@/transport/createTransport', async () => {
    const { ref } = await import('vue')
    const { BASE_PAGE_SIZE } = await import('@/composables/streaming/paging')

    const CATALOG = [
        { id: 'ch-1', name: 'CH1', channelType: 'CONTINUOUS', rate: 250, unit: 'uV', start: 15_000_000, end: 60_000_000, properties: [] },
        { id: 'ch-2', name: 'CH2', channelType: 'CONTINUOUS', rate: 250, unit: 'uV', start: 15_000_000, end: 60_000_000, properties: [] }
    ]

    const build = () => {
        const status = ref<'disconnected' | 'connecting' | 'connected'>('disconnected')
        const sets: Record<string, Set<(payload: unknown) => void>> = {
            segment: new Set(), event: new Set(), channelDetails: new Set(), error: new Set()
        }
        let latched: unknown = null

        return {
            kind: 'zarr' as const,
            status,
            capabilities: {
                maxDurationUs: null,
                pageSizeFor: () => BASE_PAGE_SIZE,
                postDumpDelayMs: 0,
                supportsAmplitudeSurvey: false
            },
            async open() {
                harness.openCalls += 1
                harness.earlySubscribers = sets.channelDetails.size
                status.value = 'connected'
                // The real transports answer open() with the catalog.
                latched = CATALOG
                for (const handler of sets.channelDetails) handler(CATALOG)
            },
            async close() {
                status.value = 'disconnected'
                latched = null
            },
            requestPage: () => true,
            setMontage: () => {},
            setFilter: () => {},
            dumpBuffer: () => true,
            dataSpans: async () => [],
            on(event: string, handler: (payload: unknown) => void) {
                sets[event].add(handler)
                if (event === 'channelDetails' && latched) {
                    const replayed = latched
                    queueMicrotask(() => {
                        if (sets[event].has(handler) && latched === replayed) handler(replayed)
                    })
                }
                return () => { sets[event].delete(handler) }
            }
        }
    }

    return { createTransport: () => build() }
})

import TSViewer from '@/components/TSViewer/TSViewer.vue'
import { createViewerStore, clearAllViewerStores } from '@/stores/tsviewer'
import type { ChannelDetail } from '@/composables/streaming/channelDetails'

const TS_START = 15_000_000
const TS_END = 60_000_000

const CHANNELS: ChannelDetail[] = [
    { id: 'ch-1', name: 'CH1', channelType: 'CONTINUOUS', rate: 250, unit: 'uV', start: TS_START, end: TS_END, properties: [] },
    { id: 'ch-2', name: 'CH2', channelType: 'CONTINUOUS', rate: 250, unit: 'uV', start: TS_START, end: TS_END, properties: [] }
]

describe('TSViewer when the package is activated before it mounts', () => {
    let wrapper: VueWrapper | null = null

    beforeEach(() => {
        harness.reset()
        vi.stubGlobal('fetch', vi.fn(async () => ({
            status: 200,
            json: async () => ({ results: [] })
        })))
    })

    afterEach(() => {
        wrapper?.unmount()
        wrapper = null
        clearAllViewerStores()
        vi.unstubAllGlobals()
        document.body.innerHTML = ''
    })

    it('renders the channels when the catalog arrives before the canvas subscribes', async () => {
        const pinia = createPinia()
        setActivePinia(pinia)

        // Activation first, exactly as a host that awaits it in its own setup.
        const store = createViewerStore('activation-order')
        store.setViewerConfig({ timeseriesDiscoverApi: 'wss://discover.example' })
        store.setActiveViewer({
            channels: CHANNELS.map((channel) => ({ ...channel })),
            content: {
                id: 'pkg-1',
                viewerAssetId: null,
                idType: 'package',
                assetType: 'timeseries-zarr',
                url: 'https://bundle.example/',
                onUrlExpired: null
            }
        })

        wrapper = mount(TSViewer, {
            props: { instanceId: 'activation-order' },
            global: { plugins: [pinia] },
            attachTo: document.body
        })

        await vi.waitFor(() => {
            const labels = wrapper!.findAll('#channelLabels .labelDiv').map((label) => label.text())
            expect(labels).toEqual(['CH1', 'CH2'])
        }, { timeout: 3000 })

        expect(store.viewerChannels.length).toBe(2)
    })

    it('keeps one connection when the same package is activated again', async () => {
        const pinia = createPinia()
        setActivePinia(pinia)
        const store = createViewerStore('activation-order-repeat')
        const activate = () => store.setActiveViewer({
            channels: CHANNELS.map((channel) => ({ ...channel })),
            content: {
                id: 'pkg-1',
                viewerAssetId: null,
                idType: 'package',
                assetType: 'timeseries-zarr',
                url: 'https://bundle.example/',
                onUrlExpired: null
            }
        })

        activate()
        wrapper = mount(TSViewer, {
            props: { instanceId: 'activation-order-repeat' },
            global: { plugins: [pinia] },
            attachTo: document.body
        })
        await vi.waitFor(() => {
            expect(harness.openCalls).toBe(1)
        }, { timeout: 3000 })

        // A host that re-activates the same package, on a prop change or a route
        // update, must not tear down the loaded catalog and cached segments.
        activate()
        activate()
        await flushPromises()
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(harness.openCalls).toBe(1)
    })

    it('opens the transport before the plot canvas has subscribed', async () => {
        const pinia = createPinia()
        setActivePinia(pinia)
        const store = createViewerStore('activation-order-timing')
        store.setActiveViewer({
            channels: CHANNELS.map((channel) => ({ ...channel })),
            content: {
                id: 'pkg-1',
                viewerAssetId: null,
                idType: 'package',
                assetType: 'timeseries-zarr',
                url: 'https://bundle.example/',
                onUrlExpired: null
            }
        })

        wrapper = mount(TSViewer, {
            props: { instanceId: 'activation-order-timing' },
            global: { plugins: [pinia] },
            attachTo: document.body
        })
        await flushPromises()
        await vi.waitFor(() => {
            expect(harness.openCalls).toBeGreaterThan(0)
        }, { timeout: 3000 })

        // This is the condition that broke the release: nothing was listening
        // when the catalog was emitted, so it can only arrive by replay.
        expect(harness.earlySubscribers).toBe(0)
    })
})
