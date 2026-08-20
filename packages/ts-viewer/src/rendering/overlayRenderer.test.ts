import { describe, it, expect, vi } from 'vitest'
import {
    computeAnnotationBoxRows,
    computeAnnotationBoxSpan,
    computeSelectBox,
    drawAnnotationBox,
    drawSelectBox
} from './overlayRenderer'
import type { AnnotationBoxChannel } from './overlayRenderer'

// Enough of a 2D context for the overlay draws, with the style fields they assign.
const recordingContext = () => ({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    rect: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    setLineDash: vi.fn(),
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: ''
})

/** The stroke and fill state a draw can leave behind on the shared overlay canvas. */
interface OverlayStyle {
    lineWidth: number
    strokeStyle: string
    fillStyle: string
    lineDash: number[]
}

/**
 * Recording context whose save and restore keep a stack of the style fields, the way a
 * real 2D context does, so a test can compare the state before and after a draw.
 */
const restoringContext = () => {
    const stack: OverlayStyle[] = []
    const ctx = {
        ...recordingContext(),
        lineWidth: 1,
        strokeStyle: '#000',
        fillStyle: '#000',
        lineDash: [] as number[],
        setLineDash: vi.fn((pattern: number[]) => {
            ctx.lineDash = pattern
        }),
        save: vi.fn(() => {
            stack.push(styleOf(ctx))
        }),
        restore: vi.fn(() => {
            const previous = stack.pop()
            if (previous) {
                Object.assign(ctx, previous)
            }
        })
    }
    return ctx
}

const styleOf = (ctx: OverlayStyle): OverlayStyle => ({
    lineWidth: ctx.lineWidth,
    strokeStyle: ctx.strokeStyle,
    fillStyle: ctx.fillStyle,
    lineDash: ctx.lineDash
})

const channels: AnnotationBoxChannel[] = [
    { selected: true, visible: true, rowBaseline: 100 },
    { selected: false, visible: true, rowBaseline: 200 },
    { selected: true, visible: false, rowBaseline: 300 },
    { selected: true, visible: true, rowBaseline: 400 }
]

describe('computeSelectBox', () => {
    it('anchors the box at the pointer and sizes it back to the drag origin', () => {
        expect(computeSelectBox({
            curX: 300,
            curY: 200,
            canvasLeft: 50,
            canvasTop: 20,
            dragStartX: 100,
            dragStartY: 60
        })).toEqual({ x: 250, y: 180, width: -200, height: -140 })
    })

    it('reports positive extents for a drag up and to the left', () => {
        expect(computeSelectBox({
            curX: 100,
            curY: 60,
            canvasLeft: 50,
            canvasTop: 20,
            dragStartX: 300,
            dragStartY: 200
        })).toEqual({ x: 50, y: 40, width: 200, height: 140 })
    })
})

describe('computeAnnotationBoxSpan', () => {
    it('measures the box from the pointer back to the drag origin', () => {
        expect(computeAnnotationBoxSpan({ curX: 100, canvasLeft: 50, dragStartX: 300 }))
            .toEqual({ xStart: 50, dx: 200, lblStart: 49, lblEnd: 202 })
    })

    it('mirrors the label bar overhang on a drag to the right', () => {
        expect(computeAnnotationBoxSpan({ curX: 300, canvasLeft: 50, dragStartX: 100 }))
            .toEqual({ xStart: 250, dx: -200, lblStart: 251, lblEnd: -202 })
    })
})

describe('computeAnnotationBoxRows', () => {
    it('places a label bar on each selected and visible row', () => {
        const rows = computeAnnotationBoxRows(channels, 500, 20)

        expect(rows.halfHeight).toBe(10)
        expect(rows.rowTops).toEqual([90, 390])
    })

    it('spans from the highest to the lowest drawn row', () => {
        const rows = computeAnnotationBoxRows(channels, 500, 20)

        expect(rows.minOffset).toBe(100)
        expect(rows.maxOffset).toBe(400)
    })

    it('truncates a fractional row baseline to a whole pixel', () => {
        const rows = computeAnnotationBoxRows([{ selected: true, visible: true, rowBaseline: 100.7 }], 500, 20)

        expect(rows.rowTops).toEqual([90])
        expect(rows.minOffset).toBe(100)
    })

    it('halves an odd label height downward', () => {
        expect(computeAnnotationBoxRows(channels, 500, 21).halfHeight).toBe(10)
    })

    it('reports no row to shade between when no channel row is drawn', () => {
        const rows = computeAnnotationBoxRows([{ selected: false, visible: true, rowBaseline: 100 }], 500, 20)

        // An empty rowTops is what the draw reads to skip the shading. minOffset and
        // maxOffset only place the two edge lines in that case.
        expect(rows.rowTops).toEqual([])
        expect(rows.minOffset).toBe(500)
        expect(rows.maxOffset).toBe(0)
    })

    it('skips a selected channel whose row baseline is null', () => {
        // Channels carry a null baseline until the renderer lays them out, and a
        // null read as 0 shades from the top of the canvas.
        const rows = computeAnnotationBoxRows([
            { selected: true, visible: true, rowBaseline: null },
            { selected: true, visible: true, rowBaseline: 300 }
        ], 500, 20)

        expect(rows.rowTops).toEqual([290])
        expect(rows.minOffset).toBe(300)
        expect(rows.maxOffset).toBe(300)
    })
})

describe('drawAnnotationBox', () => {
    const params = {
        curX: 300,
        canvasLeft: 50,
        dragStartX: 100,
        cWidth: 1000,
        cHeight: 500,
        pHeight: 480,
        pixelRatio: 1,
        annotationHeight: 20,
        allChannels: true,
        channels,
        layerColor: '#18BA62'
    }

    it('draws nothing when no annotation layer is active', () => {
        const ctx = recordingContext()

        drawAnnotationBox(ctx as unknown as CanvasRenderingContext2D, { ...params, layerColor: null })

        expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0)
        expect(ctx.clearRect).not.toHaveBeenCalled()
        expect(ctx.fillRect).not.toHaveBeenCalled()
    })

    it('shades the whole plot height for an all-channel annotation', () => {
        const ctx = recordingContext()

        drawAnnotationBox(ctx as unknown as CanvasRenderingContext2D, params)

        expect(ctx.fillRect.mock.calls).toEqual([
            [250, 0, -200, 480],
            [251, 0, -202, 20]
        ])
    })

    it('shades between the outermost selected rows for a channel annotation', () => {
        const ctx = recordingContext()

        drawAnnotationBox(ctx as unknown as CanvasRenderingContext2D, { ...params, allChannels: false })

        expect(ctx.fillRect.mock.calls).toEqual([
            [251, 90, -202, 20],
            [251, 390, -202, 20],
            [249, 110, -198, 280]
        ])
    })

    it('shades nothing when no selected channel is visible', () => {
        const ctx = recordingContext()
        const hidden: AnnotationBoxChannel[] = [{ selected: true, visible: false, rowBaseline: 300 }]

        drawAnnotationBox(ctx as unknown as CanvasRenderingContext2D, {
            ...params,
            allChannels: false,
            channels: hidden
        })

        expect(ctx.fillRect).not.toHaveBeenCalled()
        // The two edge lines still span the canvas, as they do for a matched row.
        expect(ctx.moveTo.mock.calls).toEqual([[250, 510], [50, 510]])
        expect(ctx.lineTo.mock.calls).toEqual([[250, -10], [50, -10]])
        expect(ctx.stroke).toHaveBeenCalledTimes(1)
    })
})

describe('overlay draws and the shared context state', () => {
    const selectBoxParams = {
        curX: 300,
        curY: 200,
        canvasLeft: 50,
        canvasTop: 20,
        dragStartX: 100,
        dragStartY: 60,
        cWidth: 1000,
        cHeight: 500,
        pixelRatio: 1
    }

    const annotationBoxParams = {
        curX: 300,
        canvasLeft: 50,
        dragStartX: 100,
        cWidth: 1000,
        cHeight: 500,
        pHeight: 480,
        pixelRatio: 1,
        annotationHeight: 20,
        allChannels: true,
        channels,
        layerColor: '#18BA62'
    }

    it('leaves the stroke state and the dash pattern as it found them after a select box draw', () => {
        const ctx = restoringContext()
        const before = styleOf(ctx)

        drawSelectBox(ctx as unknown as CanvasRenderingContext2D, selectBoxParams)

        expect(styleOf(ctx)).toEqual(before)
        expect(ctx.save).toHaveBeenCalledTimes(1)
        expect(ctx.restore).toHaveBeenCalledTimes(1)
    })

    it('leaves the stroke state and the dash pattern as it found them after an annotation box draw', () => {
        const ctx = restoringContext()
        const before = styleOf(ctx)

        drawAnnotationBox(ctx as unknown as CanvasRenderingContext2D, annotationBoxParams)

        expect(styleOf(ctx)).toEqual(before)
        expect(ctx.save).toHaveBeenCalledTimes(1)
        expect(ctx.restore).toHaveBeenCalledTimes(1)
    })

    it('keeps the select box dash pattern out of a later annotation box draw', () => {
        const ctx = restoringContext()
        const before = styleOf(ctx)

        drawSelectBox(ctx as unknown as CanvasRenderingContext2D, selectBoxParams)
        drawAnnotationBox(ctx as unknown as CanvasRenderingContext2D, annotationBoxParams)

        expect(styleOf(ctx)).toEqual(before)
        expect(ctx.save).toHaveBeenCalledTimes(2)
        expect(ctx.restore).toHaveBeenCalledTimes(2)
    })
})
