import { describe, it, expect, vi } from 'vitest'
import { computeAxisGrid, computeChannelTicks, drawAxis, getUTCTimeString } from './axisRenderer'
import type { AxisGridInput } from './axisRenderer'

// One second of grid over a 1000 px canvas showing 10 s: 100 px between lines.
const baseInput: AxisGridInput = {
    start: 0,
    duration: 10_000_000,
    tsEnd: 100_000_000,
    rsPeriod: 10_000,
    xOffset: 40,
    baseGridSpacing: 1_000_000,
    pxPerLabel: 150
}

// Enough of a 2D context for drawAxis, with the style fields it assigns.
const recordingContext = () => ({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    font: ''
})

describe('computeAxisGrid', () => {
    it('places a line every grid period across the viewport', () => {
        const grid = computeAxisGrid(baseInput)

        expect(grid.gridSpacing).toBe(1_000_000)
        expect(grid.lines.map((line) => line.x)).toEqual([40, 140, 240, 340, 440, 540, 640, 740, 840, 940, 1040])
        expect(grid.lines.map((line) => line.timeUs)).toEqual([
            0, 1_000_000, 2_000_000, 3_000_000, 4_000_000,
            5_000_000, 6_000_000, 7_000_000, 8_000_000, 9_000_000, 10_000_000
        ])
    })

    it('labels one line in labelDecimator', () => {
        const grid = computeAxisGrid(baseInput)

        expect(grid.labelDecimator).toBe(2)
        expect(grid.lines.filter((line) => line.label !== null).map((line) => line.label)).toEqual([
            '00:00:01', '00:00:03', '00:00:05', '00:00:07', '00:00:09'
        ])
    })

    it('labels every line when a label fits between two lines', () => {
        const grid = computeAxisGrid({ ...baseInput, pxPerLabel: 50 })

        expect(grid.labelDecimator).toBe(1)
        expect(grid.lines.every((line) => line.label !== null)).toBe(true)
    })

    it('stops at the end of the recording', () => {
        const grid = computeAxisGrid({ ...baseInput, tsEnd: 3_500_000 })

        expect(grid.lines.map((line) => line.timeUs)).toEqual([0, 1_000_000, 2_000_000, 3_000_000])
    })

    it('omits a line that lands on the canvas left edge', () => {
        const grid = computeAxisGrid({ ...baseInput, xOffset: 0 })

        expect(grid.lines[0].x).toBe(100)
        expect(grid.lines[0].timeUs).toBe(1_000_000)
    })

    it('offsets the first line to the next absolute grid time', () => {
        const grid = computeAxisGrid({ ...baseInput, start: 2_400_000 })

        expect(grid.lines[0].timeUs).toBe(3_000_000)
        expect(grid.lines[0].x).toBe(100)
    })

    it('coarsens the spacing one base step per 100 s of viewport', () => {
        expect(computeAxisGrid({ ...baseInput, duration: 250_000_000 }).gridSpacing).toBe(3_000_000)
        expect(computeAxisGrid({ ...baseInput, duration: 100_000_000 }).gridSpacing).toBe(1_000_000)
    })
})

describe('computeChannelTicks', () => {
    it('centers the first tick in the first channel band', () => {
        expect(computeChannelTicks(100, 4)).toEqual([13, 38, 63, 88])
    })

    it('rounds the first tick to a whole pixel', () => {
        expect(computeChannelTicks(100, 1)).toEqual([50])
    })

    it('returns no tick without a visible channel', () => {
        expect(computeChannelTicks(100, 0)).toEqual([])
    })
})

describe('getUTCTimeString', () => {
    it('pads each field to two digits', () => {
        expect(getUTCTimeString(new Date(Date.UTC(2020, 0, 1, 4, 5, 6)))).toBe('04:05:06')
    })

    it('reads the UTC clock and not the local one', () => {
        expect(getUTCTimeString(new Date(0))).toBe('00:00:00')
    })
})

describe('drawAxis', () => {
    it('writes a time label under every labeled line', () => {
        const ctx = recordingContext()

        drawAxis(ctx as unknown as CanvasRenderingContext2D, {
            viewport: {
                start: baseInput.start,
                duration: baseInput.duration,
                tsEnd: baseInput.tsEnd,
                rsPeriod: baseInput.rsPeriod,
                cWidth: 1000,
                cHeight: 500,
                pHeight: 480,
                nrVisibleChannels: 2
            },
            constants: { XOFFSET: 40, XGRIDSPACING: 1_000_000, NRPXPERLABEL: 150 },
            pixelRatio: 1
        })

        // The label baseline sits just above the bottom edge of the canvas.
        const baseline = 500 - 0.2
        expect(ctx.fillText.mock.calls).toEqual([
            ['00:00:01', 119.5, baseline],
            ['00:00:03', 319.5, baseline],
            ['00:00:05', 519.5, baseline],
            ['00:00:07', 719.5, baseline],
            ['00:00:09', 919.5, baseline]
        ])
    })

    it('scales the canvas by the pixel ratio before drawing', () => {
        const ctx = recordingContext()

        drawAxis(ctx as unknown as CanvasRenderingContext2D, {
            viewport: {
                start: 0,
                duration: 10_000_000,
                tsEnd: 0,
                rsPeriod: 10_000,
                cWidth: 1000,
                cHeight: 500,
                pHeight: 480,
                nrVisibleChannels: 2
            },
            constants: { XOFFSET: 40, XGRIDSPACING: 1_000_000, NRPXPERLABEL: 150 },
            pixelRatio: 2
        })

        expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
        expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1000, 500)
    })
})
