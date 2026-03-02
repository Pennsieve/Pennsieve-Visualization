<template>
  <div class="demo-app">
    <header class="demo-app__header">
      <h1>Orthogonal Viewer Demo</h1>
      <div class="demo-app__source-input">
        <label>OME-Zarr URL:</label>
        <input v-model="source" type="text" placeholder="https://..." />
        <button @click="loadSource">Load</button>
      </div>
    </header>
    <div class="demo-app__viewer">
      <OrthogonalViewer
        v-if="activeSource"
        :source="activeSource"
        @ready="onReady"
        @error="onError"
      />
      <div v-else class="demo-app__placeholder">
        Enter an OME-Zarr URL above and click Load
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import OrthogonalViewer from './components/OrthogonalViewer.vue'

// Public IDR OME-Zarr v0.4 dataset (2 channels, 275x271, 236 z-slices)
const DEFAULT_SOURCE = 'https://pennsieve-dev-zarr-test-use1.s3.us-east-1.amazonaws.com/ddb6cb43-3749-4e9d-9c59-e2d4a8aa7f5a';//'https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0062A/6001240.zarr'

const source = ref(DEFAULT_SOURCE)
const activeSource = ref('')

function loadSource() {
  activeSource.value = source.value.trim()
}

function onReady() {
  console.log('[OrthogonalViewer] Ready')
}

function onError(err: Error) {
  console.error('[OrthogonalViewer] Error:', err)
}
</script>

<style scoped>
.demo-app {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.demo-app__header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}

.demo-app__header h1 {
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
}

.demo-app__source-input {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.demo-app__source-input label {
  font-size: 12px;
  color: #888;
  white-space: nowrap;
}

.demo-app__source-input input {
  flex: 1;
  padding: 4px 8px;
  background: #222;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 13px;
}

.demo-app__source-input button {
  padding: 4px 12px;
  background: #2563eb;
  border: none;
  border-radius: 4px;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}

.demo-app__source-input button:hover {
  background: #1d4ed8;
}

.demo-app__viewer {
  flex: 1;
  position: relative;
}

.demo-app__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
  font-size: 14px;
}
</style>
