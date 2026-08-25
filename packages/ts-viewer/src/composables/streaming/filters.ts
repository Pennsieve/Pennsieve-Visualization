// @/composables/streaming/filters.ts
//
// Translation between the legacy filter wire messages the viewer builds
// (TSViewerCanvas.vue setFilters, TSPlotCanvas.vue clear-channels callback) and
// the reader's FilterSpec.

import type { FilterSpec } from '@pennsieve/timeseries-zarr-reader'

/** Largest order the reader's cascade builder accepts (timeseries-zarr-reader src/filter.ts MAX_ORDER). */
const MAX_ORDER = 12

/** specSignature's value for "this channel has no filter". Not a legal spec key. */
const UNFILTERED_SIGNATURE = 'unfiltered'

const CUTOFF_TYPES = ['lowpass', 'highpass']
const BAND_TYPES = ['bandpass', 'bandstop']

export type CutoffFilterSpec = Extract<FilterSpec, { type: 'lowpass' | 'highpass' }>
export type BandFilterSpec = Extract<FilterSpec, { type: 'bandpass' | 'bandstop' }>

// Wire shapes (TSViewerCanvas.vue setFilters).

export interface LegacyCutoffFilterMessage {
    filter: 'lowpass' | 'highpass'
    filterParameters: readonly [order: number | string, cutoff: number | string]
    channels?: readonly string[]
}

export interface LegacyBandFilterMessage {
    filter: 'bandpass' | 'bandstop'
    filterParameters: readonly [order: number | string, center: number | string, halfWidth: number | string]
    channels?: readonly string[]
}

export interface LegacyClearFilterMessage {
    channelFiltersToClear: readonly string[]
}

export type LegacyFilterMessage =
    | LegacyCutoffFilterMessage
    | LegacyBandFilterMessage
    | LegacyClearFilterMessage

// Every result variant declares the other variants' fields as optional undefined, so a
// caller can read `result.spec` or `result.reason` without narrowing on `kind` first.

export interface LegacyFilterSet<S extends FilterSpec = FilterSpec> {
    kind: 'set'
    spec: S
    channels: string[]
    reason?: undefined
}

export interface LegacyFilterClear {
    kind: 'clear'
    channels: string[]
    spec?: undefined
    reason?: undefined
}

export interface LegacyFilterIgnore {
    kind: 'ignore'
    reason: string
    spec?: undefined
    channels?: undefined
}

export type LegacyFilterResult = LegacyFilterSet | LegacyFilterClear | LegacyFilterIgnore

/**
 * Reads positional wire parameters as finite numbers.
 *
 * The viewer parseFloats input0/input1 but passes notchFreq through raw, so a
 * band centre can arrive as a string; coercing here keeps `center + halfWidth`
 * from becoming string concatenation.
 *
 * @returns `count` finite numbers, or null if unreadable
 */
function readParams(params: unknown, count: number): number[] | null {
    if (!Array.isArray(params) || params.length < count) return null
    const out: number[] = []
    for (let i = 0; i < count; i++) {
        const raw = params[i]
        // Only numbers and numeric strings are readable. Bare Number() would turn JSON `null`
        // into 0, and `null` is exactly what an untouched modal field becomes: the viewer
        // parseFloats it to NaN, and JSON.stringify encodes NaN as null. Coercing that to 0
        // would register a 0 Hz cutoff that the reader then rejects on every read, instead of
        // the message being ignored -- and it would classify differently depending on
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
 * @param msg parsed JSON from the fake socket's send()
 */
export function legacyFilterToSpec(msg: LegacyCutoffFilterMessage): LegacyFilterSet<CutoffFilterSpec>
export function legacyFilterToSpec(msg: LegacyBandFilterMessage): LegacyFilterSet<BandFilterSpec>
export function legacyFilterToSpec(msg: LegacyClearFilterMessage): LegacyFilterClear
export function legacyFilterToSpec(msg: unknown): LegacyFilterResult
export function legacyFilterToSpec(msg: any): LegacyFilterResult {
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

    const channels: string[] = Array.isArray(msg.channels) ? msg.channels.slice() : []
    const order = params[0]

    if (isCutoff) {
        return { kind: 'set', spec: { type: type as CutoffFilterSpec['type'], order, cutoffHz: params[1] }, channels }
    }

    const center = params[1]
    const halfWidth = params[2]
    return {
        kind: 'set',
        spec: { type: type as BandFilterSpec['type'], order, lowHz: center - halfWidth, highHz: center + halfWidth },
        channels
    }
}

/** A FilterSpec as far as the validator trusts one: any spec-shaped object qualifies. */
export interface FilterSpecLike {
    type: string
    order: number
    cutoffHz?: number
    lowHz?: number
    highHz?: number
    [key: string]: unknown
}

export type SpecValidation = { ok: true; reason?: undefined } | { ok: false; reason: string }

/**
 * Checks a FilterSpec against one channel's native sampling rate.
 *
 * Mirrors the RangeErrors createFilter() throws (timeseries-zarr-reader
 * src/filter.ts), in the same order, so the adapter can turn a hard reader
 * failure into a per-channel error message and leave other channels alone.
 *
 * @param rateHz the channel's native rate, not the resampled one
 */
export function validateSpecForRate(
    spec: FilterSpecLike | null | undefined,
    rateHz: number | undefined
): SpecValidation {
    if (spec === null || spec === undefined) {
        return { ok: false, reason: 'no filter spec' }
    }
    if (!Number.isFinite(rateHz) || rateHz! <= 0) {
        return { ok: false, reason: `channel rate must be a positive number (got ${rateHz})` }
    }
    if (!Number.isInteger(spec.order) || spec.order < 1 || spec.order > MAX_ORDER) {
        return {
            ok: false,
            reason: `order must be a whole number from 1 to ${MAX_ORDER} (got ${spec.order})`
        }
    }

    const nyquistHz = rateHz! / 2
    const inRange = (freqHz: number | undefined, label: string) =>
        Number.isFinite(freqHz) && freqHz! > 0 && freqHz! < nyquistHz
            ? null
            : `${label} must be above 0 and below the Nyquist frequency of ${nyquistHz} Hz (got ${freqHz})`

    if (CUTOFF_TYPES.includes(spec.type)) {
        const reason = inRange(spec.cutoffHz, 'cutoffHz')
        return reason === null ? { ok: true } : { ok: false, reason }
    }
    if (BAND_TYPES.includes(spec.type)) {
        const reason = inRange(spec.lowHz, 'lowHz') || inRange(spec.highHz, 'highHz')
        if (reason !== null) return { ok: false, reason }
        if (spec.lowHz! >= spec.highHz!) {
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
 */
export function specSignature(spec: FilterSpecLike | null | undefined): string {
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
