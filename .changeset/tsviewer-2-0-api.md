---
"@pennsieve-viz/tsviewer": major
---

Removes the deprecated `useViewerStore()`; use `createViewerStore(instanceId)`. Element Plus component styles are no longer bundled into `dist/style.css`, so hosts import `element-plus/dist/index.css` themselves. `@pennsieve/timeseries-zarr-reader` and `protobufjs` install as dependencies instead of being bundled, which cuts the published bundle from 4.4 MB to under 1 MB and requires the host bundler to serve the reader's WebAssembly from `node_modules`. Building the package requires Node 20. `useViewerControls` methods that take layer or annotation ids now accept `number | string`, matching what the API returns. See MIGRATION-2.0.md.
