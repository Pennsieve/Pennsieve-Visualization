import { describe, it, expect } from 'vitest'
import { durationStepFor, durationPrecisionFor } from '@/utils/durationStep'

describe('durationStepFor', () => {
    it('matches the decade of the window', () => {
        expect(durationStepFor(0.05)).toBe(0.01)
        expect(durationStepFor(0.5)).toBe(0.1)
        expect(durationStepFor(5)).toBe(1)
        expect(durationStepFor(45)).toBe(10)
        expect(durationStepFor(150)).toBe(100)
    })

    it('takes the increment below the decade at an exact boundary', () => {
        expect(durationStepFor(0.1)).toBe(0.01)
        expect(durationStepFor(1)).toBe(0.1)
        expect(durationStepFor(10)).toBe(1)
        expect(durationStepFor(100)).toBe(10)
    })

    // 0.01 is the floor the duration input enforces. The down arrow is disabled there, so
    // the invariant covers every window longer than that floor.
    it('keeps one step down above zero for any window past the minimum', () => {
        for (let exponent = -2; exponent <= 3; exponent += 1) {
            for (const mantissa of [1, 1.5, 2, 5, 9, 9.9]) {
                const duration = mantissa * Math.pow(10, exponent)
                if (duration <= 0.01) {
                    continue
                }
                expect(duration - durationStepFor(duration)).toBeGreaterThan(0)
            }
        }
    })

    it('falls back to the smallest increment for a non-finite window', () => {
        expect(durationStepFor(NaN)).toBe(0.01)
        expect(durationStepFor(undefined)).toBe(0.01)
    })
})

describe('durationPrecisionFor', () => {
    it('gives more decimal places to shorter windows', () => {
        expect(durationPrecisionFor(0.05)).toBe(2)
        expect(durationPrecisionFor(0.9)).toBe(2)
        expect(durationPrecisionFor(1)).toBe(1)
        expect(durationPrecisionFor(9.9)).toBe(1)
        expect(durationPrecisionFor(10)).toBe(0)
        expect(durationPrecisionFor(150)).toBe(0)
    })

    it('never reports fewer decimal places than the increment needs', () => {
        for (const duration of [0.01, 0.1, 0.5, 1, 5, 10, 45, 100, 150, 1000]) {
            const decimals = (String(durationStepFor(duration)).split('.')[1] || '').length
            expect(durationPrecisionFor(duration)).toBeGreaterThanOrEqual(decimals)
        }
    })
})
