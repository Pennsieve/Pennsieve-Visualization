<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from "vue";
import { Deck, OrthographicView } from "@deck.gl/core";
import { ImageLayer } from "@vivjs/layers";
import { ColorPaletteExtension } from "@vivjs/extensions";
import {
  createOrthogonalPixelSource,
  getOrthogonalDimensions,
  type ViewOrientation,
} from "./OrthogonalPixelSource";
import type { OmeDimensions } from "./types";

interface Props {
  loader: any[];
  metadata: any;
  dimensions: OmeDimensions;
}

const props = defineProps<Props>();

// Refs for the three view containers
const xyContainerRef = ref<HTMLDivElement | null>(null);
const xzContainerRef = ref<HTMLDivElement | null>(null);
const yzContainerRef = ref<HTMLDivElement | null>(null);

// Deck instances for each view
let xyDeck: Deck | null = null;
let xzDeck: Deck | null = null;
let yzDeck: Deck | null = null;

// Current slice positions (linked across views)
const currentX = ref(0);
const currentY = ref(0);
const currentZ = ref(0);

// Max values for sliders
const maxX = computed(() => props.dimensions.sizeX - 1);
const maxY = computed(() => props.dimensions.sizeY - 1);
const maxZ = computed(() => props.dimensions.sizeZ - 1);

// Loading states
const isLoading = ref({ xy: true, xz: true, yz: true });

// Default colors and contrast
const DEFAULT_COLORS: [number, number, number][] = [[255, 255, 255]];
const DTYPE_MAX_VALUES: Record<string, number> = {
  Uint8: 255,
  Uint16: 65535,
  Uint32: 4294967295,
  Float32: 1,
  Float64: 1,
  Int8: 127,
  Int16: 32767,
  Int32: 2147483647,
  "<i2": 32767,
  "<u2": 65535,
};

function getContrastLimits(): [number, number][] {
  const maxVal = DTYPE_MAX_VALUES[props.dimensions.dtype] || 65535;
  return [[0, maxVal]];
}

function createViewLayer(
  orientation: ViewOrientation,
  sliceSelection: Record<string, number>
) {
  const sourceLoader = props.loader[0];
  const orthogonalSource = createOrthogonalPixelSource(
    sourceLoader,
    orientation,
    props.dimensions
  );

  return new ImageLayer({
    id: `ome-${orientation.toLowerCase()}-layer`,
    loader: orthogonalSource,
    selections: [sliceSelection],
    contrastLimits: getContrastLimits(),
    channelsVisible: [true],
    colors: DEFAULT_COLORS,
    dtype: props.dimensions.dtype,
    extensions: [new ColorPaletteExtension()],
    onViewportLoad: () => {
      isLoading.value[orientation.toLowerCase() as 'xy' | 'xz' | 'yz'] = false;
    },
  });
}

function getInitialViewState(orientation: ViewOrientation, containerWidth: number, containerHeight: number) {
  const dims = getOrthogonalDimensions(orientation, props.dimensions);

  const scaleX = containerWidth / dims.width;
  const scaleY = containerHeight / dims.height;
  const zoom = Math.log2(Math.min(scaleX, scaleY)) - 0.1;

  return {
    target: [dims.width / 2, dims.height / 2, 0],
    zoom: Math.max(zoom, -10),
    minZoom: -10,
    maxZoom: 5,
  };
}

function initializeView(
  container: HTMLDivElement,
  orientation: ViewOrientation
): Deck {
  const containerWidth = container.clientWidth || 400;
  const containerHeight = container.clientHeight || 400;

  // Create selection based on orientation
  let selection: Record<string, number>;
  switch (orientation) {
    case 'XY':
      selection = { z: currentZ.value };
      break;
    case 'XZ':
      selection = { y: currentY.value };
      break;
    case 'YZ':
      selection = { x: currentX.value };
      break;
  }

  const layer = createViewLayer(orientation, selection);
  const initialViewState = getInitialViewState(orientation, containerWidth, containerHeight);

  return new Deck({
    parent: container,
    views: new OrthographicView({ id: "ortho", controller: true }),
    initialViewState: {
      ...initialViewState,
      id: "ortho",
    },
    controller: true,
    layers: [layer],
  });
}

function updateView(deck: Deck | null, orientation: ViewOrientation) {
  if (!deck) return;

  let selection: Record<string, number>;
  switch (orientation) {
    case 'XY':
      selection = { z: currentZ.value };
      break;
    case 'XZ':
      selection = { y: currentY.value };
      break;
    case 'YZ':
      selection = { x: currentX.value };
      break;
  }

  const layer = createViewLayer(orientation, selection);
  deck.setProps({ layers: [layer] });
}

function initializeAllViews() {
  if (xyContainerRef.value) {
    xyDeck = initializeView(xyContainerRef.value, 'XY');
  }
  if (xzContainerRef.value) {
    xzDeck = initializeView(xzContainerRef.value, 'XZ');
  }
  if (yzContainerRef.value) {
    yzDeck = initializeView(yzContainerRef.value, 'YZ');
  }
}

function cleanup() {
  if (xyDeck) {
    xyDeck.finalize();
    xyDeck = null;
  }
  if (xzDeck) {
    xzDeck.finalize();
    xzDeck = null;
  }
  if (yzDeck) {
    yzDeck.finalize();
    yzDeck = null;
  }
}

// Watch for slice position changes and update relevant views
watch(currentZ, () => {
  updateView(xyDeck, 'XY');
});

watch(currentY, () => {
  updateView(xzDeck, 'XZ');
});

watch(currentX, () => {
  updateView(yzDeck, 'YZ');
});

onMounted(() => {
  // Set initial slice positions to middle
  currentX.value = Math.floor(props.dimensions.sizeX / 2);
  currentY.value = Math.floor(props.dimensions.sizeY / 2);
  currentZ.value = Math.floor(props.dimensions.sizeZ / 2);

  initializeAllViews();
});

onUnmounted(() => {
  cleanup();
});
</script>

<template>
  <div class="orthogonal-viewer">
    <!-- Top row: XY and XZ views -->
    <div class="viewer-row">
      <!-- XY View (Axial) -->
      <div class="view-panel">
        <div class="view-header">
          <span class="view-label">XY (Axial)</span>
          <span class="slice-info">Z: {{ currentZ }}</span>
        </div>
        <div ref="xyContainerRef" class="view-container">
          <div v-if="isLoading.xy" class="view-loading">Loading...</div>
        </div>
        <input
          type="range"
          v-model.number="currentZ"
          :min="0"
          :max="maxZ"
          class="slice-slider"
        />
      </div>

      <!-- XZ View (Coronal) -->
      <div class="view-panel">
        <div class="view-header">
          <span class="view-label">XZ (Coronal)</span>
          <span class="slice-info">Y: {{ currentY }}</span>
        </div>
        <div ref="xzContainerRef" class="view-container">
          <div v-if="isLoading.xz" class="view-loading">Loading...</div>
        </div>
        <input
          type="range"
          v-model.number="currentY"
          :min="0"
          :max="maxY"
          class="slice-slider"
        />
      </div>
    </div>

    <!-- Bottom row: YZ view -->
    <div class="viewer-row">
      <!-- YZ View (Sagittal) -->
      <div class="view-panel">
        <div class="view-header">
          <span class="view-label">YZ (Sagittal)</span>
          <span class="slice-info">X: {{ currentX }}</span>
        </div>
        <div ref="yzContainerRef" class="view-container">
          <div v-if="isLoading.yz" class="view-loading">Loading...</div>
        </div>
        <input
          type="range"
          v-model.number="currentX"
          :min="0"
          :max="maxX"
          class="slice-slider"
        />
      </div>

      <!-- Info panel -->
      <div class="info-panel">
        <h3>Volume Info</h3>
        <div class="info-row">
          <span>Dimensions:</span>
          <span>{{ dimensions.sizeX }} x {{ dimensions.sizeY }} x {{ dimensions.sizeZ }}</span>
        </div>
        <div class="info-row">
          <span>Data type:</span>
          <span>{{ dimensions.dtype }}</span>
        </div>
        <div class="info-row">
          <span>Position:</span>
          <span>({{ currentX }}, {{ currentY }}, {{ currentZ }})</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.orthogonal-viewer {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #1a1a2e;
  gap: 8px;
  padding: 8px;
  box-sizing: border-box;
}

.viewer-row {
  display: flex;
  flex: 1;
  gap: 8px;
  min-height: 0;
}

.view-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #16213e;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.view-label {
  color: #60a5fa;
  font-weight: 600;
  font-size: 0.9rem;
}

.slice-info {
  color: #94a3b8;
  font-size: 0.8rem;
  font-family: monospace;
}

.view-container {
  flex: 1;
  position: relative;
  background: black;
  min-height: 200px;
}

.view-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #e2e8f0;
  font-size: 0.9rem;
}

.slice-slider {
  width: 100%;
  height: 24px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.05);
  cursor: pointer;
  margin: 0;
}

.slice-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 24px;
  background: #60a5fa;
  cursor: pointer;
}

.slice-slider::-moz-range-thumb {
  width: 12px;
  height: 24px;
  background: #60a5fa;
  cursor: pointer;
  border: none;
}

.info-panel {
  flex: 1;
  background: #16213e;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 16px;
  color: #e2e8f0;
}

.info-panel h3 {
  margin: 0 0 12px 0;
  color: #60a5fa;
  font-size: 1rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 0.85rem;
}

.info-row span:first-child {
  color: #94a3b8;
}

.info-row span:last-child {
  font-family: monospace;
}
</style>
