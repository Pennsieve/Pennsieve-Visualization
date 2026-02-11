import './assets/styles.scss';

import TSViewer from './components/TSViewer/TSViewer.vue';
import {
  createViewerStore,
  clearViewerStore,
  clearAllViewerStores,
  useViewerStore  // Deprecated - kept for backwards compatibility
} from './stores/tsviewer';
import { useViewerControls } from './composables/useViewerControls';

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

export default {
  install(app) {
    app.component('TSViewer', TSViewer);
  },
};