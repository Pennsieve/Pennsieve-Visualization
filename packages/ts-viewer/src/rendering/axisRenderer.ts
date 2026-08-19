// rendering/axisRenderer.ts
//
// Time axis of the viewer: the plot frame, one tick per visible channel, the vertical
// grid, and the UTC time labels under it.

/** Viewer constants the axis reads. */
export interface AxisConstants {
    XOFFSET: number
    XGRIDSPACING: number
    NRPXPERLABEL: number
}

/** Viewport the axis is drawn for. All times are microseconds. */
export interface AxisViewport {
    start: number
    duration: number
    /** Recording end. Grid lines past it are dropped. */
    tsEnd: number
    /** Microseconds per pixel. */
    rsPeriod: number
    cWidth: number
    cHeight: number
    /** Height of the plot area. The band between it and cHeight holds the labels. */
    pHeight: number
    nrVisibleChannels: number
}

/** Inputs of the grid arithmetic, in the units the caller already has. */
export interface AxisGridInput {
    start: number
    duration: number
    tsEnd: number
    rsPeriod: number
    /** Pixels between the canvas left edge and the plot area. */
    xOffset: number
    /** Grid spacing before coarsening, in microseconds. */
    baseGridSpacing: number
    /** Target pixels between two time labels. */
    pxPerLabel: number
}

export interface AxisGridLine {
    /** Pixel column of the line, rounded to keep it hairline sharp. */
    x: number
    /** Absolute time of the line in microseconds. */
    timeUs: number
    /** UTC label to draw under the line, or null for an unlabeled line. */
    label: string | null
}

export interface AxisGrid {
    /** Spacing after coarsening, in microseconds. */
    gridSpacing: number
    /** One line in this many carries a label. */
    labelDecimator: number
    /** Lines left to right. Lines off the canvas or past tsEnd are absent. */
    lines: AxisGridLine[]
}

/** Grid spacing gains one base step per GRID_COARSEN_STEP_US of viewport width. */
const GRID_COARSEN_STEP_US = 100000000

/** Formats a date as the UTC wall clock the axis labels show. */
export const getUTCTimeString = (d: Date): string => {
    return (
        ('0' + d.getUTCHours()).slice(-2) + ':' +
        ('0' + d.getUTCMinutes()).slice(-2) + ':' +
        ('0' + d.getUTCSeconds()).slice(-2)
    )
}

/**
 * Pixel rows of the per-channel ticks on the y axis, top to bottom. The first row sits
 * half a channel band below the top edge, and the rows are one band apart.
 */
export const computeChannelTicks = (pHeight: number, nrVisibleChannels: number): number[] => {
    const ticks: number[] = []
    let tickOffset = (((pHeight / (2 * nrVisibleChannels)) + 0.5) << 1) >> 1
    for (let i = 0; i < nrVisibleChannels; i++) {
        ticks.push(tickOffset)
        tickOffset += pHeight / nrVisibleChannels
    }
    return ticks
}

/** Grid lines and labels for one viewport. */
export const computeAxisGrid = (input: AxisGridInput): AxisGrid => {
    const gridSpacing = input.baseGridSpacing * Math.ceil(input.duration / GRID_COARSEN_STEP_US)
    const nrGridLines = Math.ceil(input.duration / gridSpacing) + 1
    const labelDecimator = Math.ceil(input.pxPerLabel / (gridSpacing / input.rsPeriod))
    const lines: AxisGridLine[] = []

    // First line at or after the viewport start that lands on the absolute grid.
    const xLoc1 = (gridSpacing - (input.start % gridSpacing)) % gridSpacing

    for (let i = 0; i < nrGridLines; i++) {
        const realX = input.start + xLoc1 + i * gridSpacing
        if (realX > input.tsEnd) {
            break
        }

        const realOffset = realX - input.start
        const curLoc = input.xOffset + (realOffset / input.rsPeriod)
        const roundedCurLoc = Math.round(curLoc)

        if (roundedCurLoc > 1) {
            const test = (((realX / gridSpacing) + gridSpacing / 10) % labelDecimator) | 0
            const labeled = test === 1 || labelDecimator === 1
            lines.push({
                x: roundedCurLoc,
                timeUs: realX,
                label: labeled ? getUTCTimeString(new Date(realX / 1000)) : null
            })
        }
    }

    return { gridSpacing, labelDecimator, lines }
}

/** Draws the axis for one viewport. Clears the canvas first. */
export const drawAxis = (
    ctx: CanvasRenderingContext2D,
    params: { viewport: AxisViewport; constants: AxisConstants; pixelRatio: number }
): void => {
    const { viewport, constants, pixelRatio } = params
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

    ctx.clearRect(0, 0, viewport.cWidth, viewport.cHeight)
    ctx.stroke()

    ctx.beginPath()
    ctx.lineWidth = 1
    ctx.moveTo(constants.XOFFSET + 0.5, 0.5)
    ctx.lineTo(constants.XOFFSET + 0.5, viewport.pHeight + 0.5)
    ctx.lineTo(viewport.cWidth + 0.5, viewport.pHeight + 0.5)
    ctx.stroke()

    ctx.lineWidth = 0.5
    for (const tickOffset of computeChannelTicks(viewport.pHeight, viewport.nrVisibleChannels)) {
        ctx.beginPath()
        ctx.moveTo(constants.XOFFSET - 2, tickOffset)
        ctx.lineTo(constants.XOFFSET + 2, tickOffset)
        ctx.stroke()
    }

    const grid = computeAxisGrid({
        start: viewport.start,
        duration: viewport.duration,
        tsEnd: viewport.tsEnd,
        rsPeriod: viewport.rsPeriod,
        xOffset: constants.XOFFSET,
        baseGridSpacing: constants.XGRIDSPACING,
        pxPerLabel: constants.NRPXPERLABEL
    })

    for (const line of grid.lines) {
        ctx.save()
        ctx.beginPath()
        ctx.lineWidth = 0.5
        ctx.strokeStyle = 'rgb(235,235,235)'
        ctx.moveTo(line.x + 0.5, 0.5)
        ctx.lineTo(line.x + 0.5, viewport.pHeight - 0.5)
        ctx.stroke()
        ctx.restore()

        if (line.label === null) {
            continue
        }

        ctx.beginPath()
        ctx.lineWidth = 1
        ctx.moveTo(line.x + 0.5, viewport.pHeight - 3)
        ctx.lineTo(line.x + 0.5, viewport.pHeight + 3)
        ctx.stroke()

        ctx.font = '12px sans-serif'
        ctx.fillStyle = 'rgb(150,150,150)'
        ctx.fillText(line.label, line.x - 20.5, viewport.cHeight - 0.2)
    }
}
