// Two TSViewer instances mounted side by side, covering which of them renders a
// message. Each instance owns an emitter, so a message raised inside one of them
// reaches that instance's handler alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// The text of every message the mounted viewers render, in order.
const harness = vi.hoisted(() => ({
    rendered: [] as string[],
    channelDetailsHandlers: [] as Array<(details: unknown) => void>,
    openCalls: 0,
    reset() {
        this.rendered.length = 0
        this.channelDetailsHandlers.length = 0
        this.openCalls = 0
    }
}))

// ElMessage is the only element-plus export replaced: the component tree keeps
// the real dialogs and buttons, and the message call is what proves a handler ran.
vi.mock('element-plus', async (importOriginal) => {
    const actual = await importOriginal<typeof import('element-plus')>()
    return {
        ...actual,
        ElMessage: (options: { message?: string }) => {
            harness.rendered.push(String(options?.message ?? ''))
        }
    }
})

vi.mock('@/composables/useToken', () => ({
    useToken: vi.fn(async () => 'test-token'),
    useLogout: vi.fn(async () => {})
}))

// One transport per viewer, absorbing everything the tree sends. Only the
// channel-details subscription is recorded, as the signal that a viewer's canvas
// subtree has mounted.
vi.mock('@/transport/createTransport', async () => {
    const { ref } = await import('vue')
    const { BASE_PAGE_SIZE } = await import('@/composables/streaming/paging')
    const createTransport = () => {
        const status = ref<'disconnected' | 'connecting' | 'connected'>('disconnected')
        return {
            kind: 'websocket' as const,
            status,
            capabilities: {
                maxDurationUs: null,
                pageSizeFor: () => BASE_PAGE_SIZE,
                postDumpDelayMs: 0,
                supportsAmplitudeSurvey: false
            },
            open: async () => {
                harness.openCalls += 1
                status.value = 'connected'
            },
            close: async () => {
                status.value = 'disconnected'
            },
            requestPage: () => true,
            setMontage: () => {},
            setFilter: () => {},
            dumpBuffer: () => true,
            dataSpans: async () => [],
            on(event: string, handler: (payload: unknown) => void) {
                if (event === 'channelDetails') {
                    harness.channelDetailsHandlers.push(handler)
                }
                return () => {}
            }
        }
    }
    return { createTransport }
})

import TSViewer from '@/components/TSViewer/TSViewer.vue'
import TSAnnotationCanvas from '@/components/TSViewer/TSAnnotationCanvas.vue'
import { createViewerStore } from '@/stores/tsviewer'
import { useHandleXhrError } from '@/mixins/request/request_composable'
import type { ChannelDetail } from '@/composables/streaming/channelDetails'

const TS_START = 15_000_000
const TS_END = 60_000_000

const CHANNEL_DETAILS: ChannelDetail[] = [
    { id: 'ch-1', name: 'CH1', channelType: 'CONTINUOUS', rate: 250, unit: 'uV', start: TS_START, end: TS_END, properties: [] }
]

// assetType 'timeseries' selects the legacy streaming path, which the mocked
// transport absorbs; the zarr client registry is never touched.
const CONTENT = {
    id: 'pkg-1',
    viewerAssetId: null,
    idType: 'package' as const,
    assetType: 'timeseries',
    url: null,
    onUrlExpired: null
}

/** The layer-creation method TSAnnotationCanvas exposes. */
interface AnnotationCanvasHandle {
    createAnnotationLayer: (layer: { name: string; color: string; description?: string }) => Promise<void>
}

describe('two TSViewer instances on one page', () => {
    const wrappers: VueWrapper[] = []
    let pinia = createPinia()

    beforeEach(() => {
        harness.reset()
        pinia = createPinia()
        setActivePinia(pinia)
        // The layer list satisfies the mount-time load in both viewers; the POST
        // reply is the layer the isolation test creates.
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { method?: string }) => {
            if (init?.method === 'POST') {
                return {
                    status: 200,
                    json: async () => ({ id: 2, name: 'Probe', color: '#0D4EFF', description: 'Probe' })
                }
            }
            return {
                status: 200,
                json: async () => ({ results: [{ id: 1, name: 'Default', color: '#18BA62', description: 'Default' }] })
            }
        }))
    })

    afterEach(async () => {
        wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
        await flushPromises()
        vi.unstubAllGlobals()
        document.body.innerHTML = ''
    })

    /** Mounts one viewer and waits for its canvas subtree to subscribe. */
    async function mountViewer(instanceId: string): Promise<VueWrapper> {
        const store = createViewerStore(instanceId)
        store.setViewerConfig({ timeseriesDiscoverApi: 'wss://discover.example' })

        const wrapper = mount(TSViewer, {
            props: { instanceId },
            global: { plugins: [pinia] },
            attachTo: document.body
        })
        wrappers.push(wrapper)
        await flushPromises()

        store.setActiveViewer({
            channels: CHANNEL_DETAILS.map((channel) => ({ ...channel })),
            content: { ...CONTENT }
        })
        await flushPromises()
        await vi.waitFor(() => {
            expect(harness.channelDetailsHandlers.length).toBeGreaterThanOrEqual(wrappers.length)
        }, { timeout: 3000 })
        await flushPromises()
        return wrapper
    }

    it('renders a toast raised in one instance once', async () => {
        const first = await mountViewer('multi-instance-a')
        await mountViewer('multi-instance-b')

        const annotationCanvas = first.findComponent(TSAnnotationCanvas)
        expect(annotationCanvas.exists()).toBe(true)

        await (annotationCanvas.vm as unknown as AnnotationCanvasHandle).createAnnotationLayer({
            name: 'Probe',
            color: '#0D4EFF'
        })
        await flushPromises()

        // One entry, from the viewer the layer was created in. A module-level bus
        // put the same text in front of both viewers.
        expect(harness.rendered.filter((text) => text.includes('Layer Created')))
            .toEqual(["'Probe' Layer Created"])
    })

    it('renders a request failure with no component context in every instance', async () => {
        await mountViewer('multi-instance-c')
        await mountViewer('multi-instance-d')

        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        // An async catch block cannot tell which viewer the request belonged to,
        // so both handlers render the message.
        useHandleXhrError({ status: 401 })
        error.mockRestore()

        expect(harness.rendered.filter((text) => text.includes('Session expired')))
            .toHaveLength(2)
    })
})
