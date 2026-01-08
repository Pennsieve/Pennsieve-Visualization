<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { Deck, OrthographicView } from "@deck.gl/core";
import { MultiscaleImageLayer, ImageLayer } from "@vivjs/layers";
import { ColorPaletteExtension } from "@vivjs/extensions";
import { getDefaultInitialViewState, DetailView } from "@vivjs/views";

import OmeViewerControls from "./OmeViewerControls.vue";
import OmeOrthogonalViewer from "./OmeOrthogonalViewer.vue";
import { useOmeLoader } from "./useOmeLoader";
import type { SourceType, ViewerLayerProps, OmeDimensions } from "./types";

// Props
interface Props {
  source: string | File;
  sourceType: SourceType;
}

const props = defineProps<Props>();

// Composables
const { load, isLoading, error } = useOmeLoader();

// Reactive state
const containerRef = ref<HTMLDivElement | null>(null);
const isTileLoading = ref(false);
let deckInstance: Deck | null = null;
let tileLoadingTimeout: ReturnType<typeof setTimeout> | null = null;
let tileLoadingDebounce: ReturnType<typeof setTimeout> | null = null;
let sliceUpdateDebounce: ReturnType<typeof setTimeout> | null = null;

// 3D detection and orthogonal viewer state
const is3D = ref(false);
const loadedData = ref<{
  loader: any[];
  metadata: any;
  dimensions: OmeDimensions;
} | null>(null);

// Dimension navigation state
const currentZ = ref(0);
const currentT = ref(0);
const maxZ = ref(0);
const maxT = ref(0);
const fluidMode = ref(false);
let currentLoader: any = null;
let currentLayerProps: ViewerLayerProps | null = null;

// Default colors for channels
const DEFAULT_COLORS: [number, number, number][] = [
  [255, 255, 255], // white for grayscale
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
];

// Max values by dtype for contrast limits
const DTYPE_MAX_VALUES: Record<string, number> = {
  Uint8: 255,
  Uint16: 65535,
  Uint32: 4294967295,
  Float32: 1,
  Float64: 1,
  Int8: 127,
  Int16: 32767,
  Int32: 2147483647,
};

// Tile loading indicator management
function startTileLoading() {
  if (tileLoadingDebounce) clearTimeout(tileLoadingDebounce);
  if (tileLoadingTimeout) clearTimeout(tileLoadingTimeout);

  tileLoadingDebounce = setTimeout(() => {
    isTileLoading.value = true;
    tileLoadingTimeout = setTimeout(() => {
      isTileLoading.value = false;
    }, 3000);
  }, 150);
}

function stopTileLoading() {
  if (tileLoadingDebounce) clearTimeout(tileLoadingDebounce);
  if (tileLoadingTimeout) clearTimeout(tileLoadingTimeout);
  isTileLoading.value = false;
}

// Build layer props from loader data
function buildLayerProps(
  loader: any[],
  dimensions: OmeDimensions,
  metadata: any
): { selections: Record<string, number>[]; layerProps: ViewerLayerProps } {
  const { labels, shape, dtype } = dimensions;

  const cIndex = labels.indexOf("c");
  const zIndex = labels.indexOf("z");
  const tIndex = labels.indexOf("t");

  const numChannels = cIndex >= 0 ? shape[cIndex] : 1;
  const maxVal = DTYPE_MAX_VALUES[dtype] || 65535;

  // Get channel metadata
  const omeroChannels = metadata.omero?.channels || [];
  const pixelsChannels = metadata.Pixels?.Channels || [];

  // Build selections
  const selections: Record<string, number>[] = [];
  for (let c = 0; c < numChannels; c++) {
    const selection: Record<string, number> = {};
    if (cIndex >= 0) selection.c = c;
    if (zIndex >= 0) selection.z = currentZ.value;
    if (tIndex >= 0) selection.t = currentT.value;
    selections.push(selection);
  }
  console.log('Built selections:', selections, { cIndex, zIndex, tIndex, numChannels });

  // Get contrast limits
  let contrastLimits: [number, number][];
  if (omeroChannels.length > 0) {
    contrastLimits = omeroChannels.map((ch: any) => {
      const { start, end } = ch.window || { start: 0, end: maxVal };
      return [start, end] as [number, number];
    });
  } else {
    contrastLimits = Array(numChannels).fill([0, maxVal]) as [number, number][];
  }

  // Get channel visibility
  const channelsVisible: boolean[] =
    omeroChannels.length > 0
      ? omeroChannels.map((ch: any) => ch.active !== false)
      : Array(numChannels).fill(true);

  // Get colors
  let colors: [number, number, number][];
  if (omeroChannels.length > 0) {
    colors = omeroChannels.map((ch: any, i: number) => {
      if (ch.color) {
        const hex = ch.color;
        return [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16),
        ] as [number, number, number];
      }
      return DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
  } else if (pixelsChannels.length > 0) {
    colors = pixelsChannels.map((ch: any, i: number) => {
      if (ch.Color) {
        return [ch.Color[0], ch.Color[1], ch.Color[2]] as [number, number, number];
      }
      return DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
  } else {
    colors = Array(numChannels)
      .fill(null)
      .map((_, i) => DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
  }

  const layerProps: ViewerLayerProps = {
    isCustomLoader: loader[0]._tiff !== undefined,
    contrastLimits,
    channelsVisible,
    colors,
    dtype,
    numChannels,
    cIndex,
    zIndex,
    tIndex,
  };

  return { selections, layerProps };
}

// Create deck.gl layer
function createLayer(
  loader: any,
  selections: Record<string, number>[],
  layerProps: ViewerLayerProps
) {
  const { isCustomLoader, contrastLimits, channelsVisible, colors, dtype } = layerProps;

  if (isCustomLoader) {
    // Custom loader (TIFF) - use ImageLayer
    return new ImageLayer({
      id: "ome-image-layer",
      loader,
      selections,
      contrastLimits,
      channelsVisible,
      colors,
      dtype,
      extensions: [new ColorPaletteExtension()],
      onViewportLoad: stopTileLoading,
    });
  } else {
    // Zarr - use MultiscaleImageLayer for pyramid support
    return new MultiscaleImageLayer({
      id: "ome-multiscale-layer",
      loader,
      selections,
      contrastLimits,
      channelsVisible,
      colors,
      dtype,
      extensions: [new ColorPaletteExtension()],
      viewportId: "detail",
      onViewportLoad: stopTileLoading,
      onTileError: (err: any) => {
        console.error("Tile error:", err);
      },
    });
  }
}

// Initialize the viewer
async function initializeViewer() {
  const result = await load(props.source, props.sourceType);
  if (!result) return;

  const { loader, metadata, dimensions, isCustomLoader } = result;

  // Detect if this is a 3D dataset suitable for orthogonal views
  const hasZAxis = dimensions.labels.includes('z');
  const detected3D = hasZAxis && dimensions.sizeZ > 1;
  console.log('is3D:', detected3D, {
    hasZAxis,
    sizeZ: dimensions.sizeZ,
    shape: dimensions.shape,
    labels: dimensions.labels,
  });

  // Store loaded data and 3D detection
  is3D.value = detected3D;
  loadedData.value = { loader, metadata, dimensions };

  // If 3D, the orthogonal viewer component will handle rendering
  if (detected3D) {
    console.log('Using orthogonal viewer for 3D data');
    return;
  }

  // 2D data - use regular single-panel viewer
  if (!containerRef.value) return;

  // Store dimension info for navigation
  maxZ.value = dimensions.sizeZ - 1;
  maxT.value = dimensions.sizeT - 1;
  currentZ.value = 0;
  currentT.value = 0;

  // Store loader for slice updates
  // For custom loaders (TIFF): loader is array with one custom object, use loader[0]
  // For zarr: loader is array of resolution levels, keep full array for MultiscaleImageLayer
  currentLoader = isCustomLoader ? loader[0] : loader;

  // Build layer props
  const { selections, layerProps } = buildLayerProps(loader, dimensions, metadata);
  currentLayerProps = layerProps;

  // Get container dimensions
  const containerWidth = containerRef.value.clientWidth || 800;
  const containerHeight = containerRef.value.clientHeight || 600;

  // Create layer
  const layer = createLayer(currentLoader, selections, layerProps);

  // Use viv's DetailView for proper tile layer handling
  const detailView = new DetailView({
    id: "detail",
    height: containerHeight,
    width: containerWidth,
  });

  // Get viv's recommended initial view state
  const vivInitialViewState = getDefaultInitialViewState(currentLoader, {
    height: containerHeight,
    width: containerWidth,
  }, 0.5);

  // Create deck.gl instance using viv's view
  deckInstance = new Deck({
    parent: containerRef.value,
    views: [detailView.getDeckGlView()],
    initialViewState: {
      detail: {
        ...vivInitialViewState,
        height: containerHeight,
        width: containerWidth,
      },
    },
    layers: [layer],
    onViewStateChange: ({ viewState }) => {
      startTileLoading();
      return viewState;
    },
  });
}

// Update layer when Z or T slice changes
function updateSlice() {
  if (!deckInstance || !currentLoader || !currentLayerProps) return;

  const { numChannels, cIndex, zIndex, tIndex } = currentLayerProps;

  // Build new selections with current Z and T
  const selections: Record<string, number>[] = [];
  for (let c = 0; c < numChannels; c++) {
    const selection: Record<string, number> = {};
    if (cIndex >= 0) selection.c = c;
    if (zIndex >= 0) selection.z = currentZ.value;
    if (tIndex >= 0) selection.t = currentT.value;
    selections.push(selection);
  }

  const layer = createLayer(currentLoader, selections, currentLayerProps);
  deckInstance.setProps({ layers: [layer] });
}

// Cleanup
function cleanup() {
  if (sliceUpdateDebounce) clearTimeout(sliceUpdateDebounce);
  if (deckInstance) {
    deckInstance.finalize();
    deckInstance = null;
  }
  currentLoader = null;
  currentLayerProps = null;
  is3D.value = false;
  loadedData.value = null;
}

// Watchers
watch(
  () => [props.source, props.sourceType],
  () => {
    cleanup();
    initializeViewer();
  }
);

watch([currentZ, currentT], () => {
  // In fluid mode, update immediately (load every slice while dragging)
  // Otherwise, debounce to avoid loading intermediate slices
  if (fluidMode.value) {
    updateSlice();
  } else {
    if (sliceUpdateDebounce) clearTimeout(sliceUpdateDebounce);
    sliceUpdateDebounce = setTimeout(() => {
      updateSlice();
    }, 100); // Wait 100ms after last change before loading
  }
});

// Lifecycle
onMounted(() => {
  initializeViewer();
});

onUnmounted(() => {
  cleanup();
});
</script>

<template>
  <div class="ome-viewer-wrapper">
    <!-- Loading indicator -->
    <div v-if="isLoading" class="ome-viewer-loading">
      <span>Loading...</span>
    </div>

    <!-- Error display -->
    <div v-if="error" class="ome-viewer-error">
      <span>{{ error.message }}</span>
    </div>

    <!-- 3D Orthogonal Viewer -->
    <OmeOrthogonalViewer
      v-if="is3D && loadedData"
      :loader="loadedData.loader"
      :metadata="loadedData.metadata"
      :dimensions="loadedData.dimensions"
    />

    <!-- 2D Single-panel Viewer -->
    <template v-else-if="!isLoading && !is3D">
      <!-- Tile loading indicator -->
      <div v-if="isTileLoading" class="ome-viewer-tile-loading">
        <div class="tile-spinner"></div>
      </div>

      <!-- Controls -->
      <OmeViewerControls
        v-model:currentZ="currentZ"
        v-model:currentT="currentT"
        v-model:fluidMode="fluidMode"
        :maxZ="maxZ"
        :maxT="maxT"
      />

      <!-- Deck.gl container -->
      <div ref="containerRef" class="ome-viewer-container" />
    </template>
  </div>
</template>

<style scoped>
.ome-viewer-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 400px;
  background: black;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1), 0 10px 20px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  overflow: hidden;
}

.ome-viewer-container {
  width: 100%;
  height: 100%;
  border-radius: 8px;
}

.ome-viewer-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10;
  background: rgba(22, 33, 62, 0.95);
  color: #e2e8f0;
  padding: 1.25rem 2.5rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  font-size: 0.9rem;
  font-weight: 500;
  letter-spacing: 0.025em;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.ome-viewer-loading::before {
  content: "";
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: #60a5fa;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.ome-viewer-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10;
  background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
  color: #fecaca;
  padding: 1.25rem 2rem;
  border-radius: 8px;
  border: 1px solid rgba(254, 202, 202, 0.2);
  box-shadow: 0 8px 32px rgba(127, 29, 29, 0.4);
  font-size: 0.9rem;
  font-weight: 500;
  max-width: 80%;
  text-align: center;
}

.ome-viewer-tile-loading {
  position: absolute;
  bottom: 12px;
  left: 12px;
  z-index: 10;
  background: rgba(22, 33, 62, 0.85);
  padding: 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.tile-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: #60a5fa;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

</style>
