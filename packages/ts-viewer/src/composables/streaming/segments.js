// @/composables/streaming/segments.js

/**
 * Index of the first bin of `segment` whose start time is at or after `boundaryUs`.
 *
 * The guess is computed in sample units and only then rounded: walking the window in
 * microseconds accumulates float drift, which is invisible at 1000 Hz (integer period)
 * and real at 512 Hz from an epoch start, where one microsecond is below the ULP of the
 * timestamp. The guess is then corrected against the exact `startUs + i * period`
 * predicate, which costs at most a step or two.
 *
 * Both page bounds are resolved by this one function, so the bin straddling a page seam
 * is claimed by the earlier page only: page A's exclusive end index and page B's first
 * index are the same expression evaluated on the same boundary value.
 *
 * @param {{startUs: number, samplePeriodUs: number}} segment - Reader segment.
 * @param {number} boundaryUs - Page boundary, in microseconds.
 * @param {number} binCount - Number of bins in the segment; the result is clamped to it.
 * @returns {number} Index in [0, binCount].
 */
function firstBinAtOrAfter(segment, boundaryUs, binCount) {
    const period = segment.samplePeriodUs
    let i = Math.ceil((boundaryUs - segment.startUs) / period)
    if (!Number.isFinite(i) || i < 0) {
        i = 0
    }
    if (i > binCount) {
        i = binCount
    }
    while (i > 0 && segment.startUs + (i - 1) * period >= boundaryUs) {
        i--
    }
    while (i < binCount && segment.startUs + i * period < boundaryUs) {
        i++
    }
    return i
}

/**
 * Three zero-filled Float32Array rows of `nrVal` entries, for the renderer to fill.
 *
 * @param {number} nrVal - Row length.
 * @returns {Float32Array[]} Three independent rows.
 */
function makeCData(nrVal) {
    const cData = new Array(3)
    let k = 0
    while (k < 3) {
        cData[k] = new Float32Array(nrVal)
        k++
    }
    return cData
}

/**
 * Translates one reader Segment into the legacy protobuf segment block, clipped to the
 * requested page.
 *
 * The reader delivers on bin boundaries, so a segment may start before `req.startTime`
 * and may run one bin past `req.endTime`. Bins are kept when their start time
 * `t = segment.startUs + i * segment.samplePeriodUs` satisfies
 * `req.startTime <= t < req.endTime`. That half-open rule is what makes adjacent pages
 * tile with no duplicated timestamp and no hole.
 *
 * Y values are negated (screen coordinates grow downwards) and minMax data stays
 * interleaved across rows 1 and 2. `pageStart` must equal `req.startTime` exactly: it is
 * the key of the viewer's `requestedPages` map, and a page never completes if it differs.
 *
 * @param {{startUs: number, samplePeriodUs: number, isMinMax: boolean, data: Float64Array}} segment - Reader segment.
 * @param {{chId: string, label: string, clientId: string, unit: string}} identity - Trace identity echoing the request.
 * @param {{startTime: number, endTime: number}} req - Parsed page request.
 * @param {{useMedian?: boolean}} [options] - `useMedian` defaults to false.
 * @returns {object} Legacy segment block; `nrPoints === 0` when nothing survives clipping.
 */
export function buildContinuousSegm(segment, identity, req, options = {}) {
    const period = segment.samplePeriodUs
    const binCount = segment.isMinMax ? segment.data.length / 2 : segment.data.length
    const clippable = binCount > 0 && period > 0
    const first = clippable ? firstBinAtOrAfter(segment, req.startTime, binCount) : 0
    const endExcl = clippable ? firstBinAtOrAfter(segment, req.endTime, binCount) : 0
    const nrVal = endExcl - first
    const startTs = segment.startUs + first * period

    const parsedData = new Array(3)
    let sumElem = 0
    let nrValidPoints = 0
    let i = 0
    while (i < 3) {
        parsedData[i] = new Float64Array(nrVal)
        i++
    }

    if (segment.isMinMax) {
        let curI = first * 2
        for (let i = 0; i < nrVal; i++) {
            let curY = -segment.data[curI]
            let curY2 = -segment.data[curI + 1]
            parsedData[0][i] = startTs + (i * period)
            parsedData[1][i] = curY
            parsedData[2][i] = curY2
            if (!isNaN(curY)) {
                nrValidPoints++
                sumElem += curY + (curY2 - curY) / 2
            }
            curI += 2
        }
    } else {
        for (let i = 0; i < nrVal; i++) {
            let curY = -segment.data[first + i]
            parsedData[0][i] = startTs + (i * period)
            parsedData[1][i] = curY
            if (!isNaN(curY)) {
                nrValidPoints++
                sumElem += curY
            }
        }
    }

    let elemMedian = 0
    if (options.useMedian) {
        // Mirrors the legacy median verbatim, lexicographic sort and all: no comparator,
        // and an index of round(len/2) rather than the midpoint. The two data paths must
        // report the same number, so this is not to be "fixed" to a numeric sort.
        const sortedYvals = Array.prototype.slice.call(parsedData[1]).sort()
        elemMedian = sortedYvals[Math.round(sortedYvals.length / 2)]
    }

    return {
        chId: identity.chId,
        lastUsed: 0,
        unit: identity.unit,
        samplePeriod: period,
        pageStart: req.startTime,
        pageEnd: req.endTime,
        startTs: startTs,
        isMinMax: segment.isMinMax,
        unitM: 1,
        type: 'Continuous',
        nrPoints: nrVal,
        cData: makeCData(nrVal),
        parsedData: parsedData,
        median: elemMedian,
        sumElem: sumElem,
        nrValidPoints: nrValidPoints,
        name: identity.label,
        label: identity.label
    }
}

/**
 * Empty stand-in with the same key set as {@link buildContinuousSegm}, dispatched when a
 * trace yields nothing or its query fails.
 *
 * The viewer decrements a per-page, per-channel counter on every response, so a trace
 * that emits nothing leaves the page pending until the stuck-request sweeper fires. This
 * block drains the counter instead; it is dispatched with envelope type `gap` and is
 * never cached.
 *
 * @param {{chId: string, label: string, clientId: string, unit: string}} identity - Trace identity echoing the request.
 * @param {{startTime: number, endTime: number}} req - Parsed page request.
 * @returns {object} Legacy segment block with no points.
 */
export function buildGapSegm(identity, req) {
    return {
        chId: identity.chId,
        lastUsed: 0,
        unit: identity.unit,
        samplePeriod: 0,
        pageStart: req.startTime,
        pageEnd: req.endTime,
        startTs: req.startTime,
        isMinMax: false,
        unitM: 1,
        type: 'Continuous',
        nrPoints: 0,
        cData: makeCData(0),
        parsedData: [new Float64Array(0), new Float64Array(0), new Float64Array(0)],
        median: 0,
        sumElem: 0,
        nrValidPoints: 0,
        name: identity.label,
        label: identity.label
    }
}

/**
 * Translates one reader EventBatch into the legacy Neural block.
 *
 * The legacy wire carried interleaved time pairs and split them across two rows; the
 * reader gives one timestamp per event, so `nrPoints` is the full length of
 * `batch.times`. The renderer's UNIT path reads only `parsedData[0]` (plus `nrPoints`)
 * and writes the spike extents into `cData`, so row 1 is a duplicate kept solely to
 * preserve the legacy two-row shape.
 *
 * `name` and `label` are absent from the legacy Neural block: a required deviation, since
 * the viewer matches responses on chId AND label, and every unit-channel response would
 * otherwise be discarded as stale.
 *
 * @param {{samplePeriodUs: number, isResampled: boolean, times: Float64Array}} batch - Reader event batch.
 * @param {{chId: string, label: string, clientId: string, unit: string}} identity - Trace identity echoing the request.
 * @param {{startTime: number, endTime: number}} req - Parsed page request.
 * @returns {object} Legacy Neural block.
 */
export function buildNeuralSegm(batch, identity, req) {
    const nrVal = batch.times.length
    const times = Float64Array.from(batch.times)
    const parsedData = [times, Float64Array.from(batch.times)]

    return {
        chId: identity.chId,
        lastUsed: 0,
        unit: 'uV',
        samplePeriod: batch.samplePeriodUs,
        pageStart: req.startTime,
        pageEnd: req.endTime,
        startTs: req.startTime,
        isMinMax: batch.isResampled,
        unitM: 1,
        type: 'Neural',
        nrPoints: nrVal,
        parsedData: parsedData,
        cData: makeCData(nrVal),
        name: identity.label,
        label: identity.label
    }
}
