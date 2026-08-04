/**
 * Pennsieve viewer-asset types this viewer knows how to read.
 *
 * A viewer asset is a package-associated artifact in S3 behind CloudFront, signed at the
 * prefix level. Its `asset_type` is a free-form string in the database -- there is no enum,
 * no CHECK constraint, and the service validates only that it is non-empty -- so the
 * vocabulary is a convention shared between whoever imports the asset and whoever renders it.
 * These constants are that convention's viewer half; the host app forwards the raw
 * `asset_type` it read from the API and this module decides what it means.
 *
 * Exported from the package root so the host app matches on the same literal rather than
 * duplicating it.
 */

/** Zarr bundle read directly by the browser, no streaming service involved. */
export const TIMESERIES_ZARR = 'timeseries-zarr'

/** The pre-existing asset type, served by the `pennsieve-streaming` WebSocket. */
export const TIMESERIES_WEBSOCKET = 'timeseries'

/**
 * Whether an asset type selects the client-side Zarr reader.
 *
 * Anything else -- including an absent type, and including `timeseries` -- routes to the
 * legacy WebSocket, so an unrecognized or newly-invented asset type degrades to the old
 * behaviour rather than failing.
 *
 * @param {?string} assetType Raw `asset_type` from the viewer-asset record.
 * @returns {boolean}
 */
export function isZarrAssetType(assetType) {
    return assetType === TIMESERIES_ZARR
}
