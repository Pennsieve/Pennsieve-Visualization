// @/composables/streaming/autoscale.ts

import type { QueryOptions, Segment } from '@pennsieve/timeseries-zarr-reader'

/** Millimeters per inch, for converting a pixel scale to the toolbar's uV/mm reading. */
const MM_PER_INCH = 25.4

/**
 * Fraction of a channel's row that the median channel's full swing should occupy.
 *
 * Below 1 the median trace stays inside its row. Above it, neighbouring traces overlap and
 * the canvas fills far more area than it shows, which is what makes a too-sensitive default
 * slow to render.
 */
const ROW_FILL = 0.8

/**
 * Widest peak-to-peak swing to trust from one channel, in microvolts.
 *
 * A channel pinned to a rail, or one carrying a units mismatch, would otherwise drag the
 * whole view down to an unreadable scale.
 */
const MAX_TRUSTED_P2P_UV = 100_000

/** The fields of a reader `Segment` the amplitude pass reads. */
export type EnvelopeSegment = Pick<Segment, 'channel' | 'isMinMax'> & { readonly data: ArrayLike<number> }

/**
 * Peak-to-peak amplitude of each trace in a set of min/max envelope segments.
 *
 * Segments are the reader's `Segment` shape. Envelope data is read as interleaved
 * `[min, max, ...]` pairs; raw data is read as plain samples. Non-finite values are gaps
 * and are skipped, so a channel that is entirely gap contributes nothing.
 *
 * @returns Peak-to-peak microvolts per channel, omitting empty ones.
 */
export function peakToPeakByChannel(
    segments: readonly EnvelopeSegment[] | null | undefined
): Map<string, number> {
    const out = new Map<string, number>()
    for (const segment of segments || []) {
        const data = segment?.data
        if (!data || data.length === 0) {
            continue
        }
        let low = Infinity
        let high = -Infinity
        for (let i = 0; i < data.length; i++) {
            const value = data[i]
            if (Number.isFinite(value)) {
                if (value < low) low = value
                if (value > high) high = value
            }
        }
        if (low === Infinity) {
            continue
        }
        out.set(segment.channel, high - low)
    }
    return out
}

/** Median of a numeric list. Returns null for an empty list. */
function median(values: readonly number[]): number | null {
    if (values.length === 0) {
        return null
    }
    const sorted = [...values].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Vertical zoom multiplier that renders the median channel's swing inside its row.
 *
 * The multiplier converts microvolts to the same pixel units `rowBaseline` is measured in,
 * which is what `getPointCoords` multiplies by, so no display-density term is needed here.
 *
 * Amplitudes at or below zero, non-finite ones, and any above `MAX_TRUSTED_P2P_UV` are
 * ignored. Returns null when nothing usable is left or `rowHeight` is not positive, and the
 * caller should then keep the scale it has.
 *
 * @param amplitudes Peak-to-peak microvolts per
 *   channel, either as the Map {@link measureAmplitudes} returns or as bare values.
 * @param rowHeight Height of one channel row, in canvas pixels.
 * @param fill Fraction of the row the median swing should fill.
 */
export function zoomMultForAmplitudes(
    amplitudes: Map<string, number> | Iterable<number> | null | undefined,
    rowHeight: number,
    fill = ROW_FILL
): number | null {
    if (!(rowHeight > 0) || !(fill > 0) || !amplitudes) {
        return null
    }
    // Spreading a Map yields [key, value] pairs, so take its values explicitly.
    const values = amplitudes instanceof Map ? amplitudes.values() : amplitudes
    const usable = [...values].filter(
        (v) => Number.isFinite(v) && v > 0 && v <= MAX_TRUSTED_P2P_UV
    )
    const typical = median(usable)
    if (typical === null) {
        return null
    }
    return (rowHeight * fill) / typical
}

/**
 * Converts a vertical zoom multiplier to the sensitivity the toolbar displays.
 *
 * Mirrors the toolbar's own conversion, so a caller can log or seed a value in the units a
 * user sees.
 *
 * @param dpi Reference pixels per inch.
 * @returns Microvolts per millimeter.
 */
export function zoomMultToUvPerMm(zoomMult: number, dpi: number, devicePixelRatio: number): number {
    return (dpi * devicePixelRatio) / (zoomMult * MM_PER_INCH)
}

/**
 * Converts a sensitivity in microvolts per millimeter to a vertical zoom multiplier.
 *
 * @param dpi Reference pixels per inch.
 */
export function uvPerMmToZoomMult(uvPerMm: number, dpi: number, devicePixelRatio: number): number {
    return (dpi * devicePixelRatio) / (uvPerMm * MM_PER_INCH)
}

/**
 * Swing, as a multiple of its unit group's median, past which a channel is fitted to
 * its own row rather than sharing the group's scale.
 */
const OUTLIER_RATIO = 8

/** The unit whose channels set the shared scale whenever the recording carries it. */
const REFERENCE_UNIT = 'uV'

export interface RowScaling {
    /** Vertical zoom multiplier that fits the reference swing to a row. */
    zoomMult: number
    /** Unit of the channels whose median swing set `zoomMult`. */
    referenceUnit: string
    /** Row scale per surveyed channel id. A channel not listed keeps 1. */
    rowScales: Map<string, number>
}

/** The unit carried by the most channels; the first seen wins a tie. */
function largestGroup(byUnit: Map<string, unknown[]>): string {
    let best = ''
    let size = -1
    for (const [unit, group] of byUnit) {
        if (group.length > size) {
            best = unit
            size = group.length
        }
    }
    return best
}

/**
 * Shared scale and per-channel row scales from a whole-recording amplitude survey.
 *
 * Channels in the reference unit share one scale, fitted from their median swing the way
 * {@link zoomMultForAmplitudes} fits it, so their traces stay comparable. One of them
 * swinging more than OUTLIER_RATIO times that median is fitted to its own row instead.
 * Channels in any other unit are scaled by unit: the unit's median swing fills a row the
 * way the reference median does, and an outlier within the unit is fitted on its own. A
 * channel without a usable swing is not listed and keeps 1.
 *
 * The reference unit is `uV` when any surveyed channel carries it, otherwise the unit
 * carried by the most channels. The trusted ceiling `MAX_TRUSTED_P2P_UV` applies to the
 * reference median only when the reference unit is `uV`.
 *
 * @param amplitudes Peak-to-peak per channel id, each in its channel's own unit.
 * @param unitById Unit per channel id; a channel missing here counts as unit ''.
 * @param rowHeight Height of one channel row, in canvas pixels.
 * @param fill Fraction of the row the reference median swing should fill.
 * @returns null when no reference channel has a usable swing or `rowHeight` is not positive.
 */
export function rowScalingForAmplitudes(
    amplitudes: Map<string, number>,
    unitById: Map<string, string>,
    rowHeight: number,
    fill = ROW_FILL
): RowScaling | null {
    if (!(rowHeight > 0) || !(fill > 0)) {
        return null
    }
    const byUnit = new Map<string, Array<[string, number]>>()
    for (const [id, p2p] of amplitudes) {
        if (!(Number.isFinite(p2p) && p2p > 0)) {
            continue
        }
        const unit = unitById.get(id) ?? ''
        const group = byUnit.get(unit) ?? []
        group.push([id, p2p])
        byUnit.set(unit, group)
    }
    if (byUnit.size === 0) {
        return null
    }
    const referenceUnit = byUnit.has(REFERENCE_UNIT) ? REFERENCE_UNIT : largestGroup(byUnit)
    const reference = byUnit.get(referenceUnit)!.map(([, p2p]) => p2p)
    const trusted = referenceUnit === REFERENCE_UNIT ? reference.filter((p2p) => p2p <= MAX_TRUSTED_P2P_UV) : reference
    const typical = median(trusted)
    if (typical === null) {
        return null
    }

    const rowScales = new Map<string, number>()
    for (const [unit, group] of byUnit) {
        const groupTypical = unit === referenceUnit ? typical : median(group.map(([, p2p]) => p2p))!
        const unitScale = typical / groupTypical
        for (const [id, p2p] of group) {
            rowScales.set(id, p2p > OUTLIER_RATIO * groupTypical ? typical / p2p : unitScale)
        }
    }
    return { zoomMult: (rowHeight * fill) / typical, referenceUnit, rowScales }
}

/** Columns the amplitude pass asks for across the whole recording. */
const SURVEY_COLUMNS = 2000

/**
 * Reads one coarse min/max pass over a recording and reports each channel's swing.
 *
 * The pixel width asked for is wide enough that the reader picks its coarsest pyramid
 * level, which is the same level and the same chunks the availability scan reads, so a
 * client that has already drawn the scrubber serves this from its cache.
 *
 * @param client A reader `StreamingClient`.
 * @param channels Continuous channel ids. Unit channels must be excluded.
 * @returns Peak-to-peak microvolts per channel.
 */
export async function measureAmplitudes(
    client: { query(options: QueryOptions): AsyncIterable<EnvelopeSegment> } | null | undefined,
    channels: readonly string[],
    startUs: number,
    endUs: number,
    signal: AbortSignal | null = null
): Promise<Map<string, number>> {
    if (!client || !Array.isArray(channels) || channels.length === 0) {
        return new Map()
    }
    if (!(endUs > startUs)) {
        return new Map()
    }
    const segments: EnvelopeSegment[] = []
    const query: {
        channels: readonly string[]
        startUs: number
        endUs: number
        pixelWidthUs: number
        priority: 'background'
        signal?: AbortSignal
    } = {
        channels,
        startUs,
        endUs,
        pixelWidthUs: Math.ceil((endUs - startUs) / SURVEY_COLUMNS),
        // A survey of the whole recording is never what the user is looking at.
        priority: 'background'
    }
    if (signal) {
        query.signal = signal
    }
    for await (const segment of client.query(query)) {
        segments.push(segment)
    }
    return peakToPeakByChannel(segments)
}
