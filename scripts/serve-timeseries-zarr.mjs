/**
 * Range-capable static file server for a Zarr timeseries bundle (browser dev only).
 *
 * Usage:
 *   node scripts/serve-timeseries-zarr.mjs [rootDir] [port]
 *   node scripts/serve-timeseries-zarr.mjs 9095
 *   node scripts/serve-timeseries-zarr.mjs ../../timeseries-zarr-py/data/output/large_test.zarr 9095
 *   TS_ZARR_ROOT=/path/to/bundle.zarr pnpm dev
 *
 * Defaults: rootDir = TS_ZARR_ROOT from the environment when set, otherwise
 * test-data/sample-timeseries.zarr (relative to this repo); port = 9091. A lone numeric
 * argument is read as the port, so either argument may be given alone. The environment
 * variable exists for `pnpm dev`, which starts this server with no arguments: it points
 * the playground at any bundle without editing a script or regenerating the fixture,
 * which the unit tests read.
 *
 * Sharded (ZEP2) bundles cannot be read at all without HTTP Range: zarrita reads a shard's
 * index from the END of the object with `Range: bytes=-<n>` and only then reads the inner
 * chunk with `Range: bytes=<a>-<b>`. scripts/serve-test-zarr.py (port 9090, imaging fixture)
 * uses Python's SimpleHTTPRequestHandler, which ignores Range and answers 200 with the whole
 * object -- which is why this server exists. The two are independent; :9090 is unaffected.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ROOT = fileURLToPath(new URL('../test-data/sample-timeseries.zarr', import.meta.url))
const DEFAULT_PORT = 9091

/** `bytes=-<n>`: the last n bytes. The form zarrita uses to read a shard index. */
const SUFFIX_RANGE = /^bytes=-(\d+)$/
/** `bytes=<a>-<b>` and `bytes=<a>-`: inclusive offset range, optionally open ended. */
const OFFSET_RANGE = /^bytes=(\d+)-(\d+)?$/

const CONTENT_TYPES = {
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript'
}

/**
 * Headers sent on every response, including errors and preflights.
 *
 * Access-Control-Expose-Headers is load bearing: a cross-origin reader cannot read
 * Content-Range or Accept-Ranges off the response unless they are exposed, so without it
 * a store that validates the returned range fails even though the bytes arrived.
 */
const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Type',
    'access-control-max-age': '86400'
}

/**
 * Reads `[rootDir] [port]` off argv, in either order for a single argument.
 * Returns an absolute root; a relative rootDir resolves against the process cwd. An
 * argument outranks `TS_ZARR_ROOT`, which outranks the fixture.
 */
function parseArgs(argv, env = process.env) {
    let root = env.TS_ZARR_ROOT ? resolve(env.TS_ZARR_ROOT) : DEFAULT_ROOT
    let port = DEFAULT_PORT
    for (const arg of argv) {
        if (/^\d+$/.test(arg)) {
            port = Number(arg)
        } else {
            root = resolve(arg)
        }
    }
    return { root, port }
}

/**
 * Resolves a request path to a file inside `root`, or null if it escapes the root.
 * The escape guard compares resolved absolute paths, so `..`, encoded `%2e%2e` and
 * absolute-looking paths are all caught after normalization rather than by string matching.
 */
function resolveTarget(root, requestUrl) {
    let pathname
    try {
        pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname)
    } catch {
        return null
    }
    const target = normalize(join(root, pathname))
    if (target !== root && !target.startsWith(root + sep)) return null
    return target
}

/** Content-Type by extension; unknown extensions (Zarr chunks are extensionless) are binary. */
function contentTypeFor(path) {
    const dot = path.lastIndexOf('.')
    const ext = dot === -1 ? '' : path.slice(dot).toLowerCase()
    return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

/**
 * Parses a Range header against a known total size.
 *
 * Returns `{ start, end }` inclusive for a satisfiable range, `{ unsatisfiable: true }`
 * for a syntactically valid range that no part of the file can satisfy (-> 416), and null
 * when the header is absent or unusable (multi-range, unknown unit, last < first), which
 * RFC 9110 requires be treated as if no Range were sent (-> 200).
 */
function parseRange(header, total) {
    if (header === undefined) return null
    const value = header.trim().toLowerCase()

    const suffix = SUFFIX_RANGE.exec(value)
    if (suffix) {
        const length = Number(suffix[1])
        if (length === 0 || total === 0) return { unsatisfiable: true }
        return { start: Math.max(0, total - length), end: total - 1 }
    }

    const offset = OFFSET_RANGE.exec(value)
    if (offset) {
        const start = Number(offset[1])
        const end = offset[2] === undefined ? total - 1 : Math.min(Number(offset[2]), total - 1)
        if (start >= total || total === 0) return { unsatisfiable: true }
        if (end < start) return null
        return { start, end }
    }

    return null
}

/** Sends a bodiless response with the CORS/Accept-Ranges preamble. */
function sendStatus(response, status, headers = {}) {
    response.writeHead(status, { ...CORS_HEADERS, 'accept-ranges': 'bytes', ...headers })
    response.end()
}

const { root, port } = parseArgs(process.argv.slice(2))
const quiet = process.env.QUIET === '1'

try {
    const rootStat = await stat(root)
    if (!rootStat.isDirectory()) throw new Error('not a directory')
} catch {
    console.error(`serve-timeseries-zarr: bundle root not found: ${root}`)
    console.error('Usage: node scripts/serve-timeseries-zarr.mjs [rootDir] [port]')
    process.exit(1)
}

const server = createServer((request, response) => {
    void (async () => {
        const method = request.method ?? 'GET'
        const log = (status, note = '') => {
            if (!quiet) console.log(`${method} ${request.url} -> ${status} ${note}`.trimEnd())
        }

        if (method === 'OPTIONS') {
            sendStatus(response, 204)
            log(204, 'preflight')
            return
        }
        if (method !== 'GET' && method !== 'HEAD') {
            sendStatus(response, 405)
            log(405)
            return
        }

        const target = resolveTarget(root, request.url ?? '/')
        if (target === null) {
            sendStatus(response, 403)
            log(403, 'outside root')
            return
        }

        let size
        try {
            const info = await stat(target)
            if (info.isDirectory()) throw new Error('is a directory')
            size = info.size
        } catch {
            sendStatus(response, 404)
            log(404)
            return
        }

        const base = {
            ...CORS_HEADERS,
            'accept-ranges': 'bytes',
            'content-type': contentTypeFor(target),
            'cache-control': 'no-store'
        }
        const range = parseRange(request.headers.range, size)

        if (range?.unsatisfiable) {
            response.writeHead(416, { ...base, 'content-range': `bytes */${size}` })
            response.end()
            log(416, `bytes */${size}`)
            return
        }

        const start = range ? range.start : 0
        const end = range ? range.end : size - 1
        const length = size === 0 ? 0 : end - start + 1
        const status = range ? 206 : 200
        const headers = { ...base, 'content-length': String(length) }
        if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`

        response.writeHead(status, headers)
        if (method === 'HEAD' || length === 0) {
            response.end()
            log(status, range ? headers['content-range'] : '')
            return
        }

        const stream = createReadStream(target, { start, end })
        stream.on('error', () => response.destroy())
        response.on('close', () => stream.destroy())
        stream.pipe(response)
        log(status, range ? headers['content-range'] : '')
    })()
})

server.listen(port, () => {
    console.log(`Serving ${root}`)
    console.log(`  http://localhost:${port}  (HTTP Range enabled -- required for sharded Zarr)`)
    console.log('  Usage: node scripts/serve-timeseries-zarr.mjs [rootDir] [port]')
})
