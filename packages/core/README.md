# @pennsieve-viz/core

Pennsieve visualization component library for scientific data. Built with Vue 3, Pinia, and TypeScript.

## Installation

```bash
npm install @pennsieve-viz/core
```

### Peer Dependencies

The following peer dependencies must be installed by the host application:

| Package | Version | Required |
|---------|---------|----------|
| `vue` | ^3.2.0 | Yes |
| `pinia` | ^2.0.0 \|\| ^3.0.0 | Yes |
| `@duckdb/duckdb-wasm` | ^1.29.0 | Yes (for DataExplorer, UMAP, ProportionPlot) |
| `plotly.js` | ^2.35.0 | Optional (for AiPlotly) |
| `@aws-amplify/auth` | ^6.0.0 | Optional (for authenticated data fetching) |
| `@pennsieve-viz/micro-ct` | ^1.0.0 | Optional (for OmeViewer, TiffViewer) |
| `@pennsieve-viz/tsviewer` | ^1.0.0 | Optional (for TSViewer) |

## DuckDB Setup

`@pennsieve-viz/core` does **not** bundle or initialize DuckDB. The host application owns the DuckDB lifecycle and provides a store instance via Vue's `provide/inject`.

### 1. Install DuckDB

```bash
npm install @duckdb/duckdb-wasm
```

### 2. Create a DuckDB store

Your store must implement the `DuckDBStoreInterface` exported by this package:

```ts
import type { DuckDBStoreInterface } from '@pennsieve-viz/core'
```

The interface requires:

| Property / Method | Description |
|-------------------|-------------|
| `isReady` | Reactive boolean — components wait for this before operating |
| `createConnection(viewerId?)` | Returns `{ connection, connectionId }` |
| `closeConnection(connectionId)` | Cleans up a connection |
| `loadFile(url, type, tableName?, csvOptions?, viewerId?, fileId?)` | Loads a CSV/Parquet file into DuckDB, returns the table name |
| `executeQuery(query, connectionId)` | Runs SQL, returns an array of row objects |
| `publishViewFromQuery(name, sql, connectionId)` | Creates a DuckDB VIEW and updates shared state |
| `sharedResultName` | Reactive string — the name of the last published view |
| `sharedVersion` | Reactive number — incremented on each publish |
| `formatIdFromUrl(srcUrl)` | Pure utility to derive a stable ID from a URL |

### 3. Provide the store at the app root

```js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useDuckDBStore } from './store/duckdbStore' // your store

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)

// Provide DuckDB store for @pennsieve-viz/core components
const duckdbStore = useDuckDBStore()
app.provide('duckdb', duckdbStore)

app.mount('#app')
```

All core components inject the store with `inject('duckdb')`. If the store is not provided, components will throw a descriptive error.

## Components

### Production

| Component | Import | Description |
|-----------|--------|-------------|
| `DataExplorer` | `import { DataExplorer } from '@pennsieve-viz/core'` | SQL-powered data exploration for CSV/Parquet files |
| `UMAP` | `import { UMAP } from '@pennsieve-viz/core'` | UMAP dimensionality reduction visualization |
| `Markdown` | `import { Markdown } from '@pennsieve-viz/core'` | Markdown renderer |
| `TextViewer` | `import { TextViewer } from '@pennsieve-viz/core'` | Plain text file viewer |

Lazy-loaded variants are also available: `DataExplorerLazy`, `UMAPLazy`, `MarkdownLazy`, `TextViewerLazy`.

### Beta

| Component | Import | Description |
|-----------|--------|-------------|
| `ProportionPlotBeta` | `import { ProportionPlotBeta } from '@pennsieve-viz/core'` | Proportion/composition plot |
| `AiPlotlyBeta` | `import { AiPlotlyBeta } from '@pennsieve-viz/core'` | AI-assisted Plotly charting |

### External (lazy-loaded wrappers)

| Component | Import | Requires |
|-----------|--------|----------|
| `TSViewer` | `import { TSViewer } from '@pennsieve-viz/core'` | `@pennsieve-viz/tsviewer` |
| `OmeViewer` | `import { OmeViewer } from '@pennsieve-viz/core'` | `@pennsieve-viz/micro-ct` |
| `TiffViewer` | `import { TiffViewer } from '@pennsieve-viz/core'` | `@pennsieve-viz/micro-ct` |

## Styles

Import the component styles in your app:

```js
import '@pennsieve-viz/core/style.css'
```

A SCSS theme file is also available for customization:

```scss
@use '@pennsieve-viz/core/styles/theme.scss';
```

## Cross-Component Communication

DataExplorer and UMAP share data through the DuckDB store:

1. **DataExplorer** runs a query and calls `publishViewFromQuery('umap_result', sql, connectionId)`
2. This creates a DuckDB VIEW and increments `sharedVersion`
3. **UMAP** watches `sharedVersion` and `sharedResultName` to detect new data
4. When those change, UMAP re-queries from the published view

This works because both components inject the **same** store instance via `inject('duckdb')`.

## License

MIT
