export { default as DataExplorer } from './DataExplorerWrap.vue'
export { default as DataExplorerCore } from './DataExplorer.vue'

// Store exports (factory pattern — see ARCHITECTURE.md)
export {
  createDataExplorerStore,
  clearDataExplorerStore,
  clearAllDataExplorerStores,
  useDataExplorerStore, // deprecated, for backwards compatibility
} from './dataExplorerStore'
export type { QueryResult, CSVOptions } from './dataExplorerStore'

// Controls composable (external API for side panels / palettes)
export { useDataExplorerControls } from './useDataExplorerControls'
