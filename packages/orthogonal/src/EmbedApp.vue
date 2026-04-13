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

// ---- Service Worker for CloudFront signing ----
let swReady: Promise<ServiceWorkerRegistration | null> = navigator.serviceWorker
  ? navigator.serviceWorker.register('./sw.js').then((reg) => {
      const sw = reg.active || reg.installing || reg.waiting
      if (!sw) return reg
      if (sw.state === 'activated') return reg
      return new Promise<ServiceWorkerRegistration>((resolve) => {
        sw.addEventListener('statechange', () => {
          if (sw.state === 'activated') resolve(reg)
        })
      })
    }).catch(() => null)
  : Promise.resolve(null)

function sendParamsToSW(params: string): Promise<void> {
  return swReady.then((reg) => {
    if (!reg?.active) return
    return new Promise<void>((resolve) => {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => resolve()
      reg.active!.postMessage(
        { type: 'set-cloudfront-params', params },
        [ch.port2]
      )
    })
  })
}

// Read initial source from URL params (set by parent iframe)
onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const src = params.get('source')
  if (src) source.value = src

  const lay = params.get('layout') as LayoutMode | null
  if (lay) layout.value = lay
})

// Listen for messages from parent window
window.addEventListener('message', async (event) => {
  const { type, payload } = event.data || {}

  switch (type) {
    case 'set-cloudfront-params':
      await sendParamsToSW(payload)
      break
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
