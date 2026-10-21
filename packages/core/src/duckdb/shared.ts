import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'

/** The `@duckdb/duckdb-wasm` module namespace. */
export type DuckDBModule = typeof import('@duckdb/duckdb-wasm')

/**
 * Where to get `@duckdb/duckdb-wasm`: the module itself, or a loader such as
 * `() => import('@duckdb/duckdb-wasm')`. Core never imports DuckDB itself, so apps that only
 * use other core components (e.g. OrthogonalFrame) don't need it installed or bundled.
 */
export type DuckDBSource = DuckDBModule | (() => Promise<DuckDBModule>)

let shared: Promise<AsyncDuckDB> | null = null

async function createDuckDB(source: DuckDBSource): Promise<AsyncDuckDB> {
  const duckdb = typeof source === 'function' ? await source() : source
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles())
  // Wrap the CDN worker in a same-origin blob; browsers block cross-origin workers
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
  )
  try {
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(workerUrl))
    await db.instantiate(bundle.mainModule)
    return db
  } finally {
    URL.revokeObjectURL(workerUrl)
  }
}

/**
 * The page's one DuckDB instance, shared by every viewer and widget that asks for it.
 * The first call starts it (~1 s to download and compile); later calls get the same one, so
 * calling this early is a cheap way to preload it.
 *
 * Callers open their own connection (`db.connect()`) and close it when done. Files registered
 * with `registerFileBuffer` are visible to everyone, so give them names that won't collide
 * (e.g. a per-dataset prefix) and `dropFile` them when no longer needed.
 */
export function getSharedDuckDB(source: DuckDBSource): Promise<AsyncDuckDB> {
  if (!shared) {
    const instance = createDuckDB(source)
    shared = instance
    // A failed start shouldn't stick: the next call tries again
    instance.catch(() => {
      if (shared === instance) shared = null
    })
  }
  return shared
}

/** Stop the shared instance and its worker. The next `getSharedDuckDB` starts a new one. */
export async function terminateSharedDuckDB(): Promise<void> {
  const instance = shared
  shared = null
  const db = await instance?.catch(() => null)
  await db?.terminate()
}
