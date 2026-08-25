import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// The store reaches for Amplify, a discovery WebSocket, and the zarr client registry on
// construction. None of them exists under test. The token mock also stands in for the
// presigned-url call of the linked-package icon.
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

import { useAnnotationRendering } from './useAnnotationRendering'
import { useToken } from '@/composables/useToken'
import { createViewerStore } from '@/stores/tsviewer'
import type { ViewerChannel } from '@/stores/tsviewer'
import type { Annotation, AnnotationLayer, LinkedPackageDTO } from '@/utils/annotationUtils'

type RenderProps = Parameters<ReturnType<typeof useAnnotationRendering>['render']>[0]

/** Canvas context stub that records the calls and the styles the renderers set. */
const fakeContext = () => {
    const fillStyles: string[] = []
    const strokeStyles: string[] = []
    const texts: string[] = []

    const calls = {
        setTransform: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        setLineDash: vi.fn(),
        drawImage: vi.fn(),
        fillText: vi.fn((text: string) => {
            texts.push(text)
        })
    }

    const ctx = {
        ...calls,
        lineWidth: 1,
        font: '',
        textAlign: '',
        get fillStyle(): string {
            return fillStyles[fillStyles.length - 1] ?? ''
        },
        set fillStyle(value: string) {
            fillStyles.push(value)
        },
        get strokeStyle(): string {
            return strokeStyles[strokeStyles.length - 1] ?? ''
        },
        set strokeStyle(value: string) {
            strokeStyles.push(value)
        }
    }

    return {
        ctx: ctx as unknown as CanvasRenderingContext2D,
        calls,
        fillStyles,
        strokeStyles,
        texts
    }
}

/** Canvas element stub: the renderers read nothing but the 2d context. */
const fakeCanvas = (context: CanvasRenderingContext2D) =>
    ({ getContext: () => context }) as unknown as HTMLCanvasElement

/** Images the renderer created, in creation order. */
let createdImages: FakeImage[] = []

/** Value the next constructed image reports for `complete`. */
let nextImageComplete = false

class FakeImage {
    src = ''
    complete = nextImageComplete
    private listeners: Array<() => void> = []

    constructor() {
        createdImages.push(this)
    }

    addEventListener(_type: string, listener: () => void): void {
        this.listeners.push(listener)
    }

    /** Runs the load listeners the renderer registered. */
    fireLoad(): void {
        for (const listener of this.listeners) {
            listener()
        }
    }
}

/** One pixel is one millisecond, and the window opens at 10 seconds. */
const baseProps: RenderProps = {
    start: 10_000_000,
    duration: 15_000_000,
    rsPeriod: 1000,
    pixelRatio: 1,
    cWidth: 800,
    cHeight: 400,
    pointerMode: 'pointer',
    viewerActiveTool: 'pointer'
}

const props = (overrides: Partial<RenderProps> = {}): RenderProps => ({ ...baseProps, ...overrides })

const annotation = (fields: Partial<Annotation>): Annotation => ({
    start: baseProps.start,
    duration: 0,
    label: 'Event',
    layer_id: 'layer-a',
    ...fields
})

const layer = (fields: Partial<AnnotationLayer>): AnnotationLayer => ({
    id: 'layer-a',
    visible: true,
    annotations: [],
    color: 'rgba(51,204,102,0.8)',
    hexColor: '#33CC66',
    bkColor: 'rgba(0,0,0,0.05)',
    selColor: 'rgba(0,0,255,1)',
    ...fields
})

const channel = (fields: Partial<ViewerChannel> & Pick<ViewerChannel, 'id'>): ViewerChannel => ({
    visible: true,
    ...fields
})

let instance = 0

const setup = (channels: ViewerChannel[] = [], layers: AnnotationLayer[] = []) => {
    const store = createViewerStore(`ann-rendering-test-${instance++}`)
    store.setViewerConfig({ apiUrl: 'https://api.test' })
    store.setChannels(channels)
    store.setAnnotations(layers)

    return { store, rendering: useAnnotationRendering(store) }
}

beforeEach(() => {
    setActivePinia(createPinia())
    createdImages = []
    nextImageComplete = false
    vi.stubGlobal('Image', FakeImage)
    vi.mocked(useToken).mockResolvedValue('a.jwt.token')
})

describe('annotation geometry', () => {
    it('maps the annotation span to canvas pixels through the sample period', () => {
        const { rendering } = setup()
        const ann = annotation({ start: 10_500_000, duration: 2_000_000, allChannels: true })

        rendering.computeRenderOptions([ann], props())

        expect(ann.cStart).toBe(500)
        expect(ann.cEnd).toBe(2500)
    })

    it('shifts the span by the canvas x offset', () => {
        const { rendering } = setup()
        const ann = annotation({ start: 10_500_000, duration: 2_000_000, allChannels: true })

        rendering.computeRenderOptions([ann], props({ constants: { XOFFSET: 5 } }))

        expect(ann.cStart).toBe(505)
        expect(ann.cEnd).toBe(2505)
    })

    it('truncates a fractional pixel position toward zero', () => {
        const { rendering } = setup()
        const after = annotation({ start: 10_000_500, duration: 0, allChannels: true })
        const before = annotation({ start: 9_999_500, duration: 0, allChannels: true })

        rendering.computeRenderOptions([after, before], props())

        expect(after.cStart).toBe(0)
        expect(before.cStart).toBe(0)
    })

    it('inverts a negative duration so the start edge is the earlier one', () => {
        const { rendering } = setup()
        const ann = annotation({ start: 13_000_000, duration: -1_000_000, allChannels: true })

        rendering.computeRenderOptions([ann], props())

        expect(ann.cStart).toBe(2000)
        expect(ann.cEnd).toBe(3000)
    })

    it('gives an annotation without duration a span of a fortieth of the canvas', () => {
        const { rendering } = setup()
        const ann = annotation({ start: 11_000_000, duration: 0, allChannels: true })

        rendering.computeRenderOptions([ann], props({ cWidth: 800 }))

        expect(ann.cStart).toBe(1000)
        expect(ann.cEnd).toBe(1020)
    })

    it('places an all channel annotation at half the label height', () => {
        const { rendering } = setup()
        const ann = annotation({ allChannels: true })

        rendering.computeRenderOptions([ann], props())

        expect(ann.allOffsets).toEqual([10])
        expect(ann.cY).toBe(10)
    })

    it('places an all channel annotation at half the supplied label height', () => {
        const { rendering } = setup()
        const ann = annotation({ allChannels: true })

        rendering.computeRenderOptions([ann], props({ constants: { ANNOTATIONLABELHEIGHT: 41 } }))

        expect(ann.allOffsets).toEqual([20])
        expect(ann.cY).toBe(20)
    })

    it('collects the row baseline of every visible channel the annotation names', () => {
        const { rendering } = setup([
            channel({ id: 'a', rowBaseline: 100 }),
            channel({ id: 'b', rowBaseline: 220 }),
            channel({ id: 'c', rowBaseline: 340 })
        ])
        const ann = annotation({ allChannels: false, channelIds: ['a', 'b'] })

        rendering.computeRenderOptions([ann], props())

        expect(ann.allOffsets).toEqual([100, 220])
        expect(ann.minOffset).toBe(100)
        expect(ann.maxOffset).toBe(220)
        expect(ann.cY).toBe(100)
    })

    it('leaves out a channel that is not visible', () => {
        const { rendering } = setup([
            channel({ id: 'a', rowBaseline: 100 }),
            channel({ id: 'hidden', visible: false, rowBaseline: 220 })
        ])
        const ann = annotation({ allChannels: false, channelIds: ['a', 'hidden'] })

        rendering.computeRenderOptions([ann], props())

        expect(ann.allOffsets).toEqual([100])
        expect(ann.maxOffset).toBe(100)
    })

    it('leaves out a channel id that no channel row carries', () => {
        const { rendering } = setup([channel({ id: 'a', rowBaseline: 100 })])
        const ann = annotation({ allChannels: false, channelIds: ['a', 'unknown'] })

        rendering.computeRenderOptions([ann], props())

        expect(ann.allOffsets).toEqual([100])
    })

    it('counts only the first channel row that matches a channel id', () => {
        const { rendering } = setup([
            channel({ id: 'a', rowBaseline: 100 }),
            channel({ id: 'a', rowBaseline: 220 })
        ])
        const ann = annotation({ allChannels: false, channelIds: ['a'] })

        rendering.computeRenderOptions([ann], props())

        expect(ann.allOffsets).toEqual([100])
    })

    it('skips a channel that carries no row baseline', () => {
        const { rendering } = setup([
            channel({ id: 'not-laid-out', rowBaseline: null }),
            channel({ id: 'b', rowBaseline: 220 })
        ])
        const ann = annotation({ allChannels: false, channelIds: ['not-laid-out', 'b'] })

        rendering.computeRenderOptions([ann], props())

        expect(ann.allOffsets).toEqual([220])
        expect(ann.cY).toBe(220)
    })

    it('places an annotation on no visible row at the bottom of the canvas', () => {
        // pins current behavior; see report
        const { rendering } = setup([channel({ id: 'hidden', visible: false, rowBaseline: 100 })])
        const ann = annotation({ allChannels: false, channelIds: ['hidden'] })

        rendering.computeRenderOptions([ann], props({ cHeight: 400 }))

        expect(ann.allOffsets).toEqual([])
        expect(ann.minOffset).toBe(400)
        expect(ann.maxOffset).toBe(0)
        expect(ann.cY).toBe(400)
    })

    it('truncates a fractional row baseline to whole pixels', () => {
        const { rendering } = setup([channel({ id: 'a', rowBaseline: 100.9 })])
        const ann = annotation({ allChannels: false, channelIds: ['a'] })

        rendering.computeRenderOptions([ann], props())

        expect(ann.allOffsets).toEqual([100])
    })

    it('throws for a channel scoped annotation that names no channels', () => {
        // pins current behavior; see report
        const { rendering } = setup([channel({ id: 'a', rowBaseline: 100 })])
        const ann = annotation({ allChannels: false })

        expect(() => rendering.computeRenderOptions([ann], props())).toThrow(TypeError)
    })
})

describe('hover offsets', () => {
    it('records the top row of every channel scoped annotation once', () => {
        const { rendering } = setup([
            channel({ id: 'a', rowBaseline: 100 }),
            channel({ id: 'b', rowBaseline: 220 })
        ])
        const first = annotation({ allChannels: false, channelIds: ['a', 'b'] })
        const second = annotation({ allChannels: false, channelIds: ['a'] })
        const third = annotation({ allChannels: false, channelIds: ['b'] })

        rendering.computeRenderOptions([first, second, third], props())

        expect(rendering.hoverOffsets.value).toEqual([100, 220])
    })

    it('records no row for an all channel annotation', () => {
        const { rendering } = setup()

        rendering.computeRenderOptions([annotation({ allChannels: true })], props())

        expect(rendering.hoverOffsets.value).toEqual([])
    })

    it('resets the rows to the label bar on every render', () => {
        const bk = fakeContext()
        const lb = fakeContext()
        const { rendering } = setup()
        rendering.hoverOffsets.value = [999]

        rendering.render(props(), fakeCanvas(bk.ctx), fakeCanvas(lb.ctx), 380)

        expect(rendering.hoverOffsets.value).toEqual([10])
    })
})

describe('render window selection', () => {
    const renderWith = (
        layers: AnnotationLayer[],
        overrides: Partial<RenderProps> = {},
        channels: ViewerChannel[] = []
    ) => {
        const bk = fakeContext()
        const lb = fakeContext()
        const { rendering, store } = setup(channels, layers)

        rendering.render(props(overrides), fakeCanvas(bk.ctx), fakeCanvas(lb.ctx), 380)

        return { rendering, store, bk, lb, ids: rendering.renderAnn.value.map((ann) => ann.id) }
    }

    it('keeps only the annotations that overlap the rendered window', () => {
        const { ids } = renderWith([
            layer({
                annotations: [
                    annotation({ id: 'before', start: 5_000_000, duration: 1_000_000, allChannels: true }),
                    annotation({ id: 'straddles-start', start: 9_000_000, duration: 2_000_000, allChannels: true }),
                    annotation({ id: 'inside', start: 12_000_000, duration: 1_000_000, allChannels: true }),
                    annotation({ id: 'after', start: 30_000_000, duration: 1_000_000, allChannels: true })
                ]
            })
        ])

        expect(ids).toEqual(['straddles-start', 'inside'])
    })

    it('leaves out an annotation that ends where the window opens', () => {
        const { ids } = renderWith([
            layer({
                annotations: [
                    annotation({ id: 'ends-at-start', start: 9_000_000, duration: 1_000_000, allChannels: true })
                ]
            })
        ])

        expect(ids).toEqual([])
    })

    it('leaves out an annotation that starts where the window closes', () => {
        const { ids } = renderWith([
            layer({
                annotations: [
                    annotation({ id: 'starts-at-end', start: 25_000_000, duration: 1_000_000, allChannels: true })
                ]
            })
        ])

        expect(ids).toEqual([])
    })

    it('uses the stored end of an annotation over its duration', () => {
        const { ids } = renderWith([
            layer({
                annotations: [
                    annotation({ id: 'long-end', start: 9_000_000, duration: 0, end: 11_000_000, allChannels: true })
                ]
            })
        ])

        expect(ids).toEqual(['long-end'])
    })

    it('leaves out the annotations of a hidden layer', () => {
        const { ids } = renderWith([
            layer({ id: 'hidden-layer', visible: false, annotations: [
                annotation({ id: 'unseen', layer_id: 'hidden-layer', start: 12_000_000, duration: 1_000_000, allChannels: true })
            ] }),
            layer({ annotations: [
                annotation({ id: 'seen', start: 12_000_000, duration: 1_000_000, allChannels: true })
            ] })
        ])

        expect(ids).toEqual(['seen'])
    })

    it('skips a visible layer that holds no annotations', () => {
        const { ids } = renderWith([
            layer({ id: 'empty-layer', annotations: [] }),
            layer({ annotations: [
                annotation({ id: 'seen', start: 12_000_000, duration: 1_000_000, allChannels: true })
            ] })
        ])

        expect(ids).toEqual(['seen'])
    })

    it('orders the annotations of every layer by start time', () => {
        const { ids } = renderWith([
            layer({ id: 'layer-b', annotations: [
                annotation({ id: 'late', layer_id: 'layer-b', start: 14_000_000, duration: 100_000, allChannels: true })
            ] }),
            layer({ annotations: [
                annotation({ id: 'early', start: 11_000_000, duration: 100_000, allChannels: true })
            ] })
        ])

        expect(ids).toEqual(['early', 'late'])
    })

    it('falls back to a 15 second window when no duration is given', () => {
        const { ids } = renderWith(
            [
                layer({
                    annotations: [
                        annotation({ id: 'inside', start: 20_000_000, duration: 100_000, allChannels: true }),
                        annotation({ id: 'outside', start: 30_000_000, duration: 100_000, allChannels: true })
                    ]
                })
            ],
            { duration: undefined }
        )

        expect(ids).toEqual(['inside'])
    })

    it('falls back to a 15 second window when the duration is zero', () => {
        const { ids } = renderWith(
            [
                layer({
                    annotations: [
                        annotation({ id: 'inside', start: 20_000_000, duration: 100_000, allChannels: true }),
                        annotation({ id: 'outside', start: 30_000_000, duration: 100_000, allChannels: true })
                    ]
                })
            ],
            { duration: 0 }
        )

        expect(ids).toEqual(['inside'])
    })

    it('drops an annotation whose negative duration reaches into the window', () => {
        // pins current behavior; see report
        const { ids } = renderWith([
            layer({
                annotations: [
                    annotation({ id: 'reversed', start: 20_000_000, duration: -10_000_000, allChannels: true })
                ]
            })
        ])

        expect(ids).toEqual([])
    })

    it('computes the geometry of the annotations it keeps', () => {
        const { rendering } = renderWith([
            layer({
                annotations: [
                    annotation({ id: 'inside', start: 12_000_000, duration: 1_000_000, allChannels: true })
                ]
            })
        ])

        expect(rendering.renderAnn.value[0]).toMatchObject({ cStart: 2000, cEnd: 3000, cY: 10 })
    })

    it('clears the render list when nothing overlaps the window', () => {
        const bk = fakeContext()
        const lb = fakeContext()
        const { rendering } = setup([], [
            layer({
                annotations: [
                    annotation({ id: 'inside', start: 12_000_000, duration: 1_000_000, allChannels: true }),
                    annotation({ id: 'after', start: 40_000_000, duration: 1_000_000, allChannels: true })
                ]
            })
        ])

        rendering.render(props(), fakeCanvas(bk.ctx), fakeCanvas(lb.ctx), 380)
        expect(rendering.renderAnn.value).toHaveLength(1)

        rendering.render(props({ start: 100_000_000 }), fakeCanvas(bk.ctx), fakeCanvas(lb.ctx), 380)
        expect(rendering.renderAnn.value).toEqual([])
    })

    it('clears both canvases before it draws', () => {
        const { bk, lb } = renderWith([
            layer({
                annotations: [
                    annotation({ id: 'inside', start: 12_000_000, duration: 1_000_000, allChannels: true })
                ]
            })
        ])

        expect(bk.calls.clearRect).toHaveBeenCalledTimes(1)
        expect(lb.calls.clearRect).toHaveBeenCalledTimes(1)
    })

    it('draws nothing and warns when the area canvas is missing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const lb = fakeContext()
        const { rendering } = setup([], [
            layer({
                annotations: [
                    annotation({ id: 'inside', start: 12_000_000, duration: 1_000_000, allChannels: true })
                ]
            })
        ])

        rendering.render(props(), null, fakeCanvas(lb.ctx), 380)

        expect(rendering.renderAnn.value).toEqual([])
        expect(lb.calls.clearRect).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })

    it('draws the label of the focused annotation after the other labels', async () => {
        const bk = fakeContext()
        const lb = fakeContext()
        const { rendering } = setup([], [
            layer({
                annotations: [
                    annotation({ id: 'first', label: 'first', start: 11_000_000, duration: 1_000_000, allChannels: true }),
                    annotation({ id: 'second', label: 'second', start: 12_000_000, duration: 1_000_000, allChannels: true })
                ]
            })
        ])

        rendering.render(props(), fakeCanvas(bk.ctx), fakeCanvas(lb.ctx), 380)
        rendering.focusedAnn.value = rendering.renderAnn.value[0]
        lb.texts.length = 0
        rendering.render(props(), fakeCanvas(bk.ctx), fakeCanvas(lb.ctx), 380)

        expect(lb.texts).toEqual(['second', 'first'])
    })
})

describe('annotation area shapes', () => {
    const areaAnn = (fields: Partial<Annotation>): Annotation =>
        annotation({ cStart: 100, cEnd: 300, minOffset: 100, maxOffset: 220, allOffsets: [100, 220], ...fields })

    it('fills the window column of an all channel annotation with duration', () => {
        const { ctx, calls } = fakeContext()
        const { rendering } = setup()

        rendering.renderAnnotationAreas(ctx, [areaAnn({ allChannels: true, duration: 200_000 })], props(), 380)

        expect(calls.fillRect).toHaveBeenCalledTimes(1)
        expect(calls.stroke).toHaveBeenCalledTimes(1)
    })

    it('strokes a single line for an all channel annotation without duration', () => {
        const { ctx, calls } = fakeContext()
        const { rendering } = setup()

        rendering.renderAnnotationAreas(ctx, [areaAnn({ allChannels: true, duration: 0 })], props(), 380)

        expect(calls.fillRect).not.toHaveBeenCalled()
        expect(calls.stroke).toHaveBeenCalledTimes(1)
    })

    it('strokes a tick for a single channel annotation without duration', () => {
        const { ctx, calls } = fakeContext()
        const { rendering } = setup()

        rendering.renderAnnotationAreas(ctx, [areaAnn({ channelIds: ['a'], duration: 0 })], props(), 380)

        expect(calls.stroke).toHaveBeenCalledTimes(1)
        expect(calls.fillRect).not.toHaveBeenCalled()
    })

    it('draws no area for a single channel annotation with duration', () => {
        // pins current behavior; see report
        const { ctx, calls } = fakeContext()
        const { rendering } = setup()

        rendering.renderAnnotationAreas(ctx, [areaAnn({ channelIds: ['a'], duration: 200_000 })], props(), 380)

        expect(calls.fillRect).not.toHaveBeenCalled()
        expect(calls.stroke).not.toHaveBeenCalled()
    })

    it('shades the rows a multi channel annotation with duration covers', () => {
        const { ctx, calls } = fakeContext()
        const { rendering } = setup()

        rendering.renderAnnotationAreas(ctx, [areaAnn({ channelIds: ['a', 'b'], duration: 200_000 })], props(), 380)

        expect(calls.fillRect).toHaveBeenCalledTimes(1)
        expect(calls.stroke).toHaveBeenCalledTimes(1)
    })

    it('strokes one line across the rows of a multi channel annotation without duration', () => {
        const { ctx, calls } = fakeContext()
        const { rendering } = setup()

        rendering.renderAnnotationAreas(ctx, [areaAnn({ channelIds: ['a', 'b'], duration: 0 })], props(), 380)

        expect(calls.fillRect).not.toHaveBeenCalled()
        expect(calls.stroke).toHaveBeenCalledTimes(1)
    })

    it('draws a selected annotation in the selection colors of its layer', () => {
        const { ctx, strokeStyles, fillStyles } = fakeContext()
        const { rendering } = setup([], [layer({})])

        rendering.renderAnnotationAreas(
            ctx,
            [areaAnn({ allChannels: true, duration: 200_000, selected: true })],
            props(),
            380
        )

        expect(strokeStyles).toContain('rgba(0,0,255,1)')
        expect(fillStyles).toContain('rgba(0,0,0,0.05)')
    })

    it('draws an unselected annotation in the neutral outline color', () => {
        const { ctx, strokeStyles } = fakeContext()
        const { rendering } = setup([], [layer({})])

        rendering.renderAnnotationAreas(
            ctx,
            [areaAnn({ allChannels: true, duration: 200_000, selected: false })],
            props(),
            380
        )

        expect(strokeStyles).toEqual(['rgba(0,0,0, 0.6)'])
    })
})

describe('annotation labels', () => {
    const labelAnn = (fields: Partial<Annotation>): Annotation =>
        annotation({
            cStart: 100,
            cEnd: 300,
            duration: 200_000,
            minOffset: 100,
            maxOffset: 220,
            allOffsets: [100, 220],
            ...fields
        })

    it('draws one label bar for every row the annotation covers', async () => {
        const { ctx, calls } = fakeContext()
        const { rendering } = setup([], [layer({})])

        await rendering.renderAnnotationLabels(ctx, [labelAnn({})], props(), false, 'pointer', 'pointer')

        expect(calls.fillRect).toHaveBeenCalledTimes(2)
    })

    it('skips the focused annotation while it is drawn separately', async () => {
        const { ctx, calls, texts } = fakeContext()
        const { rendering } = setup([], [layer({})])
        rendering.focusedAnn.value = labelAnn({})
        // The composable holds the annotation as a reactive proxy, and the render list the
        // host passes carries the same proxy.
        const focused = rendering.focusedAnn.value

        await rendering.renderAnnotationLabels(ctx, [focused], props(), true, 'pointer', 'pointer')

        expect(calls.fillRect).not.toHaveBeenCalled()
        expect(texts).toEqual([])
    })

    it('draws the focused annotation when it is not drawn separately', async () => {
        const { ctx, calls } = fakeContext()
        const { rendering } = setup([], [layer({})])
        rendering.focusedAnn.value = labelAnn({})
        const focused = rendering.focusedAnn.value

        await rendering.renderAnnotationLabels(ctx, [focused], props(), false, 'pointer', 'pointer')

        expect(calls.fillRect).toHaveBeenCalledTimes(2)
    })

    it('draws the label text when the bar is wider than the text', async () => {
        const { ctx, texts } = fakeContext()
        const { rendering } = setup([], [layer({})])

        await rendering.renderAnnotationLabels(
            ctx,
            [labelAnn({ label: 'Seizure', cStart: 0, cEnd: 100 })],
            props(),
            false,
            'pointer',
            'pointer'
        )

        expect(texts).toEqual(['Seizure'])
    })

    it('omits the label text when the bar is narrower than the text', async () => {
        const { ctx, texts } = fakeContext()
        const { rendering } = setup([], [layer({})])

        await rendering.renderAnnotationLabels(
            ctx,
            [labelAnn({ label: 'Seizure', cStart: 0, cEnd: 60 })],
            props(),
            false,
            'pointer',
            'pointer'
        )

        expect(texts).toEqual([])
    })

    it('draws the resize handles while the annotate tool holds an annotation', async () => {
        const { ctx, calls } = fakeContext()
        const { rendering } = setup([], [layer({})])

        await rendering.renderAnnotationLabels(ctx, [labelAnn({})], props(), false, 'annSelect', 'annotate')

        expect(calls.stroke).toHaveBeenCalledTimes(1)
        expect(calls.moveTo).toHaveBeenCalledTimes(2)
    })

    it('draws no resize handles while the annotate tool holds no annotation', async () => {
        const { ctx, calls } = fakeContext()
        const { rendering } = setup([], [layer({})])

        await rendering.renderAnnotationLabels(ctx, [labelAnn({})], props(), false, 'annotate', 'annotate')

        expect(calls.stroke).not.toHaveBeenCalled()
    })

    it('draws no resize handles for a tool other than annotate', async () => {
        const { ctx, calls } = fakeContext()
        const { rendering } = setup([], [layer({})])

        await rendering.renderAnnotationLabels(ctx, [labelAnn({})], props(), false, 'annSelect', 'pointer')

        expect(calls.stroke).not.toHaveBeenCalled()
    })

    it('draws only the left resize handle on an annotation without duration', async () => {
        const { ctx, calls } = fakeContext()
        const { rendering } = setup([], [layer({})])

        await rendering.renderAnnotationLabels(
            ctx,
            [labelAnn({ duration: 0 })],
            props(),
            false,
            'annResize-left',
            'annotate'
        )

        expect(calls.moveTo).toHaveBeenCalledTimes(1)
    })

    it('fills a selected label bar with the selection color of its layer', async () => {
        const { ctx, fillStyles } = fakeContext()
        const { rendering } = setup([], [layer({})])

        await rendering.renderAnnotationLabels(ctx, [labelAnn({ selected: true })], props(), false, 'pointer', 'pointer')

        expect(fillStyles[0]).toBe('rgba(0,0,255,1)')
    })

    it('fills an unselected label bar with the layer color', async () => {
        const { ctx, fillStyles } = fakeContext()
        const { rendering } = setup([], [layer({})])

        await rendering.renderAnnotationLabels(ctx, [labelAnn({})], props(), false, 'pointer', 'pointer')

        expect(fillStyles[0]).toBe('rgba(51,204,102,0.8)')
    })

    it('falls back to a default color for a selected bar when the layer carries none', async () => {
        const { ctx, fillStyles } = fakeContext()
        const { rendering } = setup([], [layer({ color: undefined, selColor: undefined })])

        await rendering.renderAnnotationLabels(ctx, [labelAnn({ selected: true })], props(), false, 'pointer', 'pointer')

        expect(fillStyles[0]).toBe('rgba(51,204,102, 0.8)')
    })

    it('falls back to a default color when the layer carries none', async () => {
        const { ctx, fillStyles } = fakeContext()
        const { rendering } = setup([], [layer({ color: undefined, selColor: undefined })])

        await rendering.renderAnnotationLabels(ctx, [labelAnn({})], props(), false, 'pointer', 'pointer')

        expect(fillStyles[0]).toBe('rgba(51,204,102,0.8)')
    })

    it('writes black label text on the high contrast layer color', async () => {
        const { ctx, fillStyles } = fakeContext()
        const { rendering } = setup([], [layer({ hexColor: '#FFFF4E' })])

        await rendering.renderAnnotationLabels(
            ctx,
            [labelAnn({ label: 'Seizure', cStart: 0, cEnd: 100 })],
            props(),
            false,
            'pointer',
            'pointer'
        )

        expect(fillStyles).toContain('black')
        expect(fillStyles).not.toContain('white')
    })

    it('writes white label text on every other layer color', async () => {
        const { ctx, fillStyles } = fakeContext()
        const { rendering } = setup([], [layer({})])

        await rendering.renderAnnotationLabels(
            ctx,
            [labelAnn({ label: 'Seizure', cStart: 0, cEnd: 100 })],
            props(),
            false,
            'pointer',
            'pointer'
        )

        expect(fillStyles).toContain('white')
        expect(fillStyles).not.toContain('black')
    })

    it('rejects for an annotation that carries no label', async () => {
        // pins current behavior; see report
        const { ctx } = fakeContext()
        const { rendering } = setup([], [layer({})])

        await expect(
            rendering.renderAnnotationLabels(ctx, [labelAnn({ label: undefined })], props(), false, 'pointer', 'pointer')
        ).rejects.toThrow(TypeError)
    })
})

describe('linked package icon', () => {
    const linkedAnn = (dto: LinkedPackageDTO, cEnd = 300): Annotation =>
        annotation({
            cStart: 0,
            cEnd,
            duration: 200_000,
            allOffsets: [100],
            minOffset: 100,
            maxOffset: 100,
            linkedPackage: 'N:package:1',
            linkedPackageDTO: dto
        })

    const draw = async (ann: Annotation) => {
        const context = fakeContext()
        const { rendering } = setup([], [layer({})])

        await rendering.renderAnnotationLabels(context.ctx, [ann], props(), false, 'pointer', 'pointer')

        return context
    }

    it('draws the placeholder icon for a preview that is not a png', async () => {
        // pins current behavior; see report
        const { calls } = await draw(
            linkedAnn({ objects: { view: [{ content: {} }, { content: { fileType: 'CSV' } }] } })
        )

        expect(calls.drawImage).toHaveBeenCalledTimes(1)
        expect(createdImages).toHaveLength(1)
        expect(createdImages[0].src).toBe('/path/to/default/icon.png')
    })

    it('reads the preview from the second view entry only', async () => {
        // pins current behavior; see report
        const { calls } = await draw(
            linkedAnn({ objects: { view: [{ content: { fileType: 'PNG', id: 'file-1', packageId: 'pkg-1' } }] } })
        )

        expect(calls.drawImage).toHaveBeenCalledTimes(1)
        expect(createdImages[0].src).toBe('/path/to/default/icon.png')
    })

    it('draws no icon on an annotation without a linked package', async () => {
        const { calls } = await draw(annotation({ cStart: 0, cEnd: 300, duration: 200_000, allOffsets: [100] }))

        expect(calls.drawImage).not.toHaveBeenCalled()
        expect(createdImages).toEqual([])
    })

    it('draws no icon when the label bar is narrower than the icon', async () => {
        const { calls } = await draw(
            linkedAnn({ objects: { view: [{ content: {} }, { content: { fileType: 'CSV' } }] } }, 25)
        )

        expect(calls.drawImage).not.toHaveBeenCalled()
    })

    it('points a png preview at the presigned url of the package file', async () => {
        nextImageComplete = true

        const { calls } = await draw(
            linkedAnn({
                objects: { view: [{ content: {} }, { content: { fileType: 'PNG', id: 'file-1', packageId: 'pkg-1' } }] }
            })
        )

        expect(createdImages[0].src).toBe(
            'https://api.test/packages/pkg-1/files/file-1/presign/?api_key=a.jwt.token'
        )
        expect(calls.drawImage).toHaveBeenCalledTimes(1)
    })

    it('waits for a png preview that has not loaded yet', async () => {
        const { calls } = await draw(
            linkedAnn({
                objects: { view: [{ content: {} }, { content: { fileType: 'PNG', id: 'file-1', packageId: 'pkg-1' } }] }
            })
        )

        expect(calls.drawImage).not.toHaveBeenCalled()

        createdImages[0].fireLoad()

        expect(calls.drawImage).toHaveBeenCalledTimes(1)
    })

    it('draws no png preview when the token request fails', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        vi.mocked(useToken).mockRejectedValueOnce(new Error('no session'))

        const { calls } = await draw(
            linkedAnn({
                objects: { view: [{ content: {} }, { content: { fileType: 'PNG', id: 'file-1', packageId: 'pkg-1' } }] }
            })
        )

        expect(calls.drawImage).not.toHaveBeenCalled()
        expect(error).toHaveBeenCalled()
        error.mockRestore()
    })
})
