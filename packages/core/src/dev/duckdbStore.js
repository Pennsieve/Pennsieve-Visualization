// Dev-only DuckDB store for the core playground.
// In production, the consuming app provides its own store via app.provide('duckdb', store).
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useDuckDBStore = defineStore('duckdb', () => {
  const db = ref(null)
  const isInitialized = ref(false)
  const isInitializing = ref(false)
  const initError = ref('')
  const loadedFiles = ref(new Map())
  const connections = ref(new Map())
  const fileUsage = ref(new Map())
  const sharedResultName = ref(null)
  const sharedVersion = ref(0)

  const isReady = computed(() => isInitialized.value && !initError.value)
  let initPromise = null

  const initDuckDB = async () => {
    if (db.value) return db.value
    // Another caller already kicked off init — wait for it
    if (initPromise) { await initPromise; return db.value }

    isInitializing.value = true
    initError.value = ''
    initPromise = (async () => {
      try {
        const duckdb = await import('@duckdb/duckdb-wasm')
        const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles())
        // Wrap CDN worker URL in a same-origin blob to avoid cross-origin worker restriction
        const workerUrl = URL.createObjectURL(
          new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
        )
        const worker = new Worker(workerUrl)
        const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
        db.value = new duckdb.AsyncDuckDB(logger, worker)
        await db.value.instantiate(bundle.mainModule)
        isInitialized.value = true
        return db.value
      } catch (err) {
        initError.value = `Failed to initialize DuckDB: ${err.message}`
        db.value = null
        throw err
      } finally {
        isInitializing.value = false
        initPromise = null
      }
    })()
    await initPromise
    return db.value
  }

  const createConnection = async (viewerId = null) => {
    if (!isReady.value) await initDuckDB()
    const conn = await db.value.connect()
    const id = viewerId || `conn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
    connections.value.set(id, { connection: conn, viewerId: id, createdAt: new Date() })
    return { connection: conn, connectionId: id }
  }

  const closeConnection = async (connectionId) => {
    const connData = connections.value.get(connectionId)
    if (connData) {
      await connData.connection.close()
      connections.value.delete(connectionId)
      for (const [, viewerSet] of fileUsage.value) viewerSet.delete(connectionId)
    }
  }

  const loadFile = async (fileUrl, fileType, tableName = 'my_data', csvOptions = {}, viewerId = null, fileId = null) => {
    const stableKey = fileId || fileUrl
    const existing = loadedFiles.value.get(stableKey)
    if (existing && !existing.isLoading && !existing.error) {
      if (viewerId && !fileUsage.value.has(stableKey)) fileUsage.value.set(stableKey, new Set())
      if (viewerId) fileUsage.value.get(stableKey)?.add(viewerId)
      return existing.tableName
    }
    if (!isReady.value) await initDuckDB()
    loadedFiles.value.set(stableKey, { tableName, fileType, fileUrl, isLoading: true, error: null })
    try {
      const response = await fetch(fileUrl)
      if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`)
      const arrayBuffer = await response.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      const fileName = `${fileId || tableName}.${fileType}`
      await db.value.registerFileBuffer(fileName, uint8Array)
      const tempConn = await db.value.connect()
      try {
        const query = fileType === 'csv'
          ? `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv('${fileName}', header=${csvOptions.header ?? true}, delim='${csvOptions.delimiter ?? ','}');`
          : `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_parquet('${fileName}');`
        await tempConn.query(query)
        const result = await tempConn.query(`SELECT COUNT(*) as count FROM ${tableName};`)
        const rowCount = result.toArray()[0].count
        loadedFiles.value.set(stableKey, { tableName, fileType, fileUrl, isLoading: false, error: null, rowCount, loadedAt: new Date() })
        if (viewerId) {
          if (!fileUsage.value.has(stableKey)) fileUsage.value.set(stableKey, new Set())
          fileUsage.value.get(stableKey).add(viewerId)
        }
        return tableName
      } finally { await tempConn.close() }
    } catch (err) {
      loadedFiles.value.set(stableKey, { tableName, fileType, fileUrl, isLoading: false, error: err.message })
      throw err
    }
  }

  const executeQuery = async (query, connectionId) => {
    const connData = connections.value.get(connectionId)
    if (!connData) throw new Error(`Connection not found: ${connectionId}`)
    const result = await connData.connection.query(query)
    return result.toArray().map(row => {
      const plain = {}
      for (const [k, v] of Object.entries(row)) plain[k] = v
      return plain
    })
  }

  const formatIdFromUrl = (srcUrl) => 'url_' + btoa(srcUrl).replace(/=+$/, '').replace(/[+/]/g, '_')

  const escapeId = (name) => `"${String(name).replace(/"/g, '""')}"`

  const publishViewFromQuery = async (name, sql, connectionId) => {
    const c = connections.value.get(connectionId)?.connection
    if (!c) throw new Error(`Connection not found: ${connectionId}`)
    await c.query(`CREATE OR REPLACE VIEW ${escapeId(name)} AS ${sql}`)
    sharedResultName.value = name
    sharedVersion.value++
  }

  return {
    db, isInitialized, isInitializing, initError, loadedFiles, connections, fileUsage,
    sharedResultName, sharedVersion, isReady,
    initDuckDB, createConnection, closeConnection, loadFile, executeQuery,
    formatIdFromUrl, publishViewFromQuery,
  }
})
