<template>
  <div class="app-container">
    <dbduck-viewer
      :url="resolvedUrl"
      :file-type="resolvedFileType"
      :file-id="resolvedFileId"
      @query-results="(x)=>emitNewQueryResults(x)"
    />
  </div>
</template>

<script setup lang="ts">
import { defineProps, onMounted, ref, defineEmits } from 'vue'
import { pathOr } from 'ramda'

import DbduckViewer from './DataExplorer.vue'

const props = defineProps<{
  pkg?: { content?: { id?: string; packageType?: string } } | null
  apiUrl?: string
  /** Optional: provide a direct public URL (bypass Pennsieve API) */
  srcUrl?: string
  /** Optional: override fileType if srcUrl doesn't end with .csv/.parquet */
  srcFileType?: 'csv'|'parquet'
  /** Optional: stable id to de-dup across viewers; defaults to derived from URL */
  srcFileId?: string
}>()
const emit = defineEmits(["queryResults"])
const viewAssets = ref<any[]>([])
const resolvedUrl = ref('')
const resolvedFileType = ref<'csv'|'parquet'>('parquet')
const resolvedFileId = ref('')

onMounted(async () => {
  // Mode A: direct URL provided
  if (props.srcUrl) {
    resolvedUrl.value = props.srcUrl
    resolvedFileType.value =
      props.srcFileType ??
      (props.srcUrl.toLowerCase().endsWith('.csv') ? 'csv' : 'parquet')
    // resolvedFileId.value =
    //   props.srcFileId ??
    //   ('url_' + btoa(props.srcUrl).replace(/=+$/,'').replace(/[+/]/g,'_'))
    return
  }

  // Mode B: Pennsieve pkg + api
  const pkgId = pathOr('', ['content','id'], props.pkg)
  if (!pkgId || !props.apiUrl) {
    console.error('[DuckDBViewerWrapper] Missing pkg.id or apiUrl, and no srcUrl provided.')
    return
  }

  try {
    await getViewerAssets(pkgId)
    const firstFileId = viewAssets.value?.[0]?.content?.id
    if (!firstFileId) {
      console.error('[DuckDBViewerWrapper] No files found in /view response.')
      return
    }
    resolvedFileId.value = firstFileId
    resolvedUrl.value = await getFileUrl(pkgId, firstFileId)

    const pt = props.pkg?.content?.packageType
    resolvedFileType.value = pt === 'CSV' ? 'csv' : 'parquet'
  } catch (err) {
    console.error(err)
  }
})
function emitNewQueryResults(results){
    emit('queryResults',results)
}
async function getTokenLazy() {
    const { useGetToken } = await import('../../composables/useGetToken');
    return useGetToken();
  }
async function getViewerAssets(pkgId: string) {
  const token = await getTokenLazy()
  const url = `${props.apiUrl}/packages/${pkgId}/view?api_key=${token}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`view failed: ${r.status}`)
  viewAssets.value = await r.json()
}

async function getFileUrl(pkgId: string, fileId: string) {
  const token = await getTokenLazy()
  const url = `${props.apiUrl}/packages/${pkgId}/files/${fileId}?api_key=${token}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`file url failed: ${r.status}`)
  const j = await r.json()
  return j.url as string
}
</script>
<style scoped lang="scss">
  .app-container{
    color:black;
  }
</style>
