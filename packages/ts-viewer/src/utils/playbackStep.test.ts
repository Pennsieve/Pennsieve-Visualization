import { describe, expect, it } from 'vitest'
import {
    MAX_PLAYBACK_STEP_US,
    MIN_PLAYBACK_TICK_MS,
    PLAYBACK_TICK_MS,
    playbackPeriodFor,
    playbackStepFor
} from './playbackStep'

describe('playbackStepFor', () => {
    it('steps the fixed second at windows of a second and a third or wider', () => {
        expect(playbackStepFor(15_000_000)).toBe(MAX_PLAYBACK_STEP_US)
        expect(playbackStepFor(2_000_000)).toBe(MAX_PLAYBACK_STEP_US)
    })

    it('steps three quarters of the window below that', () => {
        expect(playbackStepFor(100_000)).toBe(75_000)
        expect(playbackStepFor(1_000_000)).toBe(750_000)
    })

    it('never steps over a stretch the window did not cover', () => {
        for (const duration of [1_000, 100_000, 500_000, 1_333_333, 15_000_000]) {
            expect(playbackStepFor(duration)).toBeLessThanOrEqual(duration)
        }
    })

    it('falls back to the fixed second for a window that is zero or unusable', () => {
        expect(playbackStepFor(0)).toBe(MAX_PLAYBACK_STEP_US)
        expect(playbackStepFor(Number.NaN)).toBe(MAX_PLAYBACK_STEP_US)
    })
})

describe('playbackPeriodFor', () => {
    it('ticks at the base period at 1x', () => {
        expect(playbackPeriodFor(1)).toBe(PLAYBACK_TICK_MS)
    })

    it('ticks faster above 1x and slower below it', () => {
        expect(playbackPeriodFor(2)).toBe(75)
        expect(playbackPeriodFor(0.5)).toBe(300)
    })

    it('holds the period at the floor for the fastest speed', () => {
        expect(playbackPeriodFor(10)).toBe(MIN_PLAYBACK_TICK_MS)
    })

    it('falls back to the base period when no speed is selected', () => {
        expect(playbackPeriodFor(null)).toBe(PLAYBACK_TICK_MS)
        expect(playbackPeriodFor(0)).toBe(PLAYBACK_TICK_MS)
    })
})
