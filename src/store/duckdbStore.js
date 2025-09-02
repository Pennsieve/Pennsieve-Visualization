
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useDuckDBStore = defineStore('duckdb', () => {
    // State
    const db = ref(null)
    const isInitialized = ref(false)
    const isInitializing = ref(false)
    const initError = ref('')
    const loadedFiles = ref(new Map()) 
    const connections = ref(new Map()) 
    const fileUsage = ref(new Map()) 

    let initPromise = null

    // Getters
    const isReady = computed(() => isInitialized.value && !initError.value)
    const getLoadedFile = computed(() => (fileId) => {console.log(fileId); return loadedFiles.value.get(fileId)})
    const isFileLoaded = computed(() => (fileId) => {
        const file = loadedFiles.value.get(fileId)
        return file && !file.isLoading && !file.error
    })
    const activeConnectionCount = computed(() => connections.value.size)
    const hasActiveConnections = computed(() => connections.value.size > 0)

    // Actions

const initDuckDB = async () => {
    // SSR / non-browser guard
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      const msg = 'DuckDB can only be initialized in the browser.'
      initError.value = msg
      throw new Error(msg)
    }
  
    // Already initialized
    if (db.value) return db.value
  
    // Another caller already kicked off initialization → wait for it
    if (initPromise) {
      await initPromise
      return db.value
    }
  
    // First caller: perform initialization
    isInitializing.value = true
    initError.value = ''
    initPromise = (async () => {
      try {
        const duckdb = await import('@duckdb/duckdb-wasm')
  
        const bundles = {
          mvp: {
            mainModule: '/static/duckdb/duckdb-mvp.wasm',
            mainWorker: '/static/duckdb/duckdb-browser-mvp.worker.js',
          },
          eh: {
            mainModule: '/static/duckdb/duckdb-eh.wasm',
            mainWorker: '/static/duckdb/duckdb-browser-eh.worker.js',
          },
        }
  
        const bundle = await duckdb.selectBundle(bundles)
        const worker = new Worker(bundle.mainWorker)
        const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
  
        db.value = new duckdb.AsyncDuckDB(logger, worker)
        await db.value.instantiate(bundle.mainModule)
  
        isInitialized.value = true
        return db.value
      } catch (err) {
        initError.value = `Failed to initialize DuckDB: ${err?.message || err}`
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
  

const createConnection = async (viewerId) => {
    // Ensure a single, completed init (handles concurrency)
    if (!db.value) await initDuckDB()
  
    const conn = await db.value.connect()
    const id =
      viewerId || `conn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  
    connections.value.set(id, {
      connection: conn,
      viewerId: id,
      createdAt: new Date(),
    })
  
    return { connection: conn, connectionId: id }
  }
  

    const closeConnection = async (connectionId) => {
        const connData = connections.value.get(connectionId)
        if (connData) {
            await connData.connection.close()
            connections.value.delete(connectionId)
            // console.log(`Closed connection for viewer: ${connectionId}`)

            // Clean up file usage for this viewer
            cleanupViewerFileUsage(connectionId)

            // If this was the last connection, consider global cleanup
            if (connections.value.size === 0) {
                console.log('No active connections remaining. Keeping DuckDB instance for potential reuse.')
                // Optionally: await performGlobalCleanup() if you want to clean up immediately
            }
        }
    }

    const cleanupViewerFileUsage = (viewerId) => {
        // Remove this viewer from all file usage tracking
        for (const [fileId, viewerSet] of fileUsage.value) {
            viewerSet.delete(viewerId)

            // If no viewers are using this file anymore, we could optionally remove it
            if (viewerSet.size === 0) {
                console.log(`File ${fileId} is no longer used by any viewers`)
                // Optionally remove the file from DuckDB and loadedFiles
                // unloadFile(fileId)
            }
        }
    }

    const trackFileUsage = (fileId, viewerId) => {
        if (!fileUsage.value.has(fileId)) {
            fileUsage.value.set(fileId, new Set())
        }
        fileUsage.value.get(fileId).add(viewerId)
        // console.log(`Tracking file usage: ${fileId} by viewer ${viewerId}`)
    }

    const unloadFile = async (fileId) => {
        const file = loadedFiles.value.get(fileId)
        if (file && file.tableName) {
            // Drop the table from DuckDB if no viewers are using it
            try {
                const tempConn = await db.value.connect()
                await tempConn.query(`DROP TABLE IF EXISTS ${file.tableName};`)
                await tempConn.close()
                // console.log(`Dropped table: ${file.tableName}`)
            } catch (err) {
                console.warn(`Failed to drop table ${file.tableName}:`, err)
            }
        }

        loadedFiles.value.delete(fileId)
        fileUsage.value.delete(fileId)
        // console.log(`Unloaded file: ${fileId}`)
    }

    // Updated loadFile function with stable fileId parameter
    const loadFile = async (fileUrl, fileType, tableName = 'my_data', csvOptions = {}, viewerId = null, fileId = null) => {
        //console.log("fileurl: "+fileUrl,"fileType: "+fileType,"tableName: "+tableName,"csvOptions: "+csvOptions,"viewerId: "+viewerId,"fileId: "+fileId)
        // Use fileId as the stable key, fallback to fileUrl if not provided (for backward compatibility)
        const stableKey = fileId || fileUrl

        // Check if file is already loaded using stable key
        const existingFile = loadedFiles.value.get(stableKey)
        console.log(loadedFiles.value)
        if (existingFile && !existingFile.isLoading && !existingFile.error) {
             console.log(`File already loaded using stable key ${stableKey}, reusing table: ${existingFile.tableName}`)
            // Track usage by this viewer
            if (viewerId) {
                trackFileUsage(stableKey, viewerId)
            }
            return existingFile.tableName
        }

        // Ensure DuckDB is initialized
        if (!isReady.value) {
            await initDuckDB()
        }

        // Set loading state
        loadedFiles.value.set(stableKey, {
            tableName,
            fileType,
            fileUrl, // Store the current URL for reference
            isLoading: true,
            error: null
        })

        try {
            // console.log(`Loading ${fileType} file from: ${fileUrl} with stable key: ${stableKey}`)

            // Download file once
            const response = await fetch(fileUrl)
            if (!response.ok) {
                throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`)
            }

            let uint8Array
            if (fileType === 'csv') {
                const fileText = await response.text()
                const blob = new Blob([fileText], { type: 'text/csv' })
                const arrayBuffer = await blob.arrayBuffer()
                uint8Array = new Uint8Array(arrayBuffer)
            } else {
                const arrayBuffer = await response.arrayBuffer()
                uint8Array = new Uint8Array(arrayBuffer)
            }

            // Register file with DuckDB using stable key for filename
            const fileName = `${fileId || tableName}.${fileType}`
            await db.value.registerFileBuffer(fileName, uint8Array)

            // Create temporary connection for loading
            const tempConn = await db.value.connect()

            try {
                let createTableQuery
                if (fileType === 'csv') {
                    const options = {
                        header: true,
                        delimiter: ',',
                        ...csvOptions
                    }
                    createTableQuery = `
            CREATE OR REPLACE TABLE ${tableName} AS
            SELECT * FROM read_csv('${fileName}', header=${options.header}, delim='${options.delimiter}');
          `
                } else if (fileType === 'parquet') {
         
                    createTableQuery = `
            CREATE OR REPLACE TABLE ${tableName} AS
            SELECT * FROM read_parquet('${fileName}');
          `
                } else {
                    throw new Error(`Unsupported file type: ${fileType}`)
                }

                await tempConn.query(createTableQuery)

                // Verify table creation
                const result = await tempConn.query(`SELECT COUNT(*) as count FROM ${tableName};`)
                const rowCount = result.toArray()[0].count

                // Update loaded files state
                loadedFiles.value.set(stableKey, {
                    tableName,
                    fileType,
                    fileUrl, // Store current URL for reference
                    isLoading: false,
                    error: null,
                    rowCount,
                    loadedAt: new Date()
                })

                // Track usage by this viewer
                if (viewerId) {
                    trackFileUsage(stableKey, viewerId)
                }

                // console.log(`Successfully loaded ${rowCount} rows from ${fileType} file into table: ${tableName} (stable key: ${stableKey})`)
                return tableName

            } finally {
                await tempConn.close()
            }

        } catch (err) {
            // console.error(`Failed to load ${fileType} file:`, err)
            loadedFiles.value.set(stableKey, {
                tableName,
                fileType,
                fileUrl,
                isLoading: false,
                error: err.message
            })
            throw err
        }
    }

    const executeQuery = async (query, connectionId) => {
        const connData = connections.value.get(connectionId)
        if (!connData) {
            throw new Error(`Connection not found: ${connectionId}`)
        }

        const result = await connData.connection.query(query)
        return result.toArray().map(row => {
            const plainRow = {}
            for (const [key, value] of Object.entries(row)) {
                plainRow[key] = value
            }
            return plainRow
        })
    }

    const performGlobalCleanup = async () => {
        // console.log('Performing global DuckDB cleanup...')

        // Close all remaining connections
        for (const [id, connData] of connections.value) {
            try {
                await connData.connection.close()
                console.log(`Closed connection: ${id}`)
            } catch (err) {
                console.warn(`Error closing connection ${id}:`, err)
            }
        }
        connections.value.clear()

        // Terminate DuckDB
        if (db.value) {
            try {
                await db.value.terminate()
                // console.log('DuckDB instance terminated')
            } catch (err) {
                console.warn('Error terminating DuckDB:', err)
            }
            db.value = null
        }

        // Reset state
        isInitialized.value = false
        loadedFiles.value.clear()
        fileUsage.value.clear()
        initError.value = ''
    }

    const cleanup = async (force = false) => {
        if (force || connections.value.size === 0) {
            await performGlobalCleanup()
        } else {
            console.log(`Skipping global cleanup. ${connections.value.size} active connections remaining.`)
        }
    }

    const getConnectionInfo = () => {
        const info = []
        for (const [id, connData] of connections.value) {
            info.push({
                connectionId: id,
                viewerId: connData.viewerId,
                createdAt: connData.createdAt
            })
        }
        return info
    }

    const getFileUsageInfo = () => {
        const info = []
        for (const [fileId, viewerSet] of fileUsage.value) {
            const file = loadedFiles.value.get(fileId)
            info.push({
                fileId,
                tableName: file?.tableName,
                fileType: file?.fileType,
                fileUrl: file?.fileUrl,
                rowCount: file?.rowCount,
                loadedAt: file?.loadedAt,
                usedByViewers: Array.from(viewerSet)
            })
        }
        return info
    }

    const sharedResultName = ref(null)
    const sharedVersion = ref(0)

    function quoteIdent(name) {
    return `"${String(name).replace(/"/g, '""')}"`
    }

    // publish the user’s query as a DB-wide VIEW (lightweight, auto-updates from base tables)
    const publishViewFromQuery = async (name, sql, connectionId) => {
        const c = connections.value.get(connectionId)?.connection
        if (!c) throw new Error(`Connection not found: ${connectionId}`)
        // make it visible to all connections (NOT TEMP)
        await c.query(`CREATE OR REPLACE VIEW ${quoteIdent(name)} AS ${sql}`)
        sharedResultName.value = name
        sharedVersion.value++
    }

    // or publish as a TABLE (materialized snapshot). Slightly heavier, but isolates from base table changes.
    const publishTableFromQuery = async (name, sql, connectionId) => {
        const c = connections.value.get(connectionId)?.connection
        if (!c) throw new Error(`Connection not found: ${connectionId}`)
        await c.query(`CREATE OR REPLACE TABLE ${quoteIdent(name)} AS ${sql}`)
        sharedResultName.value = name
        sharedVersion.value++
    }
    const formatIdFromUrl = (srUrl)=>{
        console.log(srUrl)
        return ('url_' + btoa(srUrl).replace(/=+$/,'').replace(/[+/]/g,'_'))
    }
    return {
        // State
        db,
        isInitialized,
        isInitializing,
        initError,
        loadedFiles,
        connections,
        fileUsage,
        sharedResultName,
        sharedVersion,

        // Getters
        isReady,
        getLoadedFile,
        isFileLoaded,
        activeConnectionCount,
        hasActiveConnections,

        // Actions
        initDuckDB,
        createConnection,
        closeConnection,
        cleanupViewerFileUsage,
        trackFileUsage,
        unloadFile,
        loadFile,
        executeQuery,
        cleanup,
        performGlobalCleanup,
        getConnectionInfo,
        getFileUsageInfo,
        publishViewFromQuery,
        publishTableFromQuery,
        formatIdFromUrl
    }
})