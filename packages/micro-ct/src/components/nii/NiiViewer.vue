<template>
  <div class="nii-viewer-container">
    <div v-if="loading" class="nii-viewer-overlay">
      <span class="nii-viewer-spinner" />
    </div>
    <div v-if="error" class="nii-viewer-overlay nii-viewer-error">
      <span>{{ error }}</span>
    </div>
    <canvas ref="canvas" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Niivue, SLICE_TYPE } from '@niivue/niivue'

const props = withDefaults(defineProps<{
  url: string
  /** Zarr pyramid level (0 = highest res). Enables chunked loading when set. */
  zarrLevel?: number
  /** Max voxels per dimension for zarr virtual volume (default 256) */
  zarrMaxVolumeSize?: number
  /** Which channel to load from zarr (default 0) */
  zarrChannel?: number
  /** Slice layout: 'axial' | 'coronal' | 'sagittal' | 'multi' | 'render' */
  sliceType?: 'axial' | 'coronal' | 'sagittal' | 'multi' | 'render'
}>(), {
  sliceType: 'multi',
})

const canvas = ref<HTMLCanvasElement | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let nv: InstanceType<typeof Niivue> | null = null

async function loadVolume(url: string) {
  if (!nv) return
  loading.value = true
  error.value = null
  try {
    await nv.loadVolumes([{
      url,
      ...(props.zarrLevel != null && { zarrLevel: props.zarrLevel }),
      ...(props.zarrMaxVolumeSize != null && { zarrMaxVolumeSize: props.zarrMaxVolumeSize }),
      ...(props.zarrChannel != null && { zarrChannel: props.zarrChannel }),
    }])
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load volume'
  } finally {
    loading.value = false
  }
}

const sliceTypeMap: Record<string, number> = {
  axial: SLICE_TYPE.AXIAL,
  coronal: SLICE_TYPE.CORONAL,
  sagittal: SLICE_TYPE.SAGITTAL,
  multi: SLICE_TYPE.MULTIPLANAR,
  render: SLICE_TYPE.RENDER,
}

onMounted(async () => {
  if (!canvas.value) return
  nv = new Niivue({
    sliceType: sliceTypeMap[props.sliceType] ?? SLICE_TYPE.MULTIPLANAR,
  })
  await nv.attachToCanvas(canvas.value)
  if (props.url) {
    await loadVolume(props.url)
  }
})

onBeforeUnmount(() => {
  if (nv) {
    nv.closeDrawing()
    nv = null
  }
})

watch(() => props.url, async (newUrl) => {
  if (newUrl && nv) {
    await loadVolume(newUrl)
  }
})
</script>

<style scoped>
.nii-viewer-container {
  height: 100%;
  width: 100%;
  position: relative;
}

.nii-viewer-container canvas {
  width: 100%;
  height: 100%;
}

.nii-viewer-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  background: rgba(0, 0, 0, 0.4);
}

.nii-viewer-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: nii-spin 0.8s linear infinite;
}

@keyframes nii-spin {
  to { transform: rotate(360deg); }
}

.nii-viewer-error {
  color: #ff6b6b;
  background: rgba(0, 0, 0, 0.7);
  font-size: 14px;
}
</style>
