import { describe, it, expect } from 'vitest'
import { adaptivePageSize, rawBudgetPageSize, BASE_PAGE_SIZE } from './paging'

const SECOND = 1000000

describe('adaptivePageSize', () => {
    it('returns the base span for windows up to one base page', () => {
        expect(adaptivePageSize(1 * SECOND)).toBe(BASE_PAGE_SIZE)
        expect(adaptivePageSize(15 * SECOND)).toBe(BASE_PAGE_SIZE)
    })

    it('doubles the span as the window grows', () => {
        expect(adaptivePageSize(30 * SECOND)).toBe(2 * BASE_PAGE_SIZE)
        expect(adaptivePageSize(60 * SECOND)).toBe(4 * BASE_PAGE_SIZE)
        expect(adaptivePageSize(61 * SECOND)).toBe(8 * BASE_PAGE_SIZE)
        expect(adaptivePageSize(120 * SECOND)).toBe(8 * BASE_PAGE_SIZE)
        expect(adaptivePageSize(240 * SECOND)).toBe(16 * BASE_PAGE_SIZE)
        expect(adaptivePageSize(400 * SECOND)).toBe(32 * BASE_PAGE_SIZE)
        expect(adaptivePageSize(600 * SECOND)).toBe(64 * BASE_PAGE_SIZE)
    })

    it('returns a span at least as wide as the viewport', () => {
        for (const seconds of [15, 30, 61, 100, 200, 300, 400, 600]) {
            const duration = seconds * SECOND
            const span = adaptivePageSize(duration)
            expect(Math.ceil(duration / span)).toBe(1)
        }
    })

    it('covers the viewport with at most two pages from any start', () => {
        for (const seconds of [15, 30, 61, 100, 200, 300, 400, 600]) {
            const duration = seconds * SECOND
            const span = adaptivePageSize(duration)
            for (const start of [0, 1, span - 1, span / 3, 7 * span + 11]) {
                const first = Math.floor(start / span)
                const last = Math.floor((start + duration - 1) / span)
                expect(last - first + 1).toBeLessThanOrEqual(2)
            }
        }
    })

    it('returns spans whose boundaries nest across zoom levels', () => {
        let previous = adaptivePageSize(15 * SECOND)
        for (const seconds of [61, 130, 250, 500]) {
            const span = adaptivePageSize(seconds * SECOND)
            expect(span % previous).toBe(0)
            previous = span
        }
    })

    it('returns the base span for a non-positive or non-finite duration', () => {
        expect(adaptivePageSize(0)).toBe(BASE_PAGE_SIZE)
        expect(adaptivePageSize(-5)).toBe(BASE_PAGE_SIZE)
        expect(adaptivePageSize(NaN)).toBe(BASE_PAGE_SIZE)
        expect(adaptivePageSize(Infinity)).toBe(BASE_PAGE_SIZE)
    })
})

describe('rawBudgetPageSize', () => {
    const MB = 1_000_000

    it('fits 103 channels at 512 Hz under the viewer cap in 240 s pages', () => {
        // 103 x 512 x 4 bytes is 211 kB per second; 60 MB lasts 284 s, and the largest
        // power-of-two multiple of 15 s under that is 240 s.
        expect(rawBudgetPageSize(103, 512, false, 60 * MB)).toBe(16 * BASE_PAGE_SIZE)
    })

    it('fits the same channels under the reader default in 60 s pages', () => {
        expect(rawBudgetPageSize(103, 512, false, 15 * MB)).toBe(4 * BASE_PAGE_SIZE)
    })

    it('counts a montage pair as two channels', () => {
        expect(rawBudgetPageSize(51, 512, true, 60 * MB)).toBe(rawBudgetPageSize(102, 512, false, 60 * MB))
    })

    it('never returns less than the base span', () => {
        expect(rawBudgetPageSize(1000, 30000, true, 15 * MB)).toBe(BASE_PAGE_SIZE)
        expect(rawBudgetPageSize(103, 512, false, 1)).toBe(BASE_PAGE_SIZE)
    })

    it('returns the base span for a count, rate, or cap that is not positive', () => {
        expect(rawBudgetPageSize(0, 512, false, 60 * MB)).toBe(BASE_PAGE_SIZE)
        expect(rawBudgetPageSize(10, 0, false, 60 * MB)).toBe(BASE_PAGE_SIZE)
        expect(rawBudgetPageSize(10, 512, false, 0)).toBe(BASE_PAGE_SIZE)
        expect(rawBudgetPageSize(NaN, 512, false, 60 * MB)).toBe(BASE_PAGE_SIZE)
    })

    it('keeps every span under the cap and on the adaptive grid', () => {
        for (const count of [1, 4, 64, 103, 256]) {
            for (const rate of [250, 512, 1000, 30000]) {
                for (const montaged of [false, true]) {
                    const span = rawBudgetPageSize(count, rate, montaged, 60 * MB)
                    const bytes = (span / SECOND) * count * rate * 4 * (montaged ? 2 : 1)
                    if (span > BASE_PAGE_SIZE) {
                        expect(bytes).toBeLessThanOrEqual(60 * MB)
                    }
                    expect(Math.log2(span / BASE_PAGE_SIZE) % 1).toBe(0)
                }
            }
        }
    })
})
