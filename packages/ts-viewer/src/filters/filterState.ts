// filters/filterState.ts
//
// Translation from the filter modal's payload to the legacy wire message. The wire
// shapes themselves live in @/composables/streaming/filters.

import type { LegacyFilterMessage } from '@/composables/streaming/filters'

/** Payload of the filter modal's setFilters event. */
export interface FilterPayload {
    filterType: string
    selChannels: string[]
    input0?: number | string
    input1?: number | string
    notchFreq?: number
}

/** Filter order in every message. The legacy service expects this value. */
export const BUTTERWORTH_ORDER = 4

/**
 * Full width of the bandstop notch in Hz, centered on the requested notch frequency.
 * The legacy service expects this value, and the modal cannot change it.
 */
export const BANDSTOP_WIDTH_HZ = 10

/**
 * Reads the two frequency inputs of the modal. Either is NaN when the filter type
 * leaves that field empty.
 */
export const parseFilterInputs = (payload: FilterPayload): { input0: number; input1: number } => {
    return {
        input0: parseFloat(String(payload.input0)),
        input1: parseFloat(String(payload.input1))
    }
}

/**
 * Builds the wire message for one filter payload. Returns null for a filter type the
 * legacy service has no message for.
 */
export const buildFilterMessage = (payload: FilterPayload): LegacyFilterMessage | null => {
    const { input0, input1 } = parseFilterInputs(payload)

    switch (payload.filterType) {
        case 'clear':
            return { channelFiltersToClear: payload.selChannels }
        case 'bandpass': {
            // The modal collects a low and a high band edge; the service takes a center
            // frequency and a half width.
            const center = (input0 + input1) / 2
            const halfWidth = Math.abs((input1 - input0) / 2)
            return {
                filter: 'bandpass',
                filterParameters: [BUTTERWORTH_ORDER, center, halfWidth],
                channels: payload.selChannels
            }
        }
        case 'highpass':
            return {
                filter: 'highpass',
                filterParameters: [BUTTERWORTH_ORDER, input0],
                channels: payload.selChannels
            }
        case 'lowpass':
            return {
                filter: 'lowpass',
                filterParameters: [BUTTERWORTH_ORDER, input0],
                channels: payload.selChannels
            }
        case 'bandstop':
            // notchFreq travels unparsed. A payload without one reaches the wire as
            // undefined, and the reader ignores a message it cannot read parameters from.
            return {
                filter: 'bandstop',
                filterParameters: [BUTTERWORTH_ORDER, payload.notchFreq!, BANDSTOP_WIDTH_HZ],
                channels: payload.selChannels
            }
        default:
            return null
    }
}
