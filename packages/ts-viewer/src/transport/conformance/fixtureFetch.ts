// Serves the committed fixture bundle to an injected fetch, so a transport test
// runs the real reader with no network.
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, normalize, sep } from 'node:path'

const BUNDLE_ROOT = fileURLToPath(new URL('../../../../../test-data/sample-timeseries.zarr', import.meta.url))

// The store only speaks http(s). The query string routes createStoreForUrl onto
// its intercepted-fetch path, the same one a signed production URL takes; the
// plain-URL path constructs a store that ignores the injected fetch.
export const BUNDLE_URL = 'http://bundle.test/sample-timeseries.zarr?fixture=1'
/** Request pathname prefix every object key hangs off. */
export const BUNDLE_PATH_PREFIX = '/sample-timeseries.zarr/'

/** Wall-clock start of the fixture recording, microseconds. */
export const FIXTURE_START = 1704067200000000
export const SECOND = 1000000

/**
 * Request pathname prefix of one channel's objects. Channel groups are named by index,
 * so the path of a channel is found through the `id` attribute in the root metadata.
 */
export function channelPathPrefix(channelId: string): string {
    const root = JSON.parse(readFileSync(join(BUNDLE_ROOT, 'zarr.json'), 'utf8')) as {
        consolidated_metadata: { metadata: Record<string, { attributes?: { id?: string } }> }
    }
    for (const [key, node] of Object.entries(root.consolidated_metadata.metadata)) {
        if (!key.includes('/') && node.attributes?.id === channelId) {
            return `${BUNDLE_PATH_PREFIX}${key}/`
        }
    }
    throw new Error(`fixture has no channel with id ${channelId}`)
}

/**
 * Serves the fixture from disk with the semantics FetchStore relies on: plain
 * GETs for metadata documents, suffix ranges (`bytes=-N`) for shard indexes,
 * absolute ranges (`bytes=a-b`) for shard chunks. A missing object answers
 * 404, which the store reads as an absent key. Anything else answers a status
 * the store rejects, so a mismatch fails the suite instead of hanging it.
 */
export async function serveBundleFromDisk(request: Request): Promise<Response> {
    if (request.signal.aborted) {
        throw new DOMException('The read was aborted.', 'AbortError')
    }
    if (request.method !== 'GET') {
        return new Response(null, { status: 405 })
    }

    const url = new URL(request.url)
    if (!url.pathname.startsWith(BUNDLE_PATH_PREFIX)) {
        return new Response(null, { status: 404 })
    }
    const key = decodeURIComponent(url.pathname.slice(BUNDLE_PATH_PREFIX.length))
    const filePath = normalize(join(BUNDLE_ROOT, key))
    if (!filePath.startsWith(BUNDLE_ROOT + sep)) {
        return new Response(null, { status: 404 })
    }

    let bytes: Uint8Array
    try {
        bytes = await readFile(filePath)
    } catch {
        return new Response(null, { status: 404 })
    }

    const range = request.headers.get('range')
    if (range === null) {
        return new Response(new Uint8Array(bytes), { status: 200 })
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match || (match[1] === '' && match[2] === '')) {
        return new Response(null, { status: 416 })
    }
    let start: number
    let end: number
    if (match[1] === '') {
        // Suffix form bytes=-N: the last N bytes of the object.
        start = Math.max(0, bytes.length - Number(match[2]))
        end = bytes.length
    } else {
        start = Number(match[1])
        end = match[2] === '' ? bytes.length : Math.min(bytes.length, Number(match[2]) + 1)
    }
    return new Response(new Uint8Array(bytes.subarray(start, end)), { status: 206 })
}
