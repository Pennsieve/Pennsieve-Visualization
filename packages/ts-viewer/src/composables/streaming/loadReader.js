/**
 * Loads the Zarr reader on first use, and only then.
 *
 * The reader plus zarrita is roughly 110 kB of the bundle, and the Zarr data path is opt-in:
 * a package whose viewer asset is not a Zarr bundle never touches it. Imported statically it
 * would sit in the package's entry chunk, so every consumer -- including every package still
 * on the legacy WebSocket -- would download it to use nothing. A dynamic import puts it in
 * its own chunk that is fetched the first time a bundle is actually opened.
 *
 * The numcodecs codecs (zstd/blosc/lz4) split off further on their own, and only zstd is
 * fetched for these bundles.
 *
 * @type {?Promise<object>}
 */
let readerPromise = null

/**
 * @returns {Promise<typeof import('@pennsieve/timeseries-zarr-reader')>} The reader module,
 *   loaded once and shared by every caller.
 */
export function loadReader() {
    if (readerPromise === null) {
        readerPromise = import('@pennsieve/timeseries-zarr-reader')
    }
    return readerPromise
}
