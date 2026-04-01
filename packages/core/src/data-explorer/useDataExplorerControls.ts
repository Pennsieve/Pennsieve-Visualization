/**
 * Composable for external control of DataExplorer instances.
 * Use this in wrapper components or external control panels that need
 * to interact with DataExplorer state.
 *
 * @example
 * import { useDataExplorerControls } from '@pennsieve-viz/core'
 *
 * const controls = useDataExplorerControls('explorer-1')
 *
 * // Read state
 * const results = controls.queryResults.value
 * const columns = controls.tableColumns.value
 *
 * // Control explorer
 * controls.setQuery('SELECT * FROM data LIMIT 10')
 * controls.setDisplayMode('json')
 */

import { readonly, toRef, computed } from 'vue'
import { createDataExplorerStore } from './dataExplorerStore'
export type { QueryResult, CSVOptions } from './dataExplorerStore'

/**
 * Provides read and write access to a DataExplorer instance's state.
 *
 * @param instanceId - The unique identifier of the DataExplorer instance
 * @returns Control interface for the explorer
 */
export function useDataExplorerControls(instanceId = 'default') {
  const store = createDataExplorerStore(instanceId)

  // ============================================
  // STATE QUERIES
  // ============================================

  const getState = () => ({
    isLoading: store.isLoading,
    isQueryRunning: store.isQueryRunning,
    error: store.error,
    isConnected: store.isConnected,
    hasResults: store.hasResults,
    sqlQuery: store.sqlQuery,
    rowCount: store.rowCount,
    currentPage: store.currentPage,
    totalPages: store.totalPages,
    displayMode: store.displayMode,
    sourceInfo: { ...store.sourceInfo },
  })

  // ============================================
  // RETURN PUBLIC API
  // ============================================

  return {
    // Readonly state
    isLoading: readonly(toRef(store, 'isLoading')),
    isQueryRunning: readonly(toRef(store, 'isQueryRunning')),
    isFileLoading: readonly(toRef(store, 'isFileLoading')),
    error: readonly(toRef(store, 'error')),
    sqlQuery: readonly(toRef(store, 'sqlQuery')),
    queryResults: readonly(toRef(store, 'queryResults')),
    queryHistory: readonly(toRef(store, 'queryHistory')),
    currentPage: readonly(toRef(store, 'currentPage')),
    itemsPerPage: readonly(toRef(store, 'itemsPerPage')),
    displayMode: readonly(toRef(store, 'displayMode')),

    // Computed (from store getters)
    isConnected: computed(() => store.isConnected),
    hasResults: computed(() => store.hasResults),
    tableColumns: computed(() => store.tableColumns),
    totalPages: computed(() => store.totalPages),
    paginatedResults: computed(() => store.paginatedResults),
    rowCount: computed(() => store.rowCount),

    // State queries
    getState,

    // Query controls
    setQuery: (query: string) => store.setQuery(query),
    setQueryResults: (results: any[] | null) => store.setQueryResults(results),
    addToQueryHistory: (query: string) => store.addToQueryHistory(query),
    clearQueryHistory: () => store.clearQueryHistory(),
    interceptQuery: (query: string) => store.interceptQuery(query),

    // Pagination controls
    setCurrentPage: (page: number) => store.setCurrentPage(page),
    setItemsPerPage: (count: number) => store.setItemsPerPage(count),
    nextPage: () => store.nextPage(),
    prevPage: () => store.prevPage(),

    // Display controls
    setDisplayMode: (mode: 'table' | 'json') => store.setDisplayMode(mode),
    toggleDisplayMode: () => store.toggleDisplayMode(),

    // Error handling
    setError: (err: string) => store.setError(err),
    clearError: () => store.clearError(),

    // Source tracking
    setSourceInfo: (info: Partial<typeof store.sourceInfo>) => store.setSourceInfo(info),

    // Lifecycle
    reset: () => store.resetStore(),

    // Direct store access (advanced)
    store,
  }
}
