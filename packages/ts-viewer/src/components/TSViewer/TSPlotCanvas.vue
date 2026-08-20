<!-- TSPlotCanvas.vue -->
<template>
  <div class="timeseries-plot-canvas">
    <canvas
      ref="blurCanvasRef"
      class="canvas"
      :width="canvasWidth"
      :height="canvasHeight"
      :style="canvasStyle">
    </canvas>

    <slot name="axisCanvas"></slot>
    <slot name="annCanvas"></slot>

    <canvas
      ref="plotCanvasRef"
      class="canvas"
      :width="canvasWidth"
      :height="canvasHeight"
      :style="canvasStyle">
    </canvas>
  </div>
</template>

<script setup>
import { computed, watch, onMounted, onUnmounted, reactive, ref, inject } from 'vue'
import { storeToRefs } from 'pinia'
import { createViewerStore } from '../../stores/tsviewer'
import { useTimeseriesTransport } from '@/composables/useTimeseriesTransport'
import { isZarrAssetType } from '@/composables/streaming/assetTypes'
import { adaptivePageSize, BASE_PAGE_SIZE } from '@/composables/streaming/paging'
import { useCanvasRenderer } from '@/composables/useCanvasRenderer'
import { useTimeSeriesData } from '@/composables/useTimeSeriesData'
import { useDataRequests } from '@/composables/useDataRequests'
import { useChannelProcessing } from '@/composables/useChannelProcessing'
import { createThrottle } from '@/utils/throttle'
import {useToken} from "@/composables/useToken";

const props = defineProps({
  cHeight: { type: Number, required: true },
  cWidth: { type: Number, required: true },
  start: { type: Number, required: true },
  duration: { type: Number, required: true },
  constants: { type: Object, required: true },
  rsPeriod: { type: Number, required: true },
  ts_start: { type: Number, required: true },
  ts_end: { type: Number, required: true },
  globalZoomMult: { type: Number, required: true },
  activeViewer: { type: Object, required: true },
})

const emit = defineEmits(['channelsInitialized', 'setGlobalZoom'])

const activeViewer = computed( () => props.activeViewer || {})
const baseChannels = computed(() => activeViewer.value?.channels || [])

// Store - inject from parent TSViewer component
// Falls back to default store for backwards compatibility
const viewerStore = inject('viewerStore', () => createViewerStore('default'), true)
const {
  viewerChannels,
  viewerMontageScheme,
  workspaceMontages,
} = storeToRefs(viewerStore)

// The viewer asset's type picks the data path: a Zarr bundle is read directly in the
// browser, everything else streams over the discovery WebSocket.
const isZarrSource = () => isZarrAssetType(props.activeViewer?.content?.assetType)

// A Zarr bundle answers a wide window from its pyramid in a few reads, so the page span
// grows with the viewport instead of splitting it into dozens of fixed 15-second
// columns. The legacy streaming service keeps the fixed span it was built around.
const currentPageSize = () => (isZarrSource() ? adaptivePageSize(props.duration) : BASE_PAGE_SIZE)

// The token only ever travels in the request's `session` field, which the Zarr path ignores.
// Asking Amplify for one would reject outright for a public or locally served bundle, so
// this is re-evaluated per call rather than captured.
const resolveUserToken = () => (isZarrSource() ? Promise.resolve(null) : useToken())

// Both transports are held open and dispatched per call, so a package switch that crosses
// asset types is picked up without remounting this component -- which matters because the
// unmount below calls resetViewer().
const {
  websocket,
    connectionStatus,
    openWebsocket,
    send,
    sendFilterMessage,
    sendDumpBufferRequest,
    disconnect,
    setClearChannelsCallback,
    onSegment,
    onEvent,
    onChannelDetails,
    onError
} = useTimeseriesTransport(isZarrSource)

const {
  plotCanvasRef,
  blurCanvasRef,
  initializeCanvases,
  renderData,
  cpCanvasScaler,
  computeChannelViews
} = useCanvasRenderer()

// Define pixelRatio directly in main component to avoid dependency issues
const pixelRatio = ref(1)

const isDumpingBuffer = ref(false)

const {
  chData,
  requestedPages,
  viewData,
  channelsReady,
  autoScale,
  initChannels,
  dataCallback,
  invalidate,
  autoScaleViewData,
  segmIndexOf,
  updateCurrentRequestedSamplePeriod,
  currentRequestedSamplePeriod,
  isDataCurrentForViewport,
  isSwitchingMontage
} = useTimeSeriesData()

const {
  aSyncRequests,
  aSyncPreRequests,
  isPrefetching,
  initializePrefetch,
  generatePoints,
  requestDataFromServer,
  startPrefetching,
  clearRequests,
} = useDataRequests()

// Initialize channel processing composable with baseChannels
const {
  getChannelId,
  processChannelData,
  createMontagePayload
} = useChannelProcessing(baseChannels, viewerMontageScheme, workspaceMontages, activeViewer)

const prefetchStats = ref({
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  montageRequests: 0,
  singleChannelRequests: 0,
  lastPrefetchTime: null,
  averageResponseTime: 0
})

const lastRequestedSamplePeriod = ref(null)
const lastRequestStart = ref(null)
const lastRequestDuration = ref(null)
const staleDataCounter = ref(0)

// Computed properties (from original) - moved after composable initialization
const canvasWidth = computed(() => pixelRatio.value * props.cWidth)
const canvasHeight = computed(() => cpCanvasScaler(props.cHeight, pixelRatio.value, 0))
const pHeight = computed(() => props.cHeight - 20)

const canvasStyle = computed(() => ({
  width: props.cWidth + 'px',
  height: pHeight.value + 'px'
}))

// Viewport object
const viewport = reactive({
  start: props.start,
  duration: props.duration,
  cWidth: props.cWidth,
  cHeight: props.cHeight,
  pHeight: pHeight.value,
  rsPeriod: props.rsPeriod,
  nrVisibleChannels: 0
})

const computedRsPeriod = computed(() => {
  // Use props value if valid
  if (props.rsPeriod > 0) {
    return props.rsPeriod
  }

  // Calculate from viewport as fallback
  if (viewport.duration > 0 && viewport.cWidth > 0) {
    return viewport.duration / viewport.cWidth
  }

  // Safe fallback
  console.warn('Using fallback rsPeriod = 1')
  return 1
})

watch(computedRsPeriod, (newRsPeriod) => {
  if (newRsPeriod > 0) {
    updateCurrentRequestedSamplePeriod(newRsPeriod)
  }
}, { immediate: true })

// Main methods (from original) - Define these first before throttled functions
const renderDataInternal = () => {
  try {
    if (!channelsReady.value) {
      return
    }

    // Update visible channel count
    viewport.nrVisibleChannels = viewerChannels.value?.reduce((count, ch) => {
      return ch.visible ? count + 1 : count
    }, 0) || 0

    const channelsWithData = viewData.channels.reduce((count, ch) => {
      return (ch.blocks || []).length > 0 ? count + 1 : count
    }, 0)

    if (channelsWithData === 0) {
      return
    }

    renderData(
      viewData,
      viewerChannels.value || [],
      props.constants,
      viewport,
      props.globalZoomMult,
      pixelRatio.value
    )

  } catch (error) {
    console.error('renderDataInternal failed:', error)
  }
}

const PrefetchInterval = ref()
// Sweeps page requests whose responses never arrived, so a lost response
// cannot leave a page permanently pending.
const monitorPrefetchActivity = () => {
  PrefetchInterval.value = setInterval(() => {
    if (!channelsReady.value) return

    const STUCK_REQUEST_TIMEOUT = 10000
    const now = Date.now()
    const stuckPages = Array.from(requestedPages.value.entries())
      .filter(([, info]) => now - info.ts > STUCK_REQUEST_TIMEOUT)

    if (stuckPages.length > 0) {
      console.warn('Cleaning up stuck page requests:', stuckPages.map(([pageStart, info]) => ({
        pageStart,
        age: Math.round((now - info.ts) / 1000) + 's'
      })))

      stuckPages.forEach(([pageStart]) => {
        requestedPages.value.delete(pageStart)
      })

      // Decrement stale counter to allow retries
      if (staleDataCounter.value > 0) {
        staleDataCounter.value = Math.max(0, staleDataCounter.value - 1)
      }
    }
  }, 5000)
}

const generateAndProcessRequests = async () => {
  if (!viewerChannels.value) {
    return
  }

  const showChannels = chData.value.filter(channel => {
    const channelConfig = viewerChannels.value.find(config =>
      config.id === channel.id  // Direct id comparison (both are unique)
    )
    return channelConfig && channelConfig.visible
  })

  const currentRsPeriod = computedRsPeriod.value
  const pageSize = currentPageSize()

  const buildRequests = () => generatePoints(
    showChannels,
    props.start,
    props.duration,
    viewData,
    requestedPages.value,
    props.constants,
    currentRsPeriod,
    props.ts_end,
    segmIndexOf,
    getChannelId,
    pageSize
  )

  let requests = buildRequests()

  const currentRequestedSamplePeriod = Math.ceil(currentRsPeriod)
  let shouldDumpBuffer = false
  let dumpReason = ''

  // Check for ANY rsPeriod change (any resolution change makes pending requests stale)
  if (lastRequestedSamplePeriod.value !== null && currentRequestedSamplePeriod !== lastRequestedSamplePeriod.value) {
    shouldDumpBuffer = true
    dumpReason = `rsPeriod changed: ${lastRequestedSamplePeriod.value} -> ${currentRequestedSamplePeriod} (resolution change)`
  }

  // Check for large time jump
  if (lastRequestStart.value !== null) {
    const timeJump = Math.abs(props.start - lastRequestStart.value)
    const windowSize = Math.max(props.duration, lastRequestDuration.value || props.duration)
    if (timeJump > windowSize * 2) {
      shouldDumpBuffer = true
      dumpReason = `Large time jump: ${timeJump} > ${windowSize * 2} (${(timeJump / windowSize).toFixed(1)}x window)`
    }
  }

  // A healthy pass never has more pages pending than the viewport plus the prefetch
  // horizon, so the backlog cap scales with the page count instead of sitting at a
  // fixed 15, which a wide window used to exceed just by existing.
  const viewportPages = Math.ceil(props.duration / pageSize) + 1
  const maxPendingRequests = viewportPages + props.constants.PREFETCHPAGES + 5
  if (requestedPages.value.size > maxPendingRequests) {
    shouldDumpBuffer = true
    dumpReason = `Too many pending requests: ${requestedPages.value.size} > ${maxPendingRequests}`
  }

  // Check for high stale data rate
  if (staleDataCounter.value >= 5) {
    shouldDumpBuffer = true
    dumpReason = `High stale data rate: ${staleDataCounter.value} consecutive stale segments`
  }

  // Only one dump at a time
  if (shouldDumpBuffer && !isDumpingBuffer.value) {
    isDumpingBuffer.value = true

    try {
      if (sendDumpBufferRequest()) {
        // Clear client state after successful dump
        requestedPages.value.clear()
        clearRequests()
        staleDataCounter.value = 0

        // Brief delay to let the legacy server process the dump request. The Zarr
        // client aborts synchronously, so its next requests can go out at once.
        if (!isZarrSource()) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }

        // The first pass skipped every page that was pending when it ran, and the dump
        // discarded exactly those pages. Rebuild against the now-empty bookkeeping so
        // the viewport is requested in full; without this the dumped pages are never
        // fetched again until the next user interaction.
        requests = buildRequests()
      }
    } finally {
      isDumpingBuffer.value = false
    }
  } else if (shouldDumpBuffer && isDumpingBuffer.value) {
    // Another dump is already in progress, skip this one
    return
  }

  // Update state tracking
  lastRequestedSamplePeriod.value = currentRequestedSamplePeriod
  lastRequestStart.value = props.start
  lastRequestDuration.value = props.duration

  const userToken = await resolveUserToken()

  if (requests.asyncRequests.length > 0) {
    requestDataFromServer(
      requests.asyncRequests,
      0,
      websocket.value,
      userToken,
      activeViewer.value,
      currentRsPeriod,
      requestedPages.value,
      props.ts_end
    )
  }

  // Start prefetching
  if (requests.asyncPreRequests.length > 0) {
    startPrefetching()
  }
}

const renderAll = () => {
  generateAndProcessRequests()
  renderDataInternal()
}

const renderDataOnMessage = () => {
  generateAndProcessRequests()

  if (autoScale.value === 0) {
    autoScale.value--
    handleAutoScale()
  } else {
    renderDataInternal()
  }
}

const handleAutoScale = () => {
  const autoScaleValue = autoScaleViewData(props.cHeight)
  if (autoScaleValue && !isNaN(autoScaleValue)) {
    emit('setGlobalZoom', autoScaleValue)
  }
  renderDataInternal()
}

// Throttled functions (from original) - Create these AFTER function definitions
// Leading edge so the first block of a burst paints immediately, with the trailing call
// catching whatever lands inside the window. The Zarr reader answers a whole viewport in
// one burst, so a trailing-only delay held every first paint back by the full wait.
const throttledGetRenderData = createThrottle(renderDataOnMessage, 100)
const throttledDataRender = createThrottle(() => renderAll(), 50)

// Watchers (from original)
watch(() => props.rsPeriod, (newRsPeriod) => {
  if (newRsPeriod > 0) {
    updateCurrentRequestedSamplePeriod(newRsPeriod)
  }

  invalidate()
  requestedPages.value.clear()
})

watch(() => props.duration, () => {
  // Only clear caches, don't reject responses
  invalidate()
})

watch(() => viewerMontageScheme.value, (newScheme) => {

  if (!websocket.value || websocket.value.readyState !== 1) {
    console.warn('Cannot switch montage: WebSocket not connected')
    return
  }

  // Flag the transition so stale in-flight responses are discarded
  isSwitchingMontage.value = true

  // Clear all pending requests and data
  requestedPages.value.clear()
  clearRequests()
  invalidate()

  // Reset stale data tracking
  staleDataCounter.value = 0
  lastRequestedSamplePeriod.value = null
  lastRequestStart.value = null
  lastRequestDuration.value = null

  // Clear channels to force re-initialization
  channelsReady.value = false

  // Create the proper payload using createMontagePayload
  const montagePayload = createMontagePayload(newScheme)

  if (montagePayload) {
    send(montagePayload)
  } else {
    // Montage not found in workspace montages: abort the transition
    console.warn('Montage definition not found for:', newScheme)
    isSwitchingMontage.value = false
  }
})

// Update viewport when props change
watch(() => [props.start, props.duration, props.cWidth, props.cHeight, props.rsPeriod], () => {
  viewport.start = props.start
  viewport.duration = props.duration
  viewport.cWidth = props.cWidth
  viewport.cHeight = props.cHeight
  viewport.pHeight = pHeight.value
  viewport.rsPeriod = props.rsPeriod
})

// WebSocket event handlers
onSegment((segmentData) => {
  const isOutsideViewport = segmentData.pageStart >= (props.start + props.duration)

  if (isOutsideViewport) {
    prefetchStats.value.totalRequests++
    if (viewerMontageScheme.value !== 'NOT_MONTAGED') {
      prefetchStats.value.montageRequests++
    } else {
      prefetchStats.value.singleChannelRequests++
    }
  }

  // A block requested before the last resolution change must not enter the cache: the
  // request pass would treat its page as fulfilled and never fetch it at the current
  // resolution. Its page entry was already cleared when the resolution changed.
  if (!isDataCurrentForViewport(segmentData.data)) {
    staleDataCounter.value++
    return
  }
  staleDataCounter.value = 0

  dataCallback(segmentData)

  // Check if returned page falls in viewport
  if (segmentData.pageStart < (props.start + props.duration)) {
    throttledGetRenderData()
  }
})

onEvent((eventData) => {
  if (!isDataCurrentForViewport(eventData.data)) {
    staleDataCounter.value++
    return
  }

  staleDataCounter.value = 0
  dataCallback(eventData)

  if (eventData.pageStart < (props.start + props.duration)) {
    throttledGetRenderData()
  }
})

onChannelDetails((channelDetails) => {
  // Montage transition complete: new channels are here, accept data again
  isSwitchingMontage.value = false

  try {
    const virtualChannels = processChannelData(channelDetails)

    if (!virtualChannels || virtualChannels.length === 0) {
      console.warn('No valid channels after processing channel details')
      return
    }

    initChannels(virtualChannels, viewerStore, getChannelId)
      .then(() => {
        invalidate()
        renderAll()
        emit('channelsInitialized')
      })
      .catch((err) => {
        console.error('Failed to initialize channels:', err)
        viewerStore.setViewerErrors({ error: 'Failed to initialize channels after montage switch' })
      })
  } catch (err) {
    console.error('Error processing channel details:', err)
    viewerStore.setViewerErrors({ error: 'Error processing channel details' })
  }
})

onError((error) => {
  viewerStore.setViewerErrors(error)
})

const initPlotCanvas = async () => {
  const initialRsPeriod = computedRsPeriod.value
  updateCurrentRequestedSamplePeriod(initialRsPeriod)

  // Configure WebSocket
  setClearChannelsCallback(() => {
    if (viewerChannels.value?.length) {
      const chIds = viewerChannels.value.map(ch => ch.id)
      const message = { 'channelFiltersToClear': chIds }
      sendFilterMessage(message)
    }
  })

  const userToken = await resolveUserToken()

  // Initialize prefetch function - create a wrapper that captures current values
  initializePrefetch(
    (requests) => {
      const currentRsPeriod = computedRsPeriod.value
      return requestDataFromServer(
        requests,
        0,
        websocket.value,
        userToken,
        activeViewer.value,
        currentRsPeriod,
        requestedPages.value,
        props.ts_end
      )
    },
    requestedPages
  )

  if (activeViewer.value?.content?.id) {
    try {
      // Use viewerAssetId for the WebSocket ID when available, fall back to content.id (packageId)
      const wsId = activeViewer.value.content.viewerAssetId || activeViewer.value.content.id
      const wsIdType = activeViewer.value.content.viewerAssetId ? 'viewerAsset' : (activeViewer.value.content.idType || 'viewerAsset')
      // Pass packageId separately so discover streaming gets both params
      const wsPackageId = activeViewer.value.content.viewerAssetId ? activeViewer.value.content.id : null
      await openWebsocket(
        viewerStore.config.timeseriesDiscoverApi,
        wsId,
        userToken,
        wsIdType,
        wsPackageId,
      )

      // Only start monitoring after successful connection
      monitorPrefetchActivity()

    } catch (error) {
      console.error('Failed to establish WebSocket connection:', error)
      // Handle connection failure gracefully
      return
    }
  }
}
// Lifecycle (from original mounted/unmounted logic)
onMounted(async () => {
  pixelRatio.value = 1
  initializeCanvases(pixelRatio.value)

  initPlotCanvas()
})

onUnmounted(() => {

  clearInterval(PrefetchInterval.value)

  if (requestedPages.value.size > 0) {
    sendDumpBufferRequest()
  }
  viewerStore.resetViewer()
  clearRequests()
  disconnect()
  if (throttledGetRenderData.cancel) {
    throttledGetRenderData.cancel()
  }
  if (throttledDataRender.cancel) {
    throttledDataRender.cancel()
  }
})

// Expose methods (from original)
defineExpose({
  renderAll,
  invalidate,
  throttledDataRender,
  sendFilterMessage,
  viewData,
  requestedPages,
  chData,
  viewerChannels,
  currentRequestedSamplePeriod,
  initPlotCanvas
})
</script>

<style lang="scss" scoped>
.timeseries-plot-canvas {
  position: relative;
  width: 100%;
  height: 100%;
}

.canvas {
  position: absolute;
  top: 0;
  left: 5px;
  cursor: ew-resize;
  outline: none;
}
</style>