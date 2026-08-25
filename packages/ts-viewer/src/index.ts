import './assets/styles.scss';

import type { App } from 'vue';
import TSViewer from './components/TSViewer/TSViewer.vue';
import {
  createViewerStore,
  clearViewerStore,
  clearAllViewerStores
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
  useViewerControls
};

// Viewer-asset vocabulary, so the host app matches on the same literals this viewer does
// rather than duplicating them.
export { TIMESERIES_ZARR, TIMESERIES_WEBSOCKET, isZarrAssetType };

export default {
  install(app: App) {
    app.component('TSViewer', TSViewer);
  },
};
