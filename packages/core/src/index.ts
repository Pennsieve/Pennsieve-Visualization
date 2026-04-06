// @pennsieve-viz/core - Main visualization component library
import { defineAsyncComponent } from 'vue'

// Composables & utilities
export { useGetToken } from './composables/useGetToken'
export { useViewerStyle, type ViewerStyleOverrides } from './composables/useViewerStyle'
export { default as EditIcon } from './icons/EditIcon.vue'

// DuckDB interface (app provides the store via provide/inject)
export type { DuckDBStoreInterface } from './duckdb'

// Direct exports from component modules
export * from './csv-viewer'

// =============================================================================
// Production-ready components
// =============================================================================
export * from './data-explorer'
export * from './umap'
export * from './markdown'
export * from './text-viewer'
export * from './NiiViewer'

// Lazy-loaded component exports for tree-shaking (internal components)
export const CSVViewerLazy = defineAsyncComponent(
  () => import('./csv-viewer').then(m => m.CSVViewer)
)

export const DataExplorerLazy = defineAsyncComponent(
  () => import('./data-explorer').then(m => m.DataExplorer)
)

export const UMAPLazy = defineAsyncComponent(
  () => import('./umap').then(m => m.UMAP)
)

export const MarkdownLazy = defineAsyncComponent(
  () => import('./markdown').then(m => m.Markdown)
)

export const TextViewerLazy = defineAsyncComponent(
  () => import('./text-viewer').then(m => m.TextViewer)
)
export const NiiViewerLazy = defineAsyncComponent(
  () => import('./NiiViewer').then(m => m.NiiViewer)
)
// External packages (lazy-loaded) - these remain as separate packages
// Plotly components moved to @pennsieve-viz/plot
// export const TSViewer = defineAsyncComponent(
//   () => import('@pennsieve-viz/tsviewer').then(m => m.TSViewer)
// )

// export const OmeViewer = defineAsyncComponent(
//   () => import('@pennsieve-viz/micro-ct').then(m => m.OmeViewer)
// )

// export const TiffViewer = defineAsyncComponent(
//   () => import('@pennsieve-viz/micro-ct').then(m => m.TiffViewer)
// )

// export const OrthogonalViewer = defineAsyncComponent(
//   () => import('@pennsieve-viz/orthogonal').then(m => m.OrthogonalViewer)
// )

// iframe-based wrapper — isolates neuroglancer from host app
export { OrthogonalFrame } from './orthogonal'
