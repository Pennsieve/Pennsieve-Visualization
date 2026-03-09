// @/stores/umapStore.ts
import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'

// Store instance cache - maps instanceId to store factory function
// Using 'any' for the Map value type to avoid complex generic inference issues
// The actual return type is properly inferred at the call site
const storeInstances = new Map<string, any>()

// Track if we've shown warnings (to avoid spam)
let hasShownDefaultWarning = false
let hasShownDeprecationWarning = false

export interface UMAPPoint {
  x: number
  y: number
  rawX: number
  rawY: number
  id: number
  color: number[]
  attrs: Record<string, any>
  rawRow: any[]
}

export interface UMAPMetadata {
  schema: Array<{ name: string }>
  row_groups: Array<{
    columns: Array<{
      meta_data: {
        statistics: { min_value: number; max_value: number }
      }
    }>
  }>
  key_value_metadata?: Array<{ key: string; value: string }>
}

export interface ColumnInfo {
  name: string
  type: string
}

/**
 * Factory function to create or retrieve a UMAP store instance.
 * Each instanceId gets its own isolated store, enabling multiple
 * independent UMAP components on the same page.
 *
 * @param instanceId - Unique identifier for the UMAP instance
 * @returns Pinia store instance for this UMAP viewer
 */
export function createUMAPStore(instanceId = 'default') {
  // Warn once if using default instanceId
  if (instanceId === 'default' && !hasShownDefaultWarning) {
    hasShownDefaultWarning = true
    console.warn(
      '[UMAP] Using default store instance. ' +
      'For multi-instance support, pass a unique instanceId prop to UMAP. ' +
      'Example: <UMAP instance-id="umap-1" />'
    )
  }

  // Return cached instance if it exists
  if (storeInstances.has(instanceId)) {
    return storeInstances.get(instanceId)!()
  }

  // Create a new store with a unique ID (prefixed to avoid conflicts with consuming apps)
  const useStore = defineStore(`pennsieve-viz-duckdb-umap-${instanceId}`, () => {
    // ============= UI State =============
    const pointCount = ref(5000)
    const colorMode = ref('random')
    const startColor = ref('#ff0000')
    const endColor = ref('#0000ff')
    const singleColor = ref('#4285f4')
    const forceRegenerate = ref(false)
    const componentKey = ref(0)

    // ============= Data State =============
    const pointData = ref<UMAPPoint[]>([])
    const metaData = ref<UMAPMetadata | null>(null)
    const columns = ref<ColumnInfo[]>([])

    // ============= Color Maps =============
    const colorMap = ref<Map<any, number[]>>(new Map())
    const colorMapMap = ref<Map<string, Map<any, number[]>>>(new Map())

    // ============= Axis Configuration =============
    const xAxis = ref('UMAP_1')
    const yAxis = ref('UMAP_2')

    // ============= Hover/Selection State =============
    const hoverFields = ref<string[]>([])
    const selectedPoints = ref<Set<number>>(new Set())
    const hoveredPoint = ref<UMAPPoint | null>(null)

    // ============= Connection State (per-instance tracking) =============
    const connectionId = ref<string | null>(null)
    const tableName = ref<string | null>(null)
    const isLoading = ref(false)
    const error = ref<string | null>(null)

    // ============= Source Tracking =============
    // Tracks what data source this instance is viewing
    const sourceInfo = reactive({
      url: null as string | null,
      fileType: null as 'csv' | 'parquet' | null,
      fileId: null as string | null,
      pkgId: null as string | null,
    })

    // ============= Getters =============
    const hasData = computed(() => pointData.value.length > 0)
    const selectedCount = computed(() => selectedPoints.value.size)
    const isConnected = computed(() => connectionId.value !== null)

    const numericColumns = computed(() =>
      columns.value.filter(c =>
        /DOUBLE|HUGEINT|BIGINT|INTEGER|DECIMAL|FLOAT|REAL/i.test(c.type)
      )
    )

    const categoricalColumns = computed(() =>
      columns.value.filter(c =>
        !/DOUBLE|HUGEINT|BIGINT|INTEGER|DECIMAL|FLOAT|REAL/i.test(c.type)
      )
    )

    // ============= Actions =============

    // Point data management
    const setPointData = (data: UMAPPoint[]) => {
      pointData.value = data
    }

    const setMetaData = (data: UMAPMetadata | null) => {
      metaData.value = data
    }

    const setColumns = (cols: ColumnInfo[]) => {
      columns.value = cols
    }

    // UI state actions
    const setPointCount = (count: number) => {
      pointCount.value = count
    }

    const setColorMode = (mode: string) => {
      colorMode.value = mode
    }

    const setStartColor = (color: string) => {
      startColor.value = color
    }

    const setEndColor = (color: string) => {
      endColor.value = color
    }

    const setSingleColor = (color: string) => {
      singleColor.value = color
    }

    const setAxes = (x: string, y: string) => {
      xAxis.value = x
      yAxis.value = y
    }

    // Color map actions
    const setColorMap = (map: Map<any, number[]>) => {
      colorMap.value = map
    }

    const setColorMapMap = (map: Map<string, Map<any, number[]>>) => {
      colorMapMap.value = map
    }

    const updateColorMapForColumn = (columnName: string, map: Map<any, number[]>) => {
      colorMapMap.value.set(columnName, map)
    }

    // Hover fields
    const setHoverFields = (fields: string[]) => {
      hoverFields.value = fields
    }

    // Selection actions
    const selectPoint = (pointId: number) => {
      selectedPoints.value.add(pointId)
    }

    const deselectPoint = (pointId: number) => {
      selectedPoints.value.delete(pointId)
    }

    const togglePointSelection = (pointId: number) => {
      if (selectedPoints.value.has(pointId)) {
        selectedPoints.value.delete(pointId)
      } else {
        selectedPoints.value.add(pointId)
      }
    }

    const clearSelection = () => {
      selectedPoints.value.clear()
    }

    const setSelectedPoints = (pointIds: number[]) => {
      selectedPoints.value = new Set(pointIds)
    }

    // Hover actions
    const setHoveredPoint = (point: UMAPPoint | null) => {
      hoveredPoint.value = point
    }

    // Connection management
    const setConnectionId = (id: string | null) => {
      connectionId.value = id
    }

    const setTableName = (name: string | null) => {
      tableName.value = name
    }

    // Loading state
    const setLoading = (loading: boolean) => {
      isLoading.value = loading
    }

    const setError = (err: string | null) => {
      error.value = err
    }

    // Source tracking
    const setSourceInfo = (info: Partial<typeof sourceInfo>) => {
      Object.assign(sourceInfo, info)
    }

    // Regeneration trigger
    const triggerRegenerate = () => {
      forceRegenerate.value = !forceRegenerate.value
      componentKey.value++
    }

    // Reset all state
    const resetStore = () => {
      pointCount.value = 5000
      colorMode.value = 'random'
      startColor.value = '#ff0000'
      endColor.value = '#0000ff'
      singleColor.value = '#4285f4'
      forceRegenerate.value = false
      componentKey.value = 0
      pointData.value = []
      metaData.value = null
      columns.value = []
      colorMap.value = new Map()
      colorMapMap.value = new Map()
      xAxis.value = 'UMAP_1'
      yAxis.value = 'UMAP_2'
      hoverFields.value = []
      selectedPoints.value = new Set()
      hoveredPoint.value = null
      connectionId.value = null
      tableName.value = null
      isLoading.value = false
      error.value = null
      sourceInfo.url = null
      sourceInfo.fileType = null
      sourceInfo.fileId = null
      sourceInfo.pkgId = null
    }

    return {
      // State
      pointCount,
      colorMode,
      startColor,
      endColor,
      singleColor,
      forceRegenerate,
      componentKey,
      pointData,
      metaData,
      columns,
      colorMap,
      colorMapMap,
      xAxis,
      yAxis,
      hoverFields,
      selectedPoints,
      hoveredPoint,
      connectionId,
      tableName,
      isLoading,
      error,
      sourceInfo,

      // Getters
      hasData,
      selectedCount,
      isConnected,
      numericColumns,
      categoricalColumns,

      // Actions
      setPointData,
      setMetaData,
      setColumns,
      setPointCount,
      setColorMode,
      setStartColor,
      setEndColor,
      setSingleColor,
      setAxes,
      setColorMap,
      setColorMapMap,
      updateColorMapForColumn,
      setHoverFields,
      selectPoint,
      deselectPoint,
      togglePointSelection,
      clearSelection,
      setSelectedPoints,
      setHoveredPoint,
      setConnectionId,
      setTableName,
      setLoading,
      setError,
      setSourceInfo,
      triggerRegenerate,
      resetStore,
    }
  })

  // Cache the store factory function
  storeInstances.set(instanceId, useStore)

  // Return the store instance
  return useStore()
}

/**
 * Clears a specific UMAP store instance from the cache.
 * Call this when unmounting a UMAP component to clean up resources.
 *
 * @param instanceId - The instance ID to clear
 */
export function clearUMAPStore(instanceId: string) {
  if (storeInstances.has(instanceId)) {
    const store = storeInstances.get(instanceId)!()
    store.resetStore()
    storeInstances.delete(instanceId)
  }
}

/**
 * Clears all UMAP store instances from the cache.
 */
export function clearAllUMAPStores() {
  storeInstances.forEach((useStore) => {
    const store = useStore()
    store.resetStore()
  })
  storeInstances.clear()
}

/**
 * @deprecated Use createUMAPStore(instanceId) instead for multi-instance support.
 * This export is kept for backwards compatibility with existing code.
 * Returns the default singleton store instance.
 */
export function useUMAPStore() {
  if (!hasShownDeprecationWarning) {
    hasShownDeprecationWarning = true
    console.warn(
      '[UMAP] useUMAPStore() is deprecated. ' +
      'Use createUMAPStore(instanceId) for multi-instance support.'
    )
  }
  return createUMAPStore('default')
}
