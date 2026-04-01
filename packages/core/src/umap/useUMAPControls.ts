/**
 * Composable for external control of UMAP instances.
 * Use this in wrapper components or external control panels that need
 * to interact with UMAP state.
 *
 * @example
 * import { useUMAPControls } from '@pennsieve-viz/core'
 *
 * const controls = useUMAPControls('umap-1')
 *
 * // Read state
 * const points = controls.pointData.value
 * const selected = controls.selectedPoints.value
 *
 * // Control UMAP
 * controls.setColorMode('gradient')
 * controls.selectPoints([1, 2, 3])
 * controls.setAxes('UMAP_1', 'UMAP_2')
 */

import { readonly, toRef, computed } from 'vue'
import { createUMAPStore } from './umapStore'
import type { UMAPPoint } from './umapStore'

/**
 * Provides read and write access to a UMAP instance's state.
 *
 * @param instanceId - The unique identifier of the UMAP instance
 * @returns Control interface for the UMAP viewer
 */
export function useUMAPControls(instanceId = 'default') {
  const store = createUMAPStore(instanceId)

  // ============================================
  // STATE QUERIES
  // ============================================

  const getPoint = (pointId: number): UMAPPoint | undefined => {
    return store.pointData.find((p: UMAPPoint) => p.id === pointId)
  }

  const getSelectedPoints = (): UMAPPoint[] => {
    return store.pointData.filter((p: UMAPPoint) => store.selectedPoints.has(p.id))
  }

  const getState = () => ({
    pointCount: store.pointCount,
    colorMode: store.colorMode,
    xAxis: store.xAxis,
    yAxis: store.yAxis,
    hasData: store.hasData,
    selectedCount: store.selectedCount,
    isLoading: store.isLoading,
    error: store.error,
    isConnected: store.isConnected,
    sourceInfo: { ...store.sourceInfo },
  })

  // ============================================
  // RETURN PUBLIC API
  // ============================================

  return {
    // Readonly state
    pointData: readonly(toRef(store, 'pointData')),
    metaData: readonly(toRef(store, 'metaData')),
    columns: readonly(toRef(store, 'columns')),
    colorMode: readonly(toRef(store, 'colorMode')),
    startColor: readonly(toRef(store, 'startColor')),
    endColor: readonly(toRef(store, 'endColor')),
    singleColor: readonly(toRef(store, 'singleColor')),
    pointCount: readonly(toRef(store, 'pointCount')),
    xAxis: readonly(toRef(store, 'xAxis')),
    yAxis: readonly(toRef(store, 'yAxis')),
    hoverFields: readonly(toRef(store, 'hoverFields')),
    selectedPoints: readonly(toRef(store, 'selectedPoints')),
    hoveredPoint: readonly(toRef(store, 'hoveredPoint')),
    isLoading: readonly(toRef(store, 'isLoading')),
    error: readonly(toRef(store, 'error')),

    // Computed (from store getters)
    hasData: computed(() => store.hasData),
    selectedCount: computed(() => store.selectedCount),
    isConnected: computed(() => store.isConnected),
    numericColumns: computed(() => store.numericColumns),
    categoricalColumns: computed(() => store.categoricalColumns),

    // State queries
    getPoint,
    getSelectedPoints,
    getState,

    // Visualization controls
    setColorMode: (mode: string) => store.setColorMode(mode),
    setStartColor: (color: string) => store.setStartColor(color),
    setEndColor: (color: string) => store.setEndColor(color),
    setSingleColor: (color: string) => store.setSingleColor(color),
    setAxes: (x: string, y: string) => store.setAxes(x, y),
    setPointCount: (count: number) => store.setPointCount(count),
    setHoverFields: (fields: string[]) => store.setHoverFields(fields),

    // Selection controls
    selectPoint: (pointId: number) => store.selectPoint(pointId),
    deselectPoint: (pointId: number) => store.deselectPoint(pointId),
    togglePointSelection: (pointId: number) => store.togglePointSelection(pointId),
    clearSelection: () => store.clearSelection(),
    selectPoints: (pointIds: number[]) => store.setSelectedPoints(pointIds),

    // Hover controls
    setHoveredPoint: (point: UMAPPoint | null) => store.setHoveredPoint(point),

    // Data controls
    setPointData: (data: UMAPPoint[]) => store.setPointData(data),
    triggerRegenerate: () => store.triggerRegenerate(),

    // Source tracking
    setSourceInfo: (info: Partial<typeof store.sourceInfo>) => store.setSourceInfo(info),

    // Lifecycle
    reset: () => store.resetStore(),

    // Direct store access (advanced)
    store,
  }
}
