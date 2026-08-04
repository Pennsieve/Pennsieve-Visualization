import './assets/styles.scss';

import TSViewer from './components/TSViewer/TSViewer.vue';
import {
  createViewerStore,
  clearViewerStore,
  clearAllViewerStores,
  useViewerStore  // Deprecated - kept for backwards compatibility
} from './stores/tsviewer';
import { useViewerControls } from './composables/useViewerControls';
import {
  TIMESERIES_ZARR,
  TIMESERIES_WEBSOCKET,
  isZarrAssetType
} from './composables/streaming/assetTypes';

// Primary exports for multi-instance support
export {
  TSViewer,
  createViewerStore,
  clearViewerStore,
  clearAllViewerStores,
  useViewerControls,
  // Deprecated - use createViewerStore instead
  useViewerStore
};

// Viewer-asset vocabulary, so the host app matches on the same literals this viewer does
// rather than duplicating them.
export { TIMESERIES_ZARR, TIMESERIES_WEBSOCKET, isZarrAssetType };

export default {
  install(app) {
    app.component('TSViewer', TSViewer);
  },
};