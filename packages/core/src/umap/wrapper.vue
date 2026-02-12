<template>
  <div class="app-container">
    <WebGLScatterplot
      :data="store.pointData"
      :metaData="store.metaData"
      :pointCount="store.pointCount"
      :color-map="store.colorMap"
      :colorMode="store.colorMode"
      :startColor="store.startColor"
      :endColor="store.endColor"
      :singleColor="store.singleColor"
      :selectedMapEntries="Array.from(store.colorMap)"
      :forceRegenerate="store.forceRegenerate"
      :key="store.componentKey"
      :hover-fields="store.hoverFields"
    />
    <ControlPanel
      v-model:pointCount="store.pointCount"
      v-model:colorMode="store.colorMode"
      v-model:startColor="store.startColor"
      v-model:endColor="store.endColor"
      v-model:singleColor="store.singleColor"
      :color-scheme="store.colorMap"
      :color-map-map="store.colorMapMap"
      @regenerate="regenerateData"
      @updateColorMap="updateColorMap"
    />
  </div>
</template>

<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount, computed, provide } from 'vue'
import WebGLScatterplot from './scatterplot.vue'
import ControlPanel from './control.vue'
import { useDuckDBStore } from '../duckdb'
import { useGetToken } from '../composables/useGetToken'
import { createUMAPStore, clearUMAPStore } from './umapStore'

const props = defineProps<{
  instanceId?: string
  apiUrl?: string
  pkg?: { content?: { id?: string; packageType?: string } } | null
  srcUrl?: string
  srcFileType?: 'csv' | 'parquet'
  srcFileId?: string
  /** Optional: accept pre-loaded data directly (skip URL loading) */
  data?: Array<Record<string, any>>
}>()

// Create instance-specific store
const effectiveInstanceId = computed(() => props.instanceId || 'default')
const store = createUMAPStore(effectiveInstanceId.value)

// Provide store to child components (for future use)
provide('umapStore', store)
provide('umapInstanceId', effectiveInstanceId.value)

// DuckDB store (shared singleton)
const duck = useDuckDBStore()

// View assets for Pennsieve API mode
const viewAssets = computed(() => [] as any[])

// Default axes
const defaultX = 'UMAP_1'
const defaultY = 'UMAP_2'

// Stable ID for file deduplication
const stableId = computed(() => duck.formatIdFromUrl(props.srcUrl || ''))

// ----------------- Orchestrator -----------------

// Watch for pre-loaded data prop
watch(
  () => props.data,
  async (newData) => {
    if (newData && newData.length > 0) {
      try {
        store.setLoading(true)
        store.setError(null)
        await hydrateFromPreloadedData(newData)
      } catch (e: any) {
        console.error('[UMAP Wrapper] Pre-loaded data processing failed:', e?.message || e)
        store.setError(e?.message || 'Data processing failed')
      } finally {
        store.setLoading(false)
      }
    }
  },
  { immediate: true, deep: true }
)

// Watch for URL/pkg-based loading (skip if data prop is provided)
watch(
  () => ({
    srcUrl: props.srcUrl,
    srcFileType: props.srcFileType,
    srcFileId: props.srcFileId,
    pkgId: props.pkg?.content?.id || '',
    pkgType: props.pkg?.content?.packageType || 'csv',
    apiUrl: props.apiUrl || '',
    hasPreloadedData: !!(props.data && props.data.length > 0)
  }),
  async ({ srcUrl, srcFileType, srcFileId, pkgId, pkgType, apiUrl, hasPreloadedData }) => {
    // Skip URL loading if pre-loaded data is provided
    if (hasPreloadedData) {
      return
    }

    try {
      store.setPointData([])
      store.setMetaData(null)
      store.setLoading(true)
      store.setError(null)
      await ensureConnection()

      // Track source info
      store.setSourceInfo({
        url: srcUrl || null,
        fileType: srcFileType || null,
        fileId: srcFileId || null,
        pkgId: pkgId || null,
      })

      if (srcUrl) {
        const ft = srcFileType ?? (srcUrl.toLowerCase().endsWith('.csv') ? 'csv' : 'parquet')
        await loadIntoDuckDB(srcUrl, ft, stableId.value.toString())
        await hydrateFromDuckDB()
        return
      }

      if (pkgId && apiUrl) {
        const assets = await getViewerAssets(pkgId, apiUrl)
        const firstFileId = assets?.[0]?.content?.id
        if (!firstFileId) return
        const presigned = await getFileUrl(pkgId, firstFileId, apiUrl)
        const ft = 'parquet'
        await loadIntoDuckDB(presigned, ft, firstFileId.toString())
        await hydrateFromDuckDB()
      }
    } catch (e: any) {
      console.error('[UMAP Wrapper] Load failed:', e?.message || e)
      store.setError(e?.message || 'Load failed')
    } finally {
      store.setLoading(false)
    }
  },
  { immediate: true }
)

watch(() => store.pointCount, async () => {
  // If pre-loaded data is available, re-hydrate from it
  if (props.data && props.data.length > 0) {
    await hydrateFromPreloadedData(props.data)
    return
  }
  // Otherwise, re-fetch from DuckDB
  if (store.tableName && store.connectionId) {
    await fetchPointsAndMeta()
  }
})

// Auto-update when DataExplorer publishes a view/table
watch([() => duck.sharedVersion, () => duck.sharedResultName], async () => {
  if (!duck.sharedResultName) return
  await ensureConnection()
  store.setTableName(duck.sharedResultName)
  await hydrateFromDuckDB()
})

// ----------------- DuckDB helpers -----------------
async function ensureConnection() {
  if (store.connectionId) return
  const { connectionId: cid } = await duck.createConnection(`umap_${effectiveInstanceId.value}_${Date.now()}`)
  store.setConnectionId(cid)
}

async function loadIntoDuckDB(url: string, fileType: 'csv' | 'parquet', validId: string) {
  const tname = `umap_${validId.replace(/[^a-zA-Z0-9_]/g, '_')}`
  const loadedName = await duck.loadFile(url, fileType, tname, {}, store.connectionId!, validId)
  store.setTableName(loadedName)
}

/** Process pre-loaded data array directly (no DuckDB needed) */
async function hydrateFromPreloadedData(rows: Array<Record<string, any>>) {
  if (!rows || rows.length === 0) return

  // Infer columns from first row
  const firstRow = rows[0]
  const colNames = Object.keys(firstRow)

  // Infer column types
  const cols = colNames.map(name => {
    const sampleValue = firstRow[name]
    let type = 'VARCHAR'
    if (typeof sampleValue === 'number') {
      type = Number.isInteger(sampleValue) ? 'INTEGER' : 'DOUBLE'
    } else if (typeof sampleValue === 'bigint') {
      type = 'BIGINT'
    }
    return { name, type }
  })
  store.setColumns(cols)

  const numericCols = cols.filter(c => /DOUBLE|HUGEINT|BIGINT|INTEGER|DECIMAL|FLOAT|REAL/i.test(c.type))

  // Choose axes
  const xKey = cols.some(c => c.name === defaultX) ? defaultX : (numericCols[0]?.name || cols[0]?.name)
  const yKey = cols.some(c => c.name === defaultY) ? defaultY : (numericCols[1]?.name || cols[1]?.name || xKey)
  store.setAxes(xKey, yKey)

  // Limit to pointCount
  const limitedRows = rows.slice(0, store.pointCount)
  const others = colNames.filter(n => n !== xKey && n !== yKey)

  // Transform to point format
  const points = limitedRows
    .filter((r: any) => r[xKey] != null && r[yKey] != null)
    .map((r: any, i: number) => {
      const attrs: Record<string, any> = {}
      for (const name of colNames) {
        attrs[name] = r[name]
      }
      const rawRow = [r[xKey], r[yKey], ...others.map(n => r[n])]
      return {
        x: Number(r[xKey]),
        y: Number(r[yKey]),
        rawX: Number(r[xKey]),
        rawY: Number(r[yKey]),
        id: i,
        color: [0.5, 0.5, 0.5],
        attrs,
        rawRow
      }
    })
  store.setPointData(points)

  // Compute stats for metadata
  const xVals = points.map(p => p.x).filter(Number.isFinite)
  const yVals = points.map(p => p.y).filter(Number.isFinite)
  const xmin = Math.min(...xVals), xmax = Math.max(...xVals)
  const ymin = Math.min(...yVals), ymax = Math.max(...yVals)

  store.setMetaData({
    schema: [{ name: xKey }, { name: yKey }, ...others.map(n => ({ name: n }))],
    row_groups: [
      {
        columns: [
          { meta_data: { statistics: { min_value: xmin, max_value: xmax } } },
          { meta_data: { statistics: { min_value: ymin, max_value: ymax } } }
        ]
      }
    ]
  })

  computeHoverFieldsFromSample()
  await buildColorMapsFromPreloadedData(cols, xKey, yKey, limitedRows)
}

/** Build color maps from pre-loaded data (no DuckDB queries) */
async function buildColorMapsFromPreloadedData(
  cols: Array<{ name: string, type: string }>,
  xKey: string,
  yKey: string,
  rows: Array<Record<string, any>>
) {
  const newColorMapMap = new Map<string, Map<any, number[]>>()

  const hexColors = ['#4269d0', '#efb118', '#ff725c', '#6cc5b0', '#3ca951', '#ff8ab7', '#a463f2', '#97bbf5', '#9c6b4e', '#9498a0']
  const isNumeric = (t: string) => /DOUBLE|HUGEINT|BIGINT|INTEGER|DECIMAL|FLOAT|REAL/i.test(t)

  for (const c of cols) {
    if (c.name === xKey || c.name === yKey) {
      newColorMapMap.set(c.name, new Map())
      continue
    }

    if (isNumeric(c.type)) {
      newColorMapMap.set(c.name, new Map())
    } else {
      // Get distinct values from pre-loaded data
      const distinctValues = new Set<any>()
      for (const row of rows) {
        const v = row[c.name]
        if (v !== null && v !== undefined) {
          distinctValues.add(v)
          if (distinctValues.size >= 10000) break // Same limit as DuckDB version
        }
      }

      const valueMap = new Map<any, number[]>()
      Array.from(distinctValues).forEach((v: any, i: number) =>
        valueMap.set(v, hexToRgb(hexColors[i % hexColors.length]))
      )
      newColorMapMap.set(c.name, valueMap)
    }
  }

  store.setColorMapMap(newColorMapMap)

  const meta = store.metaData
  if (meta) {
    meta.key_value_metadata = Array.from(newColorMapMap.keys()).map(key => ({
      key,
      value: JSON.stringify(Array.from(newColorMapMap.get(key)?.keys() ?? []))
    }))
    store.setMetaData(meta)
  }

  if (store.colorMode !== 'random' && !newColorMapMap.has(store.colorMode)) {
    store.setColorMode('random')
  }
}

/** choose axes, pull [x,y,...ALL cols], synthesize meta + color keys */
async function hydrateFromDuckDB() {
  if (!store.tableName || !store.connectionId) return
  const cols = await getColumns(store.tableName)
  store.setColumns(cols)

  const numericCols = cols.filter(c => /DOUBLE|HUGEINT|BIGINT|INTEGER|DECIMAL|FLOAT|REAL/i.test(c.type))

  const xKey = cols.some(c => c.name === defaultX) ? defaultX : (numericCols[0]?.name || cols[0]?.name)
  const yKey = cols.some(c => c.name === defaultY) ? defaultY : (numericCols[1]?.name || cols[1]?.name || xKey)

  store.setAxes(xKey, yKey)
  await fetchPointsAndMeta(xKey, yKey, cols.map(c => c.name))
  await buildColorMaps(cols, xKey, yKey)
}

async function fetchPointsAndMeta(
  xKey = 'UMAP_1',
  yKey = 'UMAP_2',
  allColNames?: string[],
  allCols?: Array<{ name: string, type: string }>
) {
  if (!store.tableName || !store.connectionId) return

  const cols = allCols ?? await getColumns(store.tableName)

  const names = allColNames ?? cols.map(c => c.name)

  const xCol = cols.find(c => c.name === xKey)
  const yCol = cols.find(c => c.name === yKey)

  const xExpr = isNumericType(xCol?.type ?? '') ? duckIdent(xKey) : `TRY_CAST(${duckIdent(xKey)} AS DOUBLE)`
  const yExpr = isNumericType(yCol?.type ?? '') ? duckIdent(yKey) : `TRY_CAST(${duckIdent(yKey)} AS DOUBLE)`

  const others = names.filter(n => n !== xKey && n !== yKey)
  const select = [
    `${xExpr} AS __x`,
    `${yExpr} AS __y`,
    ...others.map(n => duckIdent(n))
  ].join(', ')

  const tbl = duckIdent(store.tableName!)
  const q = `
    SELECT ${select}
    FROM ${tbl}
    WHERE ${xExpr} IS NOT NULL AND ${yExpr} IS NOT NULL
    LIMIT ${store.pointCount}
  `
  const rows = await duck.executeQuery(q, store.connectionId!)

  const points = rows.map((r: any, i: number) => {
    const attrs: Record<string, any> = {}
    for (const name of names) {
      attrs[name] = r[name]
    }
    const rawRow = [r.__x, r.__y, ...others.map(n => r[n])]
    return {
      x: Number(r.__x),
      y: Number(r.__y),
      rawX: Number(r.__x),
      rawY: Number(r.__y),
      id: i,
      color: [0.5, 0.5, 0.5],
      attrs,
      rawRow
    }
  })
  store.setPointData(points)

  const s = `
    SELECT min(${xExpr}) AS xmin, max(${xExpr}) AS xmax,
           min(${yExpr}) AS ymin, max(${yExpr}) AS ymax
    FROM ${tbl}
    WHERE ${xExpr} IS NOT NULL AND ${yExpr} IS NOT NULL
  `
  const stat = (await duck.executeQuery(s, store.connectionId!))?.[0] || { xmin: -1, xmax: 1, ymin: -1, ymax: 1 }
  store.setMetaData({
    schema: [{ name: xKey }, { name: yKey }, ...others.map(n => ({ name: n }))],
    row_groups: [
      {
        columns: [
          { meta_data: { statistics: { min_value: stat.xmin, max_value: stat.xmax } } },
          { meta_data: { statistics: { min_value: stat.ymin, max_value: stat.ymax } } }
        ]
      }
    ]
  })
  computeHoverFieldsFromSample()
}

function computeHoverFieldsFromSample(maxFields = 6) {
  const schema = (store.metaData?.schema ?? []).map((s: any) => s?.name || '')
  if (!schema.length || !store.pointData?.length) { store.setHoverFields([]); return }

  const candidates = schema.slice(2)
  const rows = store.pointData as Array<{ attrs?: Record<string, any> }>

  type Stat = { name: string; nullRate: number; unique: number; isNumeric: boolean }
  const stats: Stat[] = candidates.map((name: string) => {
    let nulls = 0
    const set = new Set<any>()
    let numericCount = 0
    let nonNullCount = 0

    for (const r of rows) {
      const v = r?.attrs?.[name]
      if (v === null || v === undefined || v === '') { nulls++; continue }
      nonNullCount++
      set.add(v)
      const num = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(num)) numericCount++
    }

    const nullRate = rows.length ? nulls / rows.length : 1
    const isNumeric = nonNullCount > 0 && (numericCount / nonNullCount) > 0.8
    return { name, nullRate, unique: set.size, isNumeric }
  })

  const preferredNames = new Set([
    'seurat_clusters', 'cluster', 'cell_type', 'Study', 'Species', 'Sex', 'Donor',
    'Atlas_annotation', 'Level', 'orig.ident', 'Dataset'
  ])

  const score = (s: Stat) => {
    let sc = 0
    if (!s.isNumeric) sc += 3
    if (s.unique >= 2 && s.unique <= 30) sc += 3
    sc += Math.max(0, 2 - Math.abs(10 - s.unique) / 10)
    sc += (1 - s.nullRate) * 3
    if (preferredNames.has(s.name)) sc += 2
    return sc
  }

  stats.sort((a, b) => score(b) - score(a))
  store.setHoverFields(stats.filter(s => s.nullRate < 0.95).slice(0, maxFields).map(s => s.name))
}

// helpers
function duckIdent(id: string) {
  return `"${id.replace(/"/g, '""')}"`
}

function isNumericType(t: string) {
  return /INT|DECIMAL|DOUBLE|FLOAT|REAL|HUGEINT|UBIGINT|BIGINT/i.test(t)
}

/** Build color options for *all* columns. Categorical -> legend map; Numeric -> empty (UMAP will do gradient) */
async function buildColorMaps(
  cols: Array<{ name: string, type: string }>,
  xKey: string,
  yKey: string
) {
  const newColorMapMap = new Map<string, Map<any, number[]>>()

  const hexColors = ['#4269d0', '#efb118', '#ff725c', '#6cc5b0', '#3ca951', '#ff8ab7', '#a463f2', '#97bbf5', '#9c6b4e', '#9498a0']
  const isNumeric = (t: string) => /DOUBLE|HUGEINT|BIGINT|INTEGER|DECIMAL|FLOAT|REAL/i.test(t)

  for (const c of cols) {
    if (c.name === xKey || c.name === yKey) {
      newColorMapMap.set(c.name, new Map())
      continue
    }

    if (isNumeric(c.type)) {
      newColorMapMap.set(c.name, new Map())
    } else {
      const distinctQ = `SELECT DISTINCT ${quote(c.name)} AS v FROM ${store.tableName} LIMIT 10000`
      const distinct = await duck.executeQuery(distinctQ, store.connectionId!)
      const values = distinct.map((r: any) => r.v).filter((v: any) => v !== null && v !== undefined)

      const valueMap = new Map<any, number[]>()
      values.forEach((v: any, i: number) => valueMap.set(v, hexToRgb(hexColors[i % hexColors.length])))
      newColorMapMap.set(c.name, valueMap)
    }
  }

  store.setColorMapMap(newColorMapMap)

  const meta = store.metaData
  if (meta) {
    meta.key_value_metadata = Array.from(newColorMapMap.keys()).map(key => ({
      key,
      value: JSON.stringify(Array.from(newColorMapMap.get(key)?.keys() ?? []))
    }))
    store.setMetaData(meta)
  }

  if (store.colorMode !== 'random' && !newColorMapMap.has(store.colorMode)) {
    store.setColorMode('random')
  }
}

// ----------------- Pennsieve helpers -----------------
async function getViewerAssets(pkgId: string, apiUrl: string) {
  const token = await useGetToken()
  const url = `${apiUrl}/packages/${pkgId}/view?api_key=${token}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`view failed: ${r.status}`)
  return await r.json()
}

async function getFileUrl(pkgId: string, fileId: string, apiUrl: string) {
  const token = await useGetToken()
  const url = `${apiUrl}/packages/${pkgId}/files/${fileId}?api_key=${token}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`file url failed: ${r.status}`)
  const j = await r.json()
  return j.url as string
}

// ----------------- tiny utils -----------------
function quote(id: string) {
  return `"${id.replace(/"/g, '""')}"`
}

function regenerateData() {
  store.triggerRegenerate()
}

function hexToRgb(hex: string): [number, number, number] {
  try {
    if (!hex || hex.length < 7) return [1, 0, 0]
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [1, 0, 0]
    return [r, g, b]
  } catch { return [1, 0, 0] }
}

function updateColorMap(data: [string, Map<any, number[]>]) {
  store.setColorMap(data[1])
}

// columns/types
async function getColumns(tbl: string) {
  const rows = await duck.executeQuery(`PRAGMA table_info(${tbl});`, store.connectionId!)
  return rows.map((r: any) => ({ name: r.name, type: r.type }))
}

// ----------------- lifecycle -----------------
onMounted(async () => { await ensureConnection() })
onBeforeUnmount(async () => {
  // Close DuckDB connection
  if (store.connectionId) {
    await duck.closeConnection(store.connectionId)
  }
  // Clear store instance
  clearUMAPStore(effectiveInstanceId.value)
})
</script>

<style scoped>
.app-container {
  height: 100%;
  position: relative;
  height: 100%;
  overflow: hidden;
}
</style>
