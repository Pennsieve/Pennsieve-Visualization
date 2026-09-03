// @/composables/streaming/paging.ts

/** Client page span at the narrowest zoom, in microseconds. */
export const BASE_PAGE_SIZE = 15000000

/** Most pages a viewport spans before the page span doubles. */
const TARGET_VIEW_PAGES = 1

/**
 * Page span for a viewport, in microseconds.
 *
 * Doubles from `BASE_PAGE_SIZE` until at most `TARGET_VIEW_PAGES` pages cover the
 * viewport. The span is therefore at least the viewport duration, and a window lands in
 * one page or two rather than filling column by column as several narrow pages answer.
 * Spans are power-of-two multiples of the base, so every coarse page boundary lies on a
 * boundary of every finer span and page starts stay aligned across zoom levels.
 *
 * A span of at least the viewport costs some overfetch at the page edges, up to about
 * 3x the visible window where the power-of-two rounding is least kind.
 *
 * @param durationUs Viewport duration, in microseconds.
 * @returns Page span, at least `BASE_PAGE_SIZE`.
 */
export function adaptivePageSize(durationUs: number): number {
    if (!Number.isFinite(durationUs) || durationUs <= 0) {
        return BASE_PAGE_SIZE
    }
    const pagesAtBase = durationUs / (TARGET_VIEW_PAGES * BASE_PAGE_SIZE)
    if (pagesAtBase <= 1) {
        return BASE_PAGE_SIZE
    }
    return BASE_PAGE_SIZE * Math.pow(2, Math.ceil(Math.log2(pagesAtBase)))
}

/** Bytes of one float32 sample, the reader's unit for the raw-read byte cap. */
const BYTES_PER_SAMPLE = 4

/**
 * Widest page span whose forced-raw read fits a byte cap, in microseconds.
 *
 * A filter or a montage reads raw samples for every trace of a page, and the reader
 * rejects a read over `maxRawBytes` before it fetches anything. The span is the largest
 * power-of-two multiple of `BASE_PAGE_SIZE` whose bytes fit, so it nests with the spans
 * `adaptivePageSize` returns. It is never less than `BASE_PAGE_SIZE`: a page that cannot
 * fit at the base span is left to fail once and be recorded.
 *
 * @param traceCount Traces the page carries.
 * @param rateHz Highest sample rate among them.
 * @param montaged Whether each trace reads two channels.
 * @param maxRawBytes The reader's byte cap on one forced-raw read.
 */
export function rawBudgetPageSize(traceCount: number, rateHz: number, montaged: boolean, maxRawBytes: number): number {
    if (!(traceCount > 0) || !(rateHz > 0) || !(maxRawBytes > 0)) {
        return BASE_PAGE_SIZE
    }
    const bytesPerUs = (traceCount * rateHz * BYTES_PER_SAMPLE * (montaged ? 2 : 1)) / 1e6
    const pagesThatFit = maxRawBytes / bytesPerUs / BASE_PAGE_SIZE
    if (pagesThatFit < 2) {
        return BASE_PAGE_SIZE
    }
    return BASE_PAGE_SIZE * Math.pow(2, Math.floor(Math.log2(pagesThatFit)))
}
