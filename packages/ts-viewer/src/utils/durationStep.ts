// utils/durationStep.ts

/**
 * Spinner increment for the duration input, in seconds.
 *
 * The increment matches the window's own decade. Crossing a decade therefore takes about
 * nine clicks at any scale. A window sitting exactly on a decade boundary takes the
 * increment from the decade below it. That keeps one step down clear of zero, so 10 steps
 * down to 9.
 *
 * @param durationSeconds Current window length, in seconds.
 * @returns Increment, at least 0.01.
 */
export function durationStepFor(durationSeconds: number | undefined): number {
    if (!Number.isFinite(durationSeconds) || durationSeconds! <= 0.1) {
        return 0.01
    }
    if (durationSeconds! <= 1) {
        return 0.1
    }
    if (durationSeconds! <= 10) {
        return 1
    }
    if (durationSeconds! <= 100) {
        return 10
    }
    return 100
}

/**
 * Decimal places the duration input accepts. A short window takes hundredths of a second.
 * A long one stays whole.
 *
 * @param durationSeconds Current window length, in seconds.
 * @returns Decimal places, 0 to 2.
 */
export function durationPrecisionFor(durationSeconds: number): number {
    if (!Number.isFinite(durationSeconds) || durationSeconds < 1) {
        return 2
    }
    if (durationSeconds < 10) {
        return 1
    }
    return 0
}
