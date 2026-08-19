import { describe, it, expect, vi } from 'vitest'
import { computeCursorGeometry, drawCursor } from './cursorRenderer'

// Enough of a 2D context for drawCursor, with the style fields it assigns.
const recordingContext = () => ({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    strokeStyle: ''
})

describe('computeCursorGeometry', () => {
    it('reads the cursor column as a fraction of the canvas width', () => {
        expect(computeCursorGeometry({ cursorLoc: 0.25, cWidth: 1000, pHeight: 480, cursorOffset: 5 }).x).toBe(250)
    })

    it('points the marker at the foot of the cursor line', () => {
        expect(computeCursorGeometry({ cursorLoc: 0.5, cWidth: 1000, pHeight: 480, cursorOffset: 5 }).marker)
            .toEqual([[495, 488], [505, 488], [500, 480]])
    })

    it('hides the cursor line inside the left gutter', () => {
        expect(computeCursorGeometry({ cursorLoc: 0.001, cWidth: 1000, pHeight: 480, cursorOffset: 5 }).drawLine)
            .toBe(false)
    })

    it('shows the cursor line once it clears the left gutter', () => {
        expect(computeCursorGeometry({ cursorLoc: 0.01, cWidth: 1000, pHeight: 480, cursorOffset: 5 }).drawLine)
            .toBe(true)
    })
})

describe('drawCursor', () => {
    const params = { cursorLoc: 0.5, cWidth: 1000, cHeight: 500, pHeight: 480, cursorOffset: 5, pixelRatio: 1 }

    it('clears the gutter along with the plot width', () => {
        const ctx = recordingContext()

        drawCursor(ctx as unknown as CanvasRenderingContext2D, params)

        expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1005, 500)
    })

    it('strokes the cursor line down to the plot floor', () => {
        const ctx = recordingContext()

        drawCursor(ctx as unknown as CanvasRenderingContext2D, params)

        expect(ctx.moveTo).toHaveBeenCalledWith(500, 0)
        expect(ctx.lineTo).toHaveBeenCalledWith(500, 480)
        expect(ctx.stroke).toHaveBeenCalledTimes(1)
    })

    it('strokes no cursor line inside the left gutter', () => {
        const ctx = recordingContext()

        drawCursor(ctx as unknown as CanvasRenderingContext2D, { ...params, cursorLoc: 0.001 })

        expect(ctx.stroke).not.toHaveBeenCalled()
        expect(ctx.fill).toHaveBeenCalledTimes(1)
    })
})
