---
"@pennsieve-viz/tsviewer": minor
---

The package now ships real type declarations: dist/index.d.ts exists and matches the exports map. dist no longer bundles element-plus chunks or the zarr reader's wasm codecs (4.4 MB down to about 0.9 MB); @pennsieve/timeseries-zarr-reader and protobufjs install as regular dependencies instead. Element Plus component CSS is no longer included in dist/style.css, so load element-plus styles in the host app (for example `import 'element-plus/dist/index.css'`) if it does not already.
