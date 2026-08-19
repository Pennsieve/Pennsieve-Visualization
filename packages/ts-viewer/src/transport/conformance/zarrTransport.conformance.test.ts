// Runs the shared conformance suite against the Zarr transport with no network:
// an injected fetch serves the committed fixture bundle straight from disk.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, normalize, sep } from 'node:path'
import { runTransportConformance } from './transportConformance'
import type { TransportHarness } from './transportConformance'
import { createZarrTransport } from '../zarrTransport'
import { disposeClient } from '@/composables/streaming/clientRegistry'

const BUNDLE_ROOT = fileURLToPath(new URL('../../../../../test-data/sample-timeseries.zarr', import.meta.url))

// The store only speaks http(s). The query string routes createStoreForUrl onto
// its intercepted-fetch path, the same one a signed production URL takes; the
// plain-URL path constructs a store that ignores the injected fetch.
const BUNDLE_URL = 'http://bundle.test/sample-timeseries.zarr?fixture=1'
const BUNDLE_PATH_PREFIX = '/sample-timeseries.zarr/'

const START = 1704067200000000
const SECOND = 1000000

/**
 * Serves the fixture from disk with the semantics FetchStore relies on: plain
 * GETs for metadata documents, suffix ranges (`bytes=-N`) for shard indexes,
 * absolute ranges (`bytes=a-b`) for shard chunks. A missing object answers
 * 404, which the store reads as an absent key. Anything else answers a status
 * the store rejects, so a mismatch fails the suite instead of hanging it.
 */
async function serveBundleFromDisk(request: Request): Promise<Response> {
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

let nextHarness = 0

async function makeHarness(): Promise<TransportHarness> {
    // The registry memoizes one client per key, so every harness takes a fresh
    // key and releases it on dispose.
    const registryKey = `zarr-conformance-${nextHarness++}`
    const transport = createZarrTransport({ registryKey, fetchImpl: serveBundleFromDisk })
    return {
        transport,
        openOptions: {
            packageId: 'pkg',
            viewerAssetId: null,
            url: BUNDLE_URL
        },
        channels: [
            { id: 'sineA', name: 'Sine A' },
            { id: 'sineB', name: 'Sine B' }
        ],
        // The fixture's unitA places its last spike at START + 27.4 s, so this
        // page holds continuous data for the sine channels and no events for
        // unitA. The transport answers the eventless unit page with exactly one
        // zero-point envelope, which is the drain the suite asserts.
        emptyChannel: { id: 'unitA', name: 'Unit A' },
        drainsEmptyChannel: true,
        page: {
            startTime: START + 28 * SECOND,
            endTime: START + 30 * SECOND,
            pixelWidth: 4000
        },
        async dispose() {
            await transport.close()
            disposeClient(registryKey)
        }
    }
}

runTransportConformance('zarr', makeHarness)
