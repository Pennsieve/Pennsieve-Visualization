<template>
  <div class="app-container">
    <WebGLScatterplot
      :data="pointData"
      :metaData="metaData"
      :pointCount="pointCount"
      :color-map="colorMap"
      :colorMode="colorMode"
      :startColor="startColor"
      :endColor="endColor"
      :singleColor="singleColor"
      :selectedMapEntries="Array.from(colorMap)"
      :forceRegenerate="forceRegenerate"
      :key="componentKey"
      :hover-fields="hoverFields"
    />
    <ControlPanel
      v-model:pointCount="pointCount"
      v-model:colorMode="colorMode"
      v-model:startColor="startColor"
      v-model:endColor="endColor"
      v-model:singleColor="singleColor"
      :color-scheme="colorMap"
      :color-map-map="colorMapMap"
      @regenerate="regenerateData"
      @updateColorMap="updateColorMap"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import WebGLScatterplot from './scatterplot.vue'
import ControlPanel from './control.vue'
import { useDuckDBStore } from '../duckdb'
import { useGetToken } from '../composables/useGetToken'

const props = defineProps<{
  apiUrl?: string
  pkg?: { content?: { id?: string; packageType?: string } } | null
  srcUrl?: string
  srcFileType?: 'csv' | 'parquet'
  srcFileId?: string
}>()

// ----------------- Reactive state -----------------
const pointCount = ref(5000)
const colorMode = ref('random')
const startColor = ref('#ff0000')
const endColor = ref('#0000ff')
const singleColor = ref('#4285f4')
const forceRegenerate = ref(false)
const componentKey = ref(0)

const pointData = ref<any[]>([])
const metaData = ref<any>(null)

const colorMap = ref<Map<any, any>>(new Map())
const colorMapMap = ref<Map<string, Map<any, number[]>>>(new Map())

const viewAssets = ref<any[]>([])

// duckdb wiring
const duck = useDuckDBStore()
const connectionId = ref<string | null>(null)
const tableName = ref<string | null>(null)

// default axes
const defaultX = 'UMAP_1'
const defaultY = 'UMAP_2'

// ----------------- Orchestrator -----------------
const stableId = computed(() => duck.formatIdFromUrl(props.srcUrl || ''))

watch(
  () => ({
    srcUrl: props.srcUrl,
    srcFileType: props.srcFileType,
    srcFileId: props.srcFileId,
    pkgId: props.pkg?.content?.id || '',
    pkgType: props.pkg?.content?.packageType || 'csv',
    apiUrl: props.apiUrl || ''
  }),
  async ({ srcUrl, srcFileType, srcFileId, pkgId, pkgType, apiUrl }) => {
    try {
      pointData.value = []
      metaData.value = null
      await ensureConnection()

      if (srcUrl) {
        const ft = srcFileType ?? (srcUrl.toLowerCase().endsWith('.csv') ? 'csv' : 'parquet')
        await loadIntoDuckDB(srcUrl, ft, stableId.value.toString())
        await hydrateFromDuckDB()
        return
      }

      if (pkgId && apiUrl) {
        await getViewerAssets(pkgId, apiUrl)
        const firstFileId = viewAssets.value?.[0]?.content?.id
        if (!firstFileId) return
        const presigned = await getFileUrl(pkgId, firstFileId, apiUrl)
        const ft = 'parquet'
        await loadIntoDuckDB(presigned, ft, firstFileId.toString())
        await hydrateFromDuckDB()
      }
    } catch (e: any) {
      console.error('[UMAP Wrapper] Load failed:', e?.message || e)
    }
  },
  { immediate: true }
)

watch(pointCount, async () => {
  if (tableName.value && connectionId.value) {
    await fetchPointsAndMeta()
  }
})

// auto-update when DataExplorer publishes a view/table
watch([() => duck.sharedVersion, () => duck.sharedResultName], async () => {
  if (!duck.sharedResultName) return
  await ensureConnection()
  tableName.value = duck.sharedResultName
  await hydrateFromDuckDB()
})

// ----------------- DuckDB helpers -----------------
async function ensureConnection() {
  if (connectionId.value) return
  const { connectionId: cid } = await duck.createConnection(`umap_${Date.now()}`)
  connectionId.value = cid
}

async function loadIntoDuckDB(url: string, fileType: 'csv' | 'parquet', validId: string) {
  const tname = `umap_${validId.replace(/[^a-zA-Z0-9_]/g, '_')}`
  tableName.value = await duck.loadFile(url, fileType, tname, {}, connectionId.value!, validId)
}

/** choose axes, pull [x,y,...ALL cols], synthesize meta + color keys */
async function hydrateFromDuckDB() {
  if (!tableName.value || !connectionId.value) return
  const cols = await getColumns(tableName.value)
  const numericCols = cols.filter(c => /DOUBLE|HUGEINT|BIGINT|INTEGER|DECIMAL|FLOAT|REAL/i.test(c.type))

  const xKey = cols.some(c => c.name === defaultX) ? defaultX : (numericCols[0]?.name || cols[0]?.name)
  const yKey = cols.some(c => c.name === defaultY) ? defaultY : (numericCols[1]?.name || cols[1]?.name || xKey)

  await fetchPointsAndMeta(xKey, yKey, cols.map(c => c.name))
  await buildColorMaps(cols, xKey, yKey)
}

async function fetchPointsAndMeta(
  xKey = 'UMAP_1',
  yKey = 'UMAP_2',
  allColNames?: string[],
  allCols?: Array<{ name: string, type: string }>
) {
  if (!tableName.value || !connectionId.value) return

  const cols = allCols ?? await getColumns(tableName.value)

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

  const tbl = duckIdent(tableName.value!)
  const q = `
    SELECT ${select}
    FROM ${tbl}
    WHERE ${xExpr} IS NOT NULL AND ${yExpr} IS NOT NULL
    LIMIT ${pointCount.value}
  `
  const rows = await duck.executeQuery(q, connectionId.value!)

  pointData.value = rows.map((r: any, i: number) => {
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

  const s = `
    SELECT min(${xExpr}) AS xmin, max(${xExpr}) AS xmax,
           min(${yExpr}) AS ymin, max(${yExpr}) AS ymax
    FROM ${tbl}
    WHERE ${xExpr} IS NOT NULL AND ${yExpr} IS NOT NULL
  `
  const stat = (await duck.executeQuery(s, connectionId.value!))?.[0] || { xmin: -1, xmax: 1, ymin: -1, ymax: 1 }
  metaData.value = {
    schema: [{ name: xKey }, { name: yKey }, ...others.map(n => ({ name: n }))],
    row_groups: [
      {
        columns: [
          { meta_data: { statistics: { min_value: stat.xmin, max_value: stat.xmax } } },
          { meta_data: { statistics: { min_value: stat.ymin, max_value: stat.ymax } } }
        ]
      }
    ]
  }
  computeHoverFieldsFromSample()
}

const hoverFields = ref<string[]>([])

function computeHoverFieldsFromSample(maxFields = 6) {
  const schema = (metaData.value?.schema ?? []).map((s: any) => s?.name || '')
  if (!schema.length || !pointData.value?.length) { hoverFields.value = []; return }

  const candidates = schema.slice(2)
  const rows = pointData.value as Array<{ attrs?: Record<string, any> }>

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
  hoverFields.value = stats.filter(s => s.nullRate < 0.95).slice(0, maxFields).map(s => s.name)
}

// helpers
function duckIdent(id: string) {
  return `"${id.replace(/"/g, '""')}"`
}

function isNumericType(t: string) {
  return /INT|DECIMAL|DOUBLE|FLOAT|REAL|HUGEINT|UBIGINT|BIGINT/i.test(t)
}

/** Build color options for *all* columns. Categorical → legend map; Numeric → empty (UMAP will do gradient) */
async function buildColorMaps(
  cols: Array<{ name: string, type: string }>,
  xKey: string,
  yKey: string
) {
  colorMapMap.value = new Map()

  const hexColors = ['#4269d0', '#efb118', '#ff725c', '#6cc5b0', '#3ca951', '#ff8ab7', '#a463f2', '#97bbf5', '#9c6b4e', '#9498a0']
  const isNumeric = (t: string) => /DOUBLE|HUGEINT|BIGINT|INTEGER|DECIMAL|FLOAT|REAL/i.test(t)

  for (const c of cols) {
    if (c.name === xKey || c.name === yKey) {
      colorMapMap.value.set(c.name, new Map())
      continue
    }

    if (isNumeric(c.type)) {
      colorMapMap.value.set(c.name, new Map())
    } else {
      const distinctQ = `SELECT DISTINCT ${quote(c.name)} AS v FROM ${tableName.value} LIMIT 10000`
      const distinct = await duck.executeQuery(distinctQ, connectionId.value!)
      const values = distinct.map((r: any) => r.v).filter((v: any) => v !== null && v !== undefined)

      const valueMap = new Map<any, number[]>()
      values.forEach((v: any, i: number) => valueMap.set(v, hexToRgb(hexColors[i % hexColors.length])))
      colorMapMap.value.set(c.name, valueMap)
    }
  }

  ; (metaData.value ||= {}).key_value_metadata = Array.from(colorMapMap.value.keys()).map(key => ({
    key,
    value: JSON.stringify(Array.from(colorMapMap.value.get(key)?.keys() ?? []))
  }))

  if (colorMode.value !== 'random' && !colorMapMap.value.has(colorMode.value)) {
    colorMode.value = 'random'
  }
}

// ----------------- Pennsieve helpers -----------------
async function getViewerAssets(pkgId: string, apiUrl: string) {
  const token = await useGetToken()
  const url = `${apiUrl}/packages/${pkgId}/view?api_key=${token}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`view failed: ${r.status}`)
  viewAssets.value = await r.json()
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
  forceRegenerate.value = !forceRegenerate.value
  componentKey.value++
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
  colorMap.value = data[1]
}

// columns/types
async function getColumns(tbl: string) {
  const rows = await duck.executeQuery(`PRAGMA table_info(${tbl});`, connectionId.value!)
  return rows.map((r: any) => ({ name: r.name, type: r.type }))
}

// ----------------- lifecycle -----------------
onMounted(async () => { await ensureConnection() })
onBeforeUnmount(async () => { if (connectionId.value) await duck.closeConnection(connectionId.value) })
</script>

<style scoped>
.app-container {
  height: 100%;
  position: relative;
  height: 100%;
  overflow: hidden;
}
</style>
