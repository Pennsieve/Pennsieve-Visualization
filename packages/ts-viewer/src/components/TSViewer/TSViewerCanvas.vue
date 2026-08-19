<template>
  <div class="timeseries-viewer-canvas">
    <div id="canvasWrapper">
      <TSPlotCanvas
        ref="plotCanvas"
        :c-width="cWidth"
        :c-height="cHeight"
        :start="start"
        :ts_start="tsStart"
        :ts_end="tsEnd"
        :duration="duration"
        :constants="constants"
        :rs-period="rsPeriod"
        :global-zoom-mult="globalZoomMult"
        :active-viewer="activeViewer"
        @channelsInitialized="channelsInitialized"
        @setGlobalZoom="setGlobalZoom"
      >
        <template #axisCanvas>
          <canvas
            id="axisArea"
            ref="axisArea"
            class="canvas"
            :width="_cpCanvasScaler(cWidth, pixelRatio, 0)"
            :height="_cpCanvasScaler(cHeight, pixelRatio, 0)"
            :style="canvasStyle1"
          />
        </template>

        <template #annCanvas>
          <canvas
            id="annArea"
            ref="annArea"
            class="canvas"
            :width="_cpCanvasScaler(cWidth, pixelRatio, 0)"
            :height="_cpCanvasScaler(pHeight, pixelRatio, 0)"
            :style="canvasStyle2"
          />
        </template>
      </TSPlotCanvas>

      <canvas
        id="cursorArea"
        ref="cursorArea"
        class="canvas"
        :width="_cpCanvasScaler(cWidth + 5, pixelRatio, 0)"
        :height="_cpCanvasScaler(cHeight, pixelRatio, 0)"
        :style="canvasStyle3"
      />

      <TimeseriesAnnotationCanvas
        ref="annCanvas"
        :c-width="cWidth"
        :c-height="cHeight"
        :constants="constants"
        :annotations-canvas="annArea"
        :pixel-ratio="pixelRatio"
        :rs-period="rsPeriod"
        :start="start"
        :duration="duration"
        :ts-end="tsEnd"
        :pointer-mode="pointerMode"
        :viewer-active-tool="viewerActiveTool"
        :active-viewer="activeViewer"
        @annLayersInitialized="onAnnLayersInitialized"
        @annotationsReceived="onAnnotationsReceived"
        @closeAnnotationLayerWindow="onCloseAnnotationLayerWindow"
        @updateAnnotation="onUpdateAnnotation"
      />

      <canvas
        id="iArea"
        ref="iArea"
        class="canvas"
        :width="_cpCanvasScaler(cWidth, pixelRatio, 0)"
        :height="_cpCanvasScaler(cHeight, pixelRatio, 0)"
        :style="canvasStyle1"
        tabindex="-1"
        @wheel="_onMouseWheel"
        @mousemove="_onMouseMove"
        @mousedown="_onMouseDown"
        @mouseup="_onMouseUp"
        @mouseout="_onMouseOut"
        @mouseenter="_onMouseEnter"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  nextTick,
  onMounted,
  defineAsyncComponent,
  inject
} from 'vue'
import { storeToRefs } from 'pinia'

import TSPlotCanvas from "@/components/TSViewer/TSPlotCanvas.vue"
import { drawAxis } from '@/rendering/axisRenderer'
import { drawCursor } from '@/rendering/cursorRenderer'
import { buildFilterMessage, parseFilterInputs } from '@/filters/filterState'
import type { FilterPayload } from '@/filters/filterState'
import { useCanvasTools } from '@/interaction/useCanvasTools'
import type { AnnotationCanvasTools } from '@/interaction/useCanvasTools'
import { createThrottle } from '@/utils/throttle'
import type { Throttled } from '@/utils/throttle'
import { createViewerStore } from "../../stores/tsviewer"
import type { ActiveViewer } from "../../stores/tsviewer"
import type { RendererConstants } from '@/composables/useCanvasRenderer'
import type { Annotation, AnnotationLayer } from '@/utils/annotationUtils'

// Import TimeseriesAnnotationCanvas properly
const TimeseriesAnnotationCanvas = defineAsyncComponent(() =>
  import('@/components/TSViewer/TSAnnotationCanvas.vue')
)

/** Keys of the viewer constants object this component and the canvases it hosts read. */
interface ViewerCanvasConstants extends RendererConstants {
  CURSOROFFSET: number
  XGRIDSPACING: number
  NRPXPERLABEL: number
  PAGESIZEDIVIDER: number
  ANNOTATIONLABELHEIGHT: number
  PREFETCHPAGES: number
  LIMITANNFETCH: number
}

/** Layer-creation payload; matches the NewLayer shape TSAnnotationCanvas exposes. */
interface NewAnnotationLayer {
  name: string
  color: string
  description?: string
}

/** The TSAnnotationCanvas members this component and its tools call through the template ref. */
interface AnnotationCanvasHandle extends AnnotationCanvasTools {
  render: () => void
  resetFocusedAnnotation: () => void
  createAnnotationLayer: (newLayer: NewAnnotationLayer) => void
  findNextAnnotation: (curTime: number) => Annotation | null
  findPreviousAnnotation: (curTime: number) => Annotation | null
}

interface Props {
  windowHeight?: number
  windowWidth?: number
  duration: number
  start: number
  cHeight: number
  cWidth: number
  globalZoomMult: number
  constants: ViewerCanvasConstants
  tsStart: number | null
  tsEnd: number | null
  cursorLoc: number
  activeViewer: ActiveViewer
}

// Define props
const props = defineProps<Props>()

// Define emits
const emit = defineEmits<{
  (e: 'setDuration', value: number): void
  (e: 'setGlobalZoom', value: number): void
  (e: 'setStart', value: number): void
  (e: 'addAnnotation', startTime: number, duration: number, allChannels: boolean, label: string, description: string, layer: AnnotationLayer): void
  (e: 'updateAnnotation', annotation: Annotation): void
  (e: 'closeAnnotationLayerWindow'): void
  (e: 'channelsInitialized'): void
  (e: 'annLayersInitialized'): void
}>()

// Store setup - inject from parent TSViewer component
// Falls back to default store for backwards compatibility
const viewerStore = inject('viewerStore', () => createViewerStore('default'), true)
const { viewerChannels, viewerAnnotations, viewerActiveTool } = storeToRefs(viewerStore)

// Template refs
const plotCanvas = ref<InstanceType<typeof TSPlotCanvas> | null>(null)
const axisArea = ref<HTMLCanvasElement | null>(null)
const annArea = ref<HTMLCanvasElement | null>(null)
const cursorArea = ref<HTMLCanvasElement | null>(null)
const annCanvas = ref<AnnotationCanvasHandle | null>(null)
const iArea = ref<HTMLCanvasElement | null>(null)

// Reactive data
const rsPeriod = ref(0)
const pageSize = ref(0)
const lastrRsUpdate = ref(0)
const pixelRatio = ref(1)

// Throttled render, rebuilt when a caller asks for different throttle settings.
let renderFnc: Throttled<[], void> | null = null
let renderThrottle = 0
let requestLeadingEdge = true

// Template-scope alias for the tsEnd prop: TSAnnotationCanvas declares its tsEnd prop as
// number | undefined, so the null this prop can hold before the time range is known is
// passed through under a non-null assertion. The value itself is unchanged.
const tsEnd = computed(() => props.tsEnd!)

// Computed properties
const nrVisibleChannels = computed(() => {
  return viewerChannels.value.filter(channel => channel.visible).length
})

const pHeight = computed(() => props.cHeight - 20)

const cursorWidth = computed(() => props.cWidth + props.constants['CURSOROFFSET'])

const canvasStyle1 = computed(() => ({
  width: props.cWidth + 'px',
  height: props.cHeight + 'px'
}))

const canvasStyle2 = computed(() => ({
  width: props.cWidth + 'px',
  height: pHeight.value + 'px'
}))

const canvasStyle3 = computed(() => ({
  width: cursorWidth.value + 'px',
  height: props.cHeight + 'px'
}))

// Tool interaction state and handlers. The template binds the DOM events to them.
const {
  pointerMode,
  setActiveTool,
  ensureActiveAnnotationLayer,
  clearInteractionCanvas,
  onMouseDown: _onMouseDown,
  onMouseMove: _onMouseMove,
  onMouseUp: _onMouseUp,
  onMouseOut: _onMouseOut,
  onMouseEnter: _onMouseEnter
} = useCanvasTools({
  store: viewerStore,
  interactionCanvas: () => iArea.value,
  annotationCanvas: () => annCanvas.value,
  viewport: () => ({
    start: props.start,
    cWidth: props.cWidth,
    cHeight: props.cHeight,
    pHeight: pHeight.value,
    rsPeriod: rsPeriod.value,
    pixelRatio: pixelRatio.value,
    annotationLabelHeight: props.constants['ANNOTATIONLABELHEIGHT']
  }),
  renderAll: (delay, requestLeadingEdgeParam) => renderAll(delay, requestLeadingEdgeParam),
  setStart: (start) => emit('setStart', start),
  addAnnotation: (startTime, duration, allChannels, label, description, layer) =>
    emit('addAnnotation', startTime, duration, allChannels, label, description, layer)
})

// Watchers
watch(() => props.cHeight, () => {
  resize()
})

watch(() => props.cWidth, () => {
  resize()
})

watch(() => props.start, () => {
  renderAll()
})

watch(() => props.duration, () => {
  plotCanvas.value?.invalidate()
  updateRsPeriod(props.cWidth, props.duration)
  renderAll()
})

watch(() => props.globalZoomMult, () => {
  nextTick(() => {
    plotCanvas.value?.throttledDataRender()
  })
})

// Watch for annotation layers being loaded
watch(viewerAnnotations, (annotations) => {
  if (annotations.length > 0 && viewerActiveTool.value === 'annotate') {
    // Ensure we have an active layer when layers become available
    ensureActiveAnnotationLayer()
  }
}, { immediate: true })

watch(pointerMode, () => {
  const iAreaEl = iArea.value
  if (!iAreaEl) return

  iAreaEl.removeAttribute('col_resize')
  iAreaEl.removeAttribute('active')
  iAreaEl.removeAttribute('point')

  switch (pointerMode.value) {
    case 'cursor_hover':
      iAreaEl.removeAttribute('point')
      iAreaEl.setAttribute('cursor_hover', 'true')
      break
    case 'annResize-left':
    case 'annResize-right':
      iAreaEl.setAttribute('col_resize', 'true')
      break
    case 'annSelect':
      iAreaEl.setAttribute('active', 'true')
      break
    case 'pan':
      break
    case 'pointer':
    case 'annotate':
      iAreaEl.setAttribute('point', 'true')
      break
    default:
      iAreaEl.removeAttribute('point')
      iAreaEl.removeAttribute('cursor_hover')
      break
  }

  nextTick(() => {
    renderAnnotationCanvas()
  })
})

// Methods
const resetFocusedAnnotation = () => {
  annCanvas.value?.resetFocusedAnnotation()
}

const createAnnotationLayer = (newLayer: NewAnnotationLayer) => {
  annCanvas.value?.createAnnotationLayer(newLayer)
}

const getNextAnnotation = (): number => {
  let cursorOffset = (props.cursorLoc * props.cWidth - props.constants['CURSOROFFSET']) * rsPeriod.value
  let nextAnn = annCanvas.value?.findNextAnnotation(props.start + cursorOffset)
  return nextAnn!.start - cursorOffset
}

const getPreviousAnnotation = (): number => {
  let cursorOffset = (props.cursorLoc * props.cWidth - props.constants['CURSOROFFSET']) * rsPeriod.value
  let nextAnn = annCanvas.value?.findPreviousAnnotation(props.start + cursorOffset)
  return nextAnn!.start - cursorOffset
}

const onUpdateAnnotation = (annotation: Annotation) => {
  emit('updateAnnotation', annotation)
}

const onCloseAnnotationLayerWindow = () => {
  emit('closeAnnotationLayerWindow')
}

const onAnnotationsReceived = () => {
  renderAll(100)
}

const onAnnLayersInitialized = () => {
  // Ensure we have an active layer when layers are initialized
  if (viewerActiveTool.value === 'annotate') {
    ensureActiveAnnotationLayer()
  }
  emit('annLayersInitialized')
}

const setGlobalZoom = (value: number) => {
  emit('setGlobalZoom', value)
}

const channelsInitialized = () => {
  emit('channelsInitialized')
}

const _onMouseWheel = (e: WheelEvent) => {
  e.stopPropagation()
  e.preventDefault()

  if (e.shiftKey) {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      if (e.deltaY > 0) {
        emit('setDuration', props.duration * 1.1)
      } else {
        emit('setDuration', props.duration / 1.1)
      }
    }
  } else {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      if (e.deltaY > 0) {
        emit('setGlobalZoom', props.globalZoomMult * 1.2)
      } else {
        emit('setGlobalZoom', props.globalZoomMult / 1.2)
      }
    }
  }
}

const resize = () => {
  updateRsPeriod(props.cWidth, props.duration)
  renderAll(25)
}

const updateRsPeriod = (w: number, d: number) => {
  const oldRs = rsPeriod.value
  const newPeriod = d / w
  if (newPeriod !== oldRs) {
    lastrRsUpdate.value = Date.now()
    rsPeriod.value = newPeriod
    pageSize.value = Math.floor(d / props.constants['PAGESIZEDIVIDER'])
  }
}

const _cpCanvasScaler = (sz: number, pixelRatio: number, offset: number) => {
  return pixelRatio * (sz + offset)
}

const renderAll = (delay = 0, requestLeadingEdgeParam = true) => {
  if (!renderFnc || delay !== renderThrottle || requestLeadingEdge !== requestLeadingEdgeParam) {
    renderFnc = createThrottle(_renderAll, delay, { leading: requestLeadingEdgeParam })
    renderThrottle = delay
    requestLeadingEdge = requestLeadingEdgeParam
  }
  renderFnc()
}

const renderAnnotationCanvas = () => {
  clearInteractionCanvas()
  annCanvas.value?.render()
}

const _renderAll = () => {
  nextTick(() => {
    _renderAxis()
    _renderCursor()
    plotCanvas.value?.renderAll()
    annCanvas.value?.render()
  })
}

const _renderAxis = () => {
  const pa = axisArea.value!
  const ctx = pa.getContext('2d')!
  drawAxis(ctx, {
    viewport: {
      start: props.start,
      duration: props.duration,
      tsEnd: props.tsEnd!,
      rsPeriod: rsPeriod.value,
      cWidth: props.cWidth,
      cHeight: props.cHeight,
      pHeight: pHeight.value,
      nrVisibleChannels: nrVisibleChannels.value
    },
    constants: props.constants,
    pixelRatio: pixelRatio.value
  })
}

const _renderCursor = () => {
  const pa = cursorArea.value!
  const ctx = pa.getContext('2d')!
  drawCursor(ctx, {
    cursorLoc: props.cursorLoc,
    cWidth: props.cWidth,
    cHeight: props.cHeight,
    pHeight: pHeight.value,
    cursorOffset: props.constants['CURSOROFFSET'],
    pixelRatio: pixelRatio.value
  })
}

const initViewerCanvas = () => {
  plotCanvas.value?.initPlotCanvas()
}

const getScreenPixelRatio = () => {
  // TODO(ts-phase4): the backing-store ratio fields are nonstandard and untyped.
  let ctx = iArea.value!.getContext('2d') as any
  let dpr = window.devicePixelRatio || 1
  let bsr = ctx.webkitBackingStorePixelRatio ||
    ctx.mozBackingStorePixelRatio ||
    ctx.msBackingStorePixelRatio ||
    ctx.oBackingStorePixelRatio ||
    ctx.backingStorePixelRatio || 1

  return dpr / bsr
}

const setFilters = (payload: FilterPayload) => {
  const message = buildFilterMessage(payload)
  if (!message) {
    return
  }

  plotCanvas.value?.sendFilterMessage(message)

  const { input0, input1 } = parseFilterInputs(payload)

  for (let i = 0; i < payload.selChannels.length; i++) {
    let channelId = payload.selChannels[i]
    let channel = viewerChannels.value.find(ch => ch.id === channelId)

    // An id with no channel row would throw below and skip the invalidate that
    // refetches the filtered signal.
    if (!channel) {
      continue
    }

    if (payload.filterType === 'clear') {
      channel.filter = {}
    } else {
      channel.filter = {
        type: payload.filterType,
        input0: input0,
        input1: input1,
        notchFreq: payload.notchFreq
      }
    }
  }

  plotCanvas.value?.invalidate()
  renderAll()
}

// Lifecycle
onMounted(() => {
  pixelRatio.value = getScreenPixelRatio()
})

// Expose methods that might be called from parent components
defineExpose({
  rsPeriod,

  resetFocusedAnnotation,
  createAnnotationLayer,
  getNextAnnotation,
  getPreviousAnnotation,
  setFilters,
  setActiveTool,
  renderAll,
  renderAnnotationCanvas,
  initViewerCanvas
})
</script>

<style lang="scss" scoped>
@import '../../assets/tsviewerVariables.scss';

.timeseries-viewer-canvas {
  display: flex;
  background-color: white;
  flex: 1;
}

#canvasWrapper {
  position: relative;
}

#channelCanvas {
  display: flex;
}

.canvas {
  position: absolute;
  top: 0;
  left: 0;
  margin-left: 5px;
  cursor: ew-resize;
  outline: none;
}

.canvas[active] {
  cursor: pointer;
}

.canvas[col_resize] {
  cursor: col-resize;
}

.canvas[point] {
  cursor: default;
}

.canvas[cursor_hover] {
  cursor: col-resize;
}

#cursorArea {
  margin-left: 0;
}

#annotationPopover {
  position: absolute;
  opacity: 0;
  display: none;
  top: 75px;
  z-index: 1000;
  left: 400px;
}
</style>