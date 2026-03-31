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

import { readonly } from 'vue'
import { storeToRefs } from 'pinia'
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

  const {
    pointCount,
    colorMode,
    startColor,
    endColor,
    singleColor,
    pointData,
    metaData,
    columns,
    colorMap,
    xAxis,
    yAxis,
    hoverFields,
    selectedPoints,
    hoveredPoint,
    isLoading,
    error,
    sourceInfo,
    hasData,
    selectedCount,
    isConnected,
    numericColumns,
    categoricalColumns,
  } = storeToRefs(store)

  // ============================================
  // STATE QUERIES
  // ============================================

  const getPoint = (pointId: number): UMAPPoint | undefined => {
    return pointData.value.find(p => p.id === pointId)
  }

  const getSelectedPoints = (): UMAPPoint[] => {
    return pointData.value.filter(p => selectedPoints.value.has(p.id))
  }

  const getState = () => ({
    pointCount: pointCount.value,
    colorMode: colorMode.value,
    xAxis: xAxis.value,
    yAxis: yAxis.value,
    hasData: hasData.value,
    selectedCount: selectedCount.value,
    isLoading: isLoading.value,
    error: error.value,
    isConnected: isConnected.value,
    sourceInfo: { ...sourceInfo.value },
  })

  // ============================================
  // RETURN PUBLIC API
  // ============================================

  return {
    // Readonly state
    pointData: readonly(pointData),
    metaData: readonly(metaData),
    columns: readonly(columns),
    colorMode: readonly(colorMode),
    startColor: readonly(startColor),
    endColor: readonly(endColor),
    singleColor: readonly(singleColor),
    pointCount: readonly(pointCount),
    xAxis: readonly(xAxis),
    yAxis: readonly(yAxis),
    hoverFields: readonly(hoverFields),
    selectedPoints: readonly(selectedPoints),
    hoveredPoint: readonly(hoveredPoint),
    isLoading: readonly(isLoading),
    error: readonly(error),

    // Computed
    hasData,
    selectedCount,
    isConnected,
    numericColumns,
    categoricalColumns,

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
    setSourceInfo: (info: Partial<typeof sourceInfo.value>) => store.setSourceInfo(info),

    // Lifecycle
    reset: () => store.resetStore(),

    // Direct store access (advanced)
    store,
  }
}
