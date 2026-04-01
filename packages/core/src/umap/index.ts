export { default as UMAP } from './wrapper.vue'
export { default as UMAPScatterplot } from './scatterplot.vue'
export { default as UMAPControlPanel } from './control.vue'

// Store exports (factory pattern — see ARCHITECTURE.md)
export {
  createUMAPStore,
  clearUMAPStore,
  clearAllUMAPStores,
  useUMAPStore, // deprecated, for backwards compatibility
} from './umapStore'
export type { UMAPPoint, UMAPMetadata, ColumnInfo } from './umapStore'

// Controls composable (external API for side panels / palettes)
export { useUMAPControls } from './useUMAPControls'
