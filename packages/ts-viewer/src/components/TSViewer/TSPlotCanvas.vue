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

<script setup lang="ts">
import { computed, watch, onMounted, onUnmounted, reactive, ref, shallowRef, inject } from 'vue'
import type { Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { createViewerStore } from '../../stores/tsviewer'
import type { ActiveViewer, ViewerChannel } from '../../stores/tsviewer'
import { useViewerTransport } from "@/state/viewerTransportContext"
import type {
  TimeseriesTransport,
  MontageMessage,
  TransportSegmentEnvelope,
  TransportError
} from '@/transport/TimeseriesTransport'
import { BASE_PAGE_SIZE } from '@/composables/streaming/paging'
import { useCanvasRenderer } from '@/composables/useCanvasRenderer'
import type { RendererConstants, RendererChannelView } from '@/composables/useCanvasRenderer'
import { useTimeSeriesData } from '@/composables/useTimeSeriesData'
import type { SegmentMessage } from '@/composables/useTimeSeriesData'
import { useDataRequests } from '@/composables/useDataRequests'
import type { PlannedRequest } from '@/composables/useDataRequests'
import { useChannelProcessing } from '@/composables/useChannelProcessing'
import type { VirtualChannel } from '@/composables/useChannelProcessing'
import type { ChannelDetail } from '@/composables/streaming/channelDetails'
import type { LegacyFilterMessage } from '@/composables/streaming/filters'
import { createThrottle } from '@/utils/throttle'

/** Keys of the viewer constants object this component reads or forwards. */
interface PlotCanvasConstants extends RendererConstants {
  PREFETCHPAGES: number
}

interface Props {
  cHeight: number
  cWidth: number
  start: number
  duration: number
  constants: PlotCanvasConstants
  rsPeriod: number
  ts_start: number | null
  ts_end: number | null
  globalZoomMult: number
  activeViewer: ActiveViewer
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'channelsInitialized'): void
  (e: 'setGlobalZoom', value: number): void
}>()

const activeViewer = computed<ActiveViewer>( () => props.activeViewer || {})
const baseChannels = computed<ChannelDetail[] | undefined>(() => activeViewer.value?.channels || [])

// Store - inject from parent TSViewer component
// Falls back to default store for backwards compatibility
const viewerStore = inject('viewerStore', () => createViewerStore('default'), true)
const {
  viewerChannels,
  viewerMontageScheme,
  workspaceMontages,
} = storeToRefs(viewerStore)

// TSViewer owns the transport and swaps it when the asset type changes; this
// canvas arms whichever one is current.
const transport = useViewerTransport()

// A Zarr bundle answers a wide window from its pyramid in a few reads, so its page span
// covers the viewport instead of splitting it into fixed 15-second columns. The legacy
// streaming service keeps the fixed span it was built around. The difference travels
// through the transport's capabilities.
const currentPageSize = () =>
  transport.value ? transport.value.capabilities.pageSizeFor(props.duration) : BASE_PAGE_SIZE

// Read-ahead is counted in pages, so the two backends need different counts to reach a
// comparable distance past the viewport. A count that is not a number would make the
// walk's end time NaN and stop every request, so the viewer constant stands in.
const currentPrefetchPages = () => {
  const fromTransport = transport.value?.capabilities.prefetchPages
  return Number.isFinite(fromTransport) ? fromTransport! : props.constants.PREFETCHPAGES
}

const sendFilterMessage = (message: LegacyFilterMessage) => {
  transport.value?.setFilter(message)
}

const {
  plotCanvasRef,
  blurCanvasRef,
  initializeCanvases,
  renderData,
  cpCanvasScaler,
  computeChannelViews
} = useCanvasRenderer()

// One device pixel per CSS pixel, against the real ratio that TSViewerCanvas.vue and
// TSScrubber.vue read. The plot canvas rasterizes a polyline per channel, so the real
// ratio on a 2x display quadruples the pixels every fill and stroke covers, which costs
// more than the sharpness returns here.
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
  updateCacheWindow,
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
} = useChannelProcessing(baseChannels, viewerMontageScheme, workspaceMontages,
  activeViewer as unknown as Ref<{ content: { id: string } } | null | undefined>)

const prefetchStats = ref({
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  montageRequests: 0,
  singleChannelRequests: 0,
  lastPrefetchTime: null,
  averageResponseTime: 0
})

const lastRequestedSamplePeriod = ref<number | null>(null)
const lastRequestStart = ref<number | null>(null)
const lastRequestDuration = ref<number | null>(null)
const staleDataCounter = ref(0)

// Computed properties (from original) - moved after composable initialization
const pHeight = computed(() => props.cHeight - 20)

// The backing store matches the CSS box the canvas is drawn into. A backing height of
// cHeight against a CSS height of pHeight makes the compositor rescale every frame by a
// fraction, and row geometry then has to carry the difference.
const canvasWidth = computed(() => cpCanvasScaler(props.cWidth, pixelRatio.value, 0))
const canvasHeight = computed(() => cpCanvasScaler(pHeight.value, pixelRatio.value, 0))

const canvasStyle = computed(() => ({
  width: props.cWidth + 'px',
  height: pHeight.value + 'px'
}))

/** Visible channel count, recomputed each render pass. */
const nrVisibleChannels = ref(0)

// The renderer's view of the viewport. Derived rather than mirrored: a watcher
// copying these props left the object holding stale numbers for anything that
// read it before the watcher flushed.
const viewport = computed(() => ({
  start: props.start,
  duration: props.duration,
  cWidth: props.cWidth,
  cHeight: props.cHeight,
  pHeight: pHeight.value,
  rsPeriod: props.rsPeriod,
  nrVisibleChannels: nrVisibleChannels.value
}))

const computedRsPeriod = computed(() => {
  // Use props value if valid
  if (props.rsPeriod > 0) {
    return props.rsPeriod
  }

  // Fall back to the ratio the viewport implies
  if (props.duration > 0 && props.cWidth > 0) {
    return props.duration / props.cWidth
  }

  // Safe fallback
  console.warn('Using fallback rsPeriod = 1')
  return 1
})

/**
 * How long the viewport holds still before the pages it needs are planned again.
 *
 * A wheel gesture moves the resolution on every tick. Planning each one dumps the buffer
 * and refetches, which leaves the viewport blank for the whole gesture.
 */
const VIEWPORT_SETTLE_MS = 200

let viewportSettleTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Sample period in effect when the open settle window began, null when none is open.
 *
 * The period the window closes on says whether the cached blocks are the wrong width for
 * the viewport. `lastRequestedSamplePeriod` cannot answer that: a planning pass inside
 * the window moves it without dropping a single block.
 */
let gestureStartPeriod: number | null = null

/**
 * Plans the viewport again now that the gesture moving it has stopped.
 *
 * Blocks read at another resolution are the wrong width for the window, so they go, and
 * with them the pending pages that would stop the walk asking again. Blocks at the
 * resolution the gesture ended on still cover the window. `planRequests` dumps whatever
 * the abandoned resolutions left in flight.
 */
const settleViewport = () => {
  viewportSettleTimer = undefined

  const settled = Math.ceil(computedRsPeriod.value)
  if (gestureStartPeriod !== null && settled !== gestureStartPeriod) {
    invalidate()
  }
  gestureStartPeriod = null

  renderAll()
}

/** Restarts the settle window, so every change inside one gesture extends it. */
const armViewportSettle = () => {
  clearTimeout(viewportSettleTimer)
  viewportSettleTimer = setTimeout(settleViewport, VIEWPORT_SETTLE_MS)
}

/** Drops a pending settle, for a change that voids the cache on its own. */
const cancelViewportSettle = () => {
  clearTimeout(viewportSettleTimer)
  viewportSettleTimer = undefined
  gestureStartPeriod = null
}

// Immediate, so the requested period is set before the first request goes out. Blocks
// answered at any other period are rejected on arrival until it changes again.
watch(computedRsPeriod, (newRsPeriod) => {
  if (newRsPeriod > 0) {
    updateCurrentRequestedSamplePeriod(newRsPeriod)
  }
}, { immediate: true })

// Both halves of the viewport shape arm the settle. A width change moves the resolution
// without moving the duration, and a duration change that a width change cancels out
// moves the duration without moving the resolution.
watch([computedRsPeriod, () => props.duration], (_current, [previousPeriod]) => {
  if (viewportSettleTimer === undefined) {
    gestureStartPeriod = Math.ceil(previousPeriod)
  }
  armViewportSettle()
})

/**
 * Draws the cached blocks of every visible channel.
 *
 * Plans nothing. A caller that changed which pages the viewport needs plans first.
 */
const paint = () => {
  try {
    if (!channelsReady.value) {
      return
    }

    // Update visible channel count
    nrVisibleChannels.value = viewerChannels.value?.reduce((count, ch) => {
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
      (viewerChannels.value || []) as unknown as RendererChannelView[],
      props.constants,
      viewport.value,
      props.globalZoomMult,
      pixelRatio.value
    )

  } catch (error) {
    console.error('TSPlotCanvas: paint failed', error)
  }
}

const PrefetchInterval = ref<ReturnType<typeof setInterval>>()
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

/**
 * Sends the pages the viewport and the prefetch horizon are missing, dumping the
 * buffer first when the pending set has gone stale.
 *
 * Draws nothing.
 */
const planRequests = async () => {
  if (!viewerChannels.value) {
    return
  }

  // Captured once per pass, so a transport swap mid-pass cannot split the dump
  // and the requests across two backends.
  const activeTransport = transport.value

  // First row wins, matching the find this replaces. chData keeps the outer loop: its
  // order is the order the request carries, and the reader matches yields by position.
  const configById = new Map<string, ViewerChannel>()
  for (const config of viewerChannels.value) {
    if (!configById.has(config.id)) {
      configById.set(config.id, config)
    }
  }

  const showChannels = chData.value.filter(channel => {
    const channelConfig = configById.get(channel.id)
    return channelConfig && channelConfig.visible
  })

  const currentRsPeriod = computedRsPeriod.value
  const pageSize = currentPageSize()
  const prefetchPages = currentPrefetchPages()
  const requestConstants = { ...props.constants, PREFETCHPAGES: prefetchPages }

  // Before the walk, so a page the walk is about to read as cached is one the window
  // still covers.
  updateCacheWindow(props.start, props.duration, pageSize, prefetchPages)

  const buildRequests = () => generatePoints(
    showChannels,
    props.start,
    props.duration,
    viewData,
    requestedPages.value,
    requestConstants,
    currentRsPeriod,
    props.ts_end!,
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

  // Check for a jump past every page the walk would ask for. The threshold is the
  // range the walk covers, which is what `updateCacheWindow` keeps. A shorter jump
  // leaves pending pages the new viewport still wants, and a dump cancels the reads
  // that would answer them.
  if (lastRequestStart.value !== null) {
    const timeJump = Math.abs(props.start - lastRequestStart.value)
    const windowSize = Math.max(props.duration, lastRequestDuration.value || props.duration)
    const requestHorizon = windowSize + prefetchPages * pageSize
    if (timeJump > requestHorizon) {
      shouldDumpBuffer = true
      dumpReason = `Large time jump: ${timeJump} > ${requestHorizon} (request horizon)`
    }
  }

  // A healthy pass never has more pages pending than the viewport plus the prefetch
  // horizon, so the backlog cap scales with the page count.
  const viewportPages = Math.ceil(props.duration / pageSize) + 1
  const maxPendingRequests = viewportPages + prefetchPages + 5
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

    // A dump cancels every read in flight, so a pass that dumps repeatedly cannot
    // finish a page on a slow link. Nothing else reports the rate or the cause.
    console.warn('Dumping the request buffer:', {
      reason: dumpReason,
      start: props.start,
      duration: props.duration,
      pageSize
    })

    try {
      if (activeTransport && activeTransport.dumpBuffer()) {
        // Clear client state after successful dump
        requestedPages.value.clear()
        clearRequests()
        staleDataCounter.value = 0

        // Brief delay to let the legacy server process the dump request. The Zarr
        // transport aborts synchronously and reports 0 ms, so its next requests
        // can go out at once.
        const postDumpDelayMs = activeTransport.capabilities.postDumpDelayMs
        if (postDumpDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, postDumpDelayMs))
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

  if (requests.asyncRequests.length > 0 && activeTransport) {
    requestDataFromServer(
      requests.asyncRequests,
      0,
      activeTransport,
      requestedPages.value,
      props.ts_end!
    )
  }

  // Start prefetching
  if (requests.asyncPreRequests.length > 0) {
    startPrefetching()
  }
}

/** Plans, then draws. Data arrival and channel initialization both need both halves. */
const renderAll = () => {
  planRequests()
  paint()
}

const renderDataOnMessage = () => {
  // Arrivals stay on the planning path: a block that lands can reveal the next page
  // the viewport needs.
  planRequests()

  if (autoScale.value === 0) {
    autoScale.value--
    handleAutoScale()
  } else {
    paint()
  }
}

const handleAutoScale = () => {
  const autoScaleValue = autoScaleViewData(props.cHeight)
  if (autoScaleValue && !isNaN(autoScaleValue)) {
    emit('setGlobalZoom', autoScaleValue)
  }
  paint()
}

// Leading edge so the first block of a burst paints immediately, with the trailing call
// catching whatever lands inside the window. The Zarr reader answers a whole viewport in
// one burst, so a trailing-only delay held every first paint back by the full wait.
const throttledGetRenderData = createThrottle(renderDataOnMessage, 100)

watch(() => viewerMontageScheme.value, (newScheme) => {

  const activeTransport = transport.value
  if (!activeTransport || activeTransport.status.value !== 'connected') {
    console.warn('Cannot switch montage: transport not connected')
    return
  }

  // Flag the transition so stale in-flight responses are discarded
  isSwitchingMontage.value = true

  // Clear all pending requests and data. A settle planning for the outgoing channel
  // set would send requests the incoming one cannot use.
  cancelViewportSettle()
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
    // createMontagePayload types montageMap as string[][]; the wire pairs are
    // always two channel names.
    activeTransport.setMontage(montagePayload as MontageMessage)
  } else {
    // Montage not found in workspace montages: abort the transition
    console.warn('Montage definition not found for:', newScheme)
    isSwitchingMontage.value = false
  }
})


// Transport event handlers, registered on each transport initPlotCanvas creates
const handleSegment = (segmentData: TransportSegmentEnvelope) => {
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
  if (!isDataCurrentForViewport(segmentData.data as { requestedSamplePeriod?: number })) {
    staleDataCounter.value++
    return
  }
  staleDataCounter.value = 0

  dataCallback(segmentData as SegmentMessage)

  // Check if returned page falls in viewport
  if (segmentData.pageStart < (props.start + props.duration)) {
    throttledGetRenderData()
  }
}

const handleEvent = (eventData: TransportSegmentEnvelope) => {
  if (!isDataCurrentForViewport(eventData.data as { requestedSamplePeriod?: number })) {
    staleDataCounter.value++
    return
  }

  staleDataCounter.value = 0
  dataCallback(eventData as unknown as SegmentMessage)

  if (eventData.pageStart < (props.start + props.duration)) {
    throttledGetRenderData()
  }
}

const handleChannelDetails = (channelDetails: ChannelDetail[]) => {
  // Montage transition complete: new channels are here, accept data again
  isSwitchingMontage.value = false

  try {
    const virtualChannels = processChannelData(channelDetails as Pick<ChannelDetail, 'id' | 'name'>[])

    if (!virtualChannels || virtualChannels.length === 0) {
      console.warn('No valid channels after processing channel details')
      return
    }

    initChannels(virtualChannels as VirtualChannel[], viewerStore, getChannelId)
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
}

const handleError = (error: TransportError) => {
  // The store field no template reads, kept for callers that poll it.
  viewerStore.setViewerErrors(error)
  // A failed page draws as blank, so without this the cause is invisible.
  console.error('TSPlotCanvas: transport error', error)
}

const initPlotCanvas = () => {
  const initialRsPeriod = computedRsPeriod.value
  updateCurrentRequestedSamplePeriod(initialRsPeriod)

  // Initialize prefetch function - create a wrapper that captures current values
  initializePrefetch(
    (requests: PlannedRequest[]) => {
      const activeTransport = transport.value
      if (!activeTransport) {
        return false
      }
      return requestDataFromServer(
        requests,
        0,
        activeTransport,
        requestedPages.value,
        props.ts_end!
      )
    },
    requestedPages
  )
}

let unsubscribeTransport: Array<() => void> = []

/**
 * Arms the current transport: registers the handlers and discards anything the
 * previous one left behind.
 *
 * Runs synchronously with the assignment in TSViewer, before that transport's
 * `open()` starts, so the catalog emission always lands on a live handler.
 */
watch(transport, (activeTransport, previous) => {
  for (const off of unsubscribeTransport) {
    off()
  }
  unsubscribeTransport = []

  if (previous) {
    // The outgoing transport's pages will never arrive, and a settle must not ask the
    // incoming one for them.
    cancelViewportSettle()
    requestedPages.value.clear()
    clearRequests()
    invalidate()
    staleDataCounter.value = 0
    lastRequestedSamplePeriod.value = null
    lastRequestStart.value = null
    lastRequestDuration.value = null
  }

  if (!activeTransport) {
    return
  }

  unsubscribeTransport = [
    activeTransport.on('segment', handleSegment),
    activeTransport.on('event', handleEvent),
    activeTransport.on('channelDetails', handleChannelDetails),
    activeTransport.on('error', handleError)
  ]

  // One sweeper per transport; a swap must not leave the old timer running.
  clearInterval(PrefetchInterval.value)
  monitorPrefetchActivity()
}, { flush: 'sync', immediate: true })

// Lifecycle (from original mounted/unmounted logic)
onMounted(async () => {
  initializeCanvases(pixelRatio.value)

  initPlotCanvas()
})

onUnmounted(() => {

  clearInterval(PrefetchInterval.value)
  cancelViewportSettle()

  if (requestedPages.value.size > 0) {
    transport.value?.dumpBuffer()
  }
  // The store outlives this canvas and the transport belongs to TSViewer, so
  // neither is torn down here. Resetting the store from this unmount hook used
  // to erase the state an incoming canvas needed.
  clearRequests()
  for (const off of unsubscribeTransport) {
    off()
  }
  unsubscribeTransport = []
  if (throttledGetRenderData.cancel) {
    throttledGetRenderData.cancel()
  }
})

// Expose methods (from original)
defineExpose({
  planRequests,
  paint,
  invalidate,
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