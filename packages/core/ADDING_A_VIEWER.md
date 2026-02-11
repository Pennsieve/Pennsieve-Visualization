# Adding a New Viewer to @pennsieve-viz/core

This guide walks through every step of adding a new visualization component to the library.

---

## How Style Overrides Work

Every viewer exposes a `customStyle` prop that lets consumers override any CSS custom property at runtime. This is the primary theming API for the library.

### Architecture

```
┌─────────────────────────────────────────────────┐
│  Consumer app                                   │
│                                                 │
│  <DataExplorer                                  │
│    :custom-style="{                             │
│      '--ps-color-primary': '#ff6600',           │
│      '--ps-font-size': '15px',                  │
│    }"                                           │
│  />                                             │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  Wrapper (DataExplorerWrap.vue)                  │
│  Passes customStyle through to core component    │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  Core component (DataExplorer.vue)               │
│                                                 │
│  useViewerStyle() converts the prop into a       │
│  reactive style object bound to the root element │
│                                                 │
│  <div class="ps-viewer" :style="rootStyle">     │
│    ← rootStyle sets CSS vars inline here         │
│    ← viewer-base mixin sets defaults             │
│    ← inline vars win over defaults (CSS cascade) │
│  </div>                                          │
└─────────────────────────────────────────────────┘
```

The `viewer-base` SCSS mixin sets all `--ps-*` CSS custom properties with default Pennsieve values. When `customStyle` is provided, `useViewerStyle()` merges those overrides into inline `style` on the root element, which takes precedence in the CSS cascade.

### Consumer Usage

```vue
<template>
  <!-- Default Pennsieve styling -->
  <DataExplorer :src-url="url" />

  <!-- Custom primary color and larger font -->
  <DataExplorer
    :src-url="url"
    :custom-style="{
      '--ps-color-primary': '#E04F39',
      '--ps-color-primary-light': '#E8705E',
      '--ps-color-primary-tint': '#FDF0EE',
      '--ps-font-size': '15px',
      '--ps-font-size-md': '16px',
    }"
  />

  <!-- Dark theme -->
  <CSVViewer
    :src-url="url"
    :custom-style="{
      '--ps-color-bg': '#1a1a2e',
      '--ps-color-bg-secondary': '#16213e',
      '--ps-color-bg-tertiary': '#0f3460',
      '--ps-color-text': '#e0e0e0',
      '--ps-color-text-dark': '#ffffff',
      '--ps-color-text-secondary': '#a0a0a0',
      '--ps-color-border': '#2a2a4a',
      '--ps-color-border-dark': '#3a3a5a',
    }"
  />

  <!-- Reactive overrides from application state -->
  <Markdown
    :markdown-text="content"
    :custom-style="themeOverrides"
  />
</template>

<script setup>
import { computed } from 'vue'
import { DataExplorer, CSVViewer, Markdown } from '@pennsieve-viz/core'

// Overrides can be reactive
const isDark = ref(false)
const themeOverrides = computed(() =>
  isDark.value
    ? { '--ps-color-bg': '#1e1e1e', '--ps-color-text': '#d4d4d4' }
    : {}
)
</script>
```

### What Can Be Overridden

Any `--ps-*` CSS custom property defined in `viewer-theme.scss`. The full list is in the [CSS Custom Properties](#css-custom-properties) section below. Common overrides:

| What you want to change | Variables to override |
|--------------------------|----------------------|
| Brand color | `--ps-color-primary`, `--ps-color-primary-light`, `--ps-color-primary-tint` |
| Font | `--ps-font-family` |
| Font size | `--ps-font-size`, `--ps-font-size-md`, `--ps-font-size-lg` |
| Background | `--ps-color-bg`, `--ps-color-bg-secondary`, `--ps-color-bg-tertiary` |
| Text color | `--ps-color-text`, `--ps-color-text-dark`, `--ps-color-text-secondary` |
| Borders | `--ps-color-border`, `--ps-color-border-dark`, `--ps-radius`, `--ps-radius-lg` |
| Spacing | `--ps-space-sm`, `--ps-space-md`, `--ps-space-lg` |
| Buttons | `--ps-btn-primary-bg`, `--ps-btn-primary-color`, `--ps-btn-primary-hover` |
| Inputs | `--ps-input-bg`, `--ps-input-border`, `--ps-input-focus-border` |
| Tables | `--ps-table-header-bg`, `--ps-table-border`, `--ps-table-row-hover` |

### How to Wire It in Your Viewer

Three things are required in every viewer for overrides to work:

**1. Accept the prop:**
```ts
import type { ViewerStyleOverrides } from '../composables/useViewerStyle'

const props = defineProps<{
  customStyle?: ViewerStyleOverrides
  // ...other props
}>()
```

**2. Create the reactive style object:**
```ts
import { useViewerStyle } from '../composables/useViewerStyle'

const { rootStyle } = useViewerStyle(() => props.customStyle)
```

**3. Bind it to the root element alongside the theme class:**
```vue
<div class="ps-viewer your-viewer" :style="rootStyle">
```

The `viewer-base` mixin (applied via `@include vt.viewer-base`) defines all the default values. The `:style="rootStyle"` binding overlays any consumer overrides on top. If the wrapper passes `customStyle` through but the wrapper itself doesn't render themed UI, it does **not** need `useViewerStyle` — only the core component that applies `viewer-base` does.

---

## Directory Structure

Each viewer lives in its own directory under `packages/core/src/`:

```
packages/core/src/
  your-viewer/
    YourViewer.vue          # Core component (renders the visualization)
    YourViewerWrap.vue      # Wrapper (resolves Pennsieve API or direct URLs)
    index.ts                # Public exports
```

Not every viewer needs a wrapper. If your viewer doesn't load data from Pennsieve packages (e.g. the Markdown editor), a single component is fine.

---

## Step 1: Create the Module Index

**`packages/core/src/your-viewer/index.ts`**

```ts
export { default as YourViewer } from './YourViewerWrap.vue'
export { default as YourViewerCore } from './YourViewer.vue'
```

The wrapper is the default public export. The core component is exported with a `Core` suffix for consumers who want to bypass Pennsieve API integration.

---

## Step 2: Create the Core Component

This is the component that actually renders the visualization.

**`packages/core/src/your-viewer/YourViewer.vue`**

```vue
<template>
  <div class="ps-viewer your-viewer" :style="rootStyle">
    <div v-if="loading" class="your-viewer__loading">
      <div class="your-viewer__spinner" />
      Loading...
    </div>

    <div v-else-if="error" class="your-viewer__error">
      <h3>Error</h3>
      <p>{{ error }}</p>
    </div>

    <div v-else class="your-viewer__content">
      <!-- Your visualization here -->
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useDuckDBStore } from '../duckdb'
import { useViewerStyle, type ViewerStyleOverrides } from '../composables/useViewerStyle'

const props = defineProps<{
  url?: string
  fileType?: 'csv' | 'parquet'
  fileId?: string
  customStyle?: ViewerStyleOverrides
}>()

const { rootStyle } = useViewerStyle(() => props.customStyle)

const duck = useDuckDBStore()
const connectionId = ref<string | null>(null)
const tableName = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

async function ensureConnection() {
  if (connectionId.value) return
  const { connectionId: cid } = await duck.createConnection(`yourviewer_${Date.now()}`)
  connectionId.value = cid
}

async function loadData() {
  if (!props.url || !connectionId.value) return
  loading.value = true
  error.value = null
  try {
    const ft = props.fileType ?? (props.url.toLowerCase().endsWith('.csv') ? 'csv' : 'parquet')
    const id = (props.fileId || props.url).replace(/[^A-Za-z0-9]/g, '_')
    tableName.value = await duck.loadFile(props.url, ft, `yv_${id.slice(0, 48)}`, {}, connectionId.value, id)
    // Query your data here...
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

watch(() => props.url, async () => {
  await ensureConnection()
  await loadData()
}, { immediate: true })

onMounted(async () => { await ensureConnection() })
onBeforeUnmount(async () => {
  if (connectionId.value) await duck.closeConnection(connectionId.value)
})
</script>

<style scoped lang="scss">
@use "../styles/viewer-theme" as vt;

.your-viewer {
  @include vt.viewer-base;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ps-color-border);
  border-radius: var(--ps-radius-lg);
  background-color: var(--ps-color-bg);
  overflow: hidden;
}

.your-viewer__loading {
  @include vt.ps-loading;
}

.your-viewer__spinner {
  @include vt.ps-spinner;
  margin-bottom: var(--ps-space-lg);
}

.your-viewer__error {
  @include vt.ps-error-panel;
  margin: var(--ps-space-lg);
}
</style>
```

### Required patterns in the core component

| Pattern | How |
|---------|-----|
| Root element | `<div class="ps-viewer your-viewer" :style="rootStyle">` |
| Theme mixin | `@include vt.viewer-base;` on root class |
| Style import | `@use "../styles/viewer-theme" as vt;` |
| Custom style prop | `customStyle?: ViewerStyleOverrides` in defineProps |
| Style composable | `const { rootStyle } = useViewerStyle(() => props.customStyle)` |
| Colors | Use `var(--ps-color-*)` variables, never hardcoded hex |
| DuckDB cleanup | Close connection in `onBeforeUnmount` |

---

## Step 3: Create the Wrapper Component (if needed)

The wrapper resolves data URLs from either a direct `srcUrl` prop or the Pennsieve package API. It then passes the resolved URL to the core component.

**`packages/core/src/your-viewer/YourViewerWrap.vue`**

```vue
<template>
  <div class="your-viewer-wrap">
    <YourViewer
      v-if="resolvedUrl"
      :url="resolvedUrl"
      :file-type="resolvedFileType"
      :file-id="resolvedFileId"
      :custom-style="customStyle"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { pathOr } from 'ramda'
import { useGetToken } from '../composables/useGetToken'
import YourViewer from './YourViewer.vue'
import type { ViewerStyleOverrides } from '../composables/useViewerStyle'

const props = defineProps<{
  pkg?: { content?: { id?: string; packageType?: string } } | null
  apiUrl?: string
  srcUrl?: string
  srcFileType?: 'csv' | 'parquet'
  srcFileId?: string
  customStyle?: ViewerStyleOverrides
}>()

const resolvedUrl = ref('')
const resolvedFileType = ref<'csv' | 'parquet'>('parquet')
const resolvedFileId = ref('')

onMounted(async () => {
  // Mode A: direct URL
  if (props.srcUrl) {
    resolvedUrl.value = props.srcUrl
    resolvedFileType.value =
      props.srcFileType ?? (props.srcUrl.toLowerCase().endsWith('.csv') ? 'csv' : 'parquet')
    resolvedFileId.value = props.srcFileId || ''
    return
  }

  // Mode B: Pennsieve package API
  const pkgId = pathOr('', ['content', 'id'], props.pkg)
  if (!pkgId || !props.apiUrl) return

  try {
    const token = await useGetToken()
    const viewUrl = `${props.apiUrl}/packages/${pkgId}/view?api_key=${token}`
    const r = await fetch(viewUrl)
    if (!r.ok) throw new Error(`view failed: ${r.status}`)
    const assets = await r.json()

    const firstFileId = assets?.[0]?.content?.id
    if (!firstFileId) return
    resolvedFileId.value = firstFileId

    const fileUrl = `${props.apiUrl}/packages/${pkgId}/files/${firstFileId}?api_key=${token}`
    const r2 = await fetch(fileUrl)
    if (!r2.ok) throw new Error(`file url failed: ${r2.status}`)
    resolvedUrl.value = (await r2.json()).url

    const pt = props.pkg?.content?.packageType
    resolvedFileType.value = pt === 'CSV' ? 'csv' : 'parquet'
  } catch (err) {
    console.error('[YourViewerWrap]', err)
  }
})
</script>

<style scoped>
.your-viewer-wrap {
  height: 100%;
  width: 100%;
}
</style>
```

The wrapper **does not** apply `viewer-base` or use `rootStyle` itself — that happens in the core component. The wrapper only passes `customStyle` through.

---

## Step 4: Register in the Core Index

**`packages/core/src/index.ts`** — add two lines:

```ts
// In the "Direct exports" section:
export * from './your-viewer'

// In the "Lazy-loaded" section:
export const YourViewerLazy = defineAsyncComponent(
  () => import('./your-viewer').then(m => m.YourViewer)
)
```

No other config files need changes. The build picks up new modules automatically.

---

## Step 5: Add to the Dev Playground (optional)

**`packages/core/src/App.vue`** — add a section to visually test your viewer:

```vue
<section class="component-section">
  <h2 class="component-label">YourViewer</h2>
  <p class="component-path">@pennsieve-viz/your-viewer</p>
  <div class="component-container" style="height: 400px">
    <YourViewer :src-url="someUrl" />
  </div>
</section>
```

Run the playground with:

```bash
pnpm --filter @pennsieve-viz/core dev
```

---

## Styling Reference

### Theme Import

Every viewer's `<style>` block starts with:

```scss
@use "../styles/viewer-theme" as vt;
```

### Root Element

Always apply `viewer-base` on the root class. This sets all CSS custom properties and base typography:

```scss
.your-viewer {
  @include vt.viewer-base;
}
```

### Available Mixins

| Mixin | Use for |
|-------|---------|
| `vt.viewer-base` | Root element of every viewer (required) |
| `vt.ps-btn-primary` | Primary action buttons |
| `vt.ps-btn-secondary` | Secondary/cancel buttons |
| `vt.ps-btn-danger` | Destructive action buttons |
| `vt.ps-input` | Text inputs and selects |
| `vt.ps-data-table` | Data tables with sticky headers |
| `vt.ps-loading` | Loading state container |
| `vt.ps-spinner` | Animated spinner ring |
| `vt.ps-error-panel` | Error message panel |
| `vt.ps-info-bar` | Info/status bar above content |

### CSS Custom Properties

Use `var(--ps-*)` for all visual values. Never hardcode hex colors.

**Colors — Brand:**
| Variable | Value | Use |
|----------|-------|-----|
| `--ps-color-primary` | `#011F5B` | Primary actions, links, focus rings |
| `--ps-color-primary-light` | `#4d628c` | Hover state for primary |
| `--ps-color-primary-tint` | `#e6e9ef` | Subtle primary backgrounds |

**Colors — Text:**
| Variable | Value | Use |
|----------|-------|-----|
| `--ps-color-text` | `#4d4d4d` | Default body text |
| `--ps-color-text-secondary` | `#999999` | Muted/secondary text |
| `--ps-color-text-dark` | `#333333` | Headings, labels |
| `--ps-color-text-inverse` | `#ffffff` | Text on dark backgrounds |

**Colors — Backgrounds:**
| Variable | Value | Use |
|----------|-------|-----|
| `--ps-color-bg` | `#ffffff` | Default background |
| `--ps-color-bg-secondary` | `#F7F7F7` | Alternate rows, sidebars |
| `--ps-color-bg-tertiary` | `#F2F2F2` | Inset areas, empty states |
| `--ps-color-bg-hover` | `#F2F2F2` | Hover highlight |

**Colors — Borders:**
| Variable | Value | Use |
|----------|-------|-----|
| `--ps-color-border` | `#e5e5e5` | Default borders |
| `--ps-color-border-light` | `#F7F7F7` | Subtle dividers |
| `--ps-color-border-dark` | `#CCCCCC` | Emphasized borders |

**Colors — Semantic:**
| Variable | Value | Use |
|----------|-------|-----|
| `--ps-color-success` | `#17bb62` | Success states |
| `--ps-color-error` | `#F25641` | Error states |
| `--ps-color-error-dark` | `#C14D49` | Error text on tinted bg |
| `--ps-color-error-tint` | `#FEEEEC` | Error background |
| `--ps-color-warning` | `#F9A23A` | Warning states |

**Spacing:**
| Variable | Value |
|----------|-------|
| `--ps-space-xs` | `4px` |
| `--ps-space-sm` | `8px` |
| `--ps-space-md` | `12px` |
| `--ps-space-lg` | `16px` |
| `--ps-space-xl` | `20px` |
| `--ps-space-2xl` | `24px` |

**Radii:**
| Variable | Value |
|----------|-------|
| `--ps-radius-sm` | `2px` |
| `--ps-radius` | `4px` |
| `--ps-radius-lg` | `6px` |

**Typography:**
| Variable | Value |
|----------|-------|
| `--ps-font-family` | `'Roboto', sans-serif` |
| `--ps-font-family-mono` | `ui-monospace, SFMono-Regular, ...` |
| `--ps-font-size-xs` | `11px` |
| `--ps-font-size-sm` | `12px` |
| `--ps-font-size` | `13px` |
| `--ps-font-size-md` | `14px` |
| `--ps-font-size-lg` | `16px` |

### Color Rules

1. **UI elements** — always use `var(--ps-*)` variables
2. **Data visualization palettes** (chart colors, heatmap gradients) — hardcoded hex is acceptable since these are semantic to the data, not the UI chrome
3. **CSS fallback values** — when a child component doesn't include `viewer-base` itself and inherits variables from a parent, use the exact Pennsieve palette value as the fallback: `var(--ps-color-border, #e5e5e5)` not `var(--ps-color-border, #ddd)`

---

## DuckDB Integration

Most data viewers use the shared DuckDB-WASM store to load and query CSV/Parquet files in-browser.

```ts
import { useDuckDBStore } from '../duckdb'

const duck = useDuckDBStore()
```

### Connection Lifecycle

```ts
const connectionId = ref<string | null>(null)

// Create — typically in onMounted or a watcher
const { connectionId: cid } = await duck.createConnection(`myviewer_${Date.now()}`)
connectionId.value = cid

// Destroy — always in onBeforeUnmount
onBeforeUnmount(async () => {
  if (connectionId.value) await duck.closeConnection(connectionId.value)
})
```

### Loading Files

```ts
const loadedTableName = await duck.loadFile(
  url,              // presigned S3 URL or public URL
  'parquet',        // 'csv' | 'parquet'
  'my_table_name',  // DuckDB table name
  {},               // CSV options (header, delimiter, etc.)
  connectionId,     // your connection ID
  stableFileId      // de-duplication key (prevents reloading the same file)
)
```

The store de-duplicates by `stableFileId`. If the same file is already loaded, `loadFile` returns the existing table name immediately.

### Querying

```ts
const rows = await duck.executeQuery(
  `SELECT * FROM ${tableName} LIMIT 100`,
  connectionId
)
// rows is an array of plain objects: [{ col1: val1, col2: val2, ... }, ...]
```

### Cross-Viewer Communication

The store exposes `sharedResultName` and `sharedVersion` for viewers that publish query results to other viewers (e.g. DataExplorer publishing a filtered view that UMAP picks up):

```ts
await duck.publishViewFromQuery('my_view', sql, connectionId)
// Other viewers watch:
watch([() => duck.sharedVersion, () => duck.sharedResultName], async () => { ... })
```

---

## Authentication

For Pennsieve API calls, use the `useGetToken` composable. It's async and returns `null` if `@aws-amplify/auth` isn't available (the dependency is optional):

```ts
import { useGetToken } from '../composables/useGetToken'

const token = await useGetToken()
const url = `${apiUrl}/packages/${pkgId}/view?api_key=${token}`
```

---

## Checklist

Before submitting your viewer:

- [ ] Directory created: `packages/core/src/your-viewer/`
- [ ] `index.ts` exports the main component
- [ ] Core component has `class="ps-viewer ..."` + `:style="rootStyle"` on root element
- [ ] Core component uses `@include vt.viewer-base` in its root SCSS class
- [ ] `customStyle?: ViewerStyleOverrides` prop is accepted
- [ ] `useViewerStyle()` composable is wired up
- [ ] No hardcoded hex colors in CSS (use `var(--ps-*)` variables)
- [ ] CSS fallback values match the Pennsieve palette exactly
- [ ] DuckDB connection is cleaned up in `onBeforeUnmount`
- [ ] Wrapper passes `customStyle` through to core component
- [ ] `packages/core/src/index.ts` has both direct and lazy exports
- [ ] `pnpm --filter @pennsieve-viz/core build` succeeds
- [ ] Component renders in the dev playground (`pnpm --filter @pennsieve-viz/core dev`)
