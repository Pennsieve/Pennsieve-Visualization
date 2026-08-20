import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
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
import type { AnnotationCanvasTools, CanvasToolsViewport } from './useCanvasTools'
import type { ViewerChannel, ViewerStore } from '@/stores/tsviewer'
import type { AnnotationLayer } from '@/utils/annotationUtils'

/** Canvas top edge in client coordinates, so a row baseline of 0 sits above the drag. */
const CANVAS_TOP = 20

/** Overlay context: every member the drag overlays write through. */
const contextStub = () => ({
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    rect: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    setLineDash: vi.fn(),
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: ''
})

/**
 * The interaction canvas the tools read: a bounding rect and a context the overlays
 * write through.
 */
const canvasStub = (ctx: ReturnType<typeof contextStub>) => ({
    getBoundingClientRect: () => ({ left: 0, top: CANVAS_TOP, width: 800, height: 400 }),
    getContext: () => ctx
})

const mouseEvent = (clientX: number, clientY: number, metaKey = false) => ({
    clientX,
    clientY,
    metaKey,
    buttons: 1,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
}) as unknown as MouseEvent

/** Annotation canvas whose returned pointer mode each test controls. */
const annotationCanvasStub = () => ({
    onMouseDown: vi.fn<AnnotationCanvasTools['onMouseDown']>(),
    onMouseMove: vi.fn<AnnotationCanvasTools['onMouseMove']>(),
    onMouseUp: vi.fn<AnnotationCanvasTools['onMouseUp']>(),
    selectFocusedAnn: vi.fn<AnnotationCanvasTools['selectFocusedAnn']>()
})

interface SetupOptions {
    layers?: AnnotationLayer[]
    /** Tool the store reports before the tools are created. */
    activeTool?: string
    viewport?: Partial<CanvasToolsViewport>
    /** Set to null to drive the tools without an annotation canvas. */
    annotationCanvas?: ReturnType<typeof annotationCanvasStub> | null
}

const layerFixture = (fields: Partial<AnnotationLayer>): AnnotationLayer => ({
    id: 'layer-a',
    visible: true,
    selected: false,
    annotations: [],
    color: 'rgba(51,204,102,0.8)',
    ...fields
})

let instance = 0

const setup = (channels: ViewerChannel[], options: SetupOptions = {}) => {
    const store = createViewerStore(`canvas-tools-test-${instance++}`)
    store.setChannels(channels)
    if (options.layers) {
        store.setAnnotations(options.layers)
    }
    if (options.activeTool) {
        store.setActiveTool(options.activeTool)
    }

    const ctx = contextStub()
    const canvas = canvasStub(ctx)
    const annotationCanvas = options.annotationCanvas === undefined ? annotationCanvasStub() : options.annotationCanvas
    const viewport: CanvasToolsViewport = {
        start: 0,
        cWidth: 800,
        cHeight: 400,
        pHeight: 380,
        rsPeriod: 1000,
        pixelRatio: 1,
        annotationLabelHeight: 20,
        ...options.viewport
    }
    const renderAll = vi.fn()
    const setStart = vi.fn()
    const addAnnotation = vi.fn()

    const tools = useCanvasTools({
        store,
        interactionCanvas: () => canvas as unknown as HTMLCanvasElement,
        annotationCanvas: () => annotationCanvas as AnnotationCanvasTools | null,
        viewport: () => viewport,
        renderAll,
        setStart,
        addAnnotation
    })

    return { store, tools, ctx, annotationCanvas, viewport, renderAll, setStart, addAnnotation }
}

const selectedIds = (store: ViewerStore) =>
    store.viewerChannels.filter((channel) => channel.selected).map((channel) => channel.id)

/** Drags from above the canvas top edge down to y 80 inside it. */
const dragDown = (tools: ReturnType<typeof setup>['tools']) => {
    tools.onMouseDown(mouseEvent(400, CANVAS_TOP - 10))
    tools.onMouseUp(mouseEvent(400, CANVAS_TOP + 80))
}

beforeEach(() => {
    setActivePinia(createPinia())
})

describe('pointer drag selection', () => {
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

    it('selects the rows of a drag that ran upward', () => {
        const { store, tools } = setup([
            { id: 'covered', rowBaseline: 50, selected: false, visible: true },
            { id: 'below', rowBaseline: 300, selected: false, visible: true }
        ])

        tools.onMouseDown(mouseEvent(400, CANVAS_TOP + 200))
        tools.onMouseUp(mouseEvent(400, CANVAS_TOP + 10))

        expect(selectedIds(store)).toEqual(['covered'])
    })

    it('drops the earlier selection when the drag ends without the meta key', () => {
        const { store, tools } = setup([
            { id: 'covered', rowBaseline: 50, selected: false, visible: true },
            { id: 'kept', rowBaseline: 300, selected: true, visible: true }
        ])

        dragDown(tools)

        expect(selectedIds(store)).toEqual(['covered'])
    })

    it('adds to the earlier selection when the drag ends with the meta key', () => {
        const { store, tools } = setup([
            { id: 'covered', rowBaseline: 50, selected: false, visible: true },
            { id: 'kept', rowBaseline: 300, selected: true, visible: true }
        ])

        tools.onMouseDown(mouseEvent(400, CANVAS_TOP - 10))
        tools.onMouseUp(mouseEvent(400, CANVAS_TOP + 80, true))

        expect(selectedIds(store)).toEqual(['covered', 'kept'])
    })

    it('clears the overlay and redraws once the selection is stored', () => {
        const { tools, ctx, renderAll } = setup([
            { id: 'covered', rowBaseline: 50, selected: false, visible: true }
        ])

        dragDown(tools)

        expect(ctx.clearRect).toHaveBeenCalledTimes(1)
        expect(renderAll).toHaveBeenCalledTimes(1)
    })

    it('draws the selection overlay while the pointer tool drags', () => {
        const { tools, ctx, annotationCanvas } = setup([])

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 10))
        tools.onMouseMove(mouseEvent(300, CANVAS_TOP + 200))

        expect(ctx.rect).toHaveBeenCalledTimes(1)
        expect(annotationCanvas?.onMouseMove).not.toHaveBeenCalled()
    })

    it('asks the annotation canvas for a pointer mode while the pointer tool hovers', () => {
        const { tools, annotationCanvas } = setup([])
        annotationCanvas!.onMouseMove.mockReturnValue('annSelect')

        tools.onMouseMove(mouseEvent(300, CANVAS_TOP + 40))

        expect(annotationCanvas?.onMouseMove).toHaveBeenCalledWith(300, 40, 'pointer', false)
        expect(tools.pointerMode.value).toBe('annSelect')
    })

    it('keeps the pointer tool mode when the annotation canvas reports none', () => {
        const { tools, annotationCanvas } = setup([])
        annotationCanvas!.onMouseMove.mockReturnValue(undefined)

        tools.onMouseMove(mouseEvent(300, CANVAS_TOP + 40))

        expect(tools.pointerMode.value).toBe('pointer')
    })

    it('keeps the pointer tool mode when there is no annotation canvas', () => {
        const { tools } = setup([], { annotationCanvas: null })

        tools.onMouseMove(mouseEvent(300, CANVAS_TOP + 40))

        expect(tools.pointerMode.value).toBe('pointer')
    })
})

describe('pan drag', () => {
    it('moves the viewport start back by the distance the drag covered', () => {
        const { tools, setStart } = setup([], { activeTool: 'pan', viewport: { start: 5_000_000 } })

        tools.onMouseDown(mouseEvent(400, CANVAS_TOP + 100))
        tools.onMouseMove(mouseEvent(500, CANVAS_TOP + 100))

        expect(setStart).toHaveBeenCalledWith(4_900_000)
    })

    it('moves the viewport start forward when the drag runs left', () => {
        const { tools, setStart } = setup([], { activeTool: 'pan', viewport: { start: 5_000_000 } })

        tools.onMouseDown(mouseEvent(400, CANVAS_TOP + 100))
        tools.onMouseMove(mouseEvent(300, CANVAS_TOP + 100))

        expect(setStart).toHaveBeenCalledWith(5_100_000)
    })

    it('measures every pan step from the start the drag began at', () => {
        const { tools, setStart } = setup([], { activeTool: 'pan', viewport: { start: 5_000_000 } })

        tools.onMouseDown(mouseEvent(400, CANVAS_TOP + 100))
        tools.onMouseMove(mouseEvent(450, CANVAS_TOP + 100))
        tools.onMouseMove(mouseEvent(500, CANVAS_TOP + 100))

        expect(setStart).toHaveBeenNthCalledWith(1, 4_950_000)
        expect(setStart).toHaveBeenNthCalledWith(2, 4_900_000)
    })

    it('scales the pan by the sample period of the viewport', () => {
        const { tools, setStart } = setup([], {
            activeTool: 'pan',
            viewport: { start: 5_000_000, rsPeriod: 4000 }
        })

        tools.onMouseDown(mouseEvent(400, CANVAS_TOP + 100))
        tools.onMouseMove(mouseEvent(500, CANVAS_TOP + 100))

        expect(setStart).toHaveBeenCalledWith(4_600_000)
    })

    it('leaves the annotation canvas alone while the pan drag runs', () => {
        const { tools, annotationCanvas } = setup([], { activeTool: 'pan' })

        tools.onMouseDown(mouseEvent(400, CANVAS_TOP + 100))
        tools.onMouseMove(mouseEvent(500, CANVAS_TOP + 100))

        expect(annotationCanvas?.onMouseMove).not.toHaveBeenCalled()
    })

    it('adopts the annotation pointer mode while the pan tool hovers', () => {
        const { tools, annotationCanvas, setStart } = setup([], { activeTool: 'pan' })
        annotationCanvas!.onMouseMove.mockReturnValue('annResize-right')

        tools.onMouseMove(mouseEvent(500, CANVAS_TOP + 40))

        expect(tools.pointerMode.value).toBe('annResize-right')
        expect(setStart).not.toHaveBeenCalled()
    })

    it('falls back to the pan mode when the annotation canvas reports none', () => {
        const { tools, annotationCanvas } = setup([], { activeTool: 'pan' })
        annotationCanvas!.onMouseMove.mockReturnValue(undefined)

        tools.onMouseMove(mouseEvent(500, CANVAS_TOP + 40))

        expect(tools.pointerMode.value).toBe('pan')
    })

    it('does nothing when a pan drag ends', () => {
        const { tools, ctx, renderAll, addAnnotation } = setup([
            { id: 'covered', rowBaseline: 50, selected: false, visible: true }
        ], { activeTool: 'pan' })

        tools.onMouseDown(mouseEvent(400, CANVAS_TOP - 10))
        tools.onMouseUp(mouseEvent(400, CANVAS_TOP + 80))

        expect(ctx.clearRect).not.toHaveBeenCalled()
        expect(renderAll).not.toHaveBeenCalled()
        expect(addAnnotation).not.toHaveBeenCalled()
    })
})

describe('annotate drag', () => {
    const annotateSetup = (options: SetupOptions = {}) =>
        setup([{ id: 'a', rowBaseline: 50, selected: false, visible: true }], {
            activeTool: 'annotate',
            layers: [layerFixture({ selected: true })],
            ...options
        })

    it('takes the annotate mode when a drag starts on empty canvas', () => {
        const { tools } = annotateSetup()

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 100))

        expect(tools.pointerMode.value).toBe('annotate')
        expect(tools.mouseDown.value).toBe(true)
    })

    it('draws the annotation preview while the drag runs', () => {
        const { tools, ctx } = annotateSetup()

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 100))
        tools.onMouseMove(mouseEvent(300, CANVAS_TOP + 100))

        expect(ctx.fillRect).toHaveBeenCalled()
    })

    it('draws no annotation preview while no layer is selected', () => {
        const { tools, ctx } = annotateSetup({ layers: [] })

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 100))
        tools.onMouseMove(mouseEvent(300, CANVAS_TOP + 100))

        expect(ctx.fillRect).not.toHaveBeenCalled()
    })

    it('creates an annotation spanning the drag when it ends', () => {
        const { tools, addAnnotation } = annotateSetup()

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 100))
        tools.onMouseUp(mouseEvent(300, CANVAS_TOP + 100))

        expect(addAnnotation).toHaveBeenCalledWith(
            100_000,
            200_000,
            true,
            'Event',
            '',
            expect.objectContaining({ id: 'layer-a' })
        )
    })

    it('creates the same annotation from a drag that ran right to left', () => {
        const { tools, addAnnotation } = annotateSetup()

        tools.onMouseDown(mouseEvent(300, CANVAS_TOP + 100))
        tools.onMouseUp(mouseEvent(100, CANVAS_TOP + 100))

        expect(addAnnotation).toHaveBeenCalledWith(100_000, 200_000, true, 'Event', '', expect.anything())
    })

    it('offsets the annotation start by the viewport start of the drag', () => {
        const { tools, addAnnotation } = annotateSetup({ viewport: { start: 7_000_000 } })

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 100))
        tools.onMouseUp(mouseEvent(300, CANVAS_TOP + 100))

        expect(addAnnotation).toHaveBeenCalledWith(7_100_000, 200_000, true, 'Event', '', expect.anything())
    })

    it('creates no annotation for a drag at the shortest duration', () => {
        const { tools, addAnnotation } = annotateSetup()

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 100))
        tools.onMouseUp(mouseEvent(101, CANVAS_TOP + 100))

        expect(addAnnotation).not.toHaveBeenCalled()
    })

    it('creates an annotation once the drag passes the shortest duration', () => {
        const { tools, addAnnotation } = annotateSetup()

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 100))
        tools.onMouseUp(mouseEvent(102, CANVAS_TOP + 100))

        expect(addAnnotation).toHaveBeenCalledWith(100_000, 2_000, true, 'Event', '', expect.anything())
    })

    it('reports the new annotation as the active one', () => {
        const { tools, store } = annotateSetup()

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 100))
        tools.onMouseUp(mouseEvent(300, CANVAS_TOP + 100))

        expect(store.activeAnnotation).toMatchObject({
            label: 'Event',
            start: 100_000,
            duration: 200_000,
            end: 300_000,
            layer_id: 'layer-a',
            selected: true
        })
    })

    it('scopes the annotation to the selected channels', () => {
        const { tools, store, addAnnotation } = setup(
            [
                { id: 'a', rowBaseline: 50, selected: true, visible: true },
                { id: 'b', rowBaseline: 100, selected: false, visible: true }
            ],
            { activeTool: 'annotate', layers: [layerFixture({ selected: true })] }
        )

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 100))
        tools.onMouseUp(mouseEvent(300, CANVAS_TOP + 100))

        expect(addAnnotation).toHaveBeenCalledWith(100_000, 200_000, false, 'Event', '', expect.anything())
        expect(store.activeAnnotation.channelIds).toEqual(['a'])
    })

    it('spans every channel when all of them are selected', () => {
        const { tools, addAnnotation } = setup(
            [
                { id: 'a', rowBaseline: 50, selected: true, visible: true },
                { id: 'b', rowBaseline: 100, selected: true, visible: true }
            ],
            { activeTool: 'annotate', layers: [layerFixture({ selected: true })] }
        )

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 100))
        tools.onMouseUp(mouseEvent(300, CANVAS_TOP + 100))

        expect(addAnnotation).toHaveBeenCalledWith(100_000, 200_000, true, 'Event', '', expect.anything())
    })

    it('creates the annotation in the first layer when the selected one has no id', () => {
        const { tools, store, addAnnotation } = annotateSetup({
            layers: [layerFixture({ id: 'layer-a' }), layerFixture({ id: 'layer-b', selected: true })]
        })
        store.viewerAnnotations[1].id = ''

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 100))
        tools.onMouseUp(mouseEvent(300, CANVAS_TOP + 100))

        expect(addAnnotation).toHaveBeenCalledWith(
            100_000,
            200_000,
            true,
            'Event',
            '',
            expect.objectContaining({ id: 'layer-a' })
        )
        expect(store.viewerAnnotations[0].selected).toBe(true)
    })

    it('creates no annotation when there is no layer to hold it', () => {
        const { tools, addAnnotation } = annotateSetup({ layers: [] })

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 100))
        tools.onMouseUp(mouseEvent(300, CANVAS_TOP + 100))

        expect(addAnnotation).not.toHaveBeenCalled()
    })

    it('adopts the annotation pointer mode the annotation canvas reports on hover', () => {
        const { tools, annotationCanvas } = annotateSetup()
        annotationCanvas!.onMouseMove.mockReturnValue('annResize-left')

        tools.onMouseMove(mouseEvent(300, CANVAS_TOP + 40))

        expect(tools.pointerMode.value).toBe('annResize-left')
    })

    it('falls back to the annotate mode when the annotation canvas reports none', () => {
        const { tools, annotationCanvas } = annotateSetup()
        annotationCanvas!.onMouseMove.mockReturnValue(undefined)

        tools.onMouseMove(mouseEvent(300, CANVAS_TOP + 40))

        expect(tools.pointerMode.value).toBe('annotate')
    })
})

describe('annotation edge drag', () => {
    /** Hovers an annotation edge so the tools hold a resize pointer mode. */
    const hoverEdge = (mode: 'annResize-left' | 'annResize-right' | 'annSelect') => {
        const harness = setup([{ id: 'a', rowBaseline: 50, selected: false, visible: true }], {
            activeTool: 'annotate',
            layers: [layerFixture({ selected: true })]
        })
        harness.annotationCanvas!.onMouseMove.mockReturnValue(mode)
        harness.tools.onMouseMove(mouseEvent(300, CANVAS_TOP + 40))
        harness.annotationCanvas!.onMouseMove.mockClear()

        return harness
    }

    it('hands the press on a resize handle to the annotation canvas in canvas coordinates', () => {
        const { tools, annotationCanvas } = hoverEdge('annResize-left')

        tools.onMouseDown(mouseEvent(300, CANVAS_TOP + 40))

        expect(annotationCanvas?.onMouseDown).toHaveBeenCalledWith(300, 40)
        expect(tools.pointerMode.value).toBe('annResize-left')
    })

    it('leaves a press that starts no resize with the annotation canvas untouched', () => {
        const { tools, annotationCanvas } = hoverEdge('annSelect')

        tools.onMouseDown(mouseEvent(300, CANVAS_TOP + 40))

        expect(annotationCanvas?.onMouseDown).not.toHaveBeenCalled()
        expect(tools.pointerMode.value).toBe('annSelect')
    })

    it('hands a resize drag to the annotation canvas and redraws', () => {
        const { tools, annotationCanvas, renderAll } = hoverEdge('annResize-right')
        annotationCanvas!.onMouseMove.mockReturnValue('annResize-right')

        tools.onMouseDown(mouseEvent(300, CANVAS_TOP + 40))
        tools.onMouseMove(mouseEvent(340, CANVAS_TOP + 40))

        expect(annotationCanvas?.onMouseMove).toHaveBeenCalledWith(340, 40, 'annResize-right', true)
        expect(renderAll).toHaveBeenCalledTimes(1)
    })

    it('keeps the resize mode when the annotation canvas reports none mid drag', () => {
        const { tools, annotationCanvas } = hoverEdge('annResize-right')
        annotationCanvas!.onMouseMove.mockReturnValue(undefined)

        tools.onMouseDown(mouseEvent(300, CANVAS_TOP + 40))
        tools.onMouseMove(mouseEvent(340, CANVAS_TOP + 40))

        expect(tools.pointerMode.value).toBe('annResize-right')
    })

    it('hands the release of a resize to the annotation canvas', () => {
        const { tools, annotationCanvas, addAnnotation } = hoverEdge('annResize-left')

        tools.onMouseDown(mouseEvent(300, CANVAS_TOP + 40))
        tools.onMouseUp(mouseEvent(340, CANVAS_TOP + 40))

        expect(annotationCanvas?.onMouseUp).toHaveBeenCalledTimes(1)
        expect(addAnnotation).not.toHaveBeenCalled()
    })

    it('selects the focused annotation when a click on one ends', () => {
        const { tools, annotationCanvas, ctx } = hoverEdge('annSelect')

        tools.onMouseDown(mouseEvent(300, CANVAS_TOP + 40))
        tools.onMouseUp(mouseEvent(300, CANVAS_TOP + 40))

        expect(annotationCanvas?.selectFocusedAnn).toHaveBeenCalledTimes(1)
        expect(ctx.clearRect).toHaveBeenCalledTimes(1)
    })
})

describe('active tool dispatch', () => {
    it('adopts the tool the store reports when the tools are created', () => {
        const { tools } = setup([], { activeTool: 'pan' })

        expect(tools.pointerMode.value).toBe('pan')
    })

    it('follows a later tool change', async () => {
        const { tools, store } = setup([])

        store.setActiveTool('pan')
        await nextTick()

        expect(tools.pointerMode.value).toBe('pan')
    })

    it('keeps an annotation pointer mode across a tool change', async () => {
        const { tools, store, annotationCanvas } = setup([], { activeTool: 'annotate' })
        annotationCanvas!.onMouseMove.mockReturnValue('annSelect')
        tools.onMouseMove(mouseEvent(300, CANVAS_TOP + 40))

        store.setActiveTool('pan')
        await nextTick()

        expect(tools.pointerMode.value).toBe('annSelect')
    })

    it('keeps the pointer mode of a drag that is still running', async () => {
        const { tools, store } = setup([])

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 40))
        store.setActiveTool('pan')
        await nextTick()

        expect(tools.pointerMode.value).toBe('pointer')
    })

    it('selects the first layer when the annotate tool becomes active', () => {
        const { tools, store } = setup([], { layers: [layerFixture({ id: 'layer-a' }), layerFixture({ id: 'layer-b' })] })

        tools.setActiveTool('annotate')

        expect(store.viewerAnnotations.map((entry) => entry.selected)).toEqual([true, false])
    })

    it('leaves an already selected layer alone when the annotate tool becomes active', () => {
        const { tools, store } = setup([], {
            layers: [layerFixture({ id: 'layer-a' }), layerFixture({ id: 'layer-b', selected: true })]
        })

        tools.setActiveTool('annotate')

        expect(store.viewerAnnotations.map((entry) => entry.selected)).toEqual([false, true])
    })

    it('selects no layer for the pan tool', () => {
        const { tools, store } = setup([], { layers: [layerFixture({ id: 'layer-a' })] })

        tools.setActiveTool('pan')

        expect(store.viewerAnnotations[0].selected).toBe(false)
    })

    it('selects no layer for the pointer tool', () => {
        const { tools, store } = setup([], { layers: [layerFixture({ id: 'layer-a' })] })

        tools.setActiveTool('pointer')

        expect(store.viewerAnnotations[0].selected).toBe(false)
    })

    it('ignores a tool name it does not know', () => {
        const { tools, store } = setup([], { layers: [layerFixture({ id: 'layer-a' })] })

        tools.setActiveTool('lasso')

        expect(store.viewerAnnotations[0].selected).toBe(false)
        expect(tools.pointerMode.value).toBe('pointer')
    })
})

describe('deferred layer selection', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('selects a layer that arrives after the annotate tool became active', () => {
        const { tools, store } = setup([], { layers: [] })

        tools.setActiveTool('annotate')
        store.setAnnotations([layerFixture({ id: 'layer-late' })])
        vi.advanceTimersByTime(500)

        expect(store.viewerAnnotations[0].selected).toBe(true)
    })

    it('selects nothing while no layer arrives', () => {
        const { tools, store } = setup([], { layers: [] })

        tools.setActiveTool('annotate')
        vi.advanceTimersByTime(5000)

        expect(store.viewerAnnotations).toEqual([])
    })
})

describe('drag state', () => {
    it('ends the drag when the pointer leaves the canvas', () => {
        const { tools } = setup([])

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 40))
        tools.onMouseOut()

        expect(tools.mouseDown.value).toBe(false)
    })

    it('resumes the drag when the pointer returns with a button held', () => {
        const { tools } = setup([])

        tools.onMouseEnter({ buttons: 1 } as unknown as MouseEvent)

        expect(tools.mouseDown.value).toBe(true)
    })

    it('ends the drag when the pointer returns with no button held', () => {
        const { tools } = setup([])

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 40))
        tools.onMouseEnter({ buttons: 0 } as unknown as MouseEvent)

        expect(tools.mouseDown.value).toBe(false)
    })

    it('ends the drag when the button is released', () => {
        const { tools } = setup([])

        tools.onMouseDown(mouseEvent(100, CANVAS_TOP + 40))
        tools.onMouseUp(mouseEvent(300, CANVAS_TOP + 40))

        expect(tools.mouseDown.value).toBe(false)
    })

    it('stops the move event from reaching other handlers', () => {
        const { tools } = setup([])
        const event = mouseEvent(300, CANVAS_TOP + 40)

        tools.onMouseMove(event)

        expect(event.preventDefault).toHaveBeenCalledTimes(1)
        expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    })
})
