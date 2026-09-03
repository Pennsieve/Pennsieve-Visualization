// Runs the shared conformance suite against the Zarr transport with no network:
// an injected fetch serves the committed fixture bundle straight from disk.
import { runTransportConformance } from './transportConformance'
import type { TransportHarness } from './transportConformance'
import { createZarrTransport } from '../zarrTransport'
import { disposeClient } from '@/composables/streaming/clientRegistry'
import { serveBundleFromDisk, BUNDLE_URL, FIXTURE_START as START, SECOND } from './fixtureFetch'

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
