import { describe, it, expect } from 'vitest'
import { useCanvasRenderer } from './useCanvasRenderer'
import { buildContinuousSegm } from './streaming/segments.js'

// Records every 2D context call so path construction can be asserted.
const recordingContext = () => {
    const ops = []
    const record = (op) => (...args) => { ops.push({ op, args }) }
    return {
        ops,
        setTransform: record('setTransform'),
        clearRect: record('clearRect'),
        fillRect: record('fillRect'),
        save: record('save'),
        restore: record('restore'),
        beginPath: record('beginPath'),
        moveTo: record('moveTo'),
        lineTo: record('lineTo'),
        closePath: record('closePath'),
        fill: record('fill'),
        stroke: record('stroke'),
        fillStyle: '',
        strokeStyle: ''
    }
}

// Splits recorded ops into paths: one entry per beginPath, ended by fill or stroke.
const paths = (ops) => {
    const out = []
    let cur = null
    for (const o of ops) {
        if (o.op === 'beginPath') {
            cur = { ops: [], end: null }
            out.push(cur)
        } else if (cur && (o.op === 'fill' || o.op === 'stroke')) {
            cur.end = o.op
        } else if (cur && (o.op === 'moveTo' || o.op === 'lineTo' || o.op === 'closePath')) {
            cur.ops.push(o)
        }
    }
    return out
}

const identity = { chId: 'srv-1', label: 'Ch 1', clientId: 'ch1', unit: 'uV' }

// One min/max page of zero-valued bins: startUs on the shared bin grid.
const minMaxPage = (startUs, binCount, periodUs) => buildContinuousSegm(
    { startUs, samplePeriodUs: periodUs, isMinMax: true, data: new Float64Array(binCount * 2) },
    identity,
    { startTime: startUs, endTime: startUs + binCount * periodUs }
)

// Geometry: 4000 us bins at 4000 us/px put bins 1px apart, page A at x 0..99
// and an adjacent page B at x 100..199. rowBaseline lands at 50 and zero-valued
// min/max bins collapse to y 50, y2 51.
const PERIOD = 4000
const BINS = 100

const renderBlocks = (blocks, { sampleRateHz = 1000 } = {}) => {
    const { plotCanvasRef, blurCanvasRef, renderData } = useCanvasRenderer()
    const ctx = recordingContext()
    const ctxb = recordingContext()
    plotCanvasRef.value = { getContext: () => ctx }
    blurCanvasRef.value = { getContext: () => ctxb }

    const viewerChannels = [{
        id: 'ch1',
        type: 'CONTINUOUS',
        visible: true,
        rank: 0,
        rowScale: 1,
        rowBaseline: null,
        sf: sampleRateHz,
        selected: false,
        hover: false,
        dataSegments: []
    }]
    const viewData = {
        start: 0,
        duration: 900000,
        channels: [{ id: 'ch1', mean: null, median: null, blocks }]
    }
    const viewport = {
        start: 0,
        duration: 900000,
        cWidth: 225,
        cHeight: 100,
        pHeight: 80,
        rsPeriod: PERIOD,
        nrVisibleChannels: 1
    }
    renderData(viewData, viewerChannels, { XOFFSET: 0, USEMEDIAN: false }, viewport, 1, 1)
    return paths(ctx.ops)
}

describe('renderData min/max blocks', () => {
    it('joins the fill and the max trace across adjacent blocks', () => {
        const drawn = renderBlocks([
            minMaxPage(0, BINS, PERIOD),
            minMaxPage(400000, BINS, PERIOD)
        ])
        const fills = drawn.filter((p) => p.end === 'fill')
        const strokes = drawn.filter((p) => p.end === 'stroke')
        expect(fills).toHaveLength(2)
        expect(strokes).toHaveLength(2)

        expect(fills[1].ops[0]).toEqual({ op: 'moveTo', args: [99, 50] })
        expect(fills[1].ops[fills[1].ops.length - 2]).toEqual({ op: 'lineTo', args: [99, 51] })

        expect(strokes[0].ops[0]).toEqual({ op: 'moveTo', args: [0, 50] })
        expect(strokes[1].ops[0]).toEqual({ op: 'moveTo', args: [99, 50] })
        expect(strokes[1].ops[1]).toEqual({ op: 'lineTo', args: [100, 50] })
    })

    it('includes the last bin in the fill bottom edge', () => {
        const drawn = renderBlocks([minMaxPage(0, BINS, PERIOD)])
        const fill = drawn.find((p) => p.end === 'fill')
        expect(fill.ops[BINS]).toEqual({ op: 'lineTo', args: [99, 50] })
        expect(fill.ops[BINS + 1]).toEqual({ op: 'lineTo', args: [99, 51] })
    })

    it('keeps blocks separated by a data gap apart', () => {
        const drawn = renderBlocks([
            minMaxPage(0, BINS, PERIOD),
            minMaxPage(412000, BINS, PERIOD)
        ])
        const fills = drawn.filter((p) => p.end === 'fill')
        const strokes = drawn.filter((p) => p.end === 'stroke')

        expect(fills[1].ops[0]).toEqual({ op: 'moveTo', args: [103, 50] })
        expect(fills[1].ops.some((o) => o.args[0] === 99)).toBe(false)
        expect(strokes[1].ops[0]).toEqual({ op: 'moveTo', args: [103, 50] })
    })

    it('joins the max trace across blocks when bins are under 3 sample periods', () => {
        const drawn = renderBlocks([
            minMaxPage(0, BINS, PERIOD),
            minMaxPage(400000, BINS, PERIOD)
        ], { sampleRateHz: 500 })
        const fills = drawn.filter((p) => p.end === 'fill')
        const strokes = drawn.filter((p) => p.end === 'stroke')
        expect(fills).toHaveLength(0)
        expect(strokes).toHaveLength(4)

        expect(strokes[3].ops[0]).toEqual({ op: 'moveTo', args: [99, 50] })
        expect(strokes[3].ops[1]).toEqual({ op: 'lineTo', args: [100, 50] })
    })
})
