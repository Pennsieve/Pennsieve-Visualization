<template>
  <div class="timeseries-scrubber">
    <div class="dateWrap">
      <div>{{ ts_start_str }}</div>
      <div>{{ fullDateStr }}</div>
      <div>{{ ts_end_str }}</div>
    </div>
    <div class="noselect">
      <div id="scrubber" noselect>
        <div id="canvasWrap" ref="canvasWrap">
          <canvas id="segmentsCanvas" class="canvas" ref="segmentsCanvas"
                  :width="_cpCanvasScaler(cWidth, pixelRatio, 0)"
                  :height="_cpCanvasScaler(viewportHeight - 2, pixelRatio, 0)"
                  :style="canvasStyle"></canvas>
          <canvas id="annotationCanvas" class="canvas" ref="annotationCanvas"
                  :width="_cpCanvasScaler(cWidth, pixelRatio, 0)"
                  :height="_cpCanvasScaler(viewportHeight - 2, pixelRatio, 0)"
                  :style="canvasStyle"></canvas>
          <canvas id="iCanvas" class="canvas" ref="iCanvas"
                  :width="_cpCanvasScaler(cWidth, pixelRatio, 0)"
                  :height="_cpCanvasScaler(viewportHeight, pixelRatio, 0)"
                  @mousemove="_onMouseMove"
                  @mousedown="_onMouseDown"
                  @mouseup="_onMouseUp"
                  @mouseenter="_onMouseEnter"
                  @mouseout="_onMouseOut"
                  :style="iCanvasStyle"></canvas>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, inject } from 'vue'
import { createViewerStore } from '../../stores/tsviewer'
import type { ActiveViewer, ViewerChannel } from '../../stores/tsviewer'
import { useToken } from "@/composables/useToken"
import { useHandleXhrError, useSendXhr } from "@/mixins/request/request_composable"
import { useViewerTransport } from "@/state/viewerTransportContext"

/** Viewer constants TSViewer passes whole. The transport owns the segment-span walk. */
interface ScrubberConstants {
  SEGMENTSPAN: number
  MAXRECURSION: number
}

interface Props {
  /** Recording start in microseconds; null until the channel list is known. */
  ts_start: number | null
  /** Recording end in microseconds; null until the channel list is known. */
  ts_end: number | null
  cWidth: number
  constants: ScrubberConstants
  start: number
  duration: number
  cursorLoc: number
  labelWidth: number
  activeViewer: ActiveViewer
}

// Props
const props = defineProps<Props>()

// Emits
const emit = defineEmits<{
  (e: 'setStart', value: number): void
}>()

// Store - inject from parent TSViewer component
// Falls back to default store for backwards compatibility
const viewerStore = inject('viewerStore', () => createViewerStore('default'), true)

// Availability spans come from whichever transport TSViewer opened.
const transport = useViewerTransport()

// Template refs
const canvasWrap = ref<HTMLDivElement | null>(null)
const segmentsCanvas = ref<HTMLCanvasElement | null>(null)
const annotationCanvas = ref<HTMLCanvasElement | null>(null)
const iCanvas = ref<HTMLCanvasElement | null>(null)

// Reactive data
const pixelRatio = ref(1)
const scrubberHeight = ref(28)
const viewportHeight = ref(30)
const mouseDown = ref(false)
const hoverTxt = ref('')
const pointerMode = ref('point')
const patternCnvs = ref<HTMLCanvasElement | null>(null)
// TODO(ts-phase4): holds the annotation-window response, an object keyed by layer id.
const annotations = ref<any>([])
const segmentSpans = ref<number[]>([])
const segments = ref<number[]>([])
const isInitializing = ref(false)
// Additional mouse tracking data
const clickX = ref(0)
const startDragTime = ref(0)
const cStart = ref(0)
const cDuration = ref(0)

// Computed properties
const ts_start_str = computed(() => {
  return getUTCTimeString(props.ts_start)
})

const ts_end_str = computed(() => {
  return getUTCTimeString(props.ts_end)
})

const fullDateStr = computed(() => {
  if (hoverTxt.value !== '') {
    return hoverTxt.value
  } else if (props.start > 0) {
    const d = new Date(props.start / 1000).toUTCString()
    return d.substring(0, d.length - 3)
  }
  return ''
})

const canvasStyle = computed(() => {
  return {
    width: props.labelWidth + props.cWidth - 8 + 5 + 'px',
    height: '28px'
  }
})

const iCanvasStyle = computed(() => {
  return {
    width: props.labelWidth + props.cWidth - 8 + 5 + 'px',
    height: '30px'
  }
})

const scrubberCWidth = computed(() => {
  return props.cWidth + props.labelWidth - 8 + 5
})

const period = computed(() => {
  return Math.floor((props.ts_end! - props.ts_start!) / props.cWidth)
})

// Watchers
watch(() => props.start, () => {
  render()
})

watch(() => props.duration, () => {
  render()
})

watch(() => props.cWidth, () => {
  render()
})

// Watch for changes in activeViewer (package switching)
watch(() => props.activeViewer, (newViewer, oldViewer) => {
  if (newViewer && newViewer !== oldViewer) {
    isInitializing.value = true
    resetComponentState()

    // Re-initialize if we have valid data
    if (newViewer.content?.id) {
      nextTick(() => {
        // Only fetch annotations immediately (doesn't need channels)
        getAnnotations()

        // Wait for channels to be populated before initializing segments
        // This will be handled by the viewerChannels watcher
        isInitializing.value = false
      })
    } else {
      isInitializing.value = false
    }
  }
}, { deep: true })

// Watch for changes in viewer channels (only if not currently initializing)
watch(() => viewerStore.viewerChannels, (newChannels, oldChannels) => {
  if (newChannels && newChannels.length > 0 && !isInitializing.value) {
    // Check if this is a significant change (different count or package switch)
    const hasSignificantChange = !oldChannels ||
      newChannels.length !== oldChannels.length ||
      (newChannels[0]?.id !== oldChannels[0]?.id)

    if (hasSignificantChange) {
      resetSegmentState()
      nextTick(() => {
        initSegmentSpans()
      })
    }
  }
}, { deep: true })

// Annotation rendering stamps per-frame geometry (cStart, cEnd, allOffsets) onto
// the store's annotation objects, so a deep watch refetches the annotation window
// on every repaint. The fingerprint tracks only the fields that change when a
// layer or an annotation is created, edited, or deleted.
const annotationFingerprint = computed(() =>
  viewerStore.viewerAnnotations.map(layer =>
    `${layer.id}:${layer.visible}:${layer.color}:` +
    (layer.annotations ?? []).map(a => `${a.id},${a.start},${a.duration}`).join(';')
  ).join('|')
)

watch(annotationFingerprint, () => {
  if (!isInitializing.value) {
    nextTick(() => {
      getAnnotations()
    })
  }
})

// Helper methods for state management
const resetComponentState = () => {
  // Reset annotation data
  annotations.value = []

  // Reset segment data
  resetSegmentState()

  // Reset mouse/interaction state
  mouseDown.value = false
  hoverTxt.value = ''
  pointerMode.value = 'point'

  // Clear any existing renders
  clearCanvases()
}

/**
 * Cancels the availability scan in flight, if any.
 *
 * One controller covers every channel of a scan, because they are one logical pass over
 * the recording. A scan left running holds its share of each read it makes, and the
 * deduping store cannot cancel a read while any caller still wants it.
 */
let spanAbort: AbortController | null = null

const abortSegmentSpans = () => {
  spanAbort?.abort()
  spanAbort = null
}

const resetSegmentState = () => {
  abortSegmentSpans()

  // Reset segments array
  segments.value = new Array(5000)
  segments.value = segments.value.fill(0, 0, 4999)

  // Reset segment spans
  segmentSpans.value = []
}

const clearCanvases = () => {
  // Clear all canvases
  nextTick(() => {
    const canvases = [segmentsCanvas.value, annotationCanvas.value, iCanvas.value]
    canvases.forEach(canvas => {
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
        }
      }
    })
  })
}
const _cpCanvasScaler = (sz: number, pixelRatio: number, offset: number) => {
  return pixelRatio * (sz + offset)
}

const getScreenPixelRatio = () => {
  // TODO(ts-phase4): the backing-store ratio fields are nonstandard and untyped.
  const ctx = iCanvas.value!.getContext('2d') as any
  const dpr = window.devicePixelRatio || 1
  const bsr = ctx.webkitBackingStorePixelRatio ||
    ctx.mozBackingStorePixelRatio ||
    ctx.msBackingStorePixelRatio ||
    ctx.oBackingStorePixelRatio ||
    ctx.backingStorePixelRatio || 1

  return dpr / bsr
}

// TODO(ts-phase4): the parameter starts as microseconds and is reassigned to a Date.
const getUTCTimeString = (d: any) => {
  if (d > 0) {
    d = d / 1000
    d = new Date(d)
    return (('0' + d.getUTCHours()).slice(-2) + ':' +
      ('0' + d.getUTCMinutes()).slice(-2) + ':' + ('0' + d.getUTCSeconds()).slice(-2))
  }
}

// TODO(ts-phase4): the parameter starts as microseconds and is reassigned to a Date.
const getUTCDateString = (d: any, s: string, c?: unknown) => {
  if (s !== '') {
    return s
  } else if (d > 0) {
    d = new Date(d / 1000)
    return d.toDateString()
  }
}

// Mouse Interactions
const _onMouseMove = (e: MouseEvent) => {
  if (!mouseDown.value) {
    const cCoord = iCanvas.value!.getBoundingClientRect()
    const cHoverOffset = e.clientX - cCoord.left
    const cEnd = cStart.value + cDuration.value
    const oldMode = pointerMode.value
    const inResizeArea = cHoverOffset > cStart.value - 10 && cHoverOffset < cEnd + 10

    if (inResizeArea) {
      pointerMode.value = 'drag'
      iCanvas.value!.setAttribute('dragme', 'true')
      iCanvas.value!.removeAttribute('resizeme')
    } else {
      pointerMode.value = 'point'
      iCanvas.value!.removeAttribute('dragme')
      iCanvas.value!.removeAttribute('resizeme')
    }

    // Update hoverTxt
    const realStart = ((cHoverOffset) / props.cWidth) * (props.ts_end! - props.ts_start!) + props.ts_start!
    const d = new Date(realStart / 1000).toUTCString()
    hoverTxt.value = d.substring(0, d.length - 3)

    if (oldMode !== pointerMode.value) {
      render()
    }
  } else {
    // is Dragging
    const _dx = e.clientX - clickX.value
    const realStart = ((_dx) / props.cWidth) * (props.ts_end! - props.ts_start!)
    const setStart = startDragTime.value + realStart
    emit('setStart', setStart)
    const d = new Date((realStart + props.ts_start!) / 1000)
    hoverTxt.value = d.toUTCString()
  }
}

const _onMouseUp = () => {
  mouseDown.value = false
}

const _onMouseDown = (e: MouseEvent) => {
  mouseDown.value = true
  const cCoord = iCanvas.value!.getBoundingClientRect()
  const cClickOffset = e.clientX - cCoord.left
  clickX.value = e.clientX


  const realStart = (cClickOffset / scrubberCWidth.value) * (props.ts_end! - props.ts_start!)
  emit('setStart', realStart + props.ts_start!)
  startDragTime.value = realStart + props.ts_start!
}

const _onMouseEnter = () => {
  mouseDown.value = false
}

const _onMouseOut = () => {
  hoverTxt.value = ''
}

// Annotation Functions
const pageInGap = (startEpoch: unknown, pageSize: unknown) => {
  // Implementation needed
}

const initSegmentSpans = () => {
  // Validate that we have the required data before making API calls
  if (!viewerStore.viewerChannels || viewerStore.viewerChannels.length === 0) {
    console.warn('TSScrubber: Cannot init segment spans - no viewer channels available')
    return
  }

  if (!props.ts_start || !props.ts_end) {
    console.warn('TSScrubber: Cannot init segment spans - invalid time range')
    return
  }

  if (!transport.value) {
    console.warn('TSScrubber: Cannot init segment spans - transport not ready')
    return
  }

  // Reset segment state before fetching new data
  resetSegmentState()
  const controller = new AbortController()
  spanAbort = controller

  void scanSegmentSpans(viewerStore.viewerChannels.map((channel) => channel.id), controller)
}

/** One channel's answer to a scan, held until every channel has answered. */
interface ChannelSpans {
  channel: string
  channelIdx: number
  spans: Array<[number, number]>
}

/**
 * One availability scan: every channel's spans are fetched, then applied in one pass.
 *
 * Applying each answer as it arrived filled the bitmap, walked it for the global spans,
 * wrote a row in the store, and drew the hatch once per channel. The store's deep
 * watchers ran once per write, and at a hundred channels the scan cost a hundred
 * traversals and a hundred draws for one picture. The single pass writes every row in
 * one synchronous sweep, so the watchers run once, and draws once. A scan the reset
 * aborted applies nothing.
 */
const scanSegmentSpans = async (channelIds: string[], controller: AbortController) => {
  const answers = await Promise.all(
    channelIds.map((channel, index) => fetchSegmentSpan(channel, index, controller.signal))
  )
  if (controller.signal.aborted) {
    return
  }
  const answered = answers.filter((answer): answer is ChannelSpans => answer !== null)
  if (answered.length === 0) {
    return
  }
  for (const answer of answered) {
    applySegmentSpan(answer)
  }
  recomputeSegmentSpans()
  renderSegments()
}

/**
 * Availability spans for one channel, from wherever the transport reads them.
 *
 * One call covers `ts_start` to `ts_end`; the transport chunks that range itself.
 *
 * `gapThresholdUs` is one cell of the scrubber's own 5000-cell bitmap: a gap narrower than a
 * cell cannot be drawn, so coalescing at that width matches what is actually rendered.
 *
 * Resolves null for a channel that could not be read; the scan goes on without it.
 */
const fetchSegmentSpan = async (channel: string, channelIdx: number, signal: AbortSignal): Promise<ChannelSpans | null> => {
  const activeTransport = transport.value
  if (!activeTransport) {
    console.warn('TSScrubber: transport not ready, skipping segment spans')
    return null
  }

  if (!channel) {
    console.warn('TSScrubber: Cannot request segment span - no channel ID provided')
    return null
  }

  const span = props.ts_end! - props.ts_start!
  const gapThresholdUs = Math.max(1, Math.floor(span / 5000))

  try {
    // Unit channels and montage lead resolution are the transport's business; it
    // answers a unit channel with no spans rather than throwing.
    const spans = await activeTransport.dataSpans({
      channel,
      startUs: props.ts_start!,
      endUs: props.ts_end!,
      gapThresholdUs,
      signal
    })
    return { channel, channelIdx, spans }
  } catch (err) {
    // An abandoned scan is expected: the channel set changed, or the component went away.
    if (signal.aborted) {
      return null
    }
    console.error(`TSScrubber: Error fetching segments for channel ${channel}:`, err)
    useHandleXhrError(err)
    return null
  }
}

/** Marks one channel's spans in the bitmap and records them on the channel's row. */
const applySegmentSpan = ({ channel, channelIdx, spans }: ChannelSpans) => {
  // Validate that we still have the same channels (user might have switched packages)
  const chConfig = viewerStore.viewerChannels[channelIdx] as (ViewerChannel & { dataSegments: number[] }) | undefined
  if (!chConfig || chConfig.id !== channel) {
    console.warn('TSScrubber: Channel mismatch detected, ignoring segment response (likely package switched)')
    return
  }

  const range = props.ts_end! - props.ts_start!
  const vector: number[] = new Array(spans.length * 2)
  for (let j = 0; j < spans.length; j++) {
    vector[2 * j] = spans[j][0]
    vector[2 * j + 1] = spans[j][1]

    const pxStart = Math.floor(((spans[j][0] - props.ts_start!) / range) * 5000)
    const pxEnd = Math.ceil(((spans[j][1] - props.ts_start!) / range) * 5000)
    segments.value.fill(1, pxStart, pxEnd)
  }

  // remove first value if there is overlap with what a previous init stored
  if (vector[0] < chConfig.dataSegments[chConfig.dataSegments.length - 1]) {
    vector.shift()
    vector.shift()
  }

  chConfig.dataSegments = chConfig.dataSegments.concat(vector.sort((a, b) => a - b))
  viewerStore.updateChannelProperty(chConfig.id, 'dataSegments', chConfig.dataSegments)
}

/** Derives the global spans, as bitmap cell pairs closed by 5000, from the bitmap. */
const recomputeSegmentSpans = () => {
  const spans: number[] = []
  let ii = 0
  let inSegment = false
  let startSegment = 0
  while (ii < (segments.value.length - 1)) {
    if (!segments.value[ii] && !inSegment) {
      ii++
      continue
    } else if (!segments.value[ii]) {
      // create segment
      spans.push(startSegment, ii)
      inSegment = false
    } else if (!inSegment) {
      startSegment = ii
      inSegment = true
    }
    ii++
  }

  if (inSegment) {
    spans.push(startSegment, ii)
  }
  spans.push(5000)
  segmentSpans.value = spans
}

const getAnnotations = async () => {
  // Store the viewer ID at the start to check consistency later
  const currentViewerId = props.activeViewer?.content!.id

  // Validate that we have the required data before making API call
  if (!currentViewerId) {
    console.warn('TSScrubber: Cannot get annotations - no active viewer ID')
    annotations.value = []
    return
  }

  if (!viewerStore.config?.apiUrl) {
    console.warn('TSScrubber: Cannot get annotations - no API URL configured')
    annotations.value = []
    return
  }

  if (!viewerStore.viewerAnnotations || viewerStore.viewerAnnotations.length === 0) {
    annotations.value = []
    render()
    return
  }

  try {
    const token = await useToken()
    const layerIds = viewerStore.viewerAnnotations.map(obj => obj.id)
    const endTime = props.ts_end
    const baseUrl = `${viewerStore.config.apiUrl}/timeseries/${currentViewerId}/annotations/window`
    let url = baseUrl + `?api_key=${token}&aggregation=count&start=${props.ts_start}&end=${props.ts_end}&period=${period.value}&mergePeriods=true`

    for (let i in layerIds) {
      url = url + `&layerIds=${layerIds[i as unknown as number]}`
    }

    const resp = await useSendXhr(url)

    // Double-check that we're still on the same viewer (async operations can be overtaken)
    if (props.activeViewer?.content!.id === currentViewerId) {
      annotations.value = resp
      render()
    }
  } catch (err) {
    console.error('TSScrubber: Error fetching annotations:', err)
    annotations.value = []
    useHandleXhrError(err)
    render() // Still render even if annotations failed
  }
}

// Render Functions
const render = () => {
  renderViewPort()
  renderTimelimeLine()
  renderSegments()
}

const renderViewPort = () => {
  nextTick(() => {
    const canvas = iCanvas.value
    if (!canvas) {
      console.warn('iCanvas ref is missing, skipping render')
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      console.warn('2D context is not available')
      return
    }
    ctx.setTransform(pixelRatio.value, 0, 0, pixelRatio.value, 0, 0)
    ctx.clearRect(0, 0, props.cWidth, viewportHeight.value)

    cStart.value = (((props.start - props.ts_start!) / (props.ts_end! - props.ts_start!)) * props.cWidth + 0.5) | 0
    cDuration.value = (((props.duration) / (props.ts_end! - props.ts_start!)) * props.cWidth + 0.5) | 0

    // Viewport
    ctx.fillStyle = 'rgb(80,80,80)'
    ctx.strokeStyle = 'rgb(80,80,80)'
    ctx.strokeRect(cStart.value + 0.5, 0.5, cDuration.value, viewportHeight.value - 1)

    ctx.fillRect(cStart.value - 2, (viewportHeight.value / 2 - 5) | 0, 2, 10)
    ctx.fillRect(cStart.value + cDuration.value + 1, (viewportHeight.value / 2 - 5) | 0, 2, 10)

    // Cursor
    const cursorCLoc = cStart.value + (props.cursorLoc * cDuration.value)
    if (cursorCLoc > (cStart.value + 0.5)) {
      ctx.strokeStyle = 'red'
      ctx.beginPath()
      ctx.moveTo(cursorCLoc, 0)
      ctx.lineTo(cursorCLoc, viewportHeight.value - 1)
      ctx.stroke()
    }
  })
}

const renderSegments = () => {
  nextTick(() => {
    const canvas = segmentsCanvas.value
    if (!canvas) {
      console.warn('segmentsCanvas ref is missing, skipping renderSegments')
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      console.warn('Unable to get 2D context for segmentsCanvas, skipping renderSegments')
      return
    }
    ctx.setTransform(pixelRatio.value, 0, 0, pixelRatio.value, 0, 0)
    ctx.fillStyle = ctx.createPattern(patternCnvs.value!, 'repeat')!
    ctx.clearRect(0, 0, props.cWidth, viewportHeight.value)

    for (let i = 1; i < segmentSpans.value.length; i += 2) {
      const xStart = (props.cWidth * segmentSpans.value[i]) / 5000
      const xEnd = (props.cWidth * segmentSpans.value[i + 1]) / 5000
      ctx.fillRect(xStart, 2, xEnd - xStart, viewportHeight.value - 6)
    }
  })
}

const renderTimelimeLine = () => {
  const canvas = annotationCanvas.value
  if (!canvas) {
    console.warn('annotationCanvas ref is missing, skipping renderTimelimeLine')
    return
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    console.warn('Unable to get 2D context for annotationCanvas, skipping renderTimelimeLine')
    return
  }
  ctx.setTransform(pixelRatio.value, 0, 0, pixelRatio.value, 0, 0)

  ctx.clearRect(0, 0, props.cWidth, scrubberHeight.value)
  const xStart = props.ts_start!
  const xEnd = props.ts_end!

  const annotationLayers = annotations.value
  let annotationIndex = 0

  const layerSpacing = 0
  const layerHeight = Math.floor(((scrubberHeight.value - 2) / Object.keys(annotationLayers).length - layerSpacing))
  const annPanelLayers = viewerStore.viewerAnnotations

  let color = 'rgb(0,0,0)'
  for (const annotation in annotationLayers) {
    if (annotationLayers.hasOwnProperty(annotation)) {
      // find color
      for (let i = 0; i < annPanelLayers.length; i++) {
        if (annPanelLayers[i].id === parseInt(annotation)) {
          annotationIndex = i
          color = annPanelLayers[i].color!
          break
        }
      }

      plotAnnotations(ctx, xStart, xEnd, layerSpacing, layerHeight, annotationLayers[annotation], annotationIndex, color)
    }
  }
}

// TODO(ts-phase4): annotations rows come from the untyped annotation-window response.
const plotAnnotations = (ctx: CanvasRenderingContext2D, xStart: number, xEnd: number, layerSpacing: number, layerHeight: number, annotations: any, rank: number, color: string) => {
  nextTick(() => {
    ctx.setTransform(pixelRatio.value, 0, 0, pixelRatio.value, 0, 0)
    ctx.fillStyle = color
    for (let i = 0; i < annotations.length; i++) {
      if (annotations[i].value > 0) {
        const xPosStart = ((annotations[i].start - xStart) / (xEnd - xStart)) * props.cWidth
        const xPosEnd = ((annotations[i].end - xStart) / (xEnd - xStart)) * props.cWidth
        let cw = xPosEnd - xPosStart
        if (cw < 1) {
          cw = 1
        }
        const yPos = 1 + rank * ((layerHeight - 1) + layerSpacing) + rank
        ctx.fillRect(xPosStart, yPos, cw, layerHeight)
      }
    }
  })
}

const createPinstripeCanvas = () => {
  const patternCanvas = document.createElement('canvas')
  const pctx = patternCanvas.getContext('2d', { antialias: true } as CanvasRenderingContext2DSettings)!
  const colour = 'rgb(220,220,220)'

  const CANVAS_SIDE_LENGTH = 5
  const WIDTH = CANVAS_SIDE_LENGTH
  const HEIGHT = CANVAS_SIDE_LENGTH
  const DIVISIONS = 10

  patternCanvas.width = WIDTH
  patternCanvas.height = HEIGHT
  pctx.fillStyle = colour

  // Top line
  pctx.beginPath()
  pctx.moveTo(0, HEIGHT * (1 / DIVISIONS))
  pctx.lineTo(WIDTH * (1 / DIVISIONS), 0)
  pctx.lineTo(0, 0)
  pctx.lineTo(0, HEIGHT * (1 / DIVISIONS))
  pctx.fill()

  // Middle line
  pctx.beginPath()
  pctx.moveTo(WIDTH, HEIGHT * (1 / DIVISIONS))
  pctx.lineTo(WIDTH * (1 / DIVISIONS), HEIGHT)
  pctx.lineTo(0, HEIGHT)
  pctx.lineTo(0, HEIGHT * ((DIVISIONS - 1) / DIVISIONS))
  pctx.lineTo(WIDTH * ((DIVISIONS - 1) / DIVISIONS), 0)
  pctx.lineTo(WIDTH, 0)
  pctx.lineTo(WIDTH, HEIGHT * (1 / DIVISIONS))
  pctx.fill()

  // Bottom line
  pctx.beginPath()
  pctx.moveTo(WIDTH, HEIGHT * ((DIVISIONS - 1) / DIVISIONS))
  pctx.lineTo(WIDTH * ((DIVISIONS - 1) / DIVISIONS), HEIGHT)
  pctx.lineTo(WIDTH, HEIGHT)
  pctx.lineTo(WIDTH, HEIGHT * ((DIVISIONS - 1) / DIVISIONS))
  pctx.fill()

  return patternCanvas
}

// A transport swap leaves a scan reading through a client the viewer has finished with.
watch(transport, () => {
  abortSegmentSpans()
})

// Lifecycle
onMounted(() => {
  segments.value = new Array(5000)
  segments.value = segments.value.fill(0, 0, 4999)

  pixelRatio.value = getScreenPixelRatio()
  patternCnvs.value = createPinstripeCanvas()
  renderViewPort()
})

onBeforeUnmount(() => {
  abortSegmentSpans()
})

// Expose methods for parent component access
defineExpose({
  getAnnotations,
  initSegmentSpans,
  render,
  renderViewPort,
  renderSegments,
  renderTimelimeLine,
  resetComponentState,
  resetSegmentState,
  clearCanvases
})
</script>

<style lang="scss" scoped>
@import '../../assets/tsviewerVariables.scss';

.timeseries-scrubber {
  background: $white;
  padding: 0px 8px 8px 8px;
}

.dateWrap {
  padding: 8px 0;
  font-size: 12px;
  text-transform: uppercase;
  color: #71747C;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
}

#scrubber {
  background: $white;
  box-shadow: 0 0 0px 1px #c5c5c5 inset;
  box-sizing: border-box;
  position: relative;
  display: flex;
}

#canvasWrap {
  height: 30px;
  position: relative;
}

.noselect {
  -webkit-touch-callout: none; /* iOS Safari */
  -webkit-user-select: none;   /* Chrome/Safari/Opera */
  -khtml-user-select: none;    /* Konqueror */
  -moz-user-select: none;      /* Firefox */
  -ms-user-select: none;       /* Internet Explorer/Edge */
  user-select: none;           /* Non-prefixed version, currently not supported by any browser */
}

.canvas {
  position: absolute;
  top: 0;
  left: 0;
  cursor: pointer;
}

.canvas[dragme] {
  cursor: move;
}

.canvas[resizeme] {
  cursor: ew-resize;
}

#annotationCanvas {
  margin-top: 1px;
}

#iCanvas {
  margin-left: 0px
}
</style>