<template>
  <div class="orthogonal-frame">
    <iframe
      ref="iframeRef"
      :src="iframeSrc"
      class="orthogonal-frame__iframe"
      allow="autoplay; fullscreen"
      @load="onIframeLoad"
    ></iframe>

    <div v-if="loading" class="orthogonal-frame__overlay">
      <div class="orthogonal-frame__spinner"></div>
      <span>Loading viewer...</span>
    </div>

    <div v-if="errorMsg" class="orthogonal-frame__overlay orthogonal-frame__overlay--error">
      <span>{{ errorMsg }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  source: string
  layout?: '4panel' | '3d' | 'xy' | 'xz' | 'yz'
  /** Base URL of the orthogonal embed server (defaults to same-origin /embed.html) */
  embedUrl?: string
}>(), {
  layout: '4panel',
  embedUrl: '',
})

const emit = defineEmits<{
  ready: []
  error: [message: string]
}>()

const iframeRef = ref<HTMLIFrameElement>()
const loading = ref(true)
const errorMsg = ref('')

const iframeSrc = computed(() => {
  const base = props.embedUrl || '/embed.html'
  const params = new URLSearchParams()
  params.set('source', props.source)
  params.set('layout', props.layout)
  return `${base}?${params.toString()}`
})

function onIframeLoad() {
  // iframe HTML loaded, but neuroglancer may still be initializing
}

function onMessage(event: MessageEvent) {
  // Only accept messages from our iframe
  if (iframeRef.value && event.source !== iframeRef.value.contentWindow) return

  const { type, payload } = event.data || {}
  switch (type) {
    case 'ready':
      loading.value = false
      errorMsg.value = ''
      emit('ready')
      break
    case 'error':
      loading.value = false
      errorMsg.value = payload || 'Unknown error'
      emit('error', payload)
      break
  }
}

// Post source changes to iframe
watch(() => props.source, (newSource) => {
  iframeRef.value?.contentWindow?.postMessage(
    { type: 'set-source', payload: newSource },
    '*'
  )
})

watch(() => props.layout, (newLayout) => {
  iframeRef.value?.contentWindow?.postMessage(
    { type: 'set-layout', payload: newLayout },
    '*'
  )
})

onMounted(() => {
  window.addEventListener('message', onMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', onMessage)
})
</script>

<style scoped>
.orthogonal-frame {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}

.orthogonal-frame__iframe {
  width: 100%;
  height: 100%;
  border: none;
}

.orthogonal-frame__overlay {
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
  z-index: 10;
  pointer-events: none;
}

.orthogonal-frame__overlay--error {
  color: #ff6b6b;
}

.orthogonal-frame__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fff;
  border-radius: 50%;
  animation: orthogonal-spin 0.8s linear infinite;
}

@keyframes orthogonal-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
