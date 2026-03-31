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

import { readonly } from 'vue'
import { storeToRefs } from 'pinia'
import { createDataExplorerStore } from './dataExplorerStore'

/**
 * Provides read and write access to a DataExplorer instance's state.
 *
 * @param instanceId - The unique identifier of the DataExplorer instance
 * @returns Control interface for the explorer
 */
export function useDataExplorerControls(instanceId = 'default') {
  const store = createDataExplorerStore(instanceId)

  const {
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
    isConnected,
    hasResults,
    tableColumns,
    totalPages,
    paginatedResults,
    rowCount,
  } = storeToRefs(store)

  // ============================================
  // STATE QUERIES
  // ============================================

  const getState = () => ({
    isLoading: isLoading.value,
    isQueryRunning: isQueryRunning.value,
    error: error.value,
    isConnected: isConnected.value,
    hasResults: hasResults.value,
    sqlQuery: sqlQuery.value,
    rowCount: rowCount.value,
    currentPage: currentPage.value,
    totalPages: totalPages.value,
    displayMode: displayMode.value,
    sourceInfo: { ...sourceInfo.value },
  })

  // ============================================
  // RETURN PUBLIC API
  // ============================================

  return {
    // Readonly state
    isLoading: readonly(isLoading),
    isQueryRunning: readonly(isQueryRunning),
    isFileLoading: readonly(isFileLoading),
    error: readonly(error),
    sqlQuery: readonly(sqlQuery),
    queryResults: readonly(queryResults),
    queryHistory: readonly(queryHistory),
    currentPage: readonly(currentPage),
    itemsPerPage: readonly(itemsPerPage),
    displayMode: readonly(displayMode),

    // Computed
    isConnected,
    hasResults,
    tableColumns,
    totalPages,
    paginatedResults,
    rowCount,

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
    setSourceInfo: (info: Partial<typeof sourceInfo.value>) => store.setSourceInfo(info),

    // Lifecycle
    reset: () => store.resetStore(),

    // Direct store access (advanced)
    store,
  }
}
