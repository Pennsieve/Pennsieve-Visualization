# Pennsieve Visualization

A monorepo containing Vue 3 visualization components for the Pennsieve platform.

## Packages

| Package | Description |
|---------|-------------|
| `@pennsieve-viz/core` | Main library with visualization components (DataExplorer, UMAP, ProportionPlot, Markdown, TextViewer, AiPlotly) and DuckDB utilities |
| `@pennsieve-viz/tsviewer` | Timeseries data viewer component |
| `@pennsieve-viz/micro-ct` | OME-TIFF/TIFF viewer components for microscopy data (OmeViewer, TiffViewer) |

## Folder Structure

```
pennsieve-viz-monorepo/
├── packages/
│   ├── core/           # @pennsieve-viz/core - Main component library
│   │   └── src/
│   │       ├── ai-plotly/
│   │       ├── data-explorer/
│   │       ├── duckdb/
│   │       ├── markdown/
│   │       ├── proportion-plot/
│   │       ├── text-viewer/
│   │       └── umap/
│   ├── ts-viewer/      # @pennsieve-viz/tsviewer - Timeseries viewer
│   └── micro-ct/       # @pennsieve-viz/micro-ct - Micro-CT/TIFF viewers
├── pnpm-workspace.yaml
└── package.json
```

## Requirements

- Node.js >= 18
- pnpm >= 8

## Project Setup

```bash
pnpm install
```

## Local Development

### Quick Start

```bash
# Install dependencies
pnpm install

# Start the dev server
pnpm dev
```

The dev server runs at `http://localhost:5173` (or next available port) and serves `packages/core/src/App.vue` as a playground for testing components.

### Development Workflow

1. **Start the dev server**: `pnpm dev`
2. **Edit components** in `packages/core/src/` - changes hot-reload automatically
3. **For changes to `tsviewer` or `micro-ct`**: rebuild the package, then refresh the browser

```bash
# Example: After editing packages/ts-viewer/src/
pnpm --filter @pennsieve-viz/tsviewer build
# Then refresh your browser
```

### Developing Packages

When making changes to a dependent package (e.g., `@pennsieve-viz/micro-ct` or `@pennsieve-viz/tsviewer`), you must **build the package** before the changes appear in the dev server:

```bash
# Build a specific package
pnpm --filter @pennsieve-viz/micro-ct build
pnpm --filter @pennsieve-viz/tsviewer build

# Then the dev server will pick up the changes on next refresh
```

**Workflow:**
1. Make changes to a package in `packages/<package-name>/src/`
2. Build that package: `pnpm --filter @pennsieve-viz/<package-name> build`
3. Refresh the dev server in your browser to see changes

This is because `pnpm dev` only watches the `core` package itself. Other packages are imported from their built `dist/` folders.

### Adding a New Component to Core

To add a new visualization component to `@pennsieve-viz/core`:

1. **Create a component folder** in `packages/core/src/`:
   ```
   packages/core/src/my-component/
   ├── index.ts           # Exports
   ├── MyComponent.vue    # Main component
   └── types.ts           # TypeScript types (optional)
   ```

2. **Create the component** (`MyComponent.vue`):
   ```vue
   <script setup lang="ts">
   defineProps<{
     apiUrl: string
   }>()
   </script>

   <template>
     <div class="my-component">
       <!-- Component content -->
     </div>
   </template>
   ```

3. **Create the index export** (`index.ts`):
   ```ts
   export { default as MyComponent } from './MyComponent.vue'
   ```

4. **Export from the core package** - Add to `packages/core/src/index.ts`:
   ```ts
   export * from './my-component'

   // Optional: Add lazy-loaded version
   export const MyComponentLazy = defineAsyncComponent(
     () => import('./my-component').then(m => m.MyComponent)
   )
   ```

5. **Test in the playground** - Import and use in `packages/core/src/App.vue`:
   ```vue
   <script setup>
   import { MyComponent } from './my-component'
   </script>

   <template>
     <MyComponent :apiUrl="apiUrl" />
   </template>
   ```

6. **Run the dev server** to test:
   ```bash
   pnpm dev
   ```

### Adding Components to the Playground

To test a component in the dev server, use it in `packages/core/src/App.vue`.

## Build

Build all packages:

```bash
pnpm build
```

Build a specific package:

```bash
pnpm build:core
pnpm build:tsviewer
```

## Other Commands

```bash
pnpm clean       # Remove all dist folders
pnpm lint        # Lint all packages
pnpm type-check  # Type check all packages
```

## Publishing to npm

This monorepo uses [Changesets](https://github.com/changesets/changesets) for version management and publishing.

### First-time Setup

Initialize changesets if not already configured:

```bash
pnpm changeset init
```

### Publishing Workflow

1. **Create a changeset** when you make changes that should be released:
   ```bash
   pnpm changeset
   ```
   Follow the prompts to select which packages changed and the type of change (patch/minor/major).

2. **Version packages** (updates package.json versions and changelogs):
   ```bash
   pnpm version
   ```

3. **Build and publish** to npm:
   ```bash
   pnpm release
   ```
   This runs `pnpm build` followed by `changeset publish`.

### Manual Publishing (without Changesets)

To publish a single package manually:

```bash
# Build the package
pnpm --filter @pennsieve-viz/core build

# Navigate to the package and publish
cd packages/core
npm publish --access public
```

### npm Registry Setup

Ensure you're logged in to npm:

```bash
npm login
```

For scoped packages (`@pennsieve-viz/*`), you may need to set up organization access on npmjs.com.

## Usage in Your Application

Install the core package:

```bash
pnpm add @pennsieve-viz/core
```

For optional viewers, install the additional packages:

```bash
pnpm add @pennsieve-viz/tsviewer    # For timeseries viewer
pnpm add @pennsieve-viz/micro-ct    # For micro-CT/TIFF viewers
```

Import styles in your main entry file:

```js
import '@pennsieve-viz/core/style.css'
```

Import and use components from the core package:

```vue
<script setup>
import { UMAP, DataExplorer, ProportionPlot, Markdown, TextViewer, AiPlotly } from '@pennsieve-viz/core'
</script>

<template>
  <UMAP :apiUrl="config.apiUrl" />
  <DataExplorer :apiUrl="config.apiUrl" />
</template>
```

### Lazy-loaded Components

The core package also provides lazy-loaded versions for tree-shaking:

```vue
<script setup>
import { UMAPLazy, DataExplorerLazy, TSViewer, OmeViewer, TiffViewer } from '@pennsieve-viz/core'
</script>
```

## Props

Components accept an `apiUrl` prop that should match your environment's API domain:

```vue
<UMAP :apiUrl="config.apiUrl" />
<DataExplorer :apiUrl="config.apiUrl" />
```

## TSViewer

The `@pennsieve-viz/tsviewer` package (`packages/ts-viewer/`) provides a timeseries data visualization component for viewing and annotating time-based signal data.

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

Or use the lazy-loaded version from core:

```js
import { TSViewer } from '@pennsieve-viz/core'
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
