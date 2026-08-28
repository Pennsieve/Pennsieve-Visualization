// utils/playbackStep.ts

/** Recording time one playback tick advances at the widest windows, in microseconds. */
export const MAX_PLAYBACK_STEP_US = 1000000

/** Wall-clock time between playback ticks at 1x, in milliseconds. */
export const PLAYBACK_TICK_MS = 150

/** Shortest wall-clock time between playback ticks, in milliseconds. */
export const MIN_PLAYBACK_TICK_MS = 16

/**
 * Recording time one playback tick advances, in microseconds.
 *
 * Capped at three quarters of the window, the step the page buttons take, so playback
 * never steps over a stretch it did not draw. A window of a second and a third or wider
 * takes `MAX_PLAYBACK_STEP_US` instead, which is the step every window used to take.
 *
 * @param durationUs Viewport duration, in microseconds.
 * @returns Step, at most `MAX_PLAYBACK_STEP_US`.
 */
export function playbackStepFor(durationUs: number): number {
    if (!Number.isFinite(durationUs) || durationUs <= 0) {
        return MAX_PLAYBACK_STEP_US
    }
    return Math.min(MAX_PLAYBACK_STEP_US, (3 / 4) * durationUs)
}

/**
 * Wall-clock time between playback ticks, in milliseconds.
 *
 * The speed control changes the rate rather than the step, so no speed can step over a
 * stretch the viewport did not draw.
 *
 * @param speed Multiplier from the playback speed control.
 * @returns Period, at least `MIN_PLAYBACK_TICK_MS`.
 */
export function playbackPeriodFor(speed: number | null): number {
    if (!Number.isFinite(speed) || speed! <= 0) {
        return PLAYBACK_TICK_MS
    }
    return Math.max(MIN_PLAYBACK_TICK_MS, PLAYBACK_TICK_MS / speed!)
}
