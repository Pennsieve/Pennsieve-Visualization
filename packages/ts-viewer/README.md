# @pennsieve-viz/tsviewer

Vue 3 timeseries viewer and annotator for Pennsieve packages. It renders channel
waveforms to canvas, reads data either from a Zarr bundle in the browser or from the
`pennsieve-streaming` WebSocket, and supports annotation layers, montages, and
per-channel filters.

Which backend serves a package is decided by its viewer asset's `asset_type`, not by
configuration: `timeseries-zarr` reads the bundle directly, anything else routes to the
streaming service.

## Install

```sh
npm install @pennsieve-viz/tsviewer
```

Peer dependencies: `vue` >= 3.2, `pinia`, `element-plus`, and `@aws-amplify/auth`
(optional, needed only for the streaming path's token). Requires Node 20 or newer to
build.

Element Plus component styles are not bundled. Load them in the host app:

```js
import 'element-plus/dist/index.css'
import '@pennsieve-viz/tsviewer/style.css'
```

## Usage

Each viewer owns a store instance keyed by `instanceId`, so several viewers can run on
one page without sharing state.

```vue
<script setup>
import { onMounted } from 'vue'
import { TSViewer, createViewerStore, TIMESERIES_ZARR } from '@pennsieve-viz/tsviewer'
import '@pennsieve-viz/tsviewer/style.css'

const INSTANCE = 'viewer-1'

onMounted(async () => {
  const store = createViewerStore(INSTANCE)
  store.setViewerConfig({
    apiUrl: 'https://api.pennsieve.io',
    timeseriesDiscoverApi: 'wss://streaming.pennsieve.io/ts/query',
    timeSeriesApi: 'https://api.pennsieve.io'
  })
  await store.fetchAndSetActiveViewer({
    packageId: 'N:package:0000',
    assetType: TIMESERIES_ZARR,
    url: 'https://assets.pennsieve.io/bundle/',
    onUrlExpired: async () => refreshSignedUrl()
  })
})
</script>

<template>
  <TSViewer :instance-id="INSTANCE" />
</template>
```

Call `clearViewerStore(instanceId)` when the host unmounts the viewer; it resets the
store and releases the bundle reader.

## Facts a caller cannot guess

- All times are microseconds, UTC.
- `fetchAndSetActiveViewer` takes `packageId` for API calls and `viewerAssetId` for the
  streaming socket. Passing both is normal; `viewerAssetId` wins for the socket URL.
- A `timeseries-zarr` asset requires `url`. Without it activation throws rather than
  silently falling back to the streaming path.
- `onUrlExpired` renews a signed bundle URL. It is called by the reader, may be called
  repeatedly, and must resolve to a URL or `{ url }`.
- The Zarr path is bounded only by the recording length. The streaming path caps the
  viewable window at 10 minutes, which is a limit of that service.
- Tokens for the streaming socket come from Amplify via `@aws-amplify/auth`. Without it
  installed the Zarr path still works; the streaming path will not authenticate.
- `@pennsieve/timeseries-zarr-reader` and `protobufjs` install as dependencies rather
  than being bundled. The reader ships WebAssembly codecs, so a host bundler must serve
  `.wasm` assets from `node_modules` (Vite does by default).

## External control

`useViewerControls(instanceId)` gives a wrapper component readonly state and imperative
control over a mounted viewer without reaching into the store:

```js
import { useViewerControls } from '@pennsieve-viz/tsviewer'

const controls = useViewerControls('viewer-1')
controls.selectChannels(['channel-1'])
controls.setActiveTool('annotate')
```

## Build and test

```sh
pnpm build          # library + type declarations to dist/
pnpm test           # unit and DOM suites
pnpm test:coverage  # same, with coverage floors enforced
pnpm type-check     # vue-tsc, templates included
```

Upgrading from 1.x: see [MIGRATION-2.0.md](./MIGRATION-2.0.md).

## License

MIT
