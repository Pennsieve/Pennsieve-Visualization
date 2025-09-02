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
import { useDuckDBStore } from '@/store/duckdbStore'

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
const stableId =  computed(()=> duck.formatIdFromUrl(props.srcUrl))
watch(
  () => ({
    srcUrl: props.srcUrl,
    srcFileType: props.srcFileType,
    srcFileId: props.srcFileId,
    pkgId: props.pkg?.content?.id || '',
    pkgType: props.pkg?.content?.packageType || '',
    apiUrl: props.apiUrl || ''
  }),
  async ({ srcUrl, srcFileType, srcFileId, pkgId, pkgType, apiUrl }) => {
    try {
      pointData.value = []
      metaData.value = null
      await ensureConnection()

      if (srcUrl) {
        const ft = srcFileType ?? (srcUrl.toLowerCase().endsWith('.csv') ? 'csv' : 'parquet')
        await loadIntoDuckDB(srcUrl, ft, stableId.value)
        await hydrateFromDuckDB()
        return
      }

      if (pkgId && apiUrl) {
        await getViewerAssets(pkgId, apiUrl)
        const firstFileId = viewAssets.value?.[0]?.content?.id
        if (!firstFileId) return
        const presigned = await getFileUrl(pkgId, firstFileId, apiUrl)
        const ft = pkgType === 'CSV' ? 'csv' : 'parquet'
        await loadIntoDuckDB(presigned, ft, firstFileId)
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
    await fetchPointsAndMeta() // respects pointCount
  }
})
//************* */
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

/** Pull rows as AoA: [x, y, ...otherCols], and meta for x/y */
async function fetchPointsAndMeta(xKey = defaultX, yKey = defaultY, allCols?: string[]) {
  if (!tableName.value || !connectionId.value) return

  const cols = allCols || (await getColumns(tableName.value)).map(c => c.name)
  const others = cols.filter(n => n !== xKey && n !== yKey)

  const select = [
    `CAST(${quote(xKey)} AS DOUBLE) AS __x`,
    `CAST(${quote(yKey)} AS DOUBLE) AS __y`,
    ...others.map(n => quote(n))
  ].join(', ')

  const q = `SELECT ${select} FROM ${tableName.value} LIMIT ${pointCount.value}`
  const rows = await duck.executeQuery(q, connectionId.value)

  pointData.value = rows.map(r => [r.__x, r.__y, ...others.map(n => r[n])])

  const s = `
    SELECT min(${quote(xKey)}) AS xmin, max(${quote(xKey)}) AS xmax,
           min(${quote(yKey)}) AS ymin, max(${quote(yKey)}) AS ymax
    FROM ${tableName.value}
  `
  const stat = (await duck.executeQuery(s, connectionId.value))?.[0] || { xmin: -1, xmax: 1, ymin: -1, ymax: 1 }

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
}

/** Build color options for *all* columns. Categorical → legend map; Numeric → empty (UMAP will do gradient) */
async function buildColorMaps(
  cols: Array<{ name: string, type: string }>,
  xKey: string,
  yKey: string
) {
  colorMapMap.value = new Map()

  const hexColors = ['#4269d0','#efb118','#ff725c','#6cc5b0','#3ca951','#ff8ab7','#a463f2','#97bbf5','#9c6b4e','#9498a0']
  const isNumeric = (t: string) => /DOUBLE|HUGEINT|BIGINT|INTEGER|DECIMAL|FLOAT|REAL/i.test(t)

  for (const c of cols) {
    if (c.name === xKey || c.name === yKey) {
      colorMapMap.value.set(c.name, new Map()) // axes still selectable if desired
      continue
    }

    if (isNumeric(c.type)) {
      // numeric: allow selection; legend will be gradient (no discrete mapping)
      colorMapMap.value.set(c.name, new Map())
    } else {
      // categorical: build value → color map
      const distinctQ = `SELECT DISTINCT ${quote(c.name)} AS v FROM ${tableName.value} LIMIT 10000`
      const distinct = await duck.executeQuery(distinctQ, connectionId.value!)
      const values = distinct.map(r => r.v).filter(v => v !== null && v !== undefined)

      const valueMap = new Map<any, number[]>()
      values.forEach((v, i) => valueMap.set(v, hexToRgb(hexColors[i % hexColors.length])))
      colorMapMap.value.set(c.name, valueMap)
    }
  }

  // expose all column names to the ControlPanel
  ;(metaData.value ||= {}).key_value_metadata = Array.from(colorMapMap.value.keys()).map(key => ({
    key,
    value: JSON.stringify(Array.from(colorMapMap.value.get(key)?.keys() ?? []))
  }))

  // preserve existing selection if possible; else keep 'random'
  if (colorMode.value !== 'random' && !colorMapMap.value.has(colorMode.value)) {
    colorMode.value = 'random'
  }
}

// ----------------- Pennsieve helpers -----------------
async function getTokenLazy() {
  const { useGetToken } = await import('../../composables/useGetToken')
  return useGetToken()
}
async function getViewerAssets(pkgId: string, apiUrl: string) {
  const token = await getTokenLazy()
  const url = `${apiUrl}/packages/${pkgId}/view?api_key=${token}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`view failed: ${r.status}`)
  viewAssets.value = await r.json()
}
async function getFileUrl(pkgId: string, fileId: string, apiUrl: string) {
  const token = await getTokenLazy()
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
  colorMap.value = data[1] // categorical maps; numeric will be empty → gradient
}

// columns/types
async function getColumns(tbl: string) {
  const rows = await duck.executeQuery(`PRAGMA table_info(${tbl});`, connectionId.value!)
  return rows.map(r => ({ name: r.name, type: r.type }))
}

// ----------------- lifecycle -----------------
onMounted(async () => { await ensureConnection() })
onBeforeUnmount(async () => { if (connectionId.value) await duck.closeConnection(connectionId.value) })
</script>

<style scoped>
  .app-container{
    height: 100%;
  }
</style>
