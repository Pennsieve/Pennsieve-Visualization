// interaction/useCanvasTools.ts
//
// Mouse state machine of the three viewer tools. The host component wires DOM events to
// the returned handlers and reads pointerMode for the cursor style; every drag decision
// and coordinate computation lives here.

import { reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { clearOverlay, drawAnnotationBox, drawSelectBox } from '@/rendering/overlayRenderer'
import type { ViewerStore } from '@/stores/tsviewer'
import type { Annotation, AnnotationLayer } from '@/utils/annotationUtils'

/** Annotation canvas members the tools drive. */
export interface AnnotationCanvasTools {
    onMouseDown: (mX: number, mY: number) => void
    onMouseMove: (mX: number, mY: number, pointerMode: string, mouseDown: boolean) => string | undefined
    onMouseUp: () => void
    selectFocusedAnn: () => void
}

/** Viewport values the handlers read when an event arrives. */
export interface CanvasToolsViewport {
    /** Viewport start in microseconds. */
    start: number
    cWidth: number
    cHeight: number
    /** Height of the plot area. */
    pHeight: number
    /** Microseconds per pixel. */
    rsPeriod: number
    pixelRatio: number
    /** Height of an annotation label bar in pixels. */
    annotationLabelHeight: number
}

export interface CanvasToolsOptions {
    store: ViewerStore
    /** Canvas that takes the mouse events and carries the drag overlays. */
    interactionCanvas: () => HTMLCanvasElement | null
    annotationCanvas: () => AnnotationCanvasTools | null
    viewport: () => CanvasToolsViewport
    renderAll: (delay?: number, requestLeadingEdge?: boolean) => void
    /** Reports a pan. The host owns the viewport start. */
    setStart: (start: number) => void
    addAnnotation: (
        startTime: number,
        duration: number,
        allChannels: boolean,
        label: string,
        description: string,
        layer: AnnotationLayer
    ) => void
}

/** Pointer modes that mean a drag on an annotation edge or body is in progress. */
const ANNOTATION_POINTER_MODES = ['annResize-left', 'annResize-right', 'annSelect']

/** Labels offered for a new annotation. Index labelSelect is the one applied. */
const DEFAULT_ANNOTATION_LABELS = ['Event', 'Artifact', 'Seizure', 'Mark', 'Stim On', 'Stim Off', 'Start', 'Stop']

/**
 * Shortest annotation a drag can create, in microseconds. A shorter drag reads as a
 * click, which must not leave an annotation behind.
 */
const MIN_ANNOTATION_DURATION_US = 1000

export const useCanvasTools = (options: CanvasToolsOptions) => {
    const { viewerChannels, viewerAnnotations, viewerActiveTool, viewerSelectedChannels } = storeToRefs(options.store)

    const mouseDown = ref(false)
    const pointerMode = ref('pointer') // Start with a neutral default
    const startDragCoord = reactive({ x: 0, y: 0 })
    const startDragTimeStamp = ref(0)
    const labelSelect = ref(0)

    const ensureActiveAnnotationLayer = () => {
        // If no layer is selected, select the first available layer
        if (viewerAnnotations.value.length > 0) {
            const hasSelected = viewerAnnotations.value.some(layer => layer.selected)
            if (!hasSelected) {
                const firstLayer = viewerAnnotations.value[0]
                if (firstLayer && firstLayer.id) {
                    options.store.setActiveAnnotationLayer(firstLayer.id)
                }
            }
        } else {
            // Try again after a short delay to allow layers to load
            setTimeout(() => {
                if (viewerAnnotations.value.length > 0) {
                    ensureActiveAnnotationLayer()
                }
            }, 500)
        }
    }

    /** Prepares for a tool change. The toolbar sends pointer, pan, or annotate. */
    const setActiveTool = (activeTool: string) => {
        switch (activeTool) {
            case 'annotate':
                // Ensure we have a selected annotation layer for creating annotations
                ensureActiveAnnotationLayer()
                break
            case 'pan':
            case 'pointer':
                break
        }
    }

    /** True when the annotation spans every channel, which is also the case for none selected. */
    const spansAllChannels = () => {
        const selectedChannels = viewerSelectedChannels.value
        return selectedChannels.length === viewerChannels.value.length || selectedChannels.length === 0
    }

    const overlayContext = () => {
        const canvas = options.interactionCanvas()!
        return { canvas, ctx: canvas.getContext('2d')! }
    }

    const clearInteractionCanvas = () => {
        const { ctx } = overlayContext()
        const viewport = options.viewport()
        clearOverlay(ctx, viewport.cWidth, viewport.cHeight)
    }

    const renderSelectBox = (curX: number, curY: number) => {
        const { canvas, ctx } = overlayContext()
        const viewport = options.viewport()
        const cCoord = canvas.getBoundingClientRect()

        drawSelectBox(ctx, {
            curX,
            curY,
            canvasLeft: cCoord.left,
            canvasTop: cCoord.top,
            dragStartX: startDragCoord.x,
            dragStartY: startDragCoord.y,
            cWidth: viewport.cWidth,
            cHeight: viewport.cHeight,
            pixelRatio: viewport.pixelRatio
        })
    }

    const renderAnnotationBox = (curX: number) => {
        const { canvas, ctx } = overlayContext()
        const viewport = options.viewport()
        const activeLayer = viewerAnnotations.value.find(layer => layer.selected)

        drawAnnotationBox(ctx, {
            curX,
            canvasLeft: canvas.getBoundingClientRect().left,
            dragStartX: startDragCoord.x,
            cWidth: viewport.cWidth,
            cHeight: viewport.cHeight,
            pHeight: viewport.pHeight,
            pixelRatio: viewport.pixelRatio,
            annotationHeight: viewport.annotationLabelHeight,
            allChannels: spansAllChannels(),
            channels: viewerChannels.value,
            layerColor: activeLayer ? activeLayer.color! : null
        })
    }

    const onMouseDown = (evt: MouseEvent) => {
        mouseDown.value = true
        startDragTimeStamp.value = options.viewport().start
        const cCoord = options.interactionCanvas()!.getBoundingClientRect()
        startDragCoord.x = evt.clientX
        startDragCoord.y = evt.clientY

        // For annotate tool, ensure pointerMode is set to annotate if not doing specific action
        if (viewerActiveTool.value === 'annotate' && !ANNOTATION_POINTER_MODES.includes(pointerMode.value)) {
            pointerMode.value = 'annotate'
        }

        switch (pointerMode.value) {
            case 'annResize-left':
            case 'annResize-right':
                options.annotationCanvas()?.onMouseDown(evt.clientX - cCoord.left, evt.clientY - cCoord.top)
                break
        }
    }

    const onMouseMove = (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()

        const canvas = options.interactionCanvas()!
        const cCoord = canvas.getBoundingClientRect()
        const mY = e.clientY - cCoord.top
        const mX = e.clientX - cCoord.left

        switch (viewerActiveTool.value) {
            case 'pan':
                if (mouseDown.value) {
                    const setStart = startDragTimeStamp.value - ((e.clientX - startDragCoord.x) * options.viewport().rsPeriod)
                    options.setStart(setStart)
                } else {
                    const newPointerMode = options.annotationCanvas()?.onMouseMove(mX, mY, pointerMode.value, mouseDown.value)
                    pointerMode.value = newPointerMode || 'pan'
                }
                break

            case 'pointer':
                if (mouseDown.value) {
                    renderSelectBox(e.clientX, e.clientY)
                } else {
                    const newPointerMode = options.annotationCanvas()?.onMouseMove(mX, mY, pointerMode.value, mouseDown.value)
                    pointerMode.value = newPointerMode || 'pointer'
                }
                break

            case 'annotate':
                if (mouseDown.value && pointerMode.value === 'annotate') {
                    renderAnnotationBox(e.clientX)
                } else if (mouseDown.value && ['annResize-left', 'annResize-right'].includes(pointerMode.value)) {
                    const newPointerMode = options.annotationCanvas()?.onMouseMove(mX, mY, pointerMode.value, mouseDown.value)
                    pointerMode.value = newPointerMode || pointerMode.value
                    options.renderAll()
                } else {
                    const newPointerMode = options.annotationCanvas()?.onMouseMove(mX, mY, pointerMode.value, mouseDown.value)
                    if (newPointerMode) {
                        pointerMode.value = newPointerMode
                    } else {
                        pointerMode.value = 'annotate'
                    }
                }
                break
        }
    }

    const onMouseUp = (e: MouseEvent) => {
        mouseDown.value = false

        switch (pointerMode.value) {
            case 'pointer': {
                clearInteractionCanvas()
                const canvas = options.interactionCanvas()!
                const append = e.metaKey
                const yEnd = e.clientY - canvas.getBoundingClientRect().top
                const yStart = startDragCoord.y - canvas.getBoundingClientRect().top

                const channels = viewerChannels.value.map(channel => {
                    if (append === false) {
                        channel.selected = false
                    }
                    // A channel without a row baseline has no laid-out row, so no drag
                    // can cover it.
                    const rowBaseline = channel.rowBaseline
                    if (typeof rowBaseline !== 'number') {
                        return channel
                    }
                    if ((rowBaseline > yStart && rowBaseline < yEnd) ||
                        (rowBaseline < yStart && rowBaseline > yEnd)) {
                        channel.selected = true
                    }
                    return channel
                })

                options.store.setChannels(channels)
                options.renderAll()

                break
            }

            case 'annSelect':
                clearInteractionCanvas()
                options.annotationCanvas()?.selectFocusedAnn()
                break

            case 'annotate': {
                // Ensure we have a selected layer before creating annotation
                ensureActiveAnnotationLayer()

                let curLIndex: number | null = null
                let selectedLayer: AnnotationLayer | null = null

                for (let i = 0; i < viewerAnnotations.value.length; i++) {
                    if (viewerAnnotations.value[i].selected) {
                        curLIndex = i
                        selectedLayer = viewerAnnotations.value[i]
                        break
                    }
                }

                // A layer without an id cannot carry an annotation.
                if (curLIndex === null || !selectedLayer || !selectedLayer.id) {
                    if (viewerAnnotations.value.length > 0 && viewerAnnotations.value[0].id) {
                        options.store.setActiveAnnotationLayer(viewerAnnotations.value[0].id)
                        selectedLayer = viewerAnnotations.value[0]
                        curLIndex = 0
                    } else {
                        return
                    }
                }

                const selectedChannels = viewerSelectedChannels.value
                const allChannels = spansAllChannels()
                const canvas = options.interactionCanvas()!
                const rsPeriod = options.viewport().rsPeriod

                let duration = (e.clientX - startDragCoord.x) * rsPeriod
                let startTime = startDragTimeStamp.value + ((startDragCoord.x - canvas.getBoundingClientRect().left) * rsPeriod)

                // Normalize negative durations (right-to-left drag)
                if (duration < 0) {
                    startTime = startTime + duration
                    duration = -duration
                }

                // Only create annotation if we actually dragged to create a duration
                if (duration > MIN_ANNOTATION_DURATION_US) {
                    const newAnn = {
                        name: '',
                        id: null,
                        label: DEFAULT_ANNOTATION_LABELS[labelSelect.value],
                        description: '',
                        start: startTime,
                        duration: duration,
                        end: startTime + duration,
                        cStart: null,
                        cEnd: null,
                        selected: true,
                        channelIds: selectedChannels.map(ch => ch.id),
                        allChannels: allChannels,
                        layer_id: selectedLayer.id,
                        userId: null
                    }

                    options.store.setActiveAnnotation(newAnn as unknown as Annotation)
                    options.addAnnotation(startTime, duration, allChannels, newAnn.label, newAnn.description, selectedLayer)
                    break
                }
                break
            }

            case 'annResize-left':
            case 'annResize-right':
                options.annotationCanvas()?.onMouseUp()
                break
        }
    }

    const onMouseOut = () => {
        mouseDown.value = false
    }

    const onMouseEnter = (e: MouseEvent) => {
        if (e.buttons === 1) {
            mouseDown.value = true
        } else {
            mouseDown.value = false
        }
    }

    watch(viewerActiveTool, (val) => {
        if (val) {
            setActiveTool(val)
            // Set pointer mode to match the active tool when not doing specific interactions
            if (!mouseDown.value && !ANNOTATION_POINTER_MODES.includes(pointerMode.value)) {
                pointerMode.value = val
            }
        }
    }, { immediate: true })

    return {
        pointerMode,
        mouseDown,
        setActiveTool,
        ensureActiveAnnotationLayer,
        clearInteractionCanvas,
        onMouseDown,
        onMouseMove,
        onMouseUp,
        onMouseOut,
        onMouseEnter
    }
}
