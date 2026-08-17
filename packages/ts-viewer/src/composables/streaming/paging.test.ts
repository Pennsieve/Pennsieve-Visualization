import { describe, it, expect } from 'vitest'
import { adaptivePageSize, BASE_PAGE_SIZE } from './paging'

const SECOND = 1000000

describe('adaptivePageSize', () => {
    it('returns the base span for windows up to four base pages', () => {
        expect(adaptivePageSize(1 * SECOND)).toBe(BASE_PAGE_SIZE)
        expect(adaptivePageSize(15 * SECOND)).toBe(BASE_PAGE_SIZE)
        expect(adaptivePageSize(60 * SECOND)).toBe(BASE_PAGE_SIZE)
    })

    it('doubles the span as the window grows', () => {
        expect(adaptivePageSize(61 * SECOND)).toBe(2 * BASE_PAGE_SIZE)
        expect(adaptivePageSize(120 * SECOND)).toBe(2 * BASE_PAGE_SIZE)
        expect(adaptivePageSize(240 * SECOND)).toBe(4 * BASE_PAGE_SIZE)
        expect(adaptivePageSize(400 * SECOND)).toBe(8 * BASE_PAGE_SIZE)
        expect(adaptivePageSize(600 * SECOND)).toBe(16 * BASE_PAGE_SIZE)
    })

    it('covers the viewport with at most four spans', () => {
        for (const seconds of [15, 30, 61, 100, 200, 300, 400, 600]) {
            const duration = seconds * SECOND
            const span = adaptivePageSize(duration)
            expect(Math.ceil(duration / span)).toBeLessThanOrEqual(4)
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
