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
