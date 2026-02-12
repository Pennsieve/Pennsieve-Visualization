export { default as UMAP } from './wrapper.vue'
export { default as UMAPScatterplot } from './scatterplot.vue'
export { default as UMAPControlPanel } from './control.vue'

// Store exports
export {
  createUMAPStore,
  clearUMAPStore,
  clearAllUMAPStores,
  useUMAPStore, // deprecated, for backwards compatibility
} from './umapStore'
export type { UMAPPoint, UMAPMetadata, ColumnInfo } from './umapStore'
