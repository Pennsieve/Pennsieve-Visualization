import { describe, it, expect, vi } from 'vitest'
import {
    createStoreForUrl,
    splitSignedUrl,
    stripTrailingSlash,
    policyExpiryMs
} from './createStore'
import { TIMESERIES_ZARR, TIMESERIES_WEBSOCKET, isZarrAssetType } from './assetTypes'

const BASE = 'https://assets.pennsieve.net/7fb7583a/O19/D2049/abc'
const SIG = 'Policy=POL&Signature=SIG&Key-Pair-Id=KEY'

/** Minimal byte response, standing in for a chunk read. */
const ok = (status = 200) => new Response(new Uint8Array([1, 2, 3]), { status })

/**
 * A CloudFront policy encoding the given expiry, encoded exactly the way AWS does it:
 * base64, then `+`->`-`, `=`->`_`, `/`->`~`. Using plain base64 here would not exercise the
 * substitution and would hide a wrong decode.
 */
const policyFor = (epochSeconds) =>
    btoa(JSON.stringify({
        Statement: [{ Resource: `${BASE}/*`, Condition: { DateLessThan: { 'AWS:EpochTime': epochSeconds } } }]
    })).replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~')

describe('assetTypes', () => {
    it('routes only the zarr asset type to the client-side reader', () => {
        expect(isZarrAssetType(TIMESERIES_ZARR)).toBe(true)
        expect(isZarrAssetType(TIMESERIES_WEBSOCKET)).toBe(false)
        expect(isZarrAssetType('ome-zarr')).toBe(false)
        expect(isZarrAssetType(undefined)).toBe(false)
        expect(isZarrAssetType(null)).toBe(false)
    })

    it('uses the literals the import writes and the host app matches on', () => {
        expect(TIMESERIES_ZARR).toBe('timeseries-zarr')
        expect(TIMESERIES_WEBSOCKET).toBe('timeseries')
    })
})

describe('splitSignedUrl', () => {
    it('separates the signing query from the base', () => {
        expect(splitSignedUrl(`${BASE}/?${SIG}`)).toEqual({ base: BASE, search: SIG })
    })

    it('leaves an unsigned url with an empty search', () => {
        expect(splitSignedUrl(`${BASE}/`)).toEqual({ base: BASE, search: '' })
        expect(splitSignedUrl(BASE)).toEqual({ base: BASE, search: '' })
    })

    it('strips exactly one trailing slash, since keys already start with one', () => {
        expect(stripTrailingSlash('http://x/a/')).toBe('http://x/a')
        expect(stripTrailingSlash('http://x/a')).toBe('http://x/a')
    })
})

describe('policyExpiryMs', () => {
    it('reads the expiry out of a CloudFront policy', () => {
        expect(policyExpiryMs(`Policy=${policyFor(1766457092)}&Signature=S`)).toBe(1766457092000)
    })

    it('decodes a policy carrying AWS-substituted padding', () => {
        // Padding '=' becomes '_' under CloudFront's substitution, so a decoder that treats
        // the string as standard base64url maps it back to '/' and fails on every real
        // policy. Assert the substituted characters are actually present, then that it reads.
        const encoded = policyFor(1766457092)
        expect(encoded).toMatch(/_/)
        expect(policyExpiryMs(`Policy=${encoded}&Signature=S&Key-Pair-Id=K`)).toBe(1766457092000)
    })

    it('returns null rather than throwing for anything unreadable', () => {
        expect(policyExpiryMs('')).toBeNull()
        expect(policyExpiryMs('Signature=S')).toBeNull()
        expect(policyExpiryMs('Policy=not-base64!!')).toBeNull()
        expect(policyExpiryMs(`Policy=${btoa('{"Statement":[]}')}`)).toBeNull()
    })
})

describe('createStoreForUrl', () => {
    it('rejects a url the browser cannot read', async () => {
        await expect(createStoreForUrl('')).rejects.toThrow(/bundle URL is required/)
        await expect(createStoreForUrl('file:///tmp/x.zarr')).rejects.toThrow(/http\(s\) only/)
        await expect(createStoreForUrl('/tmp/x.zarr')).rejects.toThrow(/http\(s\) only/)
    })

    it('reads an unsigned bundle with no request interception', async () => {
        const fetchImpl = vi.fn(async () => ok())
        const store = await createStoreForUrl(`${BASE}/`, { fetchImpl })
        // No signing and no refresh callback means the plain store, which uses global fetch;
        // asserting the injected impl was NOT used pins that there is no needless hook.
        expect(store).toBeTruthy()
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('carries the signing query onto every object request, preserving Range', async () => {
        const seen = []
        const fetchImpl = vi.fn(async (request) => {
            seen.push({ url: request.url, range: request.headers.get('range') })
            return ok(206)
        })
        const store = await createStoreForUrl(`${BASE}/?${SIG}`, { fetchImpl })

        await store.getRange('/c/0/0', { offset: 64, length: 16 })
        await store.getRange('/c/0/0', { suffixLength: 32 })

        expect(seen).toHaveLength(2)
        for (const call of seen) {
            expect(call.url).toBe(`${BASE}/c/0/0?${SIG}`)
        }
        // Both Range forms a sharded read depends on must survive the URL rewrite.
        expect(seen[0].range).toBe('bytes=64-79')
        expect(seen[1].range).toBe('bytes=-32')
    })

    it('returns undefined for a missing key rather than throwing', async () => {
        const store = await createStoreForUrl(`${BASE}/?${SIG}`, {
            fetchImpl: async () => new Response(null, { status: 404 })
        })
        await expect(store.get('/absent.json')).resolves.toBeUndefined()
    })

    it('renews once and retries when CloudFront answers 403', async () => {
        const onUrlExpired = vi.fn(async () => `${BASE}/?Policy=FRESH&Signature=S2&Key-Pair-Id=K`)
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(null, { status: 403 }))
            .mockResolvedValueOnce(ok())

        const store = await createStoreForUrl(`${BASE}/?${SIG}`, { fetchImpl, onUrlExpired })
        await store.get('/zarr.json')

        expect(onUrlExpired).toHaveBeenCalledTimes(1)
        expect(fetchImpl.mock.calls[0][0].url).toContain('Policy=POL')
        expect(fetchImpl.mock.calls[1][0].url).toContain('Policy=FRESH')
    })

    it('accepts the object form the host app naturally returns', async () => {
        const onUrlExpired = vi.fn(async () => ({ url: `${BASE}/?Policy=FRESH` }))
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(null, { status: 403 }))
            .mockResolvedValueOnce(ok())
        const store = await createStoreForUrl(`${BASE}/?${SIG}`, { fetchImpl, onUrlExpired })
        await store.get('/zarr.json')
        expect(fetchImpl.mock.calls[1][0].url).toContain('Policy=FRESH')
    })

    it('gives up after one retry so an unauthorized path cannot loop', async () => {
        const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }))
        const store = await createStoreForUrl(`${BASE}/?${SIG}`, {
            fetchImpl,
            onUrlExpired: async () => `${BASE}/?${SIG}`
        })
        await expect(store.get('/zarr.json')).rejects.toBeTruthy()
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('does not retry a 403 when the host gave no way to renew', async () => {
        const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }))
        const store = await createStoreForUrl(`${BASE}/?${SIG}`, { fetchImpl })
        await expect(store.get('/zarr.json')).rejects.toBeTruthy()
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('renews before expiry rather than waiting for a read to fail', async () => {
        const clock = 1_000_000_000_000
        const nearlyExpired = policyFor((clock + 60_000) / 1000)
        const onUrlExpired = vi.fn(async () => `${BASE}/?Policy=${policyFor((clock + 3600_000) / 1000)}`)
        const fetchImpl = vi.fn(async () => ok())

        const store = await createStoreForUrl(`${BASE}/?Policy=${nearlyExpired}`, {
            fetchImpl, onUrlExpired, now: () => clock
        })
        await store.get('/zarr.json')

        // Renewed before the first request went out, and the request carried the new policy.
        expect(onUrlExpired).toHaveBeenCalledTimes(1)
        expect(fetchImpl.mock.calls[0][0].url).not.toContain(nearlyExpired)
        // The renewed policy is good for an hour, so a second read must not renew again.
        await store.get('/other.json')
        expect(onUrlExpired).toHaveBeenCalledTimes(1)
    })

    it('leaves a policy that is not near expiry alone', async () => {
        const clock = 1_000_000_000_000
        const onUrlExpired = vi.fn()
        const fetchImpl = vi.fn(async () => ok())
        const store = await createStoreForUrl(
            `${BASE}/?Policy=${policyFor((clock + 3600_000) / 1000)}`,
            { fetchImpl, onUrlExpired, now: () => clock }
        )
        await store.get('/zarr.json')
        expect(onUrlExpired).not.toHaveBeenCalled()
    })

    it('collapses concurrent renewals into one call to the host', async () => {
        let release
        const gate = new Promise((resolve) => { release = resolve })
        const onUrlExpired = vi.fn(async () => { await gate; return `${BASE}/?Policy=FRESH` })
        const fetchImpl = vi.fn(async (request) =>
            request.url.includes('Policy=FRESH') ? ok() : new Response(null, { status: 403 }))

        const store = await createStoreForUrl(`${BASE}/?${SIG}`, { fetchImpl, onUrlExpired })
        const both = Promise.all([store.get('/a.json'), store.get('/b.json')])
        release()
        await both
        expect(onUrlExpired).toHaveBeenCalledTimes(1)
    })

    it('follows the base to a new host if a renewal moves it', async () => {
        const moved = 'https://cdn2.pennsieve.net/O19/D2049/abc'
        const onUrlExpired = vi.fn(async () => `${moved}/?Policy=FRESH`)
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(null, { status: 403 }))
            .mockResolvedValueOnce(ok())
        const store = await createStoreForUrl(`${BASE}/?${SIG}`, { fetchImpl, onUrlExpired })
        await store.get('/zarr.json')
        expect(fetchImpl.mock.calls[1][0].url).toBe(`${moved}/zarr.json?Policy=FRESH`)
    })

    it('surfaces a refresh callback that resolves to nothing usable', async () => {
        const store = await createStoreForUrl(`${BASE}/?${SIG}`, {
            fetchImpl: async () => new Response(null, { status: 403 }),
            onUrlExpired: async () => undefined
        })
        await expect(store.get('/zarr.json')).rejects.toThrow(/must resolve to a bundle URL/)
    })
})

describe('renewal robustness (regressions found by adversarial review)', () => {
    it('serves the read on the current signature when a proactive renewal fails', async () => {
        const clock = 1_000_000_000_000
        const onUrlExpired = vi.fn(async () => { throw new Error('packages-service down') })
        const fetchImpl = vi.fn(async () => ok())
        const store = await createStoreForUrl(
            `${BASE}/?Policy=${policyFor((clock + 60_000) / 1000)}`,
            { fetchImpl, onUrlExpired, now: () => clock }
        )
        // The signature in hand is still valid; a failed pre-emptive renewal must degrade to
        // it rather than fail a read the current signature could have served.
        await expect(store.get('/zarr.json')).resolves.toBeTruthy()
        expect(onUrlExpired).toHaveBeenCalledTimes(1)
        // And it must disarm, not retry the failing renewal on every subsequent read.
        await store.get('/other.json')
        expect(onUrlExpired).toHaveBeenCalledTimes(1)
    })

    it('stops renewing when a renewal returns a signature still inside the margin', async () => {
        const clock = 1_000_000_000_000
        // Always hands back something already near expiry - without a guard this renews per read.
        const onUrlExpired = vi.fn(async () => `${BASE}/?Policy=${policyFor((clock + 30_000) / 1000)}`)
        const fetchImpl = vi.fn(async () => ok())
        const store = await createStoreForUrl(
            `${BASE}/?Policy=${policyFor((clock + 60_000) / 1000)}`,
            { fetchImpl, onUrlExpired, now: () => clock }
        )
        for (const key of ['/a.json', '/b.json', '/c.json', '/d.json']) {
            await store.get(key)
        }
        expect(onUrlExpired).toHaveBeenCalledTimes(1)
    })

    it('does not renew twice when a peer already refreshed the signature', async () => {
        let released
        const gate = new Promise((resolve) => { released = resolve })
        const onUrlExpired = vi.fn(async () => { await gate; return `${BASE}/?Policy=FRESH` })
        // Everything 403s until the fresh signature is in play.
        const fetchImpl = vi.fn(async (request) =>
            request.url.includes('Policy=FRESH') ? ok() : new Response(null, { status: 403 }))

        const store = await createStoreForUrl(`${BASE}/?${SIG}`, { fetchImpl, onUrlExpired })
        const both = Promise.all([store.get('/a.json'), store.get('/b.json')])
        released()
        await both
        expect(onUrlExpired).toHaveBeenCalledTimes(1)
    })

    it('normalizes the base so a request splits back into its key', async () => {
        // A base with a redundant path segment or default port still has to round-trip.
        const fetchImpl = vi.fn(async () => ok())
        const store = await createStoreForUrl(`https://assets.pennsieve.net:443/O19/abc/?${SIG}`, { fetchImpl })
        await store.get('/zarr.json')
        const url = new URL(fetchImpl.mock.calls[0][0].url)
        expect(url.pathname).toBe('/O19/abc/zarr.json')
        expect(url.searchParams.get('Policy')).toBe('POL')
    })
})
