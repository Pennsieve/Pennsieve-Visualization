// @pennsieve-viz/core - Main visualization component library
import { defineAsyncComponent } from 'vue'

// Composables & utilities
export { useGetToken } from './composables/useGetToken'
export { default as EditIcon } from './icons/EditIcon.vue'

// DuckDB interface (app provides the store via provide/inject)
export type { DuckDBStoreInterface } from './duckdb'

// =============================================================================
// Production-ready components
// =============================================================================
export * from './data-explorer'
export * from './umap'
export * from './markdown'
export * from './text-viewer'

// Lazy-loaded versions for tree-shaking
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

// =============================================================================
// Beta components - not part of public API, but available for testing
// Import directly: import { ProportionPlot } from '@pennsieve-viz/core/src/proportion-plot'
// Or use the lazy exports below
// =============================================================================
export const ProportionPlotBeta = defineAsyncComponent(
  () => import('./proportion-plot').then(m => m.ProportionPlot)
)

export const AiPlotlyBeta = defineAsyncComponent(
  () => import('./ai-plotly').then(m => m.AiPlotly)
)

// External packages (lazy-loaded) - these remain as separate packages
export const TSViewer = defineAsyncComponent(
  () => import('@pennsieve-viz/tsviewer').then(m => m.TSViewer)
)

export const OmeViewer = defineAsyncComponent(
  () => import('@pennsieve-viz/micro-ct').then(m => m.OmeViewer)
)

export const TiffViewer = defineAsyncComponent(
  () => import('@pennsieve-viz/micro-ct').then(m => m.TiffViewer)
)

export const OrthogonalViewer = defineAsyncComponent(
  () => import('@pennsieve-viz/orthogonal').then(m => m.OrthogonalViewer)
)

// iframe-based wrapper — isolates neuroglancer from host app
export { OrthogonalFrame } from './orthogonal'
