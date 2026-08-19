import { describe, it, expect, vi } from 'vitest'
import {
    computeAnnotationBoxRows,
    computeAnnotationBoxSpan,
    computeSelectBox,
    drawAnnotationBox
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

    it('reports the canvas height as the span start when no row is drawn', () => {
        const rows = computeAnnotationBoxRows([{ selected: false, visible: true, rowBaseline: 100 }], 500, 20)

        expect(rows.rowTops).toEqual([])
        expect(rows.minOffset).toBe(500)
        expect(rows.maxOffset).toBe(0)
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
})
