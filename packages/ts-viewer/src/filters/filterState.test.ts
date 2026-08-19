import { describe, it, expect } from 'vitest'
import { BANDSTOP_WIDTH_HZ, BUTTERWORTH_ORDER, buildFilterMessage, parseFilterInputs } from './filterState'

const selChannels = ['ch-1', 'ch-2']

describe('parseFilterInputs', () => {
    it('reads a numeric string input', () => {
        expect(parseFilterInputs({ filterType: 'bandpass', selChannels, input0: '1', input1: '70' }))
            .toEqual({ input0: 1, input1: 70 })
    })

    it('reads an empty input as NaN', () => {
        const inputs = parseFilterInputs({ filterType: 'lowpass', selChannels, input0: 30 })

        expect(inputs.input0).toBe(30)
        expect(inputs.input1).toBeNaN()
    })
})

describe('buildFilterMessage', () => {
    it('sends the cutoff frequency for a lowpass', () => {
        expect(buildFilterMessage({ filterType: 'lowpass', selChannels, input0: 30 })).toEqual({
            filter: 'lowpass',
            filterParameters: [BUTTERWORTH_ORDER, 30],
            channels: selChannels
        })
    })

    it('sends the cutoff frequency for a highpass', () => {
        expect(buildFilterMessage({ filterType: 'highpass', selChannels, input0: 0.5 })).toEqual({
            filter: 'highpass',
            filterParameters: [BUTTERWORTH_ORDER, 0.5],
            channels: selChannels
        })
    })

    it('converts the bandpass edges to a center and a half width', () => {
        expect(buildFilterMessage({ filterType: 'bandpass', selChannels, input0: 1, input1: 70 })).toEqual({
            filter: 'bandpass',
            filterParameters: [BUTTERWORTH_ORDER, 35.5, 34.5],
            channels: selChannels
        })
    })

    it('keeps the bandpass half width positive when the edges arrive reversed', () => {
        expect(buildFilterMessage({ filterType: 'bandpass', selChannels, input0: 70, input1: 1 })).toEqual({
            filter: 'bandpass',
            filterParameters: [BUTTERWORTH_ORDER, 35.5, 34.5],
            channels: selChannels
        })
    })

    it('centers the bandstop notch on the requested frequency', () => {
        expect(buildFilterMessage({ filterType: 'bandstop', selChannels, notchFreq: 60 })).toEqual({
            filter: 'bandstop',
            filterParameters: [BUTTERWORTH_ORDER, 60, BANDSTOP_WIDTH_HZ],
            channels: selChannels
        })
    })

    it('ignores the frequency inputs of a bandstop', () => {
        expect(buildFilterMessage({ filterType: 'bandstop', selChannels, input0: 1, input1: 70, notchFreq: 60 }))
            .toEqual({
                filter: 'bandstop',
                filterParameters: [BUTTERWORTH_ORDER, 60, BANDSTOP_WIDTH_HZ],
                channels: selChannels
            })
    })

    it('names the channels to clear instead of a filter', () => {
        expect(buildFilterMessage({ filterType: 'clear', selChannels })).toEqual({
            channelFiltersToClear: selChannels
        })
    })

    it('returns null for an unknown filter type', () => {
        expect(buildFilterMessage({ filterType: 'notch', selChannels, input0: 60 })).toBeNull()
    })

    it('sends order 4 in every filter message', () => {
        expect(BUTTERWORTH_ORDER).toBe(4)
        expect(BANDSTOP_WIDTH_HZ).toBe(10)
    })
})
