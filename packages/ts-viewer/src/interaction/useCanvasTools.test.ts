import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// The store reaches for Amplify, a discovery WebSocket, and the zarr client registry on
// construction; none of them exists under test and none is involved in a pointer drag.
vi.mock('@/composables/useToken', () => ({
    useToken: vi.fn(async () => 'a.jwt.token'),
    useLogout: vi.fn()
}))

vi.mock('@/composables/useChannelDataRequest', () => ({
    useChannelDataRequest: () => ({ openConnection: vi.fn() })
}))

vi.mock('@/composables/streaming/clientRegistry', () => ({
    acquireClient: vi.fn(),
    ensureCatalog: vi.fn(),
    disposeClient: vi.fn()
}))

const { useCanvasTools } = await import('./useCanvasTools')
const { createViewerStore } = await import('@/stores/tsviewer')
import type { ViewerChannel, ViewerStore } from '@/stores/tsviewer'

/** Canvas top edge in client coordinates, so a row baseline of 0 sits above the drag. */
const CANVAS_TOP = 20

/**
 * The interaction canvas the tools read: a bounding rect and a context the overlay clear
 * writes through.
 */
const canvasStub = () => ({
    getBoundingClientRect: () => ({ left: 0, top: CANVAS_TOP, width: 800, height: 400 }),
    getContext: () => ({ clearRect: vi.fn() })
})

const mouseEvent = (clientX: number, clientY: number) => ({
    clientX,
    clientY,
    metaKey: false,
    buttons: 1,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
}) as unknown as MouseEvent

let instance = 0

const setup = (channels: ViewerChannel[]) => {
    const store = createViewerStore(`canvas-tools-test-${instance++}`)
    store.setChannels(channels)

    const canvas = canvasStub()
    const tools = useCanvasTools({
        store,
        interactionCanvas: () => canvas as unknown as HTMLCanvasElement,
        annotationCanvas: () => null,
        viewport: () => ({
            start: 0,
            cWidth: 800,
            cHeight: 400,
            pHeight: 380,
            rsPeriod: 1000,
            pixelRatio: 1,
            annotationLabelHeight: 20
        }),
        renderAll: vi.fn(),
        setStart: vi.fn(),
        addAnnotation: vi.fn()
    })

    return { store, tools }
}

const selectedIds = (store: ViewerStore) =>
    store.viewerChannels.filter((channel) => channel.selected).map((channel) => channel.id)

/** Drags from above the canvas top edge down to y 80 inside it. */
const dragDown = (tools: ReturnType<typeof setup>['tools']) => {
    tools.onMouseDown(mouseEvent(400, CANVAS_TOP - 10))
    tools.onMouseUp(mouseEvent(400, CANVAS_TOP + 80))
}

describe('pointer drag selection', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('selects every channel row the drag covers', () => {
        const { store, tools } = setup([
            { id: 'covered', rowBaseline: 50, selected: false, visible: true },
            { id: 'below', rowBaseline: 300, selected: false, visible: true }
        ])

        dragDown(tools)

        expect(selectedIds(store)).toEqual(['covered'])
    })

    it('skips a channel whose row baseline is null', () => {
        const { store, tools } = setup([
            { id: 'not-laid-out', rowBaseline: null, selected: false, visible: true },
            { id: 'covered', rowBaseline: 50, selected: false, visible: true }
        ])

        dragDown(tools)

        expect(selectedIds(store)).toEqual(['covered'])
    })

    it('skips a channel that carries no row baseline', () => {
        const { store, tools } = setup([
            { id: 'not-laid-out', selected: false, visible: true },
            { id: 'covered', rowBaseline: 50, selected: false, visible: true }
        ])

        dragDown(tools)

        expect(selectedIds(store)).toEqual(['covered'])
    })
})
