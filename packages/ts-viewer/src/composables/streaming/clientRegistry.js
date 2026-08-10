import { createStoreForUrl, splitSignedUrl } from './createStore'
import { buildCatalogIndex } from './channelDetails'
import { loadReader } from './loadReader'

/**
 * Per-viewer-instance streaming clients, keyed by the viewer store's id.
 *
 * A module-level Map rather than Pinia state on purpose: Pinia wraps state in a reactive
 * proxy, and calling a method through that proxy breaks classes that use `#private` fields,
 * which `StreamingClient` does. Nothing here is reactive, and nothing here should ever be
 * placed in a store.
 *
 * The entry is shared: TSPlotCanvas's shim reads data through it and TSScrubber reads
 * availability spans through it, so a bundle's catalog is fetched once per viewer instance.
 *
 * @type {Map<string, StreamingClientEntry>}
 */
const registry = new Map()

let nextGeneration = 1

/**
 * @typedef {object} StreamingClientEntry
 * @property {string} storeId Viewer store id that owns this entry.
 * @property {string} url Bundle URL base this client was built for.
 * @property {?Function} onUrlExpired The renewal callback baked into this client's store.
 * @property {import('@pennsieve/timeseries-zarr-reader').StreamingClient} client
 * @property {number} generation Bumped whenever a client is replaced; late async work
 *   compares against it to detect that it is stale.
 * @property {Map<string, object>} filterRegistry Active FilterSpec per client channel id.
 * @property {Set<AbortController>} inflight One controller per in-flight page request.
 * @property {?Promise<{catalogIndex: object}>} catalogPromise Memoized catalog load.
 * @property {?object} catalogIndex Resolved catalog index, once loaded.
 */

/**
 * Returns the entry for `storeId`, creating it when absent and replacing it when the bundle
 * URL changed. Performs no I/O: the client's catalog loads lazily on first use.
 *
 * Async only because the reader is code-split and loaded on first use; no network request is
 * made here, since the client defers its catalog load.
 *
 * Entries are matched on the URL's base rather than the whole URL: a signed URL's query
 * changes on every renewal, and rebuilding the client for that would throw away the loaded
 * catalog on a signature refresh.
 *
 * @param {string} storeId
 * @param {string} url Bundle root, signed or not.
 * @param {object} [options] Forwarded to store construction; notably `onUrlExpired`.
 * @returns {Promise<StreamingClientEntry>}
 */
export async function acquireClient(storeId, url, options = {}) {
    const { base } = splitSignedUrl(url)
    const existing = registry.get(storeId)
    if (existing && existing.url === base) {
        // Reusing the entry also reuses the renewal callback baked into its store. A caller
        // arriving with a different one would otherwise think it had taken effect.
        if (options.onUrlExpired && options.onUrlExpired !== existing.onUrlExpired) {
            disposeClient(storeId)
        } else {
            return existing
        }
    }
    if (existing) {
        disposeClient(storeId)
    }

    const [{ StreamingClient }, store] = await Promise.all([
        loadReader(),
        createStoreForUrl(url, options),
    ])

    // Another caller may have finished acquiring the same bundle while this one awaited.
    const raced = registry.get(storeId)
    if (raced && raced.url === base) {
        return raced
    }

    const entry = {
        storeId,
        url: base,
        onUrlExpired: options.onUrlExpired ?? null,
        client: new StreamingClient({ store }),
        generation: nextGeneration++,
        filterRegistry: new Map(),
        inflight: new Set(),
        catalogPromise: null,
        catalogIndex: null,
    }
    registry.set(storeId, entry)
    return entry
}

/**
 * @param {string} storeId
 * @returns {StreamingClientEntry|undefined}
 */
export function getClient(storeId) {
    return registry.get(storeId)
}

/**
 * Loads and memoizes the catalog index for an entry.
 *
 * Memoized on the entry rather than relying on the reader's own catalog cache so that the
 * channel list is indexed once, no matter how many callers ask. A failed load clears the
 * memo so a later call retries instead of replaying the error forever.
 *
 * @param {StreamingClientEntry} entry
 * @returns {Promise<object>} The CatalogIndex.
 */
export function ensureCatalog(entry) {
    if (entry.catalogPromise === null) {
        entry.catalogPromise = entry.client
            .channelInfo()
            .then((infos) => {
                entry.catalogIndex = buildCatalogIndex(infos)
                return entry.catalogIndex
            })
            .catch((error) => {
                entry.catalogPromise = null
                throw error
            })
    }
    return entry.catalogPromise
}

/**
 * Aborts every in-flight request on an entry and empties the set.
 *
 * @param {StreamingClientEntry|undefined} entry
 * @returns {number} How many controllers were aborted.
 */
export function abortInflight(entry) {
    if (!entry) {
        return 0
    }
    const count = entry.inflight.size
    for (const controller of entry.inflight) {
        controller.abort()
    }
    entry.inflight.clear()
    return count
}

/**
 * Tears down an entry: aborts in-flight reads and drops the client, which releases the
 * reader's cached catalog, its cache of store responses, and its per-channel filter state.
 *
 * @param {string} storeId
 * @returns {boolean} Whether an entry was removed.
 */
export function disposeClient(storeId) {
    const entry = registry.get(storeId)
    if (!entry) {
        return false
    }
    abortInflight(entry)
    entry.filterRegistry.clear()
    entry.catalogPromise = null
    entry.catalogIndex = null
    registry.delete(storeId)
    return true
}

/** Removes every entry. Intended for tests and full teardown. */
export function disposeAllClients() {
    for (const storeId of [...registry.keys()]) {
        disposeClient(storeId)
    }
}

/** @returns {number} Live entry count. Intended for leak assertions in tests. */
export function activeClientCount() {
    return registry.size
}
