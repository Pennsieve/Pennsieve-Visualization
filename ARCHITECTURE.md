# Architecture: Viewer Store Pattern

Every `@pennsieve-viz` package that exposes viewer state to the host app follows the same **factory Pinia store** pattern. This gives the host app a consistent way to wire up any viewer to side panels, palettes, or other external UI.

## The Pattern

Each package exports three things:

| Export | Purpose |
|--------|---------|
| `createViewerStore(instanceId)` | Creates (or retrieves) a Pinia store instance keyed by ID |
| `clearViewerStore(instanceId)` | Resets and removes a store instance from the cache |
| `useViewerControls(instanceId)` | Returns a curated API of readonly state refs + action methods |

The **store** is the internal state machine. The **controls composable** is the public API that external components (side panels, palettes, toolbars) should use.

### Why this pattern?

- **Pinia stores are visible in Vue DevTools** — easy to inspect and debug
- **Explicit initialization** — no silent failures if a parent forgot to `provide`
- **Instance ID keying** — supports multiple viewers side by side
- **Typed actions and state** — full TypeScript support
- **Testable in isolation** — no component tree required
- **No provide/inject** — just import and call

## Reference Implementation

**`@pennsieve-viz/tsviewer`** is the canonical example. See:

- Store factory: `packages/ts-viewer/src/stores/tsviewer.js`
- Controls composable: `packages/ts-viewer/src/composables/useViewerControls.js`
- Package exports: `packages/ts-viewer/src/index.js`

## How Each Package Follows the Pattern

### Single-viewer packages (tsviewer, micro-ct)

Use the generic names directly:

```js
import { createViewerStore, clearViewerStore, useViewerControls } from '@pennsieve-viz/tsviewer'
import { createViewerStore, clearViewerStore, useViewerControls } from '@pennsieve-viz/micro-ct'
```

### Multi-viewer packages (core)

Core contains multiple viewer types (DataExplorer, UMAP), so it uses **viewer-specific names** that follow the same API contract:

```js
import {
  createDataExplorerStore, clearDataExplorerStore, useDataExplorerControls,
  createUMAPStore, clearUMAPStore, useUMAPControls,
} from '@pennsieve-viz/core'
```

The naming is `create<Viewer>Store` / `clear<Viewer>Store` / `use<Viewer>Controls` — same shape, viewer-specific prefix.

## What the Store Must Expose

Every factory store should return at minimum:

| Category | Examples |
|----------|---------|
| **Reactive state** | Refs/reactive objects for the viewer's data and UI state |
| **Computed getters** | Derived state (e.g., `hasData`, `selectedCount`) |
| **Actions** | Methods to mutate state |
| **`resetStore()`** | Clears all state back to defaults |

## What the Controls Composable Must Expose

The `useViewerControls` (or `use<Viewer>Controls`) composable wraps the store and returns:

| Category | Description |
|----------|-------------|
| **Readonly state refs** | Wrapped with `readonly()` so consumers can read but not mutate directly |
| **State queries** | Helper methods to look up specific items (e.g., `getChannel(id)`) |
| **Action methods** | Curated subset of store actions relevant to external control |
| **`reset()`** | Delegates to the store's `resetStore()` |
| **`getState()`** | Returns a snapshot of current state for debugging/serialization |
| **`store`** | Direct store access for advanced use cases |

## How the Host App Wires It Up

The host app creates a thin composable that wraps the library's factory with a fixed instance ID. This gives all palette/side-panel components a shared entry point without prop drilling.

```js
// Host app: composables/useViewerInstance.js
import { createViewerStore, useViewerControls } from '@pennsieve-viz/tsviewer'

export const INSTANCE_ID = 'primary-viewer'
let initialized = false

export function initViewerStore() {
  initialized = true
  return createViewerStore(INSTANCE_ID)
}

export function useViewerInstance() {
  if (!initialized) createViewerStore(INSTANCE_ID)
  return useViewerControls(INSTANCE_ID)
}
```

For a multi-viewer host app, create one composable per viewer type:

```js
// Host app: composables/useDataExplorerInstance.js
import { createDataExplorerStore, useDataExplorerControls } from '@pennsieve-viz/core'

export const INSTANCE_ID = 'primary-data-explorer'

export function useDataExplorerInstance() {
  return useDataExplorerControls(INSTANCE_ID)
}
```

### How side panel / palette components consume it

Components in the side panel call the host app's composable in `setup()` and get back reactive refs + actions. No props drilling, no provide/inject — just a shared Pinia store keyed by instance ID.

```vue
<script setup>
import { useViewerInstance } from '@/composables/useViewerInstance'

const { channels, selectedChannels, selectChannels, setActiveTool } = useViewerInstance()
</script>

<template>
  <div v-for="ch in channels" :key="ch.id">
    {{ ch.name }}
  </div>
</template>
```

## Multiple Simultaneous Instances

The instance ID parameter already handles this. Create separate stores with different IDs:

```js
const leftViewer = createViewerStore('viewer-left')
const rightViewer = createViewerStore('viewer-right')

const leftControls = useViewerControls('viewer-left')
const rightControls = useViewerControls('viewer-right')
```

Each instance has fully isolated state. Clean up on unmount:

```js
onUnmounted(() => {
  clearViewerStore('viewer-left')
  clearViewerStore('viewer-right')
})
```

## Store Implementation Template

When adding the pattern to a new package, follow this structure:

```ts
// stores/viewerStore.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const storeInstances = new Map<string, any>()

export function createViewerStore(instanceId = 'default') {
  if (storeInstances.has(instanceId)) {
    return storeInstances.get(instanceId)!()
  }

  const useStore = defineStore(`my-package-viewer-${instanceId}`, () => {
    // State
    const someState = ref(null)
    const isLoading = ref(false)

    // Getters
    const hasData = computed(() => someState.value !== null)

    // Actions
    const setSomeState = (val) => { someState.value = val }

    const resetStore = () => {
      someState.value = null
      isLoading.value = false
    }

    return { someState, isLoading, hasData, setSomeState, resetStore }
  })

  storeInstances.set(instanceId, useStore)
  return useStore()
}

export function clearViewerStore(instanceId: string) {
  if (storeInstances.has(instanceId)) {
    const store = storeInstances.get(instanceId)!()
    store.resetStore()
    storeInstances.delete(instanceId)
  }
}

export function clearAllViewerStores() {
  storeInstances.forEach((useStore) => {
    useStore().resetStore()
  })
  storeInstances.clear()
}
```

```ts
// composables/useViewerControls.ts
import { readonly } from 'vue'
import { storeToRefs } from 'pinia'
import { createViewerStore } from '../stores/viewerStore'

export function useViewerControls(instanceId = 'default') {
  const store = createViewerStore(instanceId)
  const { someState, isLoading, hasData } = storeToRefs(store)

  return {
    // Readonly state
    someState: readonly(someState),
    isLoading: readonly(isLoading),
    hasData,

    // Actions
    setSomeState: store.setSomeState,

    // Lifecycle
    reset: () => store.resetStore(),
    getState: () => ({ someState: someState.value, isLoading: isLoading.value }),

    // Advanced
    store,
  }
}
```
