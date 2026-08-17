import { describe, it, expect } from 'vitest'
import { legacyFilterToSpec, validateSpecForRate, specSignature } from './filters'
import type { LegacyBandFilterMessage, LegacyCutoffFilterMessage } from './filters'

// Verbatim algebra from TSViewerCanvas.vue setFilters, so the round-trip tests
// exercise the numbers the viewer actually puts on the wire.
const wireBandpass = (input0: number, input1: number, channels = ['ch']): LegacyBandFilterMessage => ({
    filter: 'bandpass',
    filterParameters: [4, (input0 + input1) / 2, Math.abs((input1 - input0) / 2)],
    channels
})

const wireBandstop = (notchFreq: number, channels = ['ch']): LegacyBandFilterMessage => ({
    filter: 'bandstop',
    filterParameters: [4, notchFreq, 10],
    channels
})

describe('legacyFilterToSpec', () => {
    it('maps lowpass [order, cutoff]', () => {
        expect(legacyFilterToSpec({
            filter: 'lowpass',
            filterParameters: [4, 60],
            channels: ['a', 'b']
        })).toEqual({
            kind: 'set',
            spec: { type: 'lowpass', order: 4, cutoffHz: 60 },
            channels: ['a', 'b']
        })
    })

    it('maps highpass [order, cutoff]', () => {
        expect(legacyFilterToSpec({
            filter: 'highpass',
            filterParameters: [4, 0.5],
            channels: ['a']
        })).toEqual({
            kind: 'set',
            spec: { type: 'highpass', order: 4, cutoffHz: 0.5 },
            channels: ['a']
        })
    })

    it('maps bandpass [order, center, halfWidth] to band edges', () => {
        expect(legacyFilterToSpec(wireBandpass(1, 100))).toEqual({
            kind: 'set',
            spec: { type: 'bandpass', order: 4, lowHz: 1, highHz: 100 },
            channels: ['ch']
        })
    })

    it('maps bandstop as a symmetric band around the notch (half-width assumption)', () => {
        expect(legacyFilterToSpec(wireBandstop(60))).toEqual({
            kind: 'set',
            spec: { type: 'bandstop', order: 4, lowHz: 50, highHz: 70 },
            channels: ['ch']
        })
    })

    it('recovers the user endpoints exactly for the viewer bandpass algebra', () => {
        const pairs = [[1, 100], [0.5, 70], [5, 50], [2.5, 97.5], [13, 17], [1, 59]]
        for (const [input0, input1] of pairs) {
            const out = legacyFilterToSpec(wireBandpass(input0, input1))
            expect(out.kind).toBe('set')
            expect(out.spec.lowHz).toBe(input0)
            expect(out.spec.highHz).toBe(input1)
        }
    })

    it('recovers reversed endpoints too (halfWidth is an absolute value)', () => {
        const out = legacyFilterToSpec(wireBandpass(100, 1))
        expect(out.spec.lowHz).toBe(1)
        expect(out.spec.highHz).toBe(100)
    })

    // Pins a known limit: the viewer's halving rounds first, so bit-exact
    // recovery is impossible for some decimal pairs. Residual is ~1e-15.
    it('recovers decimal endpoints to within float noise, not bit-exactly', () => {
        const out = legacyFilterToSpec(wireBandpass(0.1, 59.9))
        expect(out.spec.lowHz).not.toBe(0.1)
        expect(out.spec.lowHz).toBeCloseTo(0.1, 12)
        expect(out.spec.highHz).toBe(59.9)
    })

    it('coerces a string notch frequency instead of concatenating it', () => {
        const out = legacyFilterToSpec({
            filter: 'bandstop',
            filterParameters: [4, '60', 10],
            channels: ['ch']
        })
        expect(out.spec).toEqual({ type: 'bandstop', order: 4, lowHz: 50, highHz: 70 })
    })

    it('reads the clear message', () => {
        expect(legacyFilterToSpec({ channelFiltersToClear: ['a', 'b'] })).toEqual({
            kind: 'clear',
            channels: ['a', 'b']
        })
    })

    it('copies channel arrays rather than aliasing the wire message', () => {
        const msg = { channelFiltersToClear: ['a'] }
        const out = legacyFilterToSpec(msg)
        out.channels.push('b')
        expect(msg.channelFiltersToClear).toEqual(['a'])
    })

    it('accepts an empty clear list', () => {
        expect(legacyFilterToSpec({ channelFiltersToClear: [] })).toEqual({
            kind: 'clear',
            channels: []
        })
    })

    it('defaults missing channels on a set message to an empty list', () => {
        const out = legacyFilterToSpec({ filter: 'lowpass', filterParameters: [4, 60] })
        expect(out.kind).toBe('set')
        expect(out.channels).toEqual([])
    })

    it('ignores an unknown filter name', () => {
        const out = legacyFilterToSpec({
            filter: 'notch',
            filterParameters: [4, 60],
            channels: ['a']
        })
        expect(out.kind).toBe('ignore')
        expect(out.reason).toContain('notch')
    })

    it('ignores missing filterParameters', () => {
        expect(legacyFilterToSpec({ filter: 'lowpass', channels: ['a'] }).kind).toBe('ignore')
    })

    it('ignores too-short filterParameters for a band filter', () => {
        const out = legacyFilterToSpec({
            filter: 'bandpass',
            filterParameters: [4, 30],
            channels: ['a']
        })
        expect(out.kind).toBe('ignore')
        expect(out.reason).toContain('3')
    })

    it('ignores non-numeric filterParameters', () => {
        expect(legacyFilterToSpec({
            filter: 'lowpass',
            filterParameters: [4, 'wide'],
            channels: ['a']
        }).kind).toBe('ignore')
    })

    it('ignores a non-array channelFiltersToClear', () => {
        expect(legacyFilterToSpec({ channelFiltersToClear: 'all' }).kind).toBe('ignore')
    })

    it('ignores malformed messages without throwing', () => {
        for (const msg of [null, undefined, 42, 'lowpass', [], {}, { montage: 'NOT_MONTAGED' }]) {
            const out = legacyFilterToSpec(msg)
            expect(out.kind).toBe('ignore')
            expect(typeof out.reason).toBe('string')
        }
    })
})

describe('validateSpecForRate', () => {
    const lowpass = (over?: object) => ({ type: 'lowpass', order: 4, cutoffHz: 60, ...over })
    const bandpass = (over?: object) => ({ type: 'bandpass', order: 4, lowHz: 1, highHz: 100, ...over })

    it('accepts an in-range cutoff filter', () => {
        expect(validateSpecForRate(lowpass(), 500)).toEqual({ ok: true })
    })

    it('accepts an in-range band filter', () => {
        expect(validateSpecForRate(bandpass(), 500)).toEqual({ ok: true })
    })

    it('accepts order 1 and order 12', () => {
        expect(validateSpecForRate(lowpass({ order: 1 }), 500).ok).toBe(true)
        expect(validateSpecForRate(lowpass({ order: 12 }), 500).ok).toBe(true)
    })

    it('rejects order 0, order 13 and a non-integer order', () => {
        for (const order of [0, 13, 4.5, -1, NaN, '4']) {
            const out = validateSpecForRate(lowpass({ order }), 500)
            expect(out.ok).toBe(false)
            expect(out.reason).toContain('order')
            expect(out.reason).toContain('12')
        }
    })

    it('rejects a cutoff of exactly 0', () => {
        const out = validateSpecForRate(lowpass({ cutoffHz: 0 }), 500)
        expect(out.ok).toBe(false)
        expect(out.reason).toContain('cutoffHz')
        expect(out.reason).toContain('0')
    })

    it('rejects a cutoff exactly at Nyquist and accepts just inside', () => {
        expect(validateSpecForRate(lowpass({ cutoffHz: 250 }), 500).ok).toBe(false)
        expect(validateSpecForRate(lowpass({ cutoffHz: 249.999 }), 500).ok).toBe(true)
    })

    it('names the Nyquist limit and the offending value', () => {
        const out = validateSpecForRate(lowpass({ cutoffHz: 300 }), 500)
        expect(out.reason).toContain('250')
        expect(out.reason).toContain('300')
    })

    it('rejects a negative or non-finite cutoff', () => {
        expect(validateSpecForRate(lowpass({ cutoffHz: -1 }), 500).ok).toBe(false)
        expect(validateSpecForRate(lowpass({ cutoffHz: NaN }), 500).ok).toBe(false)
    })

    it('checks both band edges against Nyquist', () => {
        expect(validateSpecForRate(bandpass({ lowHz: 0 }), 500).reason).toContain('lowHz')
        expect(validateSpecForRate(bandpass({ highHz: 250 }), 500).reason).toContain('highHz')
    })

    it('rejects lowHz equal to or above highHz', () => {
        for (const [lowHz, highHz] of [[30, 30], [40, 30]]) {
            const out = validateSpecForRate(bandpass({ lowHz, highHz }), 500)
            expect(out.ok).toBe(false)
            expect(out.reason).toContain('lowHz must be below highHz')
        }
    })

    it('rejects a spec against a missing or non-positive rate', () => {
        for (const rate of [0, -500, NaN, undefined]) {
            const out = validateSpecForRate(lowpass(), rate)
            expect(out.ok).toBe(false)
            expect(out.reason).toContain('rate')
        }
    })

    it('rejects a missing spec and an unsupported type', () => {
        expect(validateSpecForRate(null, 500).ok).toBe(false)
        expect(validateSpecForRate(undefined, 500).ok).toBe(false)
        expect(validateSpecForRate({ type: 'notch', order: 4 }, 500).reason).toContain('notch')
    })

    it('accepts a bandstop derived from a 60 Hz notch at 512 Hz', () => {
        const out = legacyFilterToSpec(wireBandstop(60))
        expect(validateSpecForRate(out.spec, 512)).toEqual({ ok: true })
    })

    it('rejects a 60 Hz notch on a 100 Hz channel (band edge past Nyquist)', () => {
        const out = legacyFilterToSpec(wireBandstop(60))
        expect(validateSpecForRate(out.spec, 100).ok).toBe(false)
    })
})

describe('specSignature', () => {
    it('is stable across key insertion order', () => {
        expect(specSignature({ type: 'lowpass', order: 4, cutoffHz: 60 }))
            .toBe(specSignature({ cutoffHz: 60, order: 4, type: 'lowpass' }))
        expect(specSignature({ type: 'bandpass', order: 4, lowHz: 1, highHz: 100 }))
            .toBe(specSignature({ highHz: 100, lowHz: 1, type: 'bandpass', order: 4 }))
    })

    it('differs when any field differs', () => {
        const seen = new Set([
            specSignature({ type: 'lowpass', order: 4, cutoffHz: 60 }),
            specSignature({ type: 'lowpass', order: 4, cutoffHz: 59 }),
            specSignature({ type: 'lowpass', order: 2, cutoffHz: 60 }),
            specSignature({ type: 'highpass', order: 4, cutoffHz: 60 }),
            specSignature({ type: 'bandpass', order: 4, lowHz: 1, highHz: 100 }),
            specSignature({ type: 'bandpass', order: 4, lowHz: 1, highHz: 99 }),
            specSignature({ type: 'bandpass', order: 4, lowHz: 2, highHz: 100 }),
            specSignature({ type: 'bandstop', order: 4, lowHz: 1, highHz: 100 })
        ])
        expect(seen.size).toBe(8)
    })

    it('separates float-drifted band edges from clean ones', () => {
        const drifted = legacyFilterToSpec(wireBandpass(0.1, 59.9)).spec
        expect(specSignature(drifted))
            .not.toBe(specSignature({ type: 'bandpass', order: 4, lowHz: 0.1, highHz: 59.9 }))
    })

    it('maps a missing spec to one fixed unfiltered sentinel', () => {
        expect(specSignature(undefined)).toBe(specSignature(null))
        expect(typeof specSignature(undefined)).toBe('string')
        expect(specSignature(undefined))
            .not.toBe(specSignature({ type: 'lowpass', order: 4, cutoffHz: 60 }))
    })

    it('still separates unknown spec shapes', () => {
        expect(specSignature({ type: 'notch', order: 4, freq: 60 }))
            .not.toBe(specSignature({ type: 'notch', order: 4, freq: 50 }))
    })

    it('groups two channels filtered from the same wire message', () => {
        const a = legacyFilterToSpec(wireBandpass(0.1, 59.9, ['a'])).spec
        const b = legacyFilterToSpec(wireBandpass(0.1, 59.9, ['b'])).spec
        expect(specSignature(a)).toBe(specSignature(b))
    })
})

describe('regression pins found by adversarial review', () => {
    it('reads the order from the wire rather than assuming 4', () => {
        // Every other fixture in this file uses order 4, so hardcoding it survived the suite.
        expect(legacyFilterToSpec({ filter: 'lowpass', filterParameters: [2, 60], channels: [] }).spec.order).toBe(2)
        expect(legacyFilterToSpec({ filter: 'bandpass', filterParameters: [6, 35.5, 34.5], channels: [] }).spec.order).toBe(6)
    })

    it('copies the channel list on the set branch, not just on clear', () => {
        const msg: LegacyCutoffFilterMessage = { filter: 'lowpass', filterParameters: [4, 60], channels: ['a'] }
        legacyFilterToSpec(msg).channels.push('b')
        expect(msg.channels).toEqual(['a'])
    })

    it('ignores a parameter that arrived as JSON null rather than reading it as 0 Hz', () => {
        // An untouched modal field is NaN, and JSON.stringify encodes NaN as null. Coercing
        // that to 0 would register a 0 Hz cutoff the reader rejects on every subsequent read.
        expect(legacyFilterToSpec({ filter: 'lowpass', filterParameters: [4, null], channels: ['a'] }).kind).toBe('ignore')
        expect(legacyFilterToSpec({ filter: 'bandstop', filterParameters: [4, null, 10], channels: ['a'] }).kind).toBe('ignore')
        // Classification must not depend on whether the message crossed JSON.
        expect(legacyFilterToSpec({ filter: 'lowpass', filterParameters: [4, NaN], channels: ['a'] }).kind).toBe('ignore')
    })
})
