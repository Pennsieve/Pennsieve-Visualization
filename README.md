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
