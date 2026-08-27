import { afterEach, describe, expect, it, vi } from 'vitest'

/** Options every StreamingClient was constructed with, in order. */
const clientOptions: Array<Record<string, unknown>> = []

vi.mock('./loadReader', () => ({
    loadReader: async () => ({
        StreamingClient: class {
            constructor(options: Record<string, unknown>) {
                clientOptions.push(options)
            }
        }
    })
}))

vi.mock('./createStore', () => ({
    createStoreForUrl: async () => ({
        get: async () => undefined,
        getRange: async () => undefined
    }),
    splitSignedUrl: (url: string) => ({ base: url, search: '' })
}))

const { acquireClient, disposeAllClients } = await import('./clientRegistry')

const BUNDLE = 'https://example.test/bundle.zarr'

/** Compressed bytes the registry splits between its clients. */
const CACHE_BUDGET = 256 * 1024 * 1024

describe('acquireClient', () => {
    afterEach(() => {
        disposeAllClients()
        clientOptions.length = 0
    })

    it('gives one viewer the whole cache budget', async () => {
        await acquireClient('registry-test-cache', BUNDLE)

        expect(clientOptions[0].maxCacheBytes).toBe(CACHE_BUDGET)
    })

    it('splits the cache budget between viewers', async () => {
        await acquireClient('registry-test-first', BUNDLE)
        await acquireClient('registry-test-second', BUNDLE)
        await acquireClient('registry-test-third', BUNDLE)

        // The earlier clients keep the caps they were built with: the reader takes the cap
        // as a constructor option, so the total runs over budget until one is disposed.
        expect(clientOptions[0].maxCacheBytes).toBe(CACHE_BUDGET)
        expect(clientOptions[1].maxCacheBytes).toBe(CACHE_BUDGET / 2)
        expect(clientOptions[2].maxCacheBytes).toBe(Math.floor(CACHE_BUDGET / 3))
    })

    // The page span in paging.ts and this cap move together. A span that outgrows the cap
    // blanks filtered and montaged views at ordinary widths, and reports no error.
    it('caps forced-raw reads at 60 MB', async () => {
        await acquireClient('registry-test-raw', BUNDLE)

        expect(clientOptions[0].maxRawBytes).toBe(60_000_000)
    })
})
