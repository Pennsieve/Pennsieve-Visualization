import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

// The store reaches for Amplify, a discovery WebSocket, and the zarr client registry on
// construction. None of them exists under test and none is involved in a pointer move.
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

import { useAnnotationInteraction } from './useAnnotationInteraction'
import { createViewerStore } from '@/stores/tsviewer'
import type { Annotation } from '@/utils/annotationUtils'

/** Label height the composable assumes when no constant is supplied. */
const DEFAULT_LABEL_HEIGHT = 20

const annotation = (fields: Partial<Annotation>): Annotation => ({
    start: 0,
    duration: 0,
    label: 'Event',
    ...fields
})

let instance = 0

const setup = (anns: Annotation[], offsets: number[] = [10]) => {
    const store = createViewerStore(`ann-interaction-test-${instance++}`)
    const focusedAnn = ref<Annotation | null>(null)
    const renderAnn = ref<Annotation[]>(anns)
    const hoverOffsets = ref<number[]>(offsets)
    const interaction = useAnnotationInteraction(focusedAnn, renderAnn, hoverOffsets, store)

    return { store, focusedAnn, renderAnn, hoverOffsets, interaction }
}

/** Interaction props for the annotate tool: one pixel is one millisecond. */
const annotateProps = { rsPeriod: 1000, viewerActiveTool: 'annotate' }

beforeEach(() => {
    setActivePinia(createPinia())
})

describe('hover band test', () => {
    it('reports a cursor inside the label band of a hover offset', () => {
        const { interaction } = setup([], [50])

        expect(interaction.shouldCheckAnnotationHover(50)).toBe(true)
        expect(interaction.shouldCheckAnnotationHover(50 - DEFAULT_LABEL_HEIGHT / 2)).toBe(true)
        expect(interaction.shouldCheckAnnotationHover(50 + DEFAULT_LABEL_HEIGHT / 2)).toBe(true)
    })

    it('reports a cursor between two label bands as outside', () => {
        const { interaction } = setup([], [10, 200])

        expect(interaction.shouldCheckAnnotationHover(100)).toBe(false)
    })

    it('widens the label band with the supplied label height', () => {
        const { interaction } = setup([], [50])

        expect(interaction.shouldCheckAnnotationHover(35)).toBe(false)
        expect(interaction.shouldCheckAnnotationHover(35, { ANNOTATIONLABELHEIGHT: 40 })).toBe(true)
    })

    it('reports every position as outside when no hover offset is known', () => {
        const { interaction } = setup([], [])

        expect(interaction.shouldCheckAnnotationHover(0)).toBe(false)
        expect(interaction.shouldCheckAnnotationHover(50)).toBe(false)
    })
})

describe('annotation hit test', () => {
    it('returns the index of the annotation under the cursor', () => {
        const { interaction } = setup([
            annotation({ cStart: 0, cEnd: 100, cY: 30 }),
            annotation({ start: 1, cStart: 200, cEnd: 300, cY: 30 })
        ])

        expect(interaction.findAnnotationAtPosition(250, 30)).toBe(1)
    })

    it('returns nothing for a cursor on the row above the annotation', () => {
        const { interaction } = setup([annotation({ cStart: 0, cEnd: 100, cY: 30 })])

        expect(interaction.findAnnotationAtPosition(50, 30 - DEFAULT_LABEL_HEIGHT / 2)).toBeNull()
        expect(interaction.findAnnotationAtPosition(50, 30 + DEFAULT_LABEL_HEIGHT / 2)).toBeNull()
        expect(interaction.findAnnotationAtPosition(50, 30)).toBe(0)
    })

    it('treats the horizontal edges of an annotation as outside it', () => {
        const { interaction } = setup([annotation({ cStart: 100, cEnd: 200, cY: 30 })])

        expect(interaction.findAnnotationAtPosition(100, 30)).toBeNull()
        expect(interaction.findAnnotationAtPosition(200, 30)).toBeNull()
        expect(interaction.findAnnotationAtPosition(101, 30)).toBe(0)
    })

    it('stops searching at the first annotation that starts right of the cursor', () => {
        // pins current behavior; see report
        const { interaction } = setup([
            annotation({ cStart: 500, cEnd: 600, cY: 30 }),
            annotation({ cStart: 0, cEnd: 1000, cY: 30 })
        ])

        expect(interaction.findAnnotationAtPosition(100, 30)).toBeNull()
    })

    it('returns nothing when nothing is rendered', () => {
        const { interaction } = setup([])

        expect(interaction.findAnnotationAtPosition(100, 30)).toBeNull()
    })

    it('uses the supplied label height for the row band', () => {
        const { interaction } = setup([annotation({ cStart: 0, cEnd: 100, cY: 30 })])

        expect(interaction.findAnnotationAtPosition(50, 45)).toBeNull()
        expect(interaction.findAnnotationAtPosition(50, 45, { ANNOTATIONLABELHEIGHT: 40 })).toBe(0)
    })
})

describe('pointer mode for a position', () => {
    const target = annotation({ cStart: 100, cEnd: 300, duration: 200000 })

    it('returns the active tool when no annotation is under the cursor', () => {
        const { interaction } = setup([])

        expect(interaction.determinePointerMode(150, 'annotate', null)).toBe('annotate')
        expect(interaction.determinePointerMode(150, 'pointer', null)).toBe('pointer')
    })

    it('reports the left resize handle within 10 pixels of the start', () => {
        const { interaction } = setup([])

        expect(interaction.determinePointerMode(110, 'annotate', target)).toBe('annResize-left')
        expect(interaction.determinePointerMode(111, 'annotate', target)).toBe('annSelect')
    })

    it('reports the right resize handle within 10 pixels of the end', () => {
        const { interaction } = setup([])

        expect(interaction.determinePointerMode(290, 'annotate', target)).toBe('annResize-right')
        expect(interaction.determinePointerMode(289, 'annotate', target)).toBe('annSelect')
    })

    it('offers no right resize handle on an annotation without duration', () => {
        const { interaction } = setup([])
        const mark = annotation({ cStart: 100, cEnd: 300, duration: 0 })

        expect(interaction.determinePointerMode(295, 'annotate', mark)).toBe('annSelect')
    })

    it('prefers the left handle when both handle zones overlap', () => {
        // pins current behavior; see report
        const { interaction } = setup([])
        const narrow = annotation({ cStart: 100, cEnd: 110, duration: 10000 })

        expect(interaction.determinePointerMode(105, 'annotate', narrow)).toBe('annResize-left')
    })

    it('offers selection only while the pointer tool is active', () => {
        const { interaction } = setup([])

        expect(interaction.determinePointerMode(105, 'pointer', target)).toBe('annSelect')
        expect(interaction.determinePointerMode(295, 'pointer', target)).toBe('annSelect')
    })

    it('returns an unknown tool name unchanged', () => {
        const { interaction } = setup([])

        expect(interaction.determinePointerMode(150, 'pan', target)).toBe('pan')
    })
})

describe('focused annotation', () => {
    it('restores the start and duration recorded before a resize', () => {
        const { interaction, focusedAnn } = setup([])
        focusedAnn.value = annotation({
            start: 5000, duration: 500, end: 5500, oldStart: 1000, oldDuration: 2000
        })

        interaction.resetFocusedAnnotation()

        expect(focusedAnn.value).toMatchObject({ start: 1000, duration: 2000, end: 3000 })
    })

    it('leaves an annotation alone when no resize was started', () => {
        const { interaction, focusedAnn } = setup([])
        focusedAnn.value = annotation({ start: 5000, duration: 500, end: 5500 })

        interaction.resetFocusedAnnotation()

        expect(focusedAnn.value).toMatchObject({ start: 5000, duration: 500, end: 5500 })
    })

    it('restores nothing when no annotation is focused', () => {
        const { interaction, focusedAnn } = setup([])

        interaction.resetFocusedAnnotation()

        expect(focusedAnn.value).toBeNull()
    })

    it('makes the focused annotation the active annotation of the store', () => {
        const { interaction, focusedAnn, store } = setup([])
        const focused = annotation({ id: 7, start: 1000, duration: 500, layer_id: 'layer-a' })
        focusedAnn.value = focused

        expect(interaction.selectFocusedAnnotation()).toBe(true)
        expect(store.activeAnnotation).toBe(focusedAnn.value)
        expect(store.activeAnnotation.id).toBe(focused.id)
    })

    it('reports no selection when nothing is focused', () => {
        const { interaction, store } = setup([])

        expect(interaction.selectFocusedAnnotation()).toBe(false)
        expect(store.activeAnnotation).toEqual({})
    })
})

describe('resize drag', () => {
    it('records the drag origin and the pre-drag span when a handle is pressed', () => {
        const { interaction, focusedAnn } = setup([])
        focusedAnn.value = annotation({ start: 1000, duration: 2000 })

        interaction.onMouseDown(120, 30, 'annResize-left')

        expect(interaction.mouseDownPosition.value).toEqual([120, 30])
        expect(focusedAnn.value).toMatchObject({ oldStart: 1000, oldDuration: 2000 })
    })

    it('records nothing when the press is not on a resize handle', () => {
        const { interaction, focusedAnn } = setup([])
        focusedAnn.value = annotation({ start: 1000, duration: 2000 })

        interaction.onMouseDown(120, 30, 'annSelect')

        expect(interaction.mouseDownPosition.value).toEqual([0, 0])
        expect(focusedAnn.value.oldStart).toBeUndefined()
    })

    it('records nothing when no annotation is focused', () => {
        const { interaction } = setup([])

        interaction.onMouseDown(120, 30, 'annResize-left')

        expect(interaction.mouseDownPosition.value).toEqual([0, 0])
    })

    it('moves the start and shrinks the duration when the left handle drags right', () => {
        const { interaction, focusedAnn } = setup([])
        focusedAnn.value = annotation({ start: 1000, duration: 2000 })

        interaction.onMouseDown(100, 30, 'annResize-left')
        const mode = interaction.onMouseMove(101, 30, 'annResize-left', true, annotateProps)

        expect(focusedAnn.value).toMatchObject({ start: 2000, duration: 1000, end: 3000 })
        expect(mode).toBe('annResize-left')
    })

    it('grows the duration when the right handle drags right', () => {
        const { interaction, focusedAnn } = setup([])
        focusedAnn.value = annotation({ start: 1000, duration: 2000 })

        interaction.onMouseDown(100, 30, 'annResize-right')
        interaction.onMouseMove(105, 30, 'annResize-right', true, annotateProps)

        expect(focusedAnn.value).toMatchObject({ start: 1000, duration: 7000, end: 8000 })
    })

    it('shrinks the duration when the right handle drags left', () => {
        const { interaction, focusedAnn } = setup([])
        focusedAnn.value = annotation({ start: 1000, duration: 2000 })

        interaction.onMouseDown(100, 30, 'annResize-right')
        interaction.onMouseMove(99, 30, 'annResize-right', true, annotateProps)

        expect(focusedAnn.value).toMatchObject({ duration: 1000, end: 2000 })
    })

    it('moves an annotation without duration and leaves its end behind', () => {
        // pins current behavior; see report
        const { interaction, focusedAnn } = setup([])
        focusedAnn.value = annotation({ start: 1000, duration: 0, end: 1000 })

        interaction.onMouseDown(100, 30, 'annResize-left')
        interaction.onMouseMove(101, 30, 'annResize-left', true, annotateProps)

        expect(focusedAnn.value).toMatchObject({ start: 2000, duration: 0, end: 1000 })
    })

    it('leaves the annotation alone while dragging in a mode that is not a resize', () => {
        const { interaction, focusedAnn } = setup([])
        focusedAnn.value = annotation({ start: 1000, duration: 2000, end: 3000 })

        const mode = interaction.onMouseMove(400, 30, 'annSelect', true, annotateProps)

        expect(focusedAnn.value).toMatchObject({ start: 1000, duration: 2000, end: 3000 })
        expect(mode).toBe('annSelect')
    })

    it('turns a resize that crossed the start into a positive span on release', () => {
        const { interaction, focusedAnn, store } = setup([])
        const focused = annotation({ start: 5000, duration: -2000, layer_id: 'layer-a' })
        focusedAnn.value = focused
        const emit = vi.fn<(event: 'updateAnnotation', ann: Annotation) => void>()

        interaction.onMouseUp('annResize-left', emit)

        expect(focused).toMatchObject({ start: 3000, duration: 2000, end: 5000 })
        expect(emit).toHaveBeenCalledWith('updateAnnotation', focusedAnn.value)
        expect(store.activeAnnotation).toBe(focusedAnn.value)
    })

    it('reports a released resize without changing a positive span', () => {
        const { interaction, focusedAnn } = setup([])
        const focused = annotation({ start: 5000, duration: 2000, end: 7000 })
        focusedAnn.value = focused
        const emit = vi.fn<(event: 'updateAnnotation', ann: Annotation) => void>()

        interaction.onMouseUp('annResize-right', emit)

        expect(focused).toMatchObject({ start: 5000, duration: 2000, end: 7000 })
        expect(emit).toHaveBeenCalledTimes(1)
    })

    it('reports nothing when the release was not a resize', () => {
        const { interaction, focusedAnn, store } = setup([])
        focusedAnn.value = annotation({ start: 5000, duration: 2000 })
        const emit = vi.fn<(event: 'updateAnnotation', ann: Annotation) => void>()

        interaction.onMouseUp('annSelect', emit)

        expect(emit).not.toHaveBeenCalled()
        expect(store.activeAnnotation).toEqual({})
    })

    it('reports nothing on release when no annotation is focused', () => {
        const { interaction } = setup([])
        const emit = vi.fn<(event: 'updateAnnotation', ann: Annotation) => void>()

        interaction.onMouseUp('annResize-right', emit)

        expect(emit).not.toHaveBeenCalled()
    })
})

describe('hover move', () => {
    it('focuses the annotation under the cursor and reports the selection mode', () => {
        const target = annotation({ id: 'target', cStart: 100, cEnd: 300, cY: 50, duration: 200000 })
        const { interaction, focusedAnn } = setup([target], [50])

        const mode = interaction.onMouseMove(200, 50, 'annotate', false, annotateProps)

        expect(focusedAnn.value?.id).toBe('target')
        expect(mode).toBe('annSelect')
    })

    it('reports a resize mode when the cursor hovers a handle', () => {
        const target = annotation({ cStart: 100, cEnd: 300, cY: 50, duration: 200000 })
        const { interaction } = setup([target], [50])

        expect(interaction.onMouseMove(105, 50, 'annotate', false, annotateProps)).toBe('annResize-left')
        expect(interaction.onMouseMove(295, 50, 'annotate', false, annotateProps)).toBe('annResize-right')
    })

    it('drops the focus and reports the active tool outside every label row', () => {
        const target = annotation({ cStart: 100, cEnd: 300, cY: 50, duration: 200000 })
        const { interaction, focusedAnn } = setup([target], [50])
        focusedAnn.value = target

        const mode = interaction.onMouseMove(200, 200, 'annSelect', false, annotateProps)

        expect(focusedAnn.value).toBeNull()
        expect(mode).toBe('annotate')
    })

    it('drops the focus inside a label row that holds no annotation at the cursor', () => {
        const target = annotation({ cStart: 100, cEnd: 300, cY: 50, duration: 200000 })
        const { interaction, focusedAnn } = setup([target], [50])
        focusedAnn.value = target

        const mode = interaction.onMouseMove(50, 50, 'annSelect', false, annotateProps)

        expect(focusedAnn.value).toBeNull()
        expect(mode).toBe('annotate')
    })

    it('keeps the focused annotation while the cursor stays inside its span', () => {
        const wide = annotation({ id: 'wide', start: 0, cStart: 0, cEnd: 400, cY: 50, duration: 400000 })
        const inner = annotation({ id: 'inner', start: 1, cStart: 100, cEnd: 300, cY: 50, duration: 200000 })
        const { interaction, focusedAnn, renderAnn } = setup([wide, inner], [50])
        focusedAnn.value = renderAnn.value[1]

        interaction.onMouseMove(200, 50, 'annSelect', false, annotateProps)

        expect(focusedAnn.value?.id).toBe('inner')
    })

    it('moves the focus once the cursor leaves the focused annotation', () => {
        const wide = annotation({ id: 'wide', start: 0, cStart: 0, cEnd: 400, cY: 50, duration: 400000 })
        const inner = annotation({ id: 'inner', start: 1, cStart: 100, cEnd: 300, cY: 50, duration: 200000 })
        const { interaction, focusedAnn, renderAnn } = setup([wide, inner], [50])
        focusedAnn.value = renderAnn.value[1]

        interaction.onMouseMove(50, 50, 'annSelect', false, annotateProps)

        expect(focusedAnn.value?.id).toBe('wide')
    })

    it('reports the selection mode of the pointer tool on hover', () => {
        const target = annotation({ cStart: 100, cEnd: 300, cY: 50, duration: 200000 })
        const { interaction } = setup([target], [50])

        const mode = interaction.onMouseMove(105, 50, 'pointer', false, {
            rsPeriod: 1000,
            viewerActiveTool: 'pointer'
        })

        expect(mode).toBe('annSelect')
    })
})
