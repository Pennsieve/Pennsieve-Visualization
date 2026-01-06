<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  /** S3 URL to parquet file */
  srcUrl?: string
}>()

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
  <div class="ai-plot-widget">
    <!-- Data source input -->
    <div class="ai-plot-field">
      <label>Data URL</label>
      <input
        v-model="dataUrl"
        type="text"
        class="ai-plot-input"
        placeholder="S3 Parquet URL"
        @blur="loadData"
      />
    </div>

    <!-- AI prompt input (only shows after data loaded) -->
    <div v-if="dataLoaded" class="ai-plot-field">
      <label>Plot Description</label>
      <input
        v-model="userPrompt"
        type="text"
        class="ai-plot-input"
        :maxlength="280"
        placeholder="Describe your plot..."
        @keyup.enter="generatePlot"
      />
    </div>

    <!-- Plotly container -->
    <div ref="plotlyDiv" class="plot-container"></div>

    <!-- Save config button -->
    <button class="ai-plot-btn" @click="saveConfig">Save Widget Config</button>
  </div>
</template>

<style scoped>
.ai-plot-widget {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ai-plot-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ai-plot-field label {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.ai-plot-input {
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 14px;
}

.ai-plot-input:focus {
  outline: none;
  border-color: #2196f3;
}

.plot-container {
  min-height: 300px;
  border: 1px dashed #d1d5db;
  border-radius: 4px;
  background: #f9fafb;
}

.ai-plot-btn {
  background: #243d8e;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  align-self: flex-start;
}

.ai-plot-btn:hover {
  background: #4338ca;
}
</style>
