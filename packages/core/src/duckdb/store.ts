import { reactive, ref } from 'vue'
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import type { DuckDBStoreInterface } from './types'
import { getSharedDuckDB, type DuckDBSource } from './shared'

interface LoadedFile {
  tableName: string
  fileType: 'csv' | 'parquet'
  fileUrl: string
  isLoading: boolean
  error: string | null
  rowCount?: number
}

/**
 * A `DuckDBStoreInterface` (what DataExplorer and UMAP inject as `'duckdb'`) backed by the
 * page's shared DuckDB. Usually you want `getSharedDuckDBStore`, so every component on the
 * page shares one store: DataExplorer publishes query results that UMAP reads.
 *
 * @example
 * ```ts
 * app.provide('duckdb', getSharedDuckDBStore(() => import('@duckdb/duckdb-wasm')))
 * ```
 */
export function createDuckDBStore(source: DuckDBSource) {
  let db: AsyncDuckDB | null = null
  const isReady = ref(false)
  const initError = ref<string | null>(null)
  const loadedFiles = new Map<string, LoadedFile>()
  const connections = new Map<string, AsyncDuckDBConnection>()
  const sharedResultName = ref<string | null>(null)
  const sharedVersion = ref(0)

  async function initDuckDB(): Promise<AsyncDuckDB> {
    if (db) return db
    try {
      db = await getSharedDuckDB(source)
      initError.value = null
      isReady.value = true
      return db
    } catch (err) {
      initError.value = `Failed to initialize DuckDB: ${err instanceof Error ? err.message : String(err)}`
      isReady.value = false
      throw err
    }
  }

  async function createConnection(viewerId?: string) {
    const connection = await (await initDuckDB()).connect()
    const connectionId = viewerId || `conn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
    connections.set(connectionId, connection)
    return { connection, connectionId }
  }

  async function closeConnection(connectionId: string) {
    const connection = connections.get(connectionId)
    if (!connection) return
    connections.delete(connectionId)
    await connection.close()
  }

  async function loadFile(
    fileUrl: string,
    fileType: 'csv' | 'parquet',
    tableName = 'my_data',
    csvOptions: { header?: boolean; delimiter?: string } = {},
    _viewerId?: string,
    fileId?: string,
  ): Promise<string> {
    const key = fileId || fileUrl
    const existing = loadedFiles.get(key)
    if (existing && !existing.isLoading && !existing.error) return existing.tableName

    const instance = await initDuckDB()
    loadedFiles.set(key, { tableName, fileType, fileUrl, isLoading: true, error: null })
    try {
      const response = await fetch(fileUrl)
      if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`)
      // Prefixed so it can't collide with files other users of the shared DuckDB register
      const fileName = `duckdb-store/${fileId || tableName}.${fileType}`
      await instance.registerFileBuffer(fileName, new Uint8Array(await response.arrayBuffer()))
      const conn = await instance.connect()
      try {
        const read =
          fileType === 'csv'
            ? `read_csv('${fileName}', header=${csvOptions.header ?? true}, delim='${csvOptions.delimiter ?? ','}')`
            : `read_parquet('${fileName}')`
        await conn.query(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM ${read};`)
        const result = await conn.query(`SELECT COUNT(*) as count FROM ${tableName};`)
        const rowCount = Number(result.toArray()[0].count)
        loadedFiles.set(key, { tableName, fileType, fileUrl, isLoading: false, error: null, rowCount })
        return tableName
      } finally {
        await conn.close()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      loadedFiles.set(key, { tableName, fileType, fileUrl, isLoading: false, error: message })
      throw err
    }
  }

  async function executeQuery(query: string, connectionId: string): Promise<any[]> {
    const connection = connections.get(connectionId)
    if (!connection) throw new Error(`Connection not found: ${connectionId}`)
    const result = await connection.query(query)
    return result.toArray().map((row: any) => {
      const plain: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) plain[k] = v
      return plain
    })
  }

  function formatIdFromUrl(srcUrl: string) {
    return 'url_' + btoa(srcUrl).replace(/=+$/, '').replace(/[+/]/g, '_')
  }

  const escapeId = (name: string) => `"${String(name).replace(/"/g, '""')}"`

  async function publishViewFromQuery(name: string, sql: string, connectionId: string) {
    const connection = connections.get(connectionId)
    if (!connection) throw new Error(`Connection not found: ${connectionId}`)
    await connection.query(`CREATE OR REPLACE VIEW ${escapeId(name)} AS ${sql}`)
    sharedResultName.value = name
    sharedVersion.value++
  }

  // reactive() unwraps the refs on access, as a Pinia store does: components read
  // `store.sharedResultName` as a plain value and watch it through a getter
  const store = reactive({
    isReady,
    initError,
    sharedResultName,
    sharedVersion,
    initDuckDB,
    createConnection,
    closeConnection,
    loadFile,
    executeQuery,
    formatIdFromUrl,
    publishViewFromQuery,
  })
  // Compile-time check that this is a valid 'duckdb' store
  const asInterface: DuckDBStoreInterface = store
  void asInterface
  return store
}

export type SharedDuckDBStore = ReturnType<typeof createDuckDBStore>

let sharedStore: SharedDuckDBStore | null = null

/**
 * The page's one `'duckdb'` store, created on first call. Provide it wherever DataExplorer or
 * UMAP render and the host hasn't provided its own store.
 */
export function getSharedDuckDBStore(source: DuckDBSource): SharedDuckDBStore {
  if (!sharedStore) sharedStore = createDuckDBStore(source)
  return sharedStore
}
