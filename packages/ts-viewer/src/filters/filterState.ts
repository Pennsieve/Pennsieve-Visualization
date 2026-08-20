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

/** A frequency field of the filter modal. */
export type FilterInputField = 'input0' | 'input1' | 'notchFreq'

/**
 * The first frequency field the filter type needs and the payload does not carry as a
 * finite number. Returns null when the payload is complete, and for a filter type that
 * needs no frequency.
 */
export const missingFilterInput = (payload: FilterPayload): FilterInputField | null => {
    const { input0, input1 } = parseFilterInputs(payload)

    switch (payload.filterType) {
        case 'lowpass':
        case 'highpass':
            return Number.isFinite(input0) ? null : 'input0'
        case 'bandpass':
            if (!Number.isFinite(input0)) {
                return 'input0'
            }
            return Number.isFinite(input1) ? null : 'input1'
        case 'bandstop':
            return Number.isFinite(payload.notchFreq) ? null : 'notchFreq'
        default:
            return null
    }
}

/**
 * Builds the wire message for one filter payload. Returns null for a filter type the
 * legacy service has no message for, and for a payload that leaves a frequency the
 * filter type needs empty or non-finite.
 */
export const buildFilterMessage = (payload: FilterPayload): LegacyFilterMessage | null => {
    if (missingFilterInput(payload) !== null) {
        return null
    }

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
            // notchFreq travels unparsed; missingFilterInput has already refused a
            // payload that leaves it out.
            return {
                filter: 'bandstop',
                filterParameters: [BUTTERWORTH_ORDER, payload.notchFreq!, BANDSTOP_WIDTH_HZ],
                channels: payload.selChannels
            }
        default:
            return null
    }
}
