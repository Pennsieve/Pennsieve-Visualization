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
        signal?: AbortSignal
    } = {
        channels,
        startUs,
        endUs,
        pixelWidthUs: Math.ceil((endUs - startUs) / SURVEY_COLUMNS)
    }
    if (signal) {
        query.signal = signal
    }
    for await (const segment of client.query(query)) {
        segments.push(segment)
    }
    return peakToPeakByChannel(segments)
}
