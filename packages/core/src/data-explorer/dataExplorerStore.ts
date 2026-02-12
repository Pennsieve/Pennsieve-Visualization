// @/stores/dataExplorerStore.ts
import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'

// Store instance cache - maps instanceId to store factory function
// Using 'any' for the Map value type to avoid complex generic inference issues
// The actual return type is properly inferred at the call site
const storeInstances = new Map<string, any>()

// Track if we've shown warnings (to avoid spam)
let hasShownDefaultWarning = false
let hasShownDeprecationWarning = false

export interface QueryResult {
  [key: string]: any
}

export interface CSVOptions {
  header: boolean
  dynamicTyping: boolean
  delimiter: string
}

/**
 * Factory function to create or retrieve a DataExplorer store instance.
 * Each instanceId gets its own isolated store, enabling multiple
 * independent DataExplorer components on the same page.
 *
 * @param instanceId - Unique identifier for the DataExplorer instance
 * @returns Pinia store instance for this DataExplorer
 */
export function createDataExplorerStore(instanceId = 'default') {
  // Warn once if using default instanceId
  if (instanceId === 'default' && !hasShownDefaultWarning) {
    hasShownDefaultWarning = true
    console.warn(
      '[DataExplorer] Using default store instance. ' +
      'For multi-instance support, pass a unique instanceId prop to DataExplorer. ' +
      'Example: <DataExplorer instance-id="explorer-1" />'
    )
  }

  // Return cached instance if it exists
  if (storeInstances.has(instanceId)) {
    return storeInstances.get(instanceId)!()
  }

  // Create a new store with a unique ID (prefixed to avoid conflicts with consuming apps)
  const useStore = defineStore(`pennsieve-viz-duckdb-dataExplorer-${instanceId}`, () => {
    // ============= Loading State =============
    const isLoading = ref(false)
    const isQueryRunning = ref(false)
    const isFileLoading = ref(false)
    const error = ref('')

    // ============= Connection State =============
    const connectionId = ref<string | null>(null)
    const tableName = ref<string | null>(null)

    // ============= Query State =============
    const sqlQuery = ref('')
    const queryResults = ref<QueryResult[] | null>(null)
    const queryHistory = ref<string[]>([])

    // ============= Pagination State =============
    const currentPage = ref(1)
    const itemsPerPage = ref(50)

    // ============= Display State =============
    const displayMode = ref<'table' | 'json'>('table')

    // ============= CSV Options =============
    const csvOptions = reactive<CSVOptions>({
      header: true,
      dynamicTyping: true,
      delimiter: ',',
    })

    // ============= Source Tracking =============
    const sourceInfo = reactive({
      url: '' as string,
      fileType: 'parquet' as 'csv' | 'parquet',
      fileId: null as string | null,
      viewerId: null as string | null,
    })

    // ============= Getters =============
    const isConnected = computed(() => connectionId.value !== null && !isLoading.value)
    const hasResults = computed(() => queryResults.value !== null && queryResults.value.length > 0)

    const tableColumns = computed(() => {
      if (!queryResults.value || !Array.isArray(queryResults.value) || queryResults.value.length === 0) {
        return []
      }
      return Object.keys(queryResults.value[0] || {})
    })

    const totalPages = computed(() => {
      if (!queryResults.value || !Array.isArray(queryResults.value)) return 0
      return Math.ceil(queryResults.value.length / itemsPerPage.value)
    })

    const paginatedResults = computed(() => {
      if (!queryResults.value || !Array.isArray(queryResults.value)) return []
      const start = (currentPage.value - 1) * itemsPerPage.value
      const end = start + itemsPerPage.value
      return queryResults.value.slice(start, end)
    })

    const rowCount = computed(() => queryResults.value?.length ?? 0)

    // ============= Actions =============

    // Connection management
    const setConnectionId = (id: string | null) => {
      connectionId.value = id
    }

    const setTableName = (name: string | null) => {
      tableName.value = name
    }

    // Query management
    const setQuery = (query: string) => {
      sqlQuery.value = query
    }

    const setQueryResults = (results: QueryResult[] | null) => {
      queryResults.value = results
      currentPage.value = 1 // Reset to first page on new results
    }

    const addToQueryHistory = (query: string) => {
      // Avoid duplicates and limit history size
      const trimmedQuery = query.trim()
      if (trimmedQuery && !queryHistory.value.includes(trimmedQuery)) {
        queryHistory.value.unshift(trimmedQuery)
        if (queryHistory.value.length > 50) {
          queryHistory.value.pop()
        }
      }
    }

    const clearQueryHistory = () => {
      queryHistory.value = []
    }

    // Pagination
    const setCurrentPage = (page: number) => {
      currentPage.value = page
    }

    const setItemsPerPage = (count: number) => {
      itemsPerPage.value = count
      currentPage.value = 1 // Reset to first page when changing page size
    }

    const nextPage = () => {
      if (currentPage.value < totalPages.value) {
        currentPage.value++
      }
    }

    const prevPage = () => {
      if (currentPage.value > 1) {
        currentPage.value--
      }
    }

    // Display mode
    const setDisplayMode = (mode: 'table' | 'json') => {
      displayMode.value = mode
    }

    const toggleDisplayMode = () => {
      displayMode.value = displayMode.value === 'table' ? 'json' : 'table'
    }

    // Loading states
    const setLoading = (loading: boolean) => {
      isLoading.value = loading
    }

    const setQueryRunning = (running: boolean) => {
      isQueryRunning.value = running
    }

    const setFileLoading = (loading: boolean) => {
      isFileLoading.value = loading
    }

    // Error handling
    const setError = (err: string) => {
      error.value = err
    }

    const clearError = () => {
      error.value = ''
    }

    // CSV options
    const setCsvOptions = (options: Partial<CSVOptions>) => {
      Object.assign(csvOptions, options)
    }

    // Source tracking
    const setSourceInfo = (info: Partial<typeof sourceInfo>) => {
      Object.assign(sourceInfo, info)
    }

    // Query interception (replace 'data' with actual table name)
    const interceptQuery = (query: string): string => {
      if (!tableName.value || !query) return query

      return query
        .replace(/\bFROM\s+data\b/gi, `FROM ${tableName.value}`)
        .replace(/\bJOIN\s+data\b/gi, `JOIN ${tableName.value}`)
        .replace(/\bUPDATE\s+data\b/gi, `UPDATE ${tableName.value}`)
        .replace(/\bINSERT\s+INTO\s+data\b/gi, `INSERT INTO ${tableName.value}`)
        .replace(/\bINTO\s+data\b/gi, `INTO ${tableName.value}`)
        .replace(/\btable_info\(\s*data\s*\)/gi, `table_info(${tableName.value})`)
    }

    // Reset all state
    const resetStore = () => {
      isLoading.value = false
      isQueryRunning.value = false
      isFileLoading.value = false
      error.value = ''
      connectionId.value = null
      tableName.value = null
      sqlQuery.value = ''
      queryResults.value = null
      queryHistory.value = []
      currentPage.value = 1
      itemsPerPage.value = 50
      displayMode.value = 'table'
      csvOptions.header = true
      csvOptions.dynamicTyping = true
      csvOptions.delimiter = ','
      sourceInfo.url = ''
      sourceInfo.fileType = 'parquet'
      sourceInfo.fileId = null
      sourceInfo.viewerId = null
    }

    return {
      // State
      isLoading,
      isQueryRunning,
      isFileLoading,
      error,
      connectionId,
      tableName,
      sqlQuery,
      queryResults,
      queryHistory,
      currentPage,
      itemsPerPage,
      displayMode,
      csvOptions,
      sourceInfo,

      // Getters
      isConnected,
      hasResults,
      tableColumns,
      totalPages,
      paginatedResults,
      rowCount,

      // Actions
      setConnectionId,
      setTableName,
      setQuery,
      setQueryResults,
      addToQueryHistory,
      clearQueryHistory,
      setCurrentPage,
      setItemsPerPage,
      nextPage,
      prevPage,
      setDisplayMode,
      toggleDisplayMode,
      setLoading,
      setQueryRunning,
      setFileLoading,
      setError,
      clearError,
      setCsvOptions,
      setSourceInfo,
      interceptQuery,
      resetStore,
    }
  })

  // Cache the store factory function
  storeInstances.set(instanceId, useStore)

  // Return the store instance
  return useStore()
}

/**
 * Clears a specific DataExplorer store instance from the cache.
 * Call this when unmounting a DataExplorer component to clean up resources.
 *
 * @param instanceId - The instance ID to clear
 */
export function clearDataExplorerStore(instanceId: string) {
  if (storeInstances.has(instanceId)) {
    const store = storeInstances.get(instanceId)!()
    store.resetStore()
    storeInstances.delete(instanceId)
  }
}

/**
 * Clears all DataExplorer store instances from the cache.
 */
export function clearAllDataExplorerStores() {
  storeInstances.forEach((useStore) => {
    const store = useStore()
    store.resetStore()
  })
  storeInstances.clear()
}

/**
 * @deprecated Use createDataExplorerStore(instanceId) instead for multi-instance support.
 * This export is kept for backwards compatibility with existing code.
 * Returns the default singleton store instance.
 */
export function useDataExplorerStore() {
  if (!hasShownDeprecationWarning) {
    hasShownDeprecationWarning = true
    console.warn(
      '[DataExplorer] useDataExplorerStore() is deprecated. ' +
      'Use createDataExplorerStore(instanceId) for multi-instance support.'
    )
  }
  return createDataExplorerStore('default')
}
