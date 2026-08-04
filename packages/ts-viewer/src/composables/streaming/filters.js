// @/composables/streaming/filters.js
//
// Translation between the legacy filter wire messages the viewer builds
// (TSViewerCanvas.vue setFilters, TSPlotCanvas.vue clear-channels callback) and
// the reader's FilterSpec.
//
// FilterSpec = { type: 'lowpass'|'highpass', order, cutoffHz }
//            | { type: 'bandpass'|'bandstop', order, lowHz, highHz }

/** Largest order the reader's cascade builder accepts (timeseries-zarr-reader src/filter.ts MAX_ORDER). */
const MAX_ORDER = 12

/** specSignature's value for "this channel has no filter". Not a legal spec key. */
const UNFILTERED_SIGNATURE = 'unfiltered'

const CUTOFF_TYPES = ['lowpass', 'highpass']
const BAND_TYPES = ['bandpass', 'bandstop']

/**
 * Reads positional wire parameters as finite numbers.
 *
 * The viewer parseFloats input0/input1 but passes notchFreq through raw, so a
 * band centre can arrive as a string; coercing here keeps `center + halfWidth`
 * from becoming string concatenation.
 *
 * @param {unknown} params
 * @param {number} count
 * @returns {number[] | null} `count` finite numbers, or null if unreadable
 */
function readParams(params, count) {
    if (!Array.isArray(params) || params.length < count) return null
    const out = []
    for (let i = 0; i < count; i++) {
        const raw = params[i]
        // Only numbers and numeric strings are readable. Bare Number() would turn JSON `null`
        // into 0, and `null` is exactly what an untouched modal field becomes: the viewer
        // parseFloats it to NaN, and JSON.stringify encodes NaN as null. Coercing that to 0
        // would register a 0 Hz cutoff that the reader then rejects on every read, instead of
        // the message simply being ignored -- and it would classify differently depending on
        // whether the message happened to cross JSON.
        if (typeof raw !== 'number' && typeof raw !== 'string') return null
        const n = Number(raw)
        if (!Number.isFinite(n)) return null
        out.push(n)
    }
    return out
}

/**
 * Translates one legacy filter wire message into a FilterSpec plus the channel
 * ids it applies to.
 *
 * Wire shapes (TSViewerCanvas.vue setFilters):
 *   { filter: 'lowpass'|'highpass', filterParameters: [order, cutoff], channels }
 *   { filter: 'bandpass'|'bandstop', filterParameters: [order, center, halfWidth], channels }
 *   { channelFiltersToClear: [ids] }
 *
 * Band edges are recovered as `center - halfWidth` / `center + halfWidth`,
 * inverting the viewer's `center = (f0 + f1) / 2`, `halfWidth = |f1 - f0| / 2`.
 * The recovery is exact for most inputs but NOT for all: `(0.1, 59.9)` comes
 * back as `(0.10000000000000142, 59.9)` because the halving already rounded.
 * The residual is sub-ulp-scale and irrelevant to the Butterworth design.
 *
 * ASSUMPTION, unverified against the legacy server: the third bandstop
 * parameter is a half-width, so a notch at f spans [f - 10, f + 10]. The viewer
 * hardcodes that 10 (`bs_width = 10`) and never round-trips it through a UI
 * field, so nothing in this repo says whether the server read it as a
 * half-width or as a full width (which would mean [f - 5, f + 5]).
 *
 * Never throws: an unreadable message returns kind 'ignore' with a reason.
 *
 * @param {any} msg parsed JSON from the fake socket's send()
 * @returns {{kind: 'set', spec: object, channels: string[]}
 *          | {kind: 'clear', channels: string[]}
 *          | {kind: 'ignore', reason: string}}
 */
export function legacyFilterToSpec(msg) {
    if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
        return { kind: 'ignore', reason: 'filter message is not an object' }
    }

    if ('channelFiltersToClear' in msg) {
        if (!Array.isArray(msg.channelFiltersToClear)) {
            return { kind: 'ignore', reason: 'channelFiltersToClear is not an array' }
        }
        return { kind: 'clear', channels: msg.channelFiltersToClear.slice() }
    }

    const type = msg.filter
    if (typeof type !== 'string') {
        return { kind: 'ignore', reason: 'filter message has no filter name' }
    }

    const isCutoff = CUTOFF_TYPES.includes(type)
    const isBand = BAND_TYPES.includes(type)
    if (!isCutoff && !isBand) {
        return { kind: 'ignore', reason: `unsupported filter type "${type}"` }
    }

    const params = readParams(msg.filterParameters, isCutoff ? 2 : 3)
    if (params === null) {
        return {
            kind: 'ignore',
            reason: `filter "${type}" needs ${isCutoff ? 2 : 3} numeric filterParameters`
        }
    }

    const channels = Array.isArray(msg.channels) ? msg.channels.slice() : []
    const order = params[0]

    if (isCutoff) {
        return { kind: 'set', spec: { type, order, cutoffHz: params[1] }, channels }
    }

    const center = params[1]
    const halfWidth = params[2]
    return {
        kind: 'set',
        spec: { type, order, lowHz: center - halfWidth, highHz: center + halfWidth },
        channels
    }
}

/**
 * Checks a FilterSpec against one channel's native sampling rate.
 *
 * Mirrors the RangeErrors createFilter() throws (timeseries-zarr-reader
 * src/filter.ts), in the same order, so the adapter can turn a hard reader
 * failure into a per-channel error message and leave other channels alone.
 *
 * @param {object|null|undefined} spec
 * @param {number} rateHz the channel's native rate, not the resampled one
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function validateSpecForRate(spec, rateHz) {
    if (spec === null || spec === undefined) {
        return { ok: false, reason: 'no filter spec' }
    }
    if (!Number.isFinite(rateHz) || rateHz <= 0) {
        return { ok: false, reason: `channel rate must be a positive number (got ${rateHz})` }
    }
    if (!Number.isInteger(spec.order) || spec.order < 1 || spec.order > MAX_ORDER) {
        return {
            ok: false,
            reason: `order must be a whole number from 1 to ${MAX_ORDER} (got ${spec.order})`
        }
    }

    const nyquistHz = rateHz / 2
    const inRange = (freqHz, label) =>
        Number.isFinite(freqHz) && freqHz > 0 && freqHz < nyquistHz
            ? null
            : `${label} must be above 0 and below the Nyquist frequency of ${nyquistHz} Hz (got ${freqHz})`

    if (CUTOFF_TYPES.includes(spec.type)) {
        const reason = inRange(spec.cutoffHz, 'cutoffHz')
        return reason === null ? { ok: true } : { ok: false, reason }
    }
    if (BAND_TYPES.includes(spec.type)) {
        const reason = inRange(spec.lowHz, 'lowHz') || inRange(spec.highHz, 'highHz')
        if (reason !== null) return { ok: false, reason }
        if (spec.lowHz >= spec.highHz) {
            return {
                ok: false,
                reason: `lowHz must be below highHz (got ${spec.lowHz} and ${spec.highHz})`
            }
        }
        return { ok: true }
    }
    return { ok: false, reason: `unsupported filter type "${spec.type}"` }
}

/**
 * Canonical grouping key for a FilterSpec.
 *
 * Equal specs produce equal strings whatever order their keys were written in;
 * any differing field produces a different string. A missing spec maps to the
 * unfiltered sentinel, so filtered and unfiltered channels never share a group.
 *
 * @param {object|null|undefined} spec
 * @returns {string}
 */
export function specSignature(spec) {
    if (spec === null || spec === undefined) return UNFILTERED_SIGNATURE
    if (CUTOFF_TYPES.includes(spec.type)) {
        return `${spec.type}:${spec.order}:${spec.cutoffHz}`
    }
    if (BAND_TYPES.includes(spec.type)) {
        return `${spec.type}:${spec.order}:${spec.lowHz}:${spec.highHz}`
    }
    const keys = Object.keys(spec).sort()
    return `other:${keys.map((k) => `${k}=${String(spec[k])}`).join(':')}`
}
