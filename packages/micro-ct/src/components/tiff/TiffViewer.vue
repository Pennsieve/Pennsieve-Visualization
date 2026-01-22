<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import * as GeoTIFF from "geotiff";

interface Props {
  source: string | File;
}

const props = defineProps<Props>();

const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const isLoading = ref(false);
const error = ref<Error | null>(null);

// Pan/zoom state
const scale = ref(1);
const translateX = ref(0);
const translateY = ref(0);
let isDragging = false;
let lastX = 0;
let lastY = 0;

async function loadAndRender() {
  console.log("TiffViewer: loadAndRender called", { source: props.source });

  if (!props.source) {
    console.log("TiffViewer: No source provided");
    return;
  }
  if (!canvasRef.value || !containerRef.value) {
    console.log("TiffViewer: No canvas or container ref");
    return;
  }

  isLoading.value = true;
  error.value = null;

  try {
    // Fetch and load TIFF
    console.log("TiffViewer: Fetching TIFF...");
    let tiff;
    if (typeof props.source === "string") {
      const response = await fetch(props.source);
      if (!response.ok) {
        throw new Error(`Failed to fetch TIFF: ${response.status}`);
      }
      const blob = await response.blob();
      console.log("TiffViewer: Fetched blob", blob.size, "bytes");
      tiff = await GeoTIFF.fromBlob(blob);
    } else {
      tiff = await GeoTIFF.fromBlob(props.source);
    }
    console.log("TiffViewer: GeoTIFF parsed");

    const image = await tiff.getImage(0);
    const width = image.getWidth();
    const height = image.getHeight();
    const samplesPerPixel = image.getSamplesPerPixel();
    const bitsPerSample = image.getBitsPerSample()[0];
    console.log("TiffViewer: Image info", { width, height, samplesPerPixel, bitsPerSample });

    // Check if image is too large (max ~50 million pixels to avoid browser crash)
    const maxPixels = 50_000_000;
    const totalPixels = width * height;
    if (totalPixels > maxPixels) {
      throw new Error(`Image too large: ${width}x${height} (${Math.round(totalPixels/1_000_000)}M pixels). Max supported: ${Math.round(maxPixels/1_000_000)}M pixels.`);
    }

    // Read raster data
    console.log("TiffViewer: Reading raster data...");
    const rasters = await image.readRasters();
    console.log("TiffViewer: Raster data loaded");

    // Set canvas size
    const canvas = canvasRef.value;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");

    // Create ImageData
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Determine max value for normalization
    const maxVal = bitsPerSample <= 8 ? 255 : bitsPerSample <= 16 ? 65535 : 1;

    if (samplesPerPixel >= 3) {
      // RGB image
      const r = rasters[0] as any;
      const g = rasters[1] as any;
      const b = rasters[2] as any;

      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        if (bitsPerSample <= 8) {
          data[idx] = r[i];
          data[idx + 1] = g[i];
          data[idx + 2] = b[i];
        } else {
          // Normalize to 0-255
          data[idx] = Math.round((r[i] / maxVal) * 255);
          data[idx + 1] = Math.round((g[i] / maxVal) * 255);
          data[idx + 2] = Math.round((b[i] / maxVal) * 255);
        }
        data[idx + 3] = 255; // Alpha
      }
    } else {
      // Grayscale image
      const gray = rasters[0] as any;

      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        let val: number;
        if (bitsPerSample <= 8) {
          val = gray[i];
        } else {
          // Normalize to 0-255
          val = Math.round((gray[i] / maxVal) * 255);
        }
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 255; // Alpha
      }
    }

    console.log("TiffViewer: Putting image data to canvas...");
    ctx.putImageData(imageData, 0, 0);
    console.log("TiffViewer: Canvas rendered");

    // Fit image to container
    fitToContainer();
    console.log("TiffViewer: Done");
  } catch (e) {
    error.value = e instanceof Error ? e : new Error("Failed to load TIFF");
    console.error("TiffViewer: TIFF load error:", e);
  } finally {
    isLoading.value = false;
  }
}

function fitToContainer() {
  if (!canvasRef.value || !containerRef.value) return;

  const canvas = canvasRef.value;
  const container = containerRef.value;

  const scaleX = container.clientWidth / canvas.width;
  const scaleY = container.clientHeight / canvas.height;
  scale.value = Math.min(scaleX, scaleY, 1) * 0.9; // 90% to leave some margin

  // Center the image
  translateX.value = (container.clientWidth - canvas.width * scale.value) / 2;
  translateY.value = (container.clientHeight - canvas.height * scale.value) / 2;
}

// Mouse event handlers for pan/zoom
function handleWheel(e: WheelEvent) {
  e.preventDefault();

  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  const newScale = Math.max(0.1, Math.min(10, scale.value * zoomFactor));

  // Zoom towards mouse position
  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    translateX.value = mouseX - (mouseX - translateX.value) * (newScale / scale.value);
    translateY.value = mouseY - (mouseY - translateY.value) * (newScale / scale.value);
  }

  scale.value = newScale;
}

function handleMouseDown(e: MouseEvent) {
  isDragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging) return;

  const deltaX = e.clientX - lastX;
  const deltaY = e.clientY - lastY;

  translateX.value += deltaX;
  translateY.value += deltaY;

  lastX = e.clientX;
  lastY = e.clientY;
}

function handleMouseUp() {
  isDragging = false;
}

// Watchers
watch(
  () => props.source,
  () => {
    loadAndRender();
  }
);

// Lifecycle
onMounted(async () => {
  await nextTick();
  loadAndRender();

  // Add mouse event listeners
  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", handleMouseUp);
});

onUnmounted(() => {
  window.removeEventListener("mousemove", handleMouseMove);
  window.removeEventListener("mouseup", handleMouseUp);
});
</script>

<template>
  <div class="tiff-viewer-wrapper">
    <div v-if="isLoading" class="tiff-viewer-loading">
      <span>Loading...</span>
    </div>

    <div v-if="error" class="tiff-viewer-error">
      <span>{{ error.message }}</span>
    </div>

    <div
      ref="containerRef"
      class="tiff-viewer-container"
      @wheel="handleWheel"
      @mousedown="handleMouseDown"
    >
      <canvas
        ref="canvasRef"
        class="tiff-canvas"
        :style="{
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        }"
      />
    </div>
  </div>
</template>

<style scoped>
.tiff-viewer-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 400px;
  background: black;
  border-radius: 8px;
  overflow: hidden;
}

.tiff-viewer-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  cursor: grab;
}

.tiff-viewer-container:active {
  cursor: grabbing;
}

.tiff-canvas {
  transform-origin: 0 0;
}

.tiff-viewer-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10;
  background: rgba(22, 33, 62, 0.95);
  color: #e2e8f0;
  padding: 1.25rem 2.5rem;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.tiff-viewer-loading::before {
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

.tiff-viewer-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10;
  background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
  color: #fecaca;
  padding: 1.25rem 2rem;
  border-radius: 8px;
}
</style>
