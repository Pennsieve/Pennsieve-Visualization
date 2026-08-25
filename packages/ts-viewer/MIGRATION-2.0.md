# Migrating to 2.0

Every published export except one keeps its name and signature. Most of the work in this
release is internal, so a typical upgrade is two CSS lines and a dependency check.

## Required changes

**Load Element Plus styles yourself.** `dist/style.css` no longer carries Element Plus
component CSS, which shrank the published bundle from 4.4 MB to under 1 MB. Add the
import if the host does not already have it:

```js
import 'element-plus/dist/index.css'
import '@pennsieve-viz/tsviewer/style.css'
```

**Replace `useViewerStore()`.** It was deprecated in 1.x and is now gone.

```js
// before
const store = useViewerStore()
// after
const store = createViewerStore('viewer-1')
```

Pass a real instance id rather than reusing the old singleton. Two viewers sharing one id
share their state.

**Serve WebAssembly from node_modules.** `@pennsieve/timeseries-zarr-reader` and
`protobufjs` are external now instead of bundled, so they install alongside the package.
The reader ships zstd and blosc as WebAssembly. Vite serves those without configuration;
another bundler may need a rule for `.wasm` under `node_modules`.

**Node 20.** The package requires Node 20 or newer to build. Runtime browser support is
unchanged.

## Behavior changes worth knowing

**Annotation navigation lands on the right annotation.** The binary search behind
next-and-previous was off by one for any cursor time that was not exactly an annotation
start, so paging moved to the annotation before the intended one. With annotations at
10, 20, and 30 seconds, next-from-25 now selects 30 rather than 20. At the ends of a
layer, paging now does nothing instead of selecting the nearest annotation: there is no
next annotation after the last one.

**Filters refuse to send when an input is missing.** A filter whose required frequency
was absent or non-numeric used to build a message the reader discarded silently, leaving
the UI showing a filter that was never applied. Such a filter is now rejected before it
is sent, with a console warning naming the field, and no filter is written to the
channel.

**Toasts are scoped per viewer.** Two viewers on one page shared a module-level event
bus, so a message raised by one appeared in both. Each viewer now has its own emitter.
Errors raised from asynchronous code that carries no viewer context still reach every
mounted viewer.

**A moved annotation keeps its data.** Editing an annotation into a different layer used
to drop the change and leave a stale copy in the original layer.

## Types

The package now ships real type declarations generated from TypeScript source, so
`dist/index.d.ts` exists and matches the exports map. Two consequences for TypeScript
hosts:

- Previously untyped imports now type-check, which can surface pre-existing mistakes in
  host code.
- `useViewerControls` methods that take layer or annotation ids accept `number | string`.
  In 1.x their declarations said `string` while the API returns numbers, so hosts cast.
  Those casts can come out.

## Not in this release

Authentication still passes tokens as query parameters (`?api_key=`, `?session=`).
Moving HTTP calls to `Authorization` headers is planned for 2.1. The WebSocket path will
keep a query ticket regardless, since browsers cannot set headers on a WebSocket
handshake.
