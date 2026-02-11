<script setup lang="ts">
import { ref } from 'vue'
import { useViewerStyle, type ViewerStyleOverrides } from '../composables/useViewerStyle'

const props = defineProps<{
  srcUrl?: string
  customStyle?: ViewerStyleOverrides
}>()

const { rootStyle } = useViewerStyle(() => props.customStyle)

const dataUrl = ref(props.srcUrl || '')
const userPrompt = ref('')
const dataLoaded = ref(false)
const plotlyDiv = ref<HTMLDivElement | null>(null)

async function loadData() {
  if (!dataUrl.value) return
  // TODO: Implement data loading
  dataLoaded.value = true
}

async function generatePlot() {
  if (!userPrompt.value || !dataLoaded.value) return
  // TODO: Implement AI-driven plot generation
}

function saveConfig() {
  // TODO: Implement config saving
}
</script>

<template>
  <div class="ps-viewer ai-plotly" :style="rootStyle">
    <div class="ai-plotly-field">
      <label>Data URL</label>
      <input
        v-model="dataUrl"
        type="text"
        class="ps-input"
        placeholder="S3 Parquet URL"
        @blur="loadData"
      />
    </div>

    <div v-if="dataLoaded" class="ai-plotly-field">
      <label>Plot Description</label>
      <input
        v-model="userPrompt"
        type="text"
        class="ps-input"
        :maxlength="280"
        placeholder="Describe your plot..."
        @keyup.enter="generatePlot"
      />
    </div>

    <div ref="plotlyDiv" class="ai-plotly-plot-container"></div>

    <button class="ps-btn-primary" @click="saveConfig">Save Widget Config</button>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/viewer-theme" as vt;

.ai-plotly {
  @include vt.viewer-base;
  padding: var(--ps-space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--ps-space-lg);
}

.ai-plotly-field {
  display: flex;
  flex-direction: column;
  gap: var(--ps-space-xs);

  label {
    font-size: var(--ps-font-size-md);
    font-weight: 600;
    color: var(--ps-color-text-dark);
  }
}

.ps-input { @include vt.ps-input; }
.ps-btn-primary {
  @include vt.ps-btn-primary;
  align-self: flex-start;
}

.ai-plotly-plot-container {
  min-height: 300px;
  border: 1px dashed var(--ps-color-border-dark);
  border-radius: var(--ps-radius);
  background: var(--ps-color-bg-tertiary);
}
</style>
