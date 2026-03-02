<template>
  <div class="orthogonal-viewer" ref="rootEl">
    <!-- Neuroglancer mounts here -->
    <div class="orthogonal-viewer__container" ref="ngContainer"></div>

    <!-- Loading overlay -->
    <div v-if="isLoading" class="orthogonal-viewer__overlay">
      <div class="orthogonal-viewer__spinner"></div>
      <span>Loading viewer...</span>
    </div>

    <!-- Error overlay -->
    <div v-if="error" class="orthogonal-viewer__overlay orthogonal-viewer__overlay--error">
      <span>{{ error.message }}</span>
    </div>

    <!-- Vue overlay controls -->
    <OrthogonalControls
      v-if="!isLoading && !error"
      :channels="channels"
      :position="position"
      :layout="layout"
      @toggle-channel="onToggleChannel"
      @set-layout="onSetLayout"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useNeuroglancer } from '../composables/useNeuroglancer'
import OrthogonalControls from './OrthogonalControls.vue'
import type { OrthogonalViewerProps, LayoutMode } from '../types'

const props = withDefaults(defineProps<OrthogonalViewerProps>(), {
  layout: '4panel',
})

const emit = defineEmits<{
  ready: []
  error: [error: Error]
  'state-change': [state: ReturnType<typeof ng.getState>]
}>()

const ngContainer = ref<HTMLElement>()

const ng = useNeuroglancer()
const { isLoading, error, channels, position, layout } = ng

onMounted(async () => {
  if (!ngContainer.value) return
  try {
    await ng.init(ngContainer.value, props.source, props.layout)
    emit('ready')
  } catch (e) {
    emit('error', e instanceof Error ? e : new Error(String(e)))
  }
})

// Re-init if source changes
watch(
  () => props.source,
  async (newSource) => {
    if (!ngContainer.value) return
    ng.dispose()
    try {
      await ng.init(ngContainer.value, newSource, props.layout)
      emit('ready')
    } catch (e) {
      emit('error', e instanceof Error ? e : new Error(String(e)))
    }
  }
)

function onToggleChannel(index: number, visible: boolean) {
  ng.setChannelVisibility(index, visible)
}

function onSetLayout(mode: LayoutMode) {
  ng.setLayout(mode)
}

defineExpose({
  getState: ng.getState,
  setPosition: ng.setPosition,
  setLayout: ng.setLayout,
  setChannelVisibility: ng.setChannelVisibility,
})
</script>

<style scoped>
.orthogonal-viewer {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}

.orthogonal-viewer__container {
  width: 100%;
  height: 100%;
}

/* Hide neuroglancer's built-in layer side panel */
.orthogonal-viewer__container :deep(.neuroglancer-layer-panel) {
  display: none !important;
}

.orthogonal-viewer__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.8);
  color: #ccc;
  font-family: system-ui, sans-serif;
  font-size: 14px;
  z-index: 100;
}

.orthogonal-viewer__overlay--error {
  color: #ff6b6b;
}

.orthogonal-viewer__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
