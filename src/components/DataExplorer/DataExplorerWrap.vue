// DuckDBViewerWrapper.vue - Updated with stable file ID support
<template>
  <div class="app-container">
    <dbduck-viewer
      :url="presignedUrl"
      :file-type="fileType"
      :file-id="fileId"
    />
  </div>
</template>

<script setup lang="ts">
import {defineProps, onMounted, ref, watch} from 'vue';
import {pathOr} from "ramda";
import {useGetToken} from '../../composables/useGetToken'
import DbduckViewer from "./DataExplorer.vue";

const props = defineProps({
  pkg: {
    type: Object,
    default: {}
  },
  apiUrl:{
    type:String,
    default:"https://api.pennsieve.net"
  }
})

const viewAssets = ref<any>([])
const fileType = ref("parquet")
const presignedUrl = ref("")
const fileId = ref("") // Add stable file ID

onMounted(async () => {
  try {
    // get Viewer Assets
    await getViewerAssets()

    // Extract stable file ID
    fileId.value = viewAssets.value[0].content.id
    console.log('Using stable file ID:', fileId.value)

    // Get presigned URL
    presignedUrl.value = await getFileUrl(fileId.value)

    if (props.pkg.content.packageType === "CSV") {
      fileType.value = "csv"
    }

  } catch (err) {
    console.error(err);
  }
})

async function getViewerAssets() {
  const pkgId = pathOr('', ['content', 'id'], props.pkg)
  const token = await useGetToken()
  const url = `${props.apiUrl}/packages/${pkgId}/view?api_key=${token}`
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      viewAssets.value = await response.json()
      return
    }

    if (!response.ok) {
      return;
    }
  } catch (err) {
    console.error(err)
    throw err;
  }
}

async function getFileUrl(fileId) {
  const pkgId = pathOr('', ['content', 'id'], props.pkg)
  const token = await useGetToken()
  const url = `${props.apiUrl}/packages/${pkgId}/files/${fileId}?api_key=${token}`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const result = await response.json()
      return result.url;
    }

    if (!response.ok) {
      return;
    }

  } catch (err) {
    console.error(err)
    throw err;
  }
}
</script>

<style scoped>
.app-container {
  position: relative;
}
</style>