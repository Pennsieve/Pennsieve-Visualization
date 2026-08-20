<template>
  <canvas
    id="annLabelArea"
    ref="annLabelArea"
    class="timeseries-annotation-canvas"
    :width="canvasScaler(cWidth, pixelRatio!, 0)"
    :height="canvasScaler(pHeight, pixelRatio!, 0)"
    :style="canvasStyle"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch, onUnmounted } from 'vue'
import { useAnnotationData } from '@/composables/useAnnotationData'
import { useAnnotationRendering } from '@/composables/useAnnotationRendering'
import { useAnnotationInteraction } from '@/composables/useAnnotationInteraction'
import { useAnnotationLayers } from '@/composables/useAnnotationLayers'
import { canvasScaler } from '@/utils/annotationUtils'
import type { Annotation } from '@/utils/annotationUtils'
import type { ActiveViewer } from '@/stores/tsviewer'

interface CanvasConstants {
  ANNOTATIONLABELHEIGHT: number
  XOFFSET: number
  LIMITANNFETCH: number
}

interface Props {
  cWidth?: number
  cHeight?: number
  start?: number
  duration?: number
  tsEnd?: number
  rsPeriod?: number
  pixelRatio?: number
  constants?: CanvasConstants
  pointerMode?: string
  annotationsCanvas?: HTMLCanvasElement | null
  activeViewer: ActiveViewer
  viewerActiveTool?: string
}

// Define props
const props = withDefaults(defineProps<Props>(), {
  cWidth: 0,
  constants: () => ({
    ANNOTATIONLABELHEIGHT: 20,
    XOFFSET: 0,
    LIMITANNFETCH: 500
  })
})

// Define emits
const emit = defineEmits<{
  (e: 'annLayersInitialized' | 'closeAnnotationLayerWindow'): void
  (e: 'annotationsReceived'): void
  (e: 'updateAnnotation', annotation: Annotation): void
}>()

// Template refs
const annLabelArea = ref<HTMLCanvasElement | null>(null)

// Composables
const {
  checkAnnotationRange,
  findNextAnnotation,
  findPreviousAnnotation
} = useAnnotationData()

const {
  renderAnn,
  hoverOffsets,
  focusedAnn,
  render
} = useAnnotationRendering()

const {
  resetFocusedAnnotation,
  selectFocusedAnnotation,
  onMouseDown: handleMouseDown,
  onMouseMove: handleMouseMove,
  onMouseUp: handleMouseUp
} = useAnnotationInteraction(focusedAnn, renderAnn, hoverOffsets)

const {
  createAnnotationLayer,
  loadLayers
} = useAnnotationLayers()

// The composables declare their own narrower parameter shapes. These aliases
// name those unexported types so call sites can cast the wider prop types.
type RenderProps = Parameters<typeof render>[0]
type InteractionProps = Parameters<typeof handleMouseMove>[4]
type DataProps = Parameters<typeof checkAnnotationRange>[2]
type DataViewer = Parameters<typeof checkAnnotationRange>[3]
type LayersViewer = Parameters<typeof loadLayers>[0]
type NewLayer = Parameters<typeof createAnnotationLayer>[0]

// Computed properties
const pHeight = computed(() => props.cHeight! - 20)

const canvasStyle = computed(() => ({
  width: props.cWidth + 'px',
  height: pHeight.value + 'px'
}))

// Public methods for parent component
const renderCanvas = () => {
  render(props as RenderProps, props.annotationsCanvas, annLabelArea.value!, pHeight.value)
}

const onMouseDown = (mX: number, mY: number) => {
  handleMouseDown(mX, mY, props.pointerMode!)
}

const onMouseMove = (mX: number, mY: number, pointerMode: string, mouseDown: boolean) => {
  return handleMouseMove(mX, mY, pointerMode, mouseDown, props as InteractionProps)
}

const onMouseUp = () => {
  handleMouseUp(props.pointerMode!, emit)
}

const selectFocusedAnn = () => {
  if (selectFocusedAnnotation()) {
    emit('updateAnnotation', focusedAnn.value!)
    nextTick(() => renderCanvas())
  }
}

const createLayer = async (newLayer: NewLayer) => {
  try {
    await createAnnotationLayer(newLayer, props.activeViewer as LayersViewer, emit)
  } catch (error) {
    console.error('Error creating layer:', error)
  }
}

// Watch for activeViewer changes
watch(
  () => props.activeViewer,
  async (newValue) => {
    try {
      await loadLayers(newValue as LayersViewer, emit)
      await checkAnnotationRange(
        props.start!,
        props.start! + props.duration!,
        props as DataProps,
        newValue as DataViewer,
        emit
      )
    } catch (error) {
      console.error('Error loading annotations for new viewer:', error)
    }
  }
)

// Lifecycle
onMounted(async () => {
  try {
    await loadLayers(props.activeViewer as LayersViewer, emit)
    await checkAnnotationRange(
      props.start!,
      props.start! + props.duration!,
      props as DataProps,
      props.activeViewer as DataViewer,
      emit
    )
  } catch (error) {
    console.warn('Error initializing annotations:', error)
  }
})

// Expose methods for parent component
defineExpose({
  render: renderCanvas,
  resetFocusedAnnotation,
  findNextAnnotation,
  findPreviousAnnotation,
  checkAnnotationRange: (start: number, end: number) =>
    checkAnnotationRange(start, end, props as DataProps, props.activeViewer as DataViewer, emit),
  selectFocusedAnn,
  createAnnotationLayer: createLayer,
  onMouseDown,
  onMouseMove,
  onMouseUp
})
</script>

<style lang="scss" scoped>
@import '../../assets/tsviewerVariables.scss';

.timeseries-annotation-canvas {
  position: absolute;
  top: 0;
  left: 0;
  margin-left: 5px;
  cursor: ew-resize;
  outline: none;
}
</style>