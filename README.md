# Pennsieve Visualization

A monorepo containing Vue 3 visualization components for the Pennsieve platform.

## Packages

| Package | Description |
|---------|-------------|
| [`@pennsieve-viz/core`](packages/core) | Main library — DataExplorer, UMAP, Markdown, TextViewer, OrthogonalFrame, plus lazy re-exports of all viewer packages |
| [`@pennsieve-viz/tsviewer`](packages/ts-viewer) | Timeseries data viewer and annotator |
| [`@pennsieve-viz/micro-ct`](packages/micro-ct) | OME-TIFF / TIFF viewer components for microscopy data |
| [`@pennsieve-viz/orthogonal`](packages/orthogonal) | Neuroglancer-based orthogonal viewer for OME-Zarr volumes |

## Folder Structure

```
pennsieve-visualization/
├── packages/
│   ├── core/              # @pennsieve-viz/core
│   │   └── src/
│   │       ├── data-explorer/
│   │       ├── umap/
│   │       ├── markdown/
│   │       ├── text-viewer/
│   │       ├── ai-plotly/        # beta
│   │       ├── proportion-plot/  # beta
│   │       ├── orthogonal/       # OrthogonalFrame (iframe wrapper)
│   │       ├── duckdb/           # DuckDB interface types
│   │       └── composables/
│   ├── orthogonal/        # @pennsieve-viz/orthogonal
│   ├── ts-viewer/         # @pennsieve-viz/tsviewer
│   └── micro-ct/          # @pennsieve-viz/micro-ct
├── src/                   # Dev playground app (not published)
│   ├── store/duckdbStore.js
│   └── main.js
├── pnpm-workspace.yaml
└── package.json
```

## Requirements

- Node.js >= 18
- pnpm >= 8

## Getting Started

1. **Clone the repo**
   ```bash
   git clone https://github.com/Pennsieve/Pennsieve-Visualization.git
   cd Pennsieve-Visualization
   ```

2. **Install pnpm** (if you don't have it)
   ```bash
   npm install -g pnpm
   ```

3. **Install dependencies**
   ```bash
   pnpm install
   ```

4. **Build all packages** — this is required before running the dev server, because `core` imports from `micro-ct` and `ts-viewer` and needs their built output:
   ```bash
   pnpm build
   ```

5. **Start the dev server**
   ```bash
   pnpm dev
   ```
   Opens at `http://localhost:5173` and serves `packages/core/src/App.vue` as a playground for testing components.

> **Why do I need to build first?** The core package imports components from `@pennsieve-viz/micro-ct` and `@pennsieve-viz/tsviewer` as dependencies. Without building them, those imports will fail and the dev server won't start.

### Rebuilding after changes

`pnpm dev` only hot-reloads changes inside `packages/core/`. If you edit other packages, rebuild them and refresh:

```bash
pnpm build:micro-ct       # after editing packages/micro-ct/
pnpm build:tsviewer        # after editing packages/ts-viewer/
pnpm build:orthogonal      # after editing packages/orthogonal/
```

### Orthogonal viewer development

The orthogonal viewer has its own dev server for the embed app:

```bash
# Run the embed app standalone
pnpm --filter @pennsieve-viz/orthogonal dev:embed

# To test with the core playground, run both:
# Terminal 1: embed app on port 5174
pnpm --filter @pennsieve-viz/orthogonal dev:embed
# Terminal 2: core playground on port 5173
pnpm dev
```

## Build

```bash
pnpm build                    # micro-ct + tsviewer + core (all packages)
pnpm build:core               # @pennsieve-viz/core only
pnpm build:micro-ct            # @pennsieve-viz/micro-ct only
pnpm build:tsviewer            # @pennsieve-viz/tsviewer only
pnpm build:orthogonal          # @pennsieve-viz/orthogonal library
pnpm build:orthogonal-embed    # orthogonal embed app (dist-embed/)
```

```bash
pnpm clean        # Remove all dist folders
pnpm lint         # Lint all packages
pnpm type-check   # Type check all packages
```

## Publishing to npm

This monorepo uses [Changesets](https://github.com/changesets/changesets) for version management.

```bash
pnpm changeset    # Create a changeset (select packages + change type)
pnpm version      # Update versions and changelogs
pnpm release      # Build + publish to npm
```

For a single package manually:

```bash
pnpm --filter @pennsieve-viz/core build
cd packages/core && npm publish --access public
```

---

## Usage in a Consuming App

### Install

```bash
pnpm add @pennsieve-viz/core

# Optional viewer packages (only needed if importing directly, not via core lazy exports)
pnpm add @pennsieve-viz/tsviewer
pnpm add @pennsieve-viz/micro-ct
pnpm add @pennsieve-viz/orthogonal neuroglancer
```

### DuckDB Setup (required for DataExplorer & UMAP)

DataExplorer and UMAP use DuckDB for in-browser SQL queries. Your app must provide a DuckDB store via Vue's `provide/inject`:

1. Install DuckDB:
   ```bash
   pnpm add @duckdb/duckdb-wasm
   ```

2. Create a DuckDB store that implements the `DuckDBStoreInterface` (see `src/store/duckdbStore.js` for a reference implementation).

3. Provide it in your app entry:
   ```js
   import { createApp } from 'vue'
   import { createPinia } from 'pinia'
   import { useDuckDBStore } from './store/duckdbStore'

   const app = createApp(App)
   const pinia = createPinia()
   app.use(pinia)

   const duckdbStore = useDuckDBStore()
   app.provide('duckdb', duckdbStore)

   app.mount('#app')
   ```

Components that don't use DuckDB (Markdown, TextViewer, OrthogonalFrame, TSViewer) work without this setup.

### Import Styles

```js
import '@pennsieve-viz/core/style.css'
```

### Components

#### Direct imports (production-ready)

```vue
<script setup>
import { DataExplorer, UMAP, Markdown, TextViewer } from '@pennsieve-viz/core'
import { OrthogonalFrame } from '@pennsieve-viz/core'
</script>
```

#### Lazy-loaded (tree-shaking)

```vue
<script setup>
import {
  DataExplorerLazy,
  UMAPLazy,
  MarkdownLazy,
  TextViewerLazy,
  // These lazy-load from their respective packages:
  TSViewer,
  OmeViewer,
  TiffViewer,
  OrthogonalViewer
} from '@pennsieve-viz/core'
</script>
```

#### Beta components

```vue
<script setup>
import { ProportionPlotBeta, AiPlotlyBeta } from '@pennsieve-viz/core'
</script>
```

### OrthogonalFrame

`OrthogonalFrame` wraps the Neuroglancer viewer in an iframe for full isolation. Point it at the Pennsieve-hosted embed app (or your own):

```vue
<OrthogonalFrame
  :source="zarrUrl"
  layout="4panel"
  :embed-url="'https://your-cloudfront-domain.com/embed.html'"
  @ready="onReady"
  @error="onError"
/>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `source` | `string` | — | OME-Zarr source URL (required) |
| `layout` | `'4panel' \| '3d' \| 'xy' \| 'xz' \| 'yz'` | `'4panel'` | Viewer layout |
| `embedUrl` | `string` | `'/'` | Base URL of the hosted embed app |

---

## TSViewer

### Peer Dependencies

```bash
pnpm add vue pinia element-plus
pnpm add @aws-amplify/auth  # optional, for authenticated endpoints
```

### Usage

```js
import '@pennsieve-viz/tsviewer/style.css'
```

```vue
<script setup>
import { TSViewer, createViewerStore, clearViewerStore } from '@pennsieve-viz/tsviewer'

// Create an isolated store instance (supports multiple viewers on one page)
const viewerStore = createViewerStore('my-viewer')

viewerStore.setViewerConfig({
  timeseriesDiscoverApi: 'https://api.pennsieve.io/timeseries'
})

viewerStore.fetchAndSetActiveViewer({ packageId: 'your-package-id' })

// Cleanup when done
onUnmounted(() => clearViewerStore('my-viewer'))
</script>

<template>
  <TSViewer :pkg="packageData" />
</template>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `pkg` | `Object` | `{}` | Package metadata object |
| `isPreview` | `Boolean` | `false` | Preview mode (no toolbar) |
| `sidePanelOpen` | `Boolean` | `false` | Side panel state (affects layout) |

### Store API

```js
const store = createViewerStore('instance-id')

store.setViewerConfig({ timeseriesDiscoverApi: '...' })
store.fetchAndSetActiveViewer({ packageId: '...' })

store.viewerChannels           // all channels
store.viewerSelectedChannels   // selected channels
store.setSelectedChannels([...])

store.viewerAnnotations
store.createAnnotation(annotation)
store.updateAnnotation(annotation)
store.deleteAnnotation(annotation)

store.resetViewer()

// Cleanup
clearViewerStore('instance-id')
clearAllViewerStores()
```

---

## Micro-CT

### Peer Dependencies

```bash
pnpm add vue @deck.gl/core @deck.gl/extensions @deck.gl/geo-layers @deck.gl/layers @deck.gl/mesh-layers @luma.gl/constants @luma.gl/core @luma.gl/engine @luma.gl/shadertools @luma.gl/webgl
```

### Usage

```js
import '@pennsieve-viz/micro-ct/style.css'
```

```vue
<script setup>
import { OmeViewer, TiffViewer } from '@pennsieve-viz/micro-ct'
</script>

<template>
  <OmeViewer :source="omeTiffUrl" />
  <TiffViewer :source="tiffUrl" />
</template>
```

Exports: `OmeViewer`, `OmeViewerControls`, `OmeOrthogonalViewer`, `TiffViewer`, `useOmeLoader`.

---

## Adding a New Component to Core

1. Create a folder in `packages/core/src/my-component/` with `index.ts` and `MyComponent.vue`

2. Export from `packages/core/src/index.ts`:
   ```ts
   export * from './my-component'

   export const MyComponentLazy = defineAsyncComponent(
     () => import('./my-component').then(m => m.MyComponent)
   )
   ```

3. Test in `packages/core/src/App.vue` with `pnpm dev`
