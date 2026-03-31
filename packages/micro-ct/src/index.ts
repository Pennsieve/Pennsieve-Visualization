// @pennsieve-viz/micro-ct - OME Viewer components for micro-CT and microscopy data

// Main viewer components
export { default as OmeViewer } from "./components/ome/OmeViewer.vue";
export { default as OmeViewerControls } from "./components/ome/OmeViewerControls.vue";
export { default as OmeOrthogonalViewer } from "./components/ome/OmeOrthogonalViewer.vue";
export { default as TiffViewer } from "./components/tiff/TiffViewer.vue";

// Store (factory pattern — see ARCHITECTURE.md)
export {
  createViewerStore,
  clearViewerStore,
  clearAllViewerStores,
} from "./stores/viewerStore";
export type { OmeChannelState } from "./stores/viewerStore";

// Composables
export { useOmeLoader } from "./components/ome/useOmeLoader";
export { useViewerControls } from "./composables/useViewerControls";

// Utilities
export * from "./components/ome/OrthogonalPixelSource";

// Types
export * from "./components/ome/types";
