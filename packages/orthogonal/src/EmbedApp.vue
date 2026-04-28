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
      console.log('[EmbedApp] SW registered, state:', sw?.state, 'active:', !!reg.active)
      if (!sw) return reg
      if (sw.state === 'activated') return reg
      return new Promise<ServiceWorkerRegistration>((resolve) => {
        sw.addEventListener('statechange', () => {
          console.log('[EmbedApp] SW state changed to:', sw.state)
          if (sw.state === 'activated') resolve(reg)
        })
      })
    }).catch((err) => { console.error('[EmbedApp] SW registration failed:', err); return null })
  : Promise.resolve(null)

function sendParamsToSW(params: string): Promise<void> {
  console.log('[EmbedApp] sendParamsToSW called, params length:', params?.length)
  return swReady.then((reg) => {
    console.log('[EmbedApp] swReady resolved, reg?.active:', !!reg?.active)
    if (!reg?.active) return
    return new Promise<void>((resolve) => {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => {
        console.log('[EmbedApp] SW acknowledged params')
        resolve()
      }
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
  console.log('[EmbedApp] mounted, pendingSource:', pendingSource?.substring(0, 60))
  setTimeout(() => {
    console.log('[EmbedApp] 500ms timeout fired, started:', started)
    startViewer()
  }, 500)
})

// Listen for messages from parent window
window.addEventListener('message', async (event) => {
  const { type, payload } = event.data || {}

  if (type) console.log('[EmbedApp] received message:', type, type === 'set-cloudfront-params' ? `(payload length: ${payload?.length})` : '')

  switch (type) {
    case 'set-cloudfront-params':
      if (isDev) {
        // Dev: send params to Vite proxy server
        await fetch('/cf-params', { method: 'POST', body: payload }).catch(() => {})
      } else {
        // Production: send params to service worker
        await sendParamsToSW(payload)
      }
      console.log('[EmbedApp] params sent to SW, calling startViewer, started:', started)
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
