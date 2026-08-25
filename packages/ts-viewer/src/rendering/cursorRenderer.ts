// rendering/cursorRenderer.ts
//
// Playback cursor: a vertical red line over the plot area with a triangular marker
// sitting on the time axis.

/** Inputs of the cursor arithmetic. */
export interface CursorGeometryInput {
    /** Cursor position as a fraction of the canvas width. */
    cursorLoc: number
    cWidth: number
    /** Height of the plot area. The marker hangs below it. */
    pHeight: number
    /** Pixels the cursor canvas extends left of the plot area. */
    cursorOffset: number
}

export interface CursorGeometry {
    /** Cursor column in canvas pixels. */
    x: number
    /** False while the cursor sits in the left gutter, where only the marker shows. */
    drawLine: boolean
    /** Marker vertices in draw order. The last one is the tip on the axis. */
    marker: Array<[number, number]>
}

/** Half the width of the marker base, in pixels. */
const MARKER_HALF_WIDTH = 5

/** Drop of the marker base below the plot area, in pixels. */
const MARKER_HEIGHT = 8

export const computeCursorGeometry = (input: CursorGeometryInput): CursorGeometry => {
    const x = input.cursorLoc * input.cWidth
    return {
        x,
        drawLine: x > input.cursorOffset,
        marker: [
            [x - MARKER_HALF_WIDTH, input.pHeight + MARKER_HEIGHT],
            [x + MARKER_HALF_WIDTH, input.pHeight + MARKER_HEIGHT],
            [x, input.pHeight]
        ]
    }
}

/** Draws the cursor for one viewport. Clears the canvas first. */
export const drawCursor = (
    ctx: CanvasRenderingContext2D,
    params: CursorGeometryInput & { cHeight: number; pixelRatio: number }
): void => {
    ctx.setTransform(params.pixelRatio, 0, 0, params.pixelRatio, 0, 0)
    ctx.clearRect(0, 0, params.cWidth + params.cursorOffset, params.cHeight)

    const geometry = computeCursorGeometry(params)

    ctx.save()
    ctx.beginPath()
    ctx.fillStyle = 'red'
    if (geometry.drawLine) {
        ctx.strokeStyle = 'red'
        ctx.moveTo(geometry.x, 0)
        ctx.lineTo(geometry.x, params.pHeight)
        ctx.stroke()
    } else {
        ctx.moveTo(geometry.x, params.pHeight)
    }

    ctx.beginPath()
    for (const [x, y] of geometry.marker) {
        ctx.lineTo(x, y)
    }
    ctx.fill()

    ctx.restore()
}
