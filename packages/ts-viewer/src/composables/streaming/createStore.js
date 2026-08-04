import { loadReader } from './loadReader'

/**
 * Shared FetchStore options.
 *
 * `useSuffixRequest` is not cosmetic. Every array in a bundle is sharded, and reading a shard
 * means first reading its index from the end of the object. Left at its default, the store
 * resolves that with a HEAD to learn the object size followed by an absolute-offset GET --
 * two round trips per index, on the hottest path there is. Asking for `Range: bytes=-N`
 * directly makes it one. S3, CloudFront, and the repo's dev server all serve suffix ranges.
 */
export const FETCH_STORE_OPTIONS = { useSuffixRequest: true }

/** Renew this far ahead of a signature's expiry. CloudFront policies here last an hour. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

/**
 * Removes one trailing slash. Reader store keys always begin with `/`, so a base URL that
 * keeps its own trailing slash produces a double slash and a 404 on some origins.
 *
 * @param {string} url
 * @returns {string}
 */
export function stripTrailingSlash(url) {
    return url.endsWith('/') ? url.slice(0, -1) : url
}

/**
 * Splits a bundle URL into the base that object keys hang off and the query string that has
 * to ride on every request.
 *
 * A signed CloudFront URL carries `Policy`/`Signature`/`Key-Pair-Id` in its query. Those
 * cannot stay on the base, because the store builds each request as `base + key` and would
 * produce `.../prefix/?Policy=...` + `/zarr.json`. Splitting here lets the caller pass one
 * already-signed URL and have every object request signed correctly.
 *
 * @param {string} url
 * @returns {{base: string, search: string}} `search` is '' for an unsigned URL.
 */
export function splitSignedUrl(url) {
    const mark = url.indexOf('?')
    const rawBase = mark === -1 ? url : url.slice(0, mark)
    const search = mark === -1 ? '' : url.slice(mark + 1)
    // Normalized through URL so the base is byte-identical to what the store will regenerate
    // when it concatenates a key; otherwise the request-to-key split below silently misses.
    let base
    try {
        base = new URL(rawBase).href
    } catch {
        base = rawBase
    }
    return { base: stripTrailingSlash(base), search }
}

/**
 * Reads the expiry out of a CloudFront signed query, in epoch milliseconds.
 *
 * The `Policy` parameter is JSON, base64'd, then run through CloudFront's own URL-safe
 * substitution -- which is NOT standard base64url. AWS replaces `+` with `-`, `=` with `_`,
 * and `/` with `~`, so decoding has to reverse exactly that. (Standard base64url would map
 * `_` back to `/`; doing that here fails on the padding `=` that ends most policies, which
 * would make this silently return null for essentially every real signature.)
 *
 * Reading the expiry lets a renewal happen before a read fails rather than after. Any parse
 * failure returns null, which falls back to renewing reactively on the first 403 -- so this
 * is an optimization, never a dependency.
 *
 * @param {string} search
 * @returns {?number}
 */
export function policyExpiryMs(search) {
    try {
        const policy = new URLSearchParams(search).get('Policy')
        if (!policy) {
            return null
        }
        const json = atob(policy.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/'))
        const seconds = JSON.parse(json)?.Statement?.[0]?.Condition?.DateLessThan?.['AWS:EpochTime']
        return typeof seconds === 'number' ? seconds * 1000 : null
    } catch {
        return null
    }
}

/** Accepts either a bare URL string or `{url}` from the host's refresh callback. */
function readRefreshedUrl(result) {
    const url = typeof result === 'string' ? result : result?.url
    if (typeof url !== 'string' || url.length === 0) {
        throw new Error('onUrlExpired must resolve to a bundle URL')
    }
    return url
}

/**
 * Builds a reader `Store` for a bundle URL.
 *
 * Deliberately does NOT use the reader's `openBundle()` helper: that helper can reach the
 * Node filesystem store, which pulls `node:fs/promises` and `node:path` into the browser
 * bundle graph and fails the build. Browser code constructs its store directly, so only
 * http(s) is supported here -- `file://` has no meaning in a browser anyway.
 *
 * Signing is not modelled as a separate store type. The host already fetches the viewer
 * asset and can sign it, so it passes one URL that may already carry a signature, plus an
 * `onUrlExpired` callback to renew it. An unsigned URL with no callback needs no interception
 * at all and gets a plain store.
 *
 * @param {string} url Bundle root, signed or not, with or without a trailing slash.
 * @param {object} [options]
 * @param {() => Promise<string|{url: string}>} [options.onUrlExpired] Resolves a fresh URL.
 * @param {typeof fetch} [options.fetchImpl] Injectable for tests.
 * @param {() => number} [options.now] Injectable clock for tests.
 * @returns {Promise<object>} A zarrita FetchStore.
 */
export async function createStoreForUrl(url, options = {}) {
    if (typeof url !== 'string' || url.length === 0) {
        throw new Error('createStoreForUrl: a bundle URL is required')
    }
    if (!/^https?:\/\//i.test(url)) {
        throw new Error(
            `createStoreForUrl: unsupported bundle URL "${url}" - the browser path supports http(s) only`,
        )
    }

    const {
        onUrlExpired = null,
        fetchImpl = (...args) => globalThis.fetch(...args),
        now = () => Date.now()
    } = options

    let { base, search } = splitSignedUrl(url)
    const { FetchStore } = await loadReader()

    if (search === '' && onUrlExpired === null) {
        return new FetchStore(base, FETCH_STORE_OPTIONS)
    }

    // The base the store was constructed with, so a request URL can be split back into its
    // key even after a renewal moves the base.
    const initialBase = base
    let expiresAtMs = policyExpiryMs(search)
    let pending = null

    const refresh = () => {
        if (pending === null) {
            pending = Promise.resolve()
                .then(onUrlExpired)
                .then((result) => {
                    const next = splitSignedUrl(readRefreshedUrl(result))
                    base = next.base
                    search = next.search
                    expiresAtMs = policyExpiryMs(search)
                    // A renewal that comes back still inside the margin would otherwise make
                    // every subsequent read renew again, forever. Disarm the proactive path
                    // and let the 403 handler be the backstop.
                    if (expiresAtMs !== null && now() >= expiresAtMs - REFRESH_MARGIN_MS) {
                        expiresAtMs = null
                    }
                    pending = null
                })
                .catch((error) => {
                    pending = null
                    throw error
                })
        }
        return pending
    }

    const isExpiring = () =>
        onUrlExpired !== null && expiresAtMs !== null && now() >= expiresAtMs - REFRESH_MARGIN_MS

    const addressOf = (requestUrl) => {
        if (!requestUrl.startsWith(initialBase)) {
            // The store only ever asks for `initialBase + key`. Anything else is a bug, and
            // concatenating it onto the base would produce a doubled-up URL whose 403 looks
            // exactly like an expired signature.
            throw new Error(`Refusing to sign a request outside the bundle: ${requestUrl}`)
        }
        const key = requestUrl.slice(initialBase.length)
        return search === '' ? `${base}${key}` : `${base}${key}?${search}`
    }

    // `new Request(url, request)` is the documented way to redirect a store request while
    // keeping its Range header and abort signal intact.
    const signedFetch = async (request) => {
        if (isExpiring()) {
            // Best effort: the signature in hand is still valid, so a failed pre-emptive
            // renewal must not fail a read the current one could have served.
            try {
                await refresh()
            } catch {
                expiresAtMs = null
            }
        }

        const attempted = search
        const response = await fetchImpl(new Request(addressOf(request.url), request))
        if (response.status !== 403 || onUrlExpired === null) {
            return response
        }

        // CloudFront answers 403 for an expired signature, a rotated key, and a path outside
        // the policy. Renew once and retry; a second 403 is a real authorization failure.
        // If a concurrent read already renewed, reuse that result instead of renewing again.
        if (search === attempted) {
            await refresh()
        }
        return await fetchImpl(new Request(addressOf(request.url), request))
    }

    return new FetchStore(initialBase, { ...FETCH_STORE_OPTIONS, fetch: signedFetch })
}
