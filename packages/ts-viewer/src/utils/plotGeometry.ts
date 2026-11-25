// utils/plotGeometry.ts

/** Strip at the bottom of the plot area that traces do not use, in CSS pixels. */
export const PLOT_BOTTOM_MARGIN = 20

/**
 * Height the channel rows share, in CSS pixels. The trace canvases and the label column
 * both divide this by the channel count, so a name sits on its own trace.
 */
export const plotHeightFor = (cHeight: number) => cHeight - PLOT_BOTTOM_MARGIN
