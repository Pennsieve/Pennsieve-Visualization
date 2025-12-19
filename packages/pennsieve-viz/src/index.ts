// @pennsieve-viz/pennsieve-viz - Meta-package that re-exports all components
import { defineAsyncComponent } from 'vue'

// Re-export from @pennsieve-viz/core
export { useGetToken, EditIcon } from '@pennsieve-viz/core'

// Re-export from @pennsieve-viz/duckdb
export { useDuckDBStore } from '@pennsieve-viz/duckdb'

// Lazy-loaded component exports for tree-shaking
export const DataExplorer = defineAsyncComponent(
  () => import('@pennsieve-viz/data-explorer').then(m => m.DataExplorer)
)

export const UMAP = defineAsyncComponent(
  () => import('@pennsieve-viz/umap').then(m => m.UMAP)
)

export const ProportionPlot = defineAsyncComponent(
  () => import('@pennsieve-viz/proportion-plot').then(m => m.ProportionPlot)
)

export const Markdown = defineAsyncComponent(
  () => import('@pennsieve-viz/markdown').then(m => m.Markdown)
)

export const TextViewer = defineAsyncComponent(
  () => import('@pennsieve-viz/text-viewer').then(m => m.TextViewer)
)

export const AiPlotly = defineAsyncComponent(
  () => import('@pennsieve-viz/ai-plotly').then(m => m.AiPlotly)
)

// Direct exports (not lazy-loaded) for consumers who want them
export * from '@pennsieve-viz/data-explorer'
export * from '@pennsieve-viz/umap'
export * from '@pennsieve-viz/proportion-plot'
export * from '@pennsieve-viz/markdown'
export * from '@pennsieve-viz/text-viewer'
export * from '@pennsieve-viz/ai-plotly'
