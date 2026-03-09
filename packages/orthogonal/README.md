# @pennsieve-viz/orthogonal

Vue 3 component wrapping [Neuroglancer](https://github.com/google/neuroglancer) for orthogonal (XY / XZ / YZ / 4-panel) viewing of OME-Zarr volumes.

## Two build targets

This package produces two outputs:

| Target | Command | Output | Purpose |
|--------|---------|--------|---------|
| **Library** | `pnpm build` | `dist/` | npm package — `OrthogonalViewer` component for direct embedding |
| **Embed app** | `pnpm build:embed` | `dist-embed/` | Standalone static site loaded in an iframe via `OrthogonalFrame` |

Most consuming apps use `OrthogonalFrame` from `@pennsieve-viz/core`, which loads the viewer in an iframe pointing at the Pennsieve-hosted embed app. You do **not** need to build or host the embed app yourself.

## Exports

```ts
import { OrthogonalViewer, OrthogonalControls, useNeuroglancer } from '@pennsieve-viz/orthogonal'
```

| Export | Description |
|--------|-------------|
| `OrthogonalViewer` | Main component — renders Neuroglancer directly in the DOM |
| `OrthogonalControls` | Channel visibility and layout controls overlay |
| `useNeuroglancer` | Composable managing the Neuroglancer viewer lifecycle |
| Types | `ChannelConfig`, `LayoutMode`, `OrthogonalViewerProps` |

### OrthogonalViewer props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `source` | `string` | — | OME-Zarr URL (required) |
| `layout` | `'4panel' \| '3d' \| 'xy' \| 'xz' \| 'yz'` | `'4panel'` | Viewer layout |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `ready` | — | Neuroglancer initialized successfully |
| `error` | `string` | Initialization or load error |
| `state-change` | state object | Viewer state updated (position, channels, layout) |

## Local development

```bash
# Library dev server (index.html + App.vue playground)
pnpm dev

# Embed app dev server
pnpm dev:embed

# Build + preview the embed app
pnpm build:embed
pnpm preview:embed
```

## Embed app hosting (S3 / CloudFront)

Pennsieve hosts the production embed app. The build produces a self-contained static site (~5 MB) with all dependencies bundled (Vue, Neuroglancer, workers, WASM).

### Build and deploy

```bash
pnpm build:embed
aws s3 sync dist-embed/ s3://YOUR_BUCKET/ --delete
```

### CloudFront / S3 configuration

- Set `embed.html` as the default root object (or configure routing to serve it)
- CORS: the parent app's origin must be allowed so the iframe can load

### How it works

`embed.html` loads `src/embed.js` which mounts `EmbedApp.vue`. The embed app:

1. Reads query params (`?source=<zarr-url>&layout=4panel`) on initial load
2. Listens for `postMessage` events (`set-source`, `set-layout`) for dynamic updates
3. Sends `postMessage` back to the parent (`ready`, `error`)

`OrthogonalFrame.vue` in core constructs the iframe URL with these parameters and handles the message protocol.

## Neuroglancer / Vite notes

Neuroglancer uses a `new Worker(new URL(..., import.meta.url))` pattern for its web workers. This is **incompatible with Vite's pre-bundling** (esbuild rewrites `import.meta.url`). The Vite configs handle this by:

- Excluding `neuroglancer` from `optimizeDeps`
- Scanning neuroglancer's bundle entry points so Vite discovers CJS transitive deps
- Setting `worker.format: 'es'` and `esbuild.target: 'es2022'` (decorators)
