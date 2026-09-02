// The page span the Zarr transport reports once a page will read raw samples.
import { describe, it, expect, afterEach } from 'vitest'
import { createZarrTransport } from './zarrTransport'
import { disposeClient } from '@/composables/streaming/clientRegistry'
import { adaptivePageSize, BASE_PAGE_SIZE } from '@/composables/streaming/paging'
import { serveBundleFromDisk, BUNDLE_URL } from './conformance/fixtureFetch'

const SECOND = 1_000_000
const TEN_MINUTES = 600 * SECOND

// The fixture's continuous channels run at 1 kHz. Two of them read 8 kB per second
// raw, so this cap lasts 125 s unmontaged, 62.5 s montaged.
const MAX_RAW_BYTES = 1_000_000

describe('zarr transport: page span under the raw-read cap', () => {
    const rigs: Array<() => Promise<void>> = []
    afterEach(async () => {
        for (const dispose of rigs.splice(0)) await dispose()
    })

    async function openTransport(maxRawBytes = MAX_RAW_BYTES) {
        const registryKey = `zarr-paging-${rigs.length}`
        const transport = createZarrTransport({ registryKey, fetchImpl: serveBundleFromDisk, maxRawBytes })
        rigs.push(async () => {
            await transport.close()
            disposeClient(registryKey)
        })
        await transport.open({ packageId: 'pkg', viewerAssetId: null, url: BUNDLE_URL })
        return transport
    }

    it('reports the viewport-sized span while nothing forces raw reads', async () => {
        const transport = await openTransport()
        expect(transport.capabilities.pageSizeFor(TEN_MINUTES)).toBe(adaptivePageSize(TEN_MINUTES))
        expect(transport.capabilities.pageSizeFor(TEN_MINUTES, { count: 2, montaged: false })).toBe(
            adaptivePageSize(TEN_MINUTES)
        )
    })

    it('narrows the span to fit the cap once a filter is registered', async () => {
        const transport = await openTransport()
        transport.setFilter({ filter: 'highpass', filterParameters: [4, 0.5], channels: ['sineA'] })

        expect(transport.capabilities.pageSizeFor(TEN_MINUTES, { count: 2, montaged: false })).toBe(8 * BASE_PAGE_SIZE)
    })

    it('returns to the viewport-sized span when the filter is cleared', async () => {
        const transport = await openTransport()
        transport.setFilter({ filter: 'highpass', filterParameters: [4, 0.5], channels: ['sineA'] })
        transport.setFilter({ channelFiltersToClear: ['sineA'] })

        expect(transport.capabilities.pageSizeFor(TEN_MINUTES, { count: 2, montaged: false })).toBe(
            adaptivePageSize(TEN_MINUTES)
        )
    })

    it('narrows the span for a montage, whose traces read two channels each', async () => {
        const transport = await openTransport()
        expect(transport.capabilities.pageSizeFor(TEN_MINUTES, { count: 2, montaged: true })).toBe(4 * BASE_PAGE_SIZE)
    })

    it('never widens a span the viewport already fits', async () => {
        const transport = await openTransport()
        transport.setFilter({ filter: 'highpass', filterParameters: [4, 0.5], channels: ['sineA'] })
        expect(transport.capabilities.pageSizeFor(20 * SECOND, { count: 2, montaged: false })).toBe(2 * BASE_PAGE_SIZE)
    })

    it('leaves the span alone when the page carries no traces', async () => {
        const transport = await openTransport()
        transport.setFilter({ filter: 'highpass', filterParameters: [4, 0.5], channels: ['sineA'] })
        expect(transport.capabilities.pageSizeFor(TEN_MINUTES, { count: 0, montaged: false })).toBe(
            adaptivePageSize(TEN_MINUTES)
        )
    })
})
