import { createViewerStore, useViewerStore } from '../../stores/tsviewer'

/**
 * @deprecated Use inject('viewerStore') or createViewerStore(instanceId) in composition API instead.
 * This mixin is kept for backwards compatibility with Options API components.
 */
export default {
  inject: {
    injectedViewerStore: {
      from: 'viewerStore',
      default: null
    }
  },
  computed: {
    viewerStore() {
      // Use injected store if available, otherwise fall back to default
      return this.injectedViewerStore || useViewerStore()
    }
  }
}