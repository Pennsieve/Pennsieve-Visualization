/** Configuration for a single image channel/layer */
export interface ChannelConfig {
  /** Layer name in neuroglancer state */
  name: string
  /** Whether the channel is currently visible */
  visible: boolean
  /** CSS color string for the channel (e.g. "#ff0000") */
  color: string
  /** Opacity 0-1 */
  opacity: number
}

/** Props accepted by OrthogonalViewer */
export interface OrthogonalViewerProps {
  /** OME-Zarr source URL */
  source: string
  /** Initial layout mode */
  layout?: LayoutMode
}

/** Layout modes for the neuroglancer viewer */
export type LayoutMode = '4panel' | '3d' | 'xy' | 'xz' | 'yz'

/** Subset of neuroglancer state JSON we track in Vue */
export interface ViewerState {
  /** Current crosshair position [x, y, z] */
  position: [number, number, number]
  /** Detected channels from layers */
  channels: ChannelConfig[]
  /** Current layout mode */
  layout: LayoutMode
}

/** Neuroglancer serialized state (opaque JSON) */
export type NeuroglancerStateJSON = Record<string, unknown>

/** Events emitted by OrthogonalViewer */
export interface OrthogonalViewerEmits {
  (e: 'ready'): void
  (e: 'error', error: Error): void
  (e: 'state-change', state: ViewerState): void
}
