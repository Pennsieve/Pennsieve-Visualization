// The vertical autoscale against a transport that surveys amplitudes: the shared scale
// comes from the microvolt median, and a channel that would not fit that scale gets
// its own row scale in the store.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const harness = vi.hoisted(() => ({
    /** The catalog the fake transport answers open() with. */
    catalog: [] as unknown[],
    /** Peak-to-peak per server id the fake survey answers with. */
    amplitudes: {} as Record<string, number>,
    surveyed: [] as string[][],
    reset() {
        this.catalog = []
        this.amplitudes = {}
        this.surveyed = []
    }
}))

vi.mock('@/composables/useToken', () => ({
    useToken: vi.fn(async () => 'test-token'),
    useLogout: vi.fn(async () => {})
}))

vi.mock('@/transport/createTransport', async () => {
    const { ref } = await import('vue')
    const { BASE_PAGE_SIZE } = await import('@/composables/streaming/paging')

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
                prefetchPages: 2,
                postDumpDelayMs: 0,
                supportsAmplitudeSurvey: true
            },
            async open() {
                status.value = 'connected'
                // The real transports answer open() with the catalog.
                latched = harness.catalog
                for (const handler of sets.channelDetails) handler(harness.catalog)
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
            async measureAmplitudes(channels: string[]) {
                harness.surveyed.push(channels)
                return channels.map((id) => harness.amplitudes[id] ?? Number.NaN)
            },
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
    { id: 'eeg-1', name: 'C3', channelType: 'CONTINUOUS', rate: 512, unit: 'uV', start: TS_START, end: TS_END, properties: [] },
    { id: 'eeg-2', name: 'C4', channelType: 'CONTINUOUS', rate: 512, unit: 'uV', start: TS_START, end: TS_END, properties: [] },
    { id: 'dc-1', name: 'DC1', channelType: 'CONTINUOUS', rate: 512, unit: 'uV', start: TS_START, end: TS_END, properties: [] },
    { id: 'spo2', name: 'SpO2', channelType: 'CONTINUOUS', rate: 512, unit: '%', start: TS_START, end: TS_END, properties: [] }
]

describe('TSViewer vertical autoscale from an amplitude survey', () => {
    let wrapper: VueWrapper | null = null
    const layout = {
        offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
        clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    }

    beforeEach(() => {
        harness.reset()
        // happy-dom lays nothing out. The viewer measures its root's offsetWidth and
        // computed height and the label column's clientWidth, so all three report sizes.
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1116 })
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 100 })
        vi.spyOn(window, 'getComputedStyle').mockImplementation(
            () => ({ getPropertyValue: (name: string) => (name === 'height' ? '600px' : '') }) as unknown as CSSStyleDeclaration
        )
        vi.stubGlobal('fetch', vi.fn(async () => ({
            status: 200,
            json: async () => ({ results: [{ id: 1, name: 'Default', color: '#18BA62', description: 'Default' }] })
        })))
    })

    afterEach(async () => {
        wrapper?.unmount()
        wrapper = null
        await flushPromises()
        clearAllViewerStores()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        for (const [name, descriptor] of Object.entries(layout)) {
            if (descriptor) {
                Object.defineProperty(HTMLElement.prototype, name, descriptor)
            } else {
                delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
            }
        }
        document.body.innerHTML = ''
    })

    it('scales a loud microvolt channel and a channel in another unit to their rows', async () => {
        harness.amplitudes = { 'eeg-1': 100, 'eeg-2': 100, 'dc-1': 47_000, spo2: 50 }
        harness.catalog = CHANNELS.map((channel) => ({ ...channel }))
        const pinia = createPinia()
        setActivePinia(pinia)
        const store = createViewerStore('autoscale')
        store.setViewerConfig({ timeseriesDiscoverApi: 'wss://discover.example' })

        wrapper = mount(TSViewer, {
            props: { instanceId: 'autoscale' },
            global: { plugins: [pinia] },
            attachTo: document.body
        })
        await flushPromises()
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
        await flushPromises()

        await vi.waitFor(() => {
            expect(harness.surveyed.length).toBeGreaterThan(0)
        }, { timeout: 3000 })
        expect(harness.surveyed[0]).toEqual(['eeg-1', 'eeg-2', 'dc-1', 'spo2'])

        await vi.waitFor(() => {
            const byId = new Map(store.viewerChannels.map((channel) => [channel.id, channel.rowScale]))
            expect(byId.get('eeg-1')).toBe(1)
            expect(byId.get('eeg-2')).toBe(1)
            expect(byId.get('dc-1')).toBeCloseTo(100 / 47_000, 12)
            expect(byId.get('spo2')).toBeCloseTo(2, 12)
        }, { timeout: 3000 })
    })
})
