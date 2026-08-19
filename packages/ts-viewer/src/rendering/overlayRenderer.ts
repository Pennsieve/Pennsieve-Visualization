// rendering/overlayRenderer.ts
//
// Drag overlays drawn on the interaction canvas: the channel selection box of the
// pointer tool and the annotation preview of the annotate tool. Both live only for the
// duration of a drag and are cleared by the next draw.

/** Rectangle in canvas pixels. Width and height are signed. */
export interface BoxRect {
    x: number
    y: number
    width: number
    height: number
}

/** Pointer and drag origin, both in client coordinates, plus the canvas origin. */
export interface DragBoxInput {
    curX: number
    curY: number
    canvasLeft: number
    canvasTop: number
    dragStartX: number
    dragStartY: number
}

/** One channel row of the annotation preview. */
export interface AnnotationBoxChannel {
    selected?: boolean
    visible?: boolean
    rowBaseline?: number | null
}

export interface AnnotationBoxSpan {
    /** Left edge of the box: the pointer, in canvas pixels. */
    xStart: number
    /** Signed width from xStart back to the drag origin. */
    dx: number
    /** Label bar left edge, pushed 1 px outward so it covers the box edge. */
    lblStart: number
    /** Label bar signed width, 2 px wider than the box for the same reason. */
    lblEnd: number
}

export interface AnnotationBoxRows {
    /** Top of the label bar of each drawn row, in row order. */
    rowTops: number[]
    /** Highest row baseline drawn, or cHeight when no row is drawn. */
    minOffset: number
    /** Lowest row baseline drawn, or 0 when no row is drawn. */
    maxOffset: number
    /** Label bar height above and below a row baseline. */
    halfHeight: number
}

/** Clears the full overlay canvas. Leaves the transform alone. */
export const clearOverlay = (ctx: CanvasRenderingContext2D, cWidth: number, cHeight: number): void => {
    ctx.clearRect(0, 0, cWidth, cHeight)
}

/** Selection box from the drag origin to the pointer. */
export const computeSelectBox = (input: DragBoxInput): BoxRect => {
    return {
        x: input.curX - input.canvasLeft,
        y: input.curY - input.canvasTop,
        width: input.dragStartX - input.curX,
        height: input.dragStartY - input.curY
    }
}

/** Horizontal extent of the annotation preview and of its label bar. */
export const computeAnnotationBoxSpan = (
    input: { curX: number; canvasLeft: number; dragStartX: number }
): AnnotationBoxSpan => {
    const xStart = input.curX - input.canvasLeft
    const dx = input.dragStartX - input.curX

    let lblStart = xStart - 1
    let lblEnd = dx + 2
    if (dx < 0) {
        lblStart = xStart + 1
        lblEnd = dx - 2
    }

    return { xStart, dx, lblStart, lblEnd }
}

/**
 * Label bar rows of a channel-scoped annotation preview, and the vertical span the
 * shading covers. Only selected and visible rows count.
 */
export const computeAnnotationBoxRows = (
    channels: AnnotationBoxChannel[],
    cHeight: number,
    annotationHeight: number
): AnnotationBoxRows => {
    const halfHeight = (annotationHeight / 2) | 0
    const rowTops: number[] = []
    let minOffset = cHeight | 0
    let maxOffset = 0

    for (const channel of channels) {
        if (channel.selected && channel.visible) {
            const channelOffset = channel.rowBaseline! | 0
            if (channelOffset < minOffset) {
                minOffset = channelOffset
            }
            if (channelOffset > maxOffset) {
                maxOffset = channelOffset
            }
            rowTops.push(channelOffset - halfHeight)
        }
    }

    return { rowTops, minOffset, maxOffset, halfHeight }
}

/** Draws the pointer tool selection box. Clears the canvas first. */
export const drawSelectBox = (
    ctx: CanvasRenderingContext2D,
    params: DragBoxInput & { cWidth: number; cHeight: number; pixelRatio: number }
): void => {
    ctx.setTransform(params.pixelRatio, 0, 0, params.pixelRatio, 0, 0)
    clearOverlay(ctx, params.cWidth, params.cHeight)

    ctx.beginPath()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#295eff'
    ctx.setLineDash([5, 5, 15, 5])

    const box = computeSelectBox(params)
    ctx.rect(box.x, box.y, box.width, box.height)
    ctx.stroke()
}

/** Draws the annotate tool drag preview. Clears the canvas first. */
export const drawAnnotationBox = (
    ctx: CanvasRenderingContext2D,
    params: {
        curX: number
        canvasLeft: number
        dragStartX: number
        cWidth: number
        cHeight: number
        pHeight: number
        pixelRatio: number
        annotationHeight: number
        /** True when the preview spans every channel and needs no per-row bars. */
        allChannels: boolean
        /** Channel rows in render order. Read only when allChannels is false. */
        channels: AnnotationBoxChannel[]
        /** Color of the layer the annotation lands in, or null when no layer is active. */
        layerColor: string | null
    }
): void => {
    ctx.setTransform(params.pixelRatio, 0, 0, params.pixelRatio, 0, 0)

    // Without an active layer there is no color to preview in, and the canvas keeps
    // whatever the last draw left on it.
    if (params.layerColor === null) {
        return
    }

    const annotationHeight = params.annotationHeight
    const { xStart, dx, lblStart, lblEnd } = computeAnnotationBoxSpan(params)

    ctx.save()
    clearOverlay(ctx, params.cWidth, params.cHeight)
    ctx.lineWidth = 1

    if (params.allChannels) {
        ctx.fillStyle = 'rgba(0,0,0,0.1)'
        ctx.fillRect(xStart, 0, dx, params.pHeight)

        ctx.fillStyle = params.layerColor
        ctx.strokeStyle = ctx.fillStyle

        ctx.fillRect(lblStart, 0, lblEnd, annotationHeight)

        ctx.setLineDash([5, 5, 5, 5])
        ctx.beginPath()
        ctx.moveTo(xStart, annotationHeight)
        ctx.lineTo(xStart, params.pHeight)
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(xStart + dx, annotationHeight)
        ctx.lineTo(xStart + dx, params.pHeight)
        ctx.stroke()
    } else {
        ctx.fillStyle = params.layerColor
        ctx.strokeStyle = ctx.fillStyle

        const rows = computeAnnotationBoxRows(params.channels, params.cHeight, annotationHeight)
        for (const rowTop of rows.rowTops) {
            ctx.fillRect(lblStart, rowTop, lblEnd, annotationHeight)
        }

        ctx.fillStyle = 'rgba(0,0,0,0.1)'
        ctx.setLineDash([5, 5, 5, 5])

        ctx.fillRect(
            xStart - 1,
            rows.minOffset + rows.halfHeight,
            dx + 2,
            rows.maxOffset - rows.minOffset - annotationHeight
        )
        ctx.beginPath()
        ctx.moveTo(xStart, rows.minOffset + rows.halfHeight)
        ctx.lineTo(xStart, rows.maxOffset - rows.halfHeight)
        ctx.moveTo(xStart + dx, rows.minOffset + rows.halfHeight)
        ctx.lineTo(xStart + dx, rows.maxOffset - rows.halfHeight)
        ctx.stroke()
    }
    ctx.restore()
}
