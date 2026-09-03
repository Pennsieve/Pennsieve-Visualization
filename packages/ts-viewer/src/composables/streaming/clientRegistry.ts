import type { FilterSpec, StreamingClient } from '@pennsieve/timeseries-zarr-reader'
import { createStoreForUrl, splitSignedUrl, type CreateStoreOptions } from './createStore'
import { buildCatalogIndex, type CatalogIndex } from './channelDetails'
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
 */
const registry = new Map<string, StreamingClientEntry>()

/**
 * Compressed bytes the viewer holds across every client, in total.
 *
 * One viewer keeps all of it. A second viewer halves it, and so on, so the number of
 * viewers on a page does not multiply what the tab holds.
 */
const CACHE_BYTES_BUDGET = 256 * 1024 * 1024

let nextGeneration = 1

/**
 * The budget share a client created now would take.
 *
 * A cap is fixed at construction, so a client already in the registry keeps the larger
 * share it was built with, and the total runs over the budget until it is disposed.
 */
function newClientCacheBytes(): number {
    return Math.floor(CACHE_BYTES_BUDGET / (registry.size + 1))
}

export interface StreamingClientEntry {
    /** Viewer store id that owns this entry. */
    storeId: string
    /** Bundle URL base this client was built for. */
    url: string
    /** The renewal callback baked into this client's store. */
    onUrlExpired: CreateStoreOptions['onUrlExpired'] | null
    client: StreamingClient
    /**
     * Bumped whenever a client is replaced; late async work compares against it to detect
     * that it is stale.
     */
    generation: number
    /** Active FilterSpec per client channel id. */
    filterRegistry: Map<string, FilterSpec>
    /** One controller per in-flight page request. */
    inflight: Set<AbortController>
    /** Memoized catalog load. */
    catalogPromise: Promise<CatalogIndex> | null
    /** Resolved catalog index, once loaded. */
    catalogIndex: CatalogIndex | null
}

/**
 * Byte cap on forced-raw reads, per query.
 *
 * A filter or a montage forces raw samples, so the reader's byte cap is spent over one page
 * span. The cap rises with the span set in paging.ts, which keeps the widest filtered or
 * montaged window that renders where it was before.
 */
export const DEFAULT_MAX_RAW_BYTES = 60_000_000

export interface AcquireClientOptions extends CreateStoreOptions {
    /** Byte cap on forced-raw reads. Defaults to `DEFAULT_MAX_RAW_BYTES`. */
    maxRawBytes?: number
}

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
 * @param url Bundle root, signed or not.
 * @param options Forwarded to store construction; notably `onUrlExpired`.
 */
export async function acquireClient(
    storeId: string,
    url: string,
    options: AcquireClientOptions = {}
): Promise<StreamingClientEntry> {
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

    const entry: StreamingClientEntry = {
        storeId,
        url: base,
        onUrlExpired: options.onUrlExpired ?? null,
        client: new StreamingClient({
            store,
            maxRawBytes: options.maxRawBytes ?? DEFAULT_MAX_RAW_BYTES,
            // The cache holds compressed chunk bytes. The scrubber reads availability for
            // the whole recording through this same client, and at the reader's 64 MB
            // default those reads evict the pages the viewport is drawing.
            maxCacheBytes: newClientCacheBytes(),
        }),
        generation: nextGeneration++,
        filterRegistry: new Map(),
        inflight: new Set(),
        catalogPromise: null,
        catalogIndex: null,
    }
    registry.set(storeId, entry)
    return entry
}

export function getClient(storeId: string): StreamingClientEntry | undefined {
    return registry.get(storeId)
}

/**
 * Loads and memoizes the catalog index for an entry.
 *
 * Memoized on the entry rather than relying on the reader's own catalog cache so that the
 * channel list is indexed once, no matter how many callers ask. A failed load clears the
 * memo so a later call retries instead of replaying the error forever.
 *
 * @returns The CatalogIndex.
 */
export function ensureCatalog(entry: StreamingClientEntry): Promise<CatalogIndex> {
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
 * @returns How many controllers were aborted.
 */
export function abortInflight(entry: StreamingClientEntry | undefined): number {
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
 * @returns Whether an entry was removed.
 */
export function disposeClient(storeId: string): boolean {
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
export function disposeAllClients(): void {
    for (const storeId of [...registry.keys()]) {
        disposeClient(storeId)
    }
}

/** @returns Live entry count. Intended for leak assertions in tests. */
export function activeClientCount(): number {
    return registry.size
}
