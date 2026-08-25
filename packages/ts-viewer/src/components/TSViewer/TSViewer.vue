<template>
  <div
    id="ts_viewer"
    ref="ts_viewer"
    :class="[ isPreview ? 'timeseries-viewer preview' : 'timeseries-viewer' ]"
  >
    <TimeseriesScrubber
      ref="scrubber"
      :ts_start="ts_start"
      :ts_end="ts_end"
      :c-width="cWidth"
      :label-width="labelWidth"
      :cursor-loc="cursorLoc"
      :start="start"
      :duration="duration"
      :constants="constants"
      :active-viewer="activeViewer"
      @setStart="updateStart"
    />

    <div id="channelCanvas">
      <!--       Channel labels-->
      <ChannelLabels
        ref="channelLabels"
        :channels="visibleChannels"
        :global-zoom-mult="globalZoomMult"
        :c-height="cHeight"
        :constants="constants"
        @labelTap="onLabelTap"
      />

      <!--       Timeseries viewport-->
      <!-- Not keyed on the asset type: the transport swap happens above and the
           canvas re-arms on it, so remounting would only discard warm caches. -->
      <TimeseriesViewerCanvas
        v-if="activeViewer?.content?.id"
        ref="viewerCanvas"
        :window_height="window_height"
        :window_width="window_width"
        :duration="duration"
        :start="start"
        :c-width="cWidth"
        :c-height="cHeight"
        :constants="constants"
        :ts-start="ts_start"
        :ts-end="ts_end"
        :cursor-loc="cursorLoc"
        :global-zoom-mult="globalZoomMult"
        :active-viewer="activeViewer"
        @setStart="updateStart"
        @setCursor="setCursor"
        @setGlobalZoom="setGlobalZoom"
        @setDuration="setDuration"
        @channelsInitialized="onChannelsInitialized"
        @annLayersInitialized="onAnnLayersInitialized"
        @closeAnnotationLayerWindow="onCloseAnnotationLayerWindow"
        @addAnnotation="onAddAnnotation"
        @updateAnnotation="onUpdateAnnotation"
      />
    </div>

    <TimeseriesViewerToolbar
      v-if="!isPreview"
      :max-duration="maxDuration"
      :duration="duration"
      :start="start"
      v-model:globalZoomMult="globalZoomMult"
      @pageBack="onPageBack"
      @pageForward="onPageForward"
      @incrementZoom="onIncrementZoom"
      @decrementZoom="onDecrementZoom"
      @updateDuration="onUpdateDuration"
      @nextAnnotation="onNextAnnotation"
      @previousAnnotation="onPreviousAnnotation"
      @setStart="updateStart"
    />

    <TimeseriesFilterModal
      ref="filterWindow"
      :visible="filterWindowOpen"
      @update:visible="filterWindowOpen = $event"
      @setFilters="setTimeseriesFilters"
      @closeWindow="onCloseFilterWindow"
    />

    <TimeseriesAnnotationModal
      ref="annotationModal"
      :visible="annotationWindowOpen"
      @update:visible="annotationWindowOpen = $event"
      @closeWindow="onCloseAnnotationWindow"
      @createUpdateAnnotation="onCreateUpdateAnnotation"
    />

    <TsAnnotationDeleteDialog
      :visible="isTsAnnotationDeleteDialogVisible"
      :delete-annotation="annotationDelete"
      @update:visible="isTsAnnotationDeleteDialogVisible = $event"
      @delete="deleteAnnotation"
    />

    <TsViewerLayerWindow
      :visible="annotationLayerWindowOpen"
      @close-window="onCloseAnnotationLayerWindow"
      @create-layer="onCreateAnnotationLayer"
    />


  </div>
</template>

<script setup lang="ts">
import {
  ref,
  shallowRef,
  computed,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
  defineAsyncComponent,
  provide
} from 'vue'
import { storeToRefs } from 'pinia'
import { createViewerStore, clearViewerStore } from "../../stores/tsviewer"
import type { ActiveViewer, ViewerChannel } from "../../stores/tsviewer"
import { useTsAnnotation } from '@/composables/useTsAnnotation'
import { useGlobalMessageHandler } from '@/composables/useGlobalMessageHandler'
import { createTransport } from '@/transport/createTransport'
import type { TimeseriesTransport } from '@/transport/TimeseriesTransport'
import { provideViewerTransport } from '@/state/viewerTransportContext'
import { createEmitter, provideViewerEmitter } from '@/events/emitter'
import type { ViewerEvents } from '@/events/emitter'
import {
  uvPerMmToZoomMult,
  zoomMultForAmplitudes
} from '@/composables/streaming/autoscale'
import type { Annotation, AnnotationLayer } from '@/utils/annotationUtils'

// Component imports (required for <script setup>)
// Loaded eagerly, unlike the components below: onMounted reads the rendered width of
// the label column, which is only measurable once the child is in the DOM.
import ChannelLabels from '@/components/TSViewer/ChannelLabels.vue'
const TimeseriesScrubber = defineAsyncComponent(() => import('@/components/TSViewer/TSScrubber.vue'))
const TimeseriesViewerCanvas = defineAsyncComponent(() => import('@/components/TSViewer/TSViewerCanvas.vue'))
const TimeseriesViewerToolbar = defineAsyncComponent(() => import('@/components/TSViewer/TSViewerToolbar.vue'))
const TimeseriesFilterModal = defineAsyncComponent(() => import('@/components/TSViewer/TSFilterModal.vue'))
const TimeseriesAnnotationModal = defineAsyncComponent(() => import('@/components/TSViewer/TSAnnotationModal.vue'))
const TsAnnotationDeleteDialog = defineAsyncComponent(() => import('@/components/TSViewer/TSAnnotationDeleteDialog/TsAnnotationDeleteDialog.vue'))
const TsViewerLayerWindow = defineAsyncComponent( () => import('@/components/TSViewer/TSViewerLayerWindow.vue'))
// Constants
const constants = {
  TIMEUNIT: 'microSeconds',   // Basis for time
  XOFFSET: 0,                 // X-offset of graph in canvas
  XGRIDSPACING: 1000000,      // Time in microseconds between vertical lines
  NRPXPERLABEL: 150,          // Number of pixels per label on x-axis
  USEREALTIME: true,          // If true than interpret timepoints as UTC microseconds.
  DEFAULTDPI: 96,             // Default pixels per inch
  ANNOTATIONLABELHEIGHT: 20,  // Height of annotation label
  ROUNDDATAPIXELS: false,     // If true, canvas point will be rounded to integer pixels for faster render (faster)
  MINMAXPOLYGON: true,        // If true, then polygon is rendered thru minMax values, otherwise vertical lines (faster)
  PREFETCHPAGES: 5,           // Number of pages to read ahead of view.
  LIMITANNFETCH: 500,         // Maximum number of annotations that are fetched per request
  USEMEDIAN: false,           // Use Median instead of mean for centering channels
  CURSOROFFSET: 5,            // Offset of cursor canvas
  SEGMENTSPAN: 1209600000000, // One week of gap-data is returned per request.
  MAXRECURSION: 20,           // Maximum recursion depth of gap-data requests (max 2 years)
  MAXDURATION: 600000000,     // Maximum duration window for the legacy streaming service (10min)
  INITDURATION: 15000000      // Initial duration window  (15sec)
}

interface Props {
  pkg?: Record<string, unknown>
  isPreview?: boolean
  sidePanelOpen?: boolean
  /**
   * Unique identifier for this viewer instance.
   * Required when running multiple TSViewer components on the same page.
   * Each instance should have a unique ID to ensure isolated state.
   */
  instanceId?: string
}

// Define props
const props = withDefaults(defineProps<Props>(), {
  pkg: () => ({}),
  isPreview: false,
  sidePanelOpen: false,
  instanceId: 'default'
})

// Store setup - create instance-specific store
const viewerStore = createViewerStore(props.instanceId)
const { viewerChannels, needsRerender } = storeToRefs(viewerStore)

// Provide store and instanceId to child components
provide('viewerStore', viewerStore)
provide('viewerInstanceId', props.instanceId)

// This viewer owns its transport. Descendants inject the ref rather than
// constructing their own, so one viewer never holds two connections.
const transport = shallowRef<TimeseriesTransport | null>(null)
provideViewerTransport(transport)

// One emitter per viewer instance. A toast raised in this viewer's subtree is
// rendered by this viewer, not by a second viewer mounted on the same page.
const emitter = createEmitter<ViewerEvents>()
provideViewerEmitter(emitter)

/**
 * Points the viewer at the backend the active viewer's content selects, closing
 * whatever was open before. A package switch that crosses asset types lands here
 * and swaps the transport in place; descendants watch the ref and re-arm.
 */
const openTransportFor = async (content: NonNullable<ActiveViewer['content']>) => {
  const previous = transport.value
  transport.value = null
  if (previous) {
    await previous.close()
  }

  // The store's $id is `tsviewer-<instanceId>`, the same key the store uses to
  // warm the zarr client registry in fetchAndSetActiveViewer.
  const next = createTransport(content.assetType, { registryKey: viewerStore.$id })
  // Assigned before open() so descendants register their handlers first; the
  // catalog arrives during open() and a late handler would miss it.
  transport.value = next

  try {
    await next.open({
      packageId: content.id,
      viewerAssetId: content.viewerAssetId ?? null,
      url: content.url ?? null,
      onUrlExpired: content.onUrlExpired ?? null,
      timeseriesDiscoverApi: viewerStore.config.timeseriesDiscoverApi as string | undefined,
      timeSeriesApi: viewerStore.config.timeSeriesApi as string | undefined
    })
  } catch (error) {
    console.error('TSViewer: failed to open the transport:', error)
  }
}

// Global message handler for toast/error events
useGlobalMessageHandler(emitter)

// TsAnnotation composable setup - pass the store instance
const {
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
} = useTsAnnotation(viewerStore)

/** Payload of the filter modal's setFilters event; matches TSViewerCanvas.setFilters. */
interface FilterPayload {
  filterType: string
  selChannels: string[]
  input0?: number | string
  input1?: number | string
  notchFreq?: number
}

/** The TSScrubber methods this component calls through its template ref. */
interface ScrubberHandle {
  resetComponentState: () => void
  initSegmentSpans: () => void
  getAnnotations: () => Promise<void>
}

/** The TSViewerCanvas members this component calls through its template ref. */
interface ViewerCanvasHandle {
  rsPeriod: number
  resetFocusedAnnotation: () => void
  createAnnotationLayer: (layer: { name: string; color: string; description?: string }) => void
  getNextAnnotation: () => number
  getPreviousAnnotation: () => number
  setFilters: (payload: FilterPayload) => void
  setActiveTool: (tool: string) => void
  renderAll: () => void
  renderAnnotationCanvas: () => void
  initViewerCanvas: () => void
}

/** The ChannelLabels members this component reads through its template ref. */
interface ChannelLabelsHandle {
  /** Root element of the label column. */
  el: HTMLDivElement | null
}

// Template refs
const ts_viewer = ref<HTMLDivElement | null>(null)
/** Watches the root's box so the plot area follows the space the host gives it. */
let resizeObserver: ResizeObserver | null = null
const scrubber = ref<ScrubberHandle | null>(null)
const channelLabels = ref<ChannelLabelsHandle | null>(null)
const viewerCanvas = ref<ViewerCanvasHandle | null>(null)
// TODO(ts-phase4): TSViewer writes into the filter modal's instance state directly.
const filterWindow = ref<any>(null)
// TODO(ts-phase4): declared for the template ref only; no member is read.
const annotationModal = ref<any>(null)


// Reactive
const ts_start = ref<number | null>(null)
const ts_end = ref<number | null>(null)
const window_height = ref(0)
const window_width = ref(0)
const start = ref(0)                // Start Timestamp of viewer in microseconds
const duration = ref(0)            // Length of data in viewer in microseconds (ignore gaps)
const cWidth = ref(0)
const cHeight = ref(0)
const labelWidth = ref(0)
/**
 * Vertical sensitivity the viewer opens at, in microvolts per millimeter, until a bundle's
 * own amplitude is measured. Derived rather than hardcoded as a multiplier so the opening
 * scale is the same on a retina display as on a 1x one.
 */
const DEFAULT_UV_PER_MM = 100

const globalZoomMult = ref(
  uvPerMmToZoomMult(
    DEFAULT_UV_PER_MM,
    constants.DEFAULTDPI,
    window.devicePixelRatio || 1
  )
)
const cursorLoc = ref(1/10)
const annotationWindowOpen = ref(false)
const annotationLayerWindowOpen = ref(false)
// TODO(ts-phase4): TsAnnotationDeleteDialog types delete-annotation as a plain object, which rejects Annotation | null.
const annotationDelete = ref<any>(null)
const isTsAnnotationDeleteDialogVisible = ref(false)
const filterWindowOpen = ref(false)

// Computed properties
const activeViewer = computed(() => viewerStore.activeViewer)

const reactiveViewerChannels = computed(() => {
  return viewerChannels.value.map(channel => ({
    ...channel,
    selected: Boolean(channel.selected)
  }) as ViewerChannel & { displayName: string })
})

const visibleChannels = computed(() => {
  return reactiveViewerChannels.value.filter(channel => channel.visible)
})

const nrVisChannels = computed(() => {
  return visibleChannels.value.length
})

/**
 * Maximum duration window, in microseconds.
 *
 * `constants.MAXDURATION` exists to stop the legacy WebSocket streaming service from
 * falling over on a wide request. The Zarr transport reads pages directly from the
 * browser and has no such backend to protect, so a Zarr viewer is bounded only by the
 * length of the recording itself.
 */
const maxDuration = computed(() => {
  const activeTransport = transport.value
  // A transport that is not open yet reports no capabilities. Hold the legacy
  // ceiling until one arrives.
  if (!activeTransport) {
    return constants.MAXDURATION
  }
  const backendCap = activeTransport.capabilities.maxDurationUs
  if (backendCap !== null) {
    return backendCap
  }
  // A null capability means no backend ceiling, so the recording length is the bound.
  if (ts_start.value === null || ts_end.value === null) {
    return constants.MAXDURATION
  }
  return ts_end.value - ts_start.value
})

// Methods that need to be defined early (used in watchers)
/**
 * Sizes the plot area from the box the host gives the viewer. The height comes from the
 * rendered root rather than from the window, so a viewer in a panel is sized by the panel.
 */
const measureLayout = () => {
  const element = ts_viewer.value
  if (!element) {
    return
  }

  const style = window.getComputedStyle(element, null)
  const rootHeight = parseInt(style.getPropertyValue('height'))

  const toolbarOffset = props.isPreview ? 0 : 100

  window_height.value = rootHeight - toolbarOffset
  window_width.value = element.offsetWidth

  // ChannelLabels owns the label column's root element, so the width is read from the
  // element it exposes rather than from a ref in this template.
  const labelDiv = channelLabels.value?.el
  if (!labelDiv) {
    return
  }

  labelWidth.value = labelDiv.clientWidth
  cWidth.value = (window_width.value - labelDiv.clientWidth - 16)
  cHeight.value = (window_height.value - 40)
}

const onResize = async () => {
  await nextTick()
  measureLayout()
}

/**
 * Whether this package's amplitude has already been measured, so the pass runs once per
 * bundle. A user who has adjusted the scale is never overridden.
 */
let verticalScaleMeasured = false

/**
 * Sets the vertical scale from the bundle's own amplitude, once per bundle.
 *
 * Reads the coarsest pyramid level over the whole recording, which the availability scan
 * has usually already fetched, and picks the sensitivity that keeps the median channel
 * inside its row. A backend without an amplitude survey keeps `DEFAULT_UV_PER_MM`. Any
 * failure leaves the current scale alone.
 */
const measureVerticalScale = async () => {
  if (verticalScaleMeasured) {
    return
  }
  const activeTransport = transport.value
  if (!activeTransport?.capabilities.supportsAmplitudeSurvey || !activeTransport.measureAmplitudes) {
    return
  }
  const rowHeight = cHeight.value / nrVisChannels.value
  if (!ts_start.value || !ts_end.value || !(rowHeight > 0)) {
    return
  }
  const channels = visibleChannels.value
    .filter((channel) => channel.type !== 'UNIT')
    .map((channel) => channel.serverId || channel.id)
  if (channels.length === 0) {
    return
  }

  verticalScaleMeasured = true
  try {
    const amplitudes = await activeTransport.measureAmplitudes(
      channels,
      ts_start.value,
      ts_end.value
    )
    const zoom = zoomMultForAmplitudes(amplitudes, rowHeight)
    if (zoom !== null) {
      globalZoomMult.value = zoom
      viewerCanvas.value?.renderAll?.()
    }
  } catch (error: any) { // TODO(ts-phase4)
    // A bundle that cannot be surveyed still renders at the default scale.
    verticalScaleMeasured = false
    console.warn(`TSViewer: vertical autoscale skipped: ${error?.message ?? error}`)
  }
}

// Watchers
watch( () => activeViewer.value, async (newValue, oldValue ) => {

  if (scrubber.value?.resetComponentState) {
    scrubber.value.resetComponentState()
  }

  if (newValue && newValue.channels && newValue.channels.length > 0) {
    initTimeRange()
  }

  initCanvasRenderer()

  await nextTick()

  if (scrubber.value?.initSegmentSpans) {
    scrubber.value.initSegmentSpans()
  }
  if (scrubber.value?.getAnnotations) {
    scrubber.value.getAnnotations()
  }

  // Not awaited: the first page should render at the default scale rather than wait on the
  // amplitude pass, which re-renders once it lands.
  void measureVerticalScale()

}, {immediate: false, deep: true})

// Watch for changes in number of visible channels
watch(nrVisChannels, (newCount, oldCount) => {
  if (oldCount !== undefined && newCount !== oldCount) {
    // Add a small delay to ensure DOM has updated
    setTimeout(() => {
      onResize()
      if (viewerCanvas.value?.renderAll) {
        viewerCanvas.value.renderAll()
      }
      // The channel list populating is the first point at which the reader, the time
      // range, and the row height are all known, so this is where the pass usually runs.
      void measureVerticalScale()
    }, 20)
  }
})

const openEditAnnotationDialog = (annotation: Annotation) => {
  viewerStore.setActiveAnnotation(annotation)
  viewerCanvas.value!.renderAnnotationCanvas()
  annotationWindowOpen.value = true
}

watch(needsRerender, (renderData) => {
  if (renderData) {
    nextTick(() => {
      // If channels visibility changed, we need to recalculate layout
      if (renderData.cause === 'channel-visibility') {
        // Add a small delay to ensure DOM has fully updated after v-if changes
        setTimeout(() => {
          onResize()
          // Re-render after layout recalculation
          if (viewerCanvas.value?.renderAll) {
            viewerCanvas.value.renderAll()
          }
        }, 10)
      } else {
        if (viewerCanvas.value?.renderAll) {
          viewerCanvas.value.renderAll()
        }
      }
    })

    viewerStore.resetRerenderTrigger()
  }
}, { deep: true })

const onUpdateAnnotation = (annotation: Annotation) => {
  openEditAnnotationDialog(annotation)
}

const onCreateUpdateAnnotation = async (annotation: Partial<Annotation>) => {
  if (!annotation || Object.keys(annotation).length === 0) {
    console.error('TSViewer: Received empty annotation!')
    return
  }

  // Validate required fields
  if (!annotation.layer_id) {
    console.error('TSViewer: annotation.layer_id is missing!', annotation)
    return
  }

  annotationWindowOpen.value = false

  try {
    if (annotation.id) {
      await updateAnnotation(annotation)
      onAnnotationUpdated()
    } else {
      await addAnnotation(annotation)
      onAnnotationCreated()
    }
  } catch (error) {
    console.error('TSViewer: Error creating/updating annotation:', error)

    // Re-open modal on error so user can retry
    annotationWindowOpen.value = true
  }
}

const onAnnotationUpdated = () => {
  viewerCanvas.value!.renderAnnotationCanvas()
}

const confirmDeleteAnnotation = (annotation: Annotation) => {
  annotationDelete.value = annotation
  isTsAnnotationDeleteDialogVisible.value = true
}

const deleteAnnotation = async (annotation: Annotation) => {
  isTsAnnotationDeleteDialogVisible.value = false
  try {
    await removeAnnotation(annotation)
    onAnnotationDeleted()
  } catch (error) {
    console.error('TSViewer: Error deleting annotation:', error)
  }
}

const onAnnotationDeleted = () => {
  viewerCanvas.value!.renderAnnotationCanvas()
}

const onAddAnnotation = (startTime: number, duration: number, allChannels: boolean, label: string, description: string, layer: AnnotationLayer) => {
  // Validate inputs
  if (!layer || !layer.id) {
    console.error('Invalid layer provided to onAddAnnotation:', layer)
    return
  }

  // Get selected channels
  const selectedChannels = viewerStore.viewerSelectedChannels || []
  const channelIds = allChannels ? [] : selectedChannels.map(ch => ch.id)

  // Create the annotation object with proper structure
  const annotation = {
    id: null,
    label: label || 'Event',
    description: description || '',
    start: Math.floor(startTime),
    end: Math.floor(startTime + duration),
    duration: Math.floor(duration),
    channelIds: channelIds,
    allChannels: allChannels,
    layer_id: layer.id,
    selected: true,
    userId: null
  }

  // Set the annotation in the store
  viewerStore.setActiveAnnotation(annotation as unknown as Annotation)

  // Open the modal
  annotationWindowOpen.value = true
}

const onAnnotationCreated = () => {
  viewerCanvas.value!.renderAnnotationCanvas()
}

const onCreateAnnotationLayer = (newLayer: { name: string; color: string; description?: string }) => {
  viewerCanvas.value!.createAnnotationLayer(newLayer)
}

const onCloseAnnotationLayerWindow = () => {
  annotationLayerWindowOpen.value = false
}

const onCloseAnnotationWindow = () => {
  viewerCanvas.value!.resetFocusedAnnotation()
  viewerCanvas.value!.renderAnnotationCanvas()
  annotationWindowOpen.value = false
}

const onCloseFilterWindow = () => {
  filterWindowOpen.value = false
}

// TODO(ts-phase4): tap is a custom gesture event with a nonstandard detail payload.
const onLabelTap = (e: any) => {
  e.stopPropagation()
  e.preventDefault()

  const append = e.detail.sourceEvent.metaKey
  selectChannel({ channelId: e.currentTarget.dataset.id, append: append })
  viewerCanvas.value!.renderAll()
}

const onNextAnnotation = () => {
  start.value = viewerCanvas.value!.getNextAnnotation()
}

const onPreviousAnnotation = () => {
  start.value = viewerCanvas.value!.getPreviousAnnotation()
}

const onUpdateDuration = (value: number) => {
  setDuration(value * 1e6)
}

const onIncrementZoom = () => {
  globalZoomMult.value = globalZoomMult.value * 1.25
}

const onDecrementZoom = () => {
  globalZoomMult.value = globalZoomMult.value * 0.8
}

const onAnnLayersInitialized = () => {
  scrubber.value!.getAnnotations()
}

const onChannelsInitialized = () => {
}

const onPageBack = () => {
  // Calculate new start position (go back by current duration)
  const newStart = Math.max(
    start.value - (3/4) * duration.value,
    ts_start.value!
  )

  updateStart(newStart)

  // Trigger re-render
  nextTick(() => {
    viewerCanvas.value?.renderAll()
  })
}

const onPageForward = () => {
  // Calculate new start position
  const newStart = Math.min(
    start.value + (3/4) * duration.value,
    ts_end.value! - duration.value
  )

  // Update start position
  updateStart(newStart)

  // Trigger re-render
  nextTick(() => {
    if (viewerCanvas.value?.renderAll) {
      viewerCanvas.value.renderAll()
    }
  })
}

const selectAnnotation = (payload: { annotation: Annotation }) => {
  let rsPeriod = viewerCanvas.value!.rsPeriod
  updateStart(payload.annotation.start - ((cursorLoc.value * cWidth.value - constants.CURSOROFFSET) * rsPeriod))

  // Trigger re-render
  nextTick(() => {
    viewerCanvas.value?.renderAll()
  })
}

const selectChannel = (payload: { channelId: string; append: boolean }) => {
  const _channels = viewerChannels.value.map(channel => {
    const selected = channel.selected

    if (payload.append === false) {
      channel.selected = false
    }

    if (payload.channelId === channel.id) {
      channel.selected = !selected
    }

    return channel
  })

  viewerStore.setChannels(_channels)
}

const selectChannels = (ids: string[], append: boolean) => {
  const channels = viewerChannels.value.map(channel => {
    if (append === false) {
      channel.selected = false
    }
    if (channel.id in ids) {
      channel.selected = true
    }
    return channel
  })

  viewerStore.setChannels(channels)
}

const updateStart = (value: number) => {
  start.value = value
}

const setCursor = (value: number) => {
  // set the cursor location as a fraction of the width of the canvas
  cursorLoc.value = value
}

const setGlobalZoom = (value: number) => {
  globalZoomMult.value = value
}

const setDuration = (value: number) => {
  if (value > maxDuration.value) {
    duration.value = maxDuration.value
  } else {
    duration.value = value
  }
}

const initTimeRange = () => {
  const channels = activeViewer.value?.channels

  if (channels && channels.length > 0) {
    // Find Global start and end from channel data
    ts_start.value = channels[0].start
    ts_end.value = channels[0].end

    for (let ic = 1; ic < channels.length; ic++) {
      if (channels[ic].start < ts_start.value) {
        ts_start.value = channels[ic].start
      }
      if (channels[ic].end > ts_end.value) {
        ts_end.value = channels[ic].end
      }
    }

    // Set the initial viewport to the actual data start time
    start.value = ts_start.value
  }
}

// In TSViewer.vue - replace the initChannels method

const initChannels = () => {
  initTimeRange()
}

const openLayerWindow = (payload?: unknown) => {
  annotationLayerWindowOpen.value = true
}

const openFilterWindow = (payload?: { channels?: unknown[]; filter?: { input0?: number | string; input1?: number | string } | null }) => {
  const channels = payload?.channels ?? []
  const filter = payload?.filter ?? null
  const filterWindowRef = filterWindow.value
  if (!filterWindowRef) return

  filterWindowRef.onChannels = channels

  if (filter && Object.keys(filter).length > 0) {
    filterWindowRef.input0 = filter.input0
    filterWindowRef.input1 = filter.input1
  } else {
    filterWindowRef.input0 = NaN
    filterWindowRef.input1 = NaN
    filterWindowRef.selectedFilter = null
    filterWindowRef.selectedNotch = null
  }
  filterWindowOpen.value = true
}

const setTimeseriesFilters = (payload: FilterPayload) => {
  viewerCanvas.value!.setFilters(payload)
}

const initCanvasRenderer = () => {
  viewerCanvas.value?.initViewerCanvas()
  viewerCanvas.value?.renderAll()
}

// Lifecycle hooks
// A package switch that crosses asset types swaps the transport; the id is in the
// key so re-activating a different package on the same backend reconnects too.
/**
 * Identifies the connection the active viewer needs. A string, not an object or
 * an array: a fresh array compares unequal on every evaluation, which would
 * reopen the transport each time the active viewer is reassigned with the same
 * package, discarding the loaded catalog and every cached segment.
 */
const transportKey = computed(() => {
  const content = activeViewer.value?.content
  return content?.id ? `${content.assetType ?? ''}|${content.id}` : null
})

watch(transportKey, (key) => {
  const content = activeViewer.value?.content
  if (key && content) {
    void openTransportFor(content)
  }
})

onMounted(() => {
  // Opened here rather than in setup so the tree exists first. Subscribers can
  // still arrive after the catalog is emitted, because the canvases are async
  // components; the transport replays the catalog to a late subscriber.
  const content = activeViewer.value?.content
  if (content?.id && !transport.value) {
    void openTransportFor(content)
  }

  initChannels()

  measureLayout()

  // A host can resize the viewer without the window resizing: a side panel opens, a pane
  // is dragged wider, a flex row reflows. Observing the root catches all of them.
  const element = ts_viewer.value
  if (element && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      void onResize()
    })
    resizeObserver.observe(element)
  } else {
    window.addEventListener('resize', onResize)
  }

  duration.value = constants.INITDURATION

  initCanvasRenderer()

})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', onResize)
  const openTransport = transport.value
  transport.value = null
  void openTransport?.close()
  // Clean up the store instance when the component is unmounted. This also
  // resets the store and disposes any zarr client held for this instance.
  clearViewerStore(props.instanceId)
})

// Expose methods that might be called from parent components
defineExpose({
  openEditAnnotationDialog,
  confirmDeleteAnnotation,
  selectAnnotation,
  selectChannel,
  selectChannels,
  openLayerWindow,
  openFilterWindow,
  setTimeseriesFilters
})
</script>

<style lang="scss" scoped>
@import'../../assets/tsviewerVariables.scss';

.timeseries-viewer {
  display: flex;
  height: 100%;
  flex-direction: column;

  &.preview {
    height: 600px;
    border: 2px solid $gray_3;
  }
}

#channelCanvas {
  display: flex;
  background-color: white;
  flex: 1;
  // This row keeps the height the column gives it. A taller child would push the
  // toolbar out of view instead of fitting inside the viewer.
  min-height: 0;
}
</style>