<template>
    <div class="pp-container">
        <div class="pp-header">
            <div class="pp-controls">
                <div class="pp-field">
                <label>Data URL</label>
                <input
                    v-model="s3Url"
                    type="text"
                    class="pp-input pp-input--url"
                    :disabled="isLoading"
                    placeholder="https://.../file.parquet"
                />
                </div>

                <div class="pp-field">
                  <div >
                  <label>X (group) column</label>
                  <select v-model="xCol" class="pp-select" :disabled="isLoading || columns.length === 0">
                      <option disabled value="">— choose —</option>
                      <option v-for="c in categoricalColumns" :key="c.name" :value="c.name">{{ c.name }} ({{ c.type }})</option>
                      <option v-for="c in numericColumns" :key="c.name + '-num'" :value="c.name">{{ c.name }} ({{ c.type }})</option>
                  </select>
                  </div>
          
                  <div >
                  <label>Y (category) column</label>
                  <select v-model="yCol" class="pp-select" :disabled="isLoading || columns.length === 0">
                      <option disabled value="">— choose —</option>
                      <option v-for="c in categoricalColumns" :key="c.name + '-y'" :value="c.name">{{ c.name }} ({{ c.type }})</option>
                  </select>
                  </div>
                </div>

                <div class="pp-field">
                    <button
                    class="pp-btn pp-btn--primary"
                    :disabled="!xCol || !yCol || isLoading || !connectionId || !tableName"
                    @click="plot"
                    >
                    {{ isLoading ? 'Working…' : 'Plot' }}
                    </button>
                    <div class="pp-message" v-if="message">{{ message }}</div>
                </div>

            </div>
        

      </div>
      <div :id="plotId" class="pp-plot"></div>
    </div>
  </template>
  
  <script setup lang="ts">
  import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
  import { useDuckDBStore } from '@/store/duckdbStore' // mirrors UMAP wrapper
  
  const props = defineProps<{
    apiUrl?: string
    pkg?: { content?: { id?: string; packageType?: string } } | null
    srcUrl?: string
    srcFileType?: 'csv' | 'parquet'
    srcFileId?: string
    /** Optional: override table name */
    tableNameOverride?: string
  }>()
  
  // ----------------- reactive state -----------------
  let Plotly: any
  const duck = useDuckDBStore()
  const connectionId = ref<string | null>(null)
  const tableName = ref<string | null>(null)

  const MAX_X_GROUPS = 100;
    const MAX_Y_CATS   = 12;
    const OTHER_LABEL  = '(other)';

  
  const s3Url = ref<string>(
    props.srcUrl || 'https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/precision_human_drg_data.parquet'
  )
  const stableId =  computed(()=> duck.formatIdFromUrl(s3Url.value))
  const isLoading = ref(false)
  const message = ref('')
  
  const columns = ref<Array<{ name: string; type: string }>>([])
  const xCol = ref('')
  const yCol = ref('')
  
  const plotId = `proportion-plot-${Math.random().toString(36).slice(2)}`
  
  // ----------------- watchers (mirror UMAP wrapper orchestrator) -----------------
  watch(
    () => ({ srcUrl: props.srcUrl, srcFileType: props.srcFileType, srcFileId: props.srcFileId, pkg: props.pkg, apiUrl: props.apiUrl }),
    async ({ srcUrl, srcFileType, srcFileId, pkg, apiUrl }) => {
      try {
        if (srcUrl) s3Url.value = srcUrl
        await ensureConnection()
  
        if (s3Url.value) {
          const ft: 'csv' | 'parquet' = srcFileType ?? (s3Url.value.toLowerCase().endsWith('.csv') ? 'csv' : 'parquet')
          await loadOrReuse( ft, stableId.value)
          return
        }
  
        // Optional: load from Pennsieve package like the UMAP wrapper
        const pkgId = pkg?.content?.id
        const pkgType = pkg?.content?.packageType
        if (pkgId && apiUrl) {
          const firstFile = await getFirstPackageFile(pkgId, apiUrl)
          if (!firstFile) return
          const presigned = await getFileUrl(pkgId, firstFile, apiUrl)
          const ft: 'csv' | 'parquet' = pkgType === 'CSV' ? 'csv' : 'parquet'
          const sanitizedId = firstFile.replace(/[^a-zA-Z0-9_.-]/g, '_')
          s3Url.value = presigned
          await loadOrReuse( ft, sanitizedId)
        }
      } catch (e: any) {
        console.error('[ProportionPlot] Load failed:', e?.message || e)
        message.value = `Load failed: ${e?.message || e}`
      }
    },
    { immediate: true }
  )
  
  // ----------------- getters -----------------
  const categoricalTypes = new Set(['VARCHAR', 'STRING', 'TEXT', 'BOOL', 'BOOLEAN', 'DATE', 'TIMESTAMP'])
  const categoricalColumns = computed(() => columns.value.filter(c => categoricalTypes.has(c.type) || c.type.startsWith('VARCHAR')))
  const numericColumns = computed(() => columns.value.filter(c => !categoricalTypes.has(c.type)))
  
  // ----------------- core: ensure connection, then reuse or load -----------------
  async function ensureConnection() {
    if (connectionId.value) return
    const { connectionId: cid } = await duck.createConnection(`prop_${Date.now()}`)
    connectionId.value = cid
  }
  
  function safeIdent(s: string) {
  const cleaned = String(s).replace(/[^A-Za-z0-9_]/g, '_')
  const prefixed = /^[A-Za-z_]/.test(cleaned) ? cleaned : `t_${cleaned}`
  return prefixed.slice(0, 63) 
}
  async function loadOrReuse( fileType?: 'csv' | 'parquet', stableId?: string) {
    if (!connectionId.value) await ensureConnection()

    const id = (stableId || props.srcFileId || s3Url.value || 'file').replace(/[^A-Za-z0-9]/g, '_') 

    //  load via store - store handles dupes
    isLoading.value = true
    message.value = 'Loading file into DuckDB…'
    try {
        const ft: 'csv' | 'parquet' = fileType ?? (s3Url.value.toLowerCase().endsWith('.csv') ? 'csv' : 'parquet')

    const tname = props.tableNameOverride || safeIdent(`file_${id.slice(0, 48)}`)

        const loadedName = await duck.loadFile(
        s3Url.value,
        ft,
        tname,
        {},
        connectionId.value!,
        id
        )

        tableName.value = loadedName
        await introspect(true)
    } finally {
        isLoading.value = false
    }
}
  
  // ----------------- schema + defaults -----------------
  function quoteIdent(name: string) {
    return '"' + String(name).replace(/"/g, '""') + '"'
  }
  
  async function introspect(resetChoices = false) {
    if (!tableName.value || !connectionId.value) return
    const pragma = `PRAGMA table_info(${quoteIdent(tableName.value)})`
    const rows = await duck.executeQuery(pragma, connectionId.value)
    columns.value = rows.map((r: any) => ({ name: String(r.name), type: String(r.type).toUpperCase() }))
  
    if (resetChoices || !xCol.value || !yCol.value) {
      const cat = columns.value.filter(c => categoricalTypes.has(c.type) || c.type.startsWith('VARCHAR'))
      xCol.value = cat[0]?.name || columns.value[0]?.name || ''
      yCol.value = cat[1]?.name || cat[0]?.name || ''
    }
  
    message.value = `Columns: ${columns.value.length}.`
  }
  
  // ----------------- plotting -----------------
  async function plot() {
  if (!tableName.value || !connectionId.value) return;
  if (!xCol.value || !yCol.value) { message.value = 'Pick both X and Y'; return; }

  isLoading.value = true;
  message.value = 'Computing proportions…';
  try {
    const t = quoteIdent(tableName.value);
    const X = quoteIdent(xCol.value);   
    const Y = quoteIdent(yCol.value);   

    const sql = `
      WITH xf AS (
        SELECT ${X} AS x, COUNT(*) AS c
        FROM ${t}
        GROUP BY 1
        ORDER BY c DESC
        LIMIT ${MAX_X_GROUPS}
      ),
      yf AS (
        SELECT ${Y} AS y, COUNT(*) AS c
        FROM ${t}
        GROUP BY 1
        ORDER BY c DESC
        LIMIT ${MAX_Y_CATS}
      ),
      filtered AS (
        SELECT src.*
        FROM ${t} AS src
        JOIN xf ON src.${X} = xf.x          -- <-- src."org.ident"
      ),
      labeled AS (
        SELECT
          ${X} AS x,
          CASE
            WHEN ${Y} IN (SELECT y FROM yf) THEN COALESCE(${Y}, '(missing)')
            ELSE '${OTHER_LABEL}'
          END AS y
        FROM filtered
      ),
      counts AS (
        SELECT x, y, COUNT(*)::DOUBLE AS n
        FROM labeled
        GROUP BY 1, 2
      ),
      denom AS (
        SELECT x, SUM(n) AS total
        FROM counts
        GROUP BY 1
      ),
      props AS (
        SELECT c.x, c.y, c.n / NULLIF(d.total, 0) AS p
        FROM counts c
        JOIN denom d USING (x)
      )
      SELECT * FROM props ORDER BY x, y;
    `;

    const rows = await duck.executeQuery(sql, connectionId.value);

    if (!rows.length) {
      message.value = 'No rows returned. Try different columns.';
      Plotly.purge(plotId);
      return;
    }

    const xLevels = Array.from(new Set(rows.map((r: any) => String(r.x))));
    const yLevels = Array.from(new Set(rows.map((r: any) => String(r.y))));

    const key = (x: string, y: string) => `${x}\u0000${y}`;
    const lut = new Map<string, number>();
    for (const r of rows) lut.set(key(String(r.x), String(r.y)), Number(r.p ?? 0));

    const traces = yLevels.map((yv: string) => ({
      type: 'bar',
      name: yv,
      x: xLevels,
      y: xLevels.map(xv => lut.get(key(xv, yv)) ?? 0),
      hovertemplate:
        `${yCol.value}=%{fullData.name}<br>` +
        `${xCol.value}=%{x}<br>` +
        `Proportion=%{y:.1%}<extra></extra>`
    }));

    const layout: Partial<Plotly.Layout> = {
      title: `${yCol.value} proportions within ${xCol.value}`,
      barmode: 'stack',
      yaxis: { range: [0, 1], tickformat: '.0%', title: 'Proportion' },
      xaxis: { title: xCol.value },
      legend: { orientation: 'h', y: -0.2 },
      margin: { t: 48, r: 16, b: 96, l: 56 }
    };

    await Plotly.newPlot(plotId, traces as any, layout as any, { responsive: true });

    const trimmedNote =
      (xLevels.length >= MAX_X_GROUPS ? ` Limited to top ${MAX_X_GROUPS} ${xCol.value}.` : '') +
      (yLevels.length >= MAX_Y_CATS || yLevels.includes(OTHER_LABEL) ? ` Limited to top ${MAX_Y_CATS} ${yCol.value} (+ ${OTHER_LABEL}).` : '');

    message.value = `Plotted ${yLevels.length} categories across ${xLevels.length} groups.${trimmedNote}`;
  } catch (err: any) {
    console.error(err);
    message.value = `Error: ${err?.message || err}`;
  } finally {
    isLoading.value = false;
  }
}


  
  // ----------------- pennsieve helpers (optional, matching UMAP style) -----------------
  async function getTokenLazy() {
    // const { useGetToken } = await import('@/composables/useGetToken')
    // return useGetToken()
  }
  async function getFirstPackageFile(pkgId: string, apiUrl: string) {
    const token = await getTokenLazy()
    const url = `${apiUrl}/packages/${pkgId}/view?api_key=${token}`
    const r = await fetch(url)
    if (!r.ok) return null
    const j = await r.json()
    return j?.[0]?.content?.id as string | null
  }
  async function getFileUrl(pkgId: string, fileId: string, apiUrl: string) {
    const token = await getTokenLazy()
    const url = `${apiUrl}/packages/${pkgId}/files/${fileId}?api_key=${token}`
    const r = await fetch(url)
    if (!r.ok) throw new Error(`file url failed: ${r.status}`)
    const j = await r.json()
    return j.url as string
  }
  
function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

async function ensurePlotly() {
  if (!isBrowser()) return null
  if (Plotly) return Plotly
  await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.plot.ly/plotly-2.35.3.min.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load Plotly CDN'));
        document.head.appendChild(s);
      });
      (window as any).Plotly;
  Plotly = (window as any).Plotly;
  return Plotly
}
  // ----------------- lifecycle -----------------
  onMounted(async () => { 

    //duck db ensure connection
    await ensureConnection() 
    const P = await ensurePlotly()
    if (!P) return


})
  onBeforeUnmount(async () => { if (connectionId.value) await duck.closeConnection(connectionId.value) })
  </script>
  
  <style scoped>
  .pp-container { 
    padding: 16px;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
     }
  .pp-header{ 
    flex: 0 0 auto;
    overflow: scroll;
}
  .pp-controls {
     display: flex; 
     flex-wrap: wrap; 
     align-items: flex-end; 
     gap: 2px; }
  
  .pp-field { 
    display: flex; 
    gap: 6px; 
}
  .pp-field label { 
    font-size: 14px; 
    font-weight: 600;
    align-content: center; }
  
  .pp-input, .pp-select {
    border: 1px solid #d1d5db; 
    border-radius: 4px;
    padding: 4px; 
    min-width: 12rem; 
    font-size: 14px;
  }
  .pp-input--url {  }
  
  .pp-btn {
    background: #f3f4f6; color: #374151; border: 1px solid #d1d5db;
    padding: 6px 8px; border-radius: 4px; cursor: pointer;
  }
  .pp-btn:hover { background: #e5e7eb; }
  .pp-btn--primary { 
    background: #243d8e; 
    border-color: #243d8e; 
    color: #fff; }
  .pp-btn--primary:hover { background: #4338ca; }
  
  .pp-btn:disabled, .pp-input:disabled, .pp-select:disabled {
    opacity: 0.5; cursor: not-allowed;
  }
  
  .pp-message { 
    font-size: 13px; 
    color: #4b5563; 
    margin-top: 4px; 
    }
  .pp-plot { 
    flex: 1 1 auto;
    min-height: 0;    
    width: 100%;
    height: 80%; 
}
  </style>