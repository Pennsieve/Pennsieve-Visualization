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

const isDev = import.meta.env.DEV

// ---- Service Worker for CloudFront signing (production) ----
let swReady: Promise<ServiceWorkerRegistration | null> = !isDev && navigator.serviceWorker
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

// ---- Deferred source: wait for CloudFront params before loading ----
let pendingSource = ''
let pendingLayout: LayoutMode = '4panel'
let started = false

function startViewer() {
  if (started || !pendingSource) return
  started = true

  if (isDev) {
    // Dev: rewrite assets.pennsieve.net URLs through the Vite proxy
    source.value = pendingSource.replace(
      /https?:\/\/assets\.pennsieve\.net/,
      '/cf-proxy'
    )
  } else {
    source.value = pendingSource
  }

  layout.value = pendingLayout
}

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  pendingSource = params.get('source') || ''
  const lay = params.get('layout') as LayoutMode | null
  if (lay) pendingLayout = lay

  // If no CloudFront params arrive within 500ms, assume public data
  setTimeout(() => startViewer(), 500)
})

// Listen for messages from parent window
window.addEventListener('message', async (event) => {
  const { type, payload } = event.data || {}

  switch (type) {
    case 'set-cloudfront-params':
      if (isDev) {
        // Dev: send params to Vite proxy server
        await fetch('/cf-params', { method: 'POST', body: payload }).catch(() => {})
      } else {
        // Production: send params to service worker
        await sendParamsToSW(payload)
      }
      startViewer()
      break
    case 'set-source':
      if (started) {
        source.value = isDev
          ? payload.replace(/https?:\/\/assets\.pennsieve\.net/, '/cf-proxy')
          : payload
      } else {
        pendingSource = payload
      }
      break
    case 'set-layout':
      if (started) {
        layout.value = payload
      } else {
        pendingLayout = payload
      }
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
