// @pennsieve-viz/core - Main visualization component library
import { defineAsyncComponent } from 'vue'

// Composables & utilities
export { useGetToken } from './composables/useGetToken'
export { default as EditIcon } from './icons/EditIcon.vue'

// DuckDB store
export { useDuckDBStore } from './duckdb'

// Direct exports from component modules
export * from './data-explorer'
export * from './umap'
export * from './proportion-plot'
export * from './markdown'
export * from './text-viewer'
export * from './ai-plotly'

// Lazy-loaded component exports for tree-shaking (internal components)
export const DataExplorerLazy = defineAsyncComponent(
  () => import('./data-explorer').then(m => m.DataExplorer)
)

export const UMAPLazy = defineAsyncComponent(
  () => import('./umap').then(m => m.UMAP)
)

export const ProportionPlotLazy = defineAsyncComponent(
  () => import('./proportion-plot').then(m => m.ProportionPlot)
)

export const MarkdownLazy = defineAsyncComponent(
  () => import('./markdown').then(m => m.Markdown)
)

export const TextViewerLazy = defineAsyncComponent(
  () => import('./text-viewer').then(m => m.TextViewer)
)

export const AiPlotlyLazy = defineAsyncComponent(
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
