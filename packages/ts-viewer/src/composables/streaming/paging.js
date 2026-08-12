// @/composables/streaming/paging.js

/** Client page span at the narrowest zoom, in microseconds. */
export const BASE_PAGE_SIZE = 15000000

/** Most pages a viewport spans before the page span doubles. */
const TARGET_VIEW_PAGES = 4

/**
 * Page span for a viewport, in microseconds.
 *
 * Doubles from `BASE_PAGE_SIZE` until at most `TARGET_VIEW_PAGES` pages cover the
 * viewport, so a wide window becomes a handful of reader queries rather than one
 * 15-second query per column of the canvas. Spans are power-of-two multiples of the
 * base, so every coarse page boundary lies on a boundary of every finer span and page
 * starts stay aligned across zoom levels.
 *
 * @param {number} durationUs Viewport duration, in microseconds.
 * @returns {number} Page span, at least `BASE_PAGE_SIZE`.
 */
export function adaptivePageSize(durationUs) {
    if (!Number.isFinite(durationUs) || durationUs <= 0) {
        return BASE_PAGE_SIZE
    }
    const pagesAtBase = durationUs / (TARGET_VIEW_PAGES * BASE_PAGE_SIZE)
    if (pagesAtBase <= 1) {
        return BASE_PAGE_SIZE
    }
    return BASE_PAGE_SIZE * Math.pow(2, Math.ceil(Math.log2(pagesAtBase)))
}
