<template>
  <OrthogonalViewer
    v-if="source"
    :source="source"
    :layout="layout"
    @ready="onReady"
    @error="onError"
  />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import OrthogonalViewer from './components/OrthogonalViewer.vue'
import type { LayoutMode } from './types'

const source = ref('')
const layout = ref<LayoutMode>('4panel')

// Read initial source from URL params (set by parent iframe)
onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const src = params.get('source')
  if (src) source.value = src

  const lay = params.get('layout') as LayoutMode | null
  if (lay) layout.value = lay
})

// Listen for messages from parent window
window.addEventListener('message', (event) => {
  const { type, payload } = event.data || {}

  switch (type) {
    case 'set-source':
      source.value = payload
      break
    case 'set-layout':
      layout.value = payload
      break
  }
})

function onReady() {
  window.parent?.postMessage({ type: 'ready' }, '*')
}

function onError(err: Error) {
  window.parent?.postMessage({ type: 'error', payload: err.message }, '*')
}
</script>

<style>
html, body, #app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}
</style>
