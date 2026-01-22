# Pennsieve Visualization

A monorepo containing Vue 3 visualization components for the Pennsieve platform.

## Packages

| Package | Description |
|---------|-------------|
| `@pennsieve-viz/core` | Shared utilities, stores, and base components |
| `@pennsieve-viz/duckdb` | DuckDB integration for data processing |
| `@pennsieve-viz/data-explorer` | Data exploration component |
| `@pennsieve-viz/umap` | UMAP visualization component |
| `@pennsieve-viz/proportion-plot` | Proportion plot visualization |
| `@pennsieve-viz/markdown` | Markdown rendering component |
| `@pennsieve-viz/text-viewer` | Text file viewer component |
| `@pennsieve-viz/ai-plotly` | AI-powered Plotly charts |
| `@pennsieve-viz/tsviewer` | Timeseries data viewer component |
| `@pennsieve-viz/micro-ct` | OME-TIFF/TIFF viewer components for microscopy data |
| `@pennsieve-viz/pennsieve-viz` | Demo app / development playground |

## Requirements

- Node.js >= 18
- pnpm >= 8

## Project Setup

```bash
pnpm install
```

## Development

Run the development server:

```bash
pnpm dev
```

This starts the dev server for `@pennsieve-viz/pennsieve-viz`, which serves `packages/pennsieve-viz/src/App.vue` as a playground for testing components.

### Developing Packages

When making changes to a package (e.g., `@pennsieve-viz/micro-ct`), you must **build the package** before the changes appear in the dev server:

```bash
# Build a specific package
pnpm --filter @pennsieve-viz/micro-ct build

# Then the dev server will pick up the changes on next refresh
```

**Workflow:**
1. Make changes to a package in `packages/<package-name>/src/`
2. Build that package: `pnpm --filter @pennsieve-viz/<package-name> build`
3. Refresh the dev server in your browser to see changes

This is because `pnpm dev` only watches the `pennsieve-viz` package itself. Other packages are imported from their built `dist/` folders.

### Adding Components to the Playground

To test a new component in the dev server:

1. Export the component from your package's `index.ts`
2. Build the package
3. Import and add it to `packages/pennsieve-viz/src/index.ts`
4. Use it in `packages/pennsieve-viz/src/App.vue`

## Build

Build all packages:

```bash
pnpm build
```

Build a specific package:

```bash
pnpm build:core
pnpm build:duckdb
```

## Other Commands

```bash
pnpm clean       # Remove all dist folders
pnpm lint        # Lint all packages
pnpm type-check  # Type check all packages
```

## Usage in Your Application

Install the packages you need:

```bash
pnpm add @pennsieve-viz/umap @pennsieve-viz/data-explorer
```

Import styles in your main entry file:

```js
import '@pennsieve-viz/core/style.css'
```

Import and use components:

```vue
<script setup>
import { UMAP } from '@pennsieve-viz/umap'
import { DataExplorer } from '@pennsieve-viz/data-explorer'
</script>

<template>
  <UMAP :apiUrl="config.apiUrl" />
  <DataExplorer :apiUrl="config.apiUrl" />
</template>
```

## Props

Components accept an `apiUrl` prop that should match your environment's API domain:

```vue
<UMAP :apiUrl="config.apiUrl" />
<DataExplorer :apiUrl="config.apiUrl" />
```

## TSViewer

The `@pennsieve-viz/tsviewer` package provides a timeseries data visualization component for viewing and annotating time-based signal data.

### Installation

```bash
pnpm add @pennsieve-viz/tsviewer
```

### Peer Dependencies

The tsviewer requires the following peer dependencies:

```bash
pnpm add vue@^3.2.0 pinia@^2.0.0 element-plus@^2.3.0
```

Optional peer dependency for authentication:

```bash
pnpm add @aws-amplify/auth@^6.0.0
```

### Importing

Import styles in your main entry file:

```js
import '@pennsieve-viz/tsviewer/style.css'
```

Import the component and store:

```js
import { TSViewer, useViewerStore } from '@pennsieve-viz/tsviewer'
```

Or register as a Vue plugin for global component access:

```js
import { createApp } from 'vue'
import TSViewerPlugin from '@pennsieve-viz/tsviewer'

const app = createApp(App)
app.use(TSViewerPlugin)
```

### Usage

```vue
<script setup>
import { TSViewer, useViewerStore } from '@pennsieve-viz/tsviewer'

const viewerStore = useViewerStore()

// Configure the API endpoint
viewerStore.setViewerConfig({
  timeseriesDiscoverApi: 'https://api.pennsieve.io/timeseries'
})

// Load timeseries data for a package
viewerStore.fetchAndSetActiveViewer({ packageId: 'your-package-id' })
</script>

<template>
  <TSViewer
    :pkg="packageData"
    :is-preview="false"
    :side-panel-open="false"
  />
</template>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `pkg` | Object | `{}` | Package metadata object |
| `isPreview` | Boolean | `false` | When true, renders in preview mode (no toolbar) |
| `sidePanelOpen` | Boolean | `false` | Indicates if side panel is open (affects layout) |

### Store API

The `useViewerStore()` provides methods for managing viewer state:

```js
const viewerStore = useViewerStore()

// Configuration
viewerStore.setViewerConfig({ timeseriesDiscoverApi: '...' })

// Load data
viewerStore.fetchAndSetActiveViewer({ packageId: '...' })

// Access channels
viewerStore.viewerChannels
viewerStore.viewerSelectedChannels

// Annotations
viewerStore.viewerAnnotations
viewerStore.createAnnotation(annotation)
viewerStore.updateAnnotation(annotation)
viewerStore.deleteAnnotation(annotation)

// Reset state
viewerStore.resetViewer()
```
