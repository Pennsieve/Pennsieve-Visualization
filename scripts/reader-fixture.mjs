// The TS-Zarr bundle the tsviewer tests and the :9091 dev server read.
//
// It is the reader's own test-data/sample.zarr, fetched from the reader's GitHub repo
// at the tag of the installed @pennsieve/timeseries-zarr-reader, so the viewer tests
// against the bundle the installed reader was tested against. The npm package does
// not ship it. Cached under node_modules/.cache; delete that directory to refetch.
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { access, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const VIEWER_PACKAGE = join(REPO_ROOT, 'packages/ts-viewer/package.json')
const CACHE_DIR = join(REPO_ROOT, 'node_modules/.cache/timeseries-zarr-reader-fixture')
const REPO = 'https://github.com/Pennsieve/timeseries-zarr-reader'

const run = promisify(execFile)

/** Version of the reader installed for packages/ts-viewer. */
export function readerVersion() {
    const entry = createRequire(VIEWER_PACKAGE).resolve('@pennsieve/timeseries-zarr-reader')
    const packageJson = join(dirname(dirname(entry)), 'package.json')
    return JSON.parse(readFileSync(packageJson, 'utf8')).version
}

/** Where the fixture for the installed reader lives once fetched. */
export function fixtureRoot() {
    return join(CACHE_DIR, `v${readerVersion()}`, 'sample.zarr')
}

async function exists(path) {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

/**
 * Fetches the fixture for the installed reader unless it is already cached.
 *
 * Downloads the tag's source archive (a few MB), extracts it in a scratch directory,
 * and moves only test-data/sample.zarr into place, so a failed fetch leaves no
 * half-written fixture behind.
 */
export async function ensureFixture() {
    const root = fixtureRoot()
    if (await exists(join(root, 'zarr.json'))) {
        return root
    }

    const version = readerVersion()
    const url = `${REPO}/archive/refs/tags/v${version}.tar.gz`
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Fetching the reader fixture from ${url} failed: ${response.status} ${response.statusText}`)
    }

    const work = join(CACHE_DIR, `v${version}.fetching-${process.pid}`)
    await rm(work, { recursive: true, force: true })
    await mkdir(work, { recursive: true })
    try {
        const tarball = join(work, 'reader.tar.gz')
        await writeFile(tarball, new Uint8Array(await response.arrayBuffer()))
        await run('tar', ['-xzf', tarball, '-C', work])
        // The archive's top directory is named after the tag; find it rather than guess.
        const top = (await readdir(work)).find((name) => name !== 'reader.tar.gz')
        const bundle = join(work, top, 'test-data', 'sample.zarr')
        if (!(await exists(join(bundle, 'zarr.json')))) {
            throw new Error(`The reader archive for v${version} holds no test-data/sample.zarr`)
        }
        await mkdir(dirname(root), { recursive: true })
        await rm(root, { recursive: true, force: true })
        await rename(bundle, root)
    } finally {
        await rm(work, { recursive: true, force: true })
    }
    return root
}
