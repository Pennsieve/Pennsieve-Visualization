import { describe, expect, it } from 'vitest'
import type { EventChannelInfo, EventRecord } from '@pennsieve/timeseries-zarr-reader'
import { bodyToDescription, eventToAnnotation, isBundleLayerId } from './useBundleAnnotations'

const channel: EventChannelInfo = {
    id: 'marks',
    name: 'Clinical marks',
    count: 2,
    labelNames: ['spike'],
    bodyMediaType: 'application/json',
    maxDurationUs: 3000
}

const event = (over: Partial<EventRecord> = {}): EventRecord => ({
    index: 4,
    timeUs: 1000,
    durationUs: 0,
    label: 'spike',
    body: '{"description":"RC1-3","ts_annotation_id":"38411834"}',
    channels: [],
    ...over
})

describe('useBundleAnnotations', () => {
    it('recognises bundle layer ids and nothing else', () => {
        expect(isBundleLayerId('bundle:marks')).toBe(true)
        expect(isBundleLayerId(12)).toBe(false)
        expect(isBundleLayerId('12')).toBe(false)
        expect(isBundleLayerId(undefined)).toBe(false)
    })

    it('shows a JSON body by its description and anything else as stored', () => {
        expect(bodyToDescription('{"description":"RC1-3"}', 'application/json')).toBe('RC1-3')
        expect(bodyToDescription('{"other":1}', 'application/json')).toBe('{"other":1}')
        expect(bodyToDescription('not json', 'application/json')).toBe('not json')
        expect(bodyToDescription('{"description":"x"}', 'text/plain')).toBe('{"description":"x"}')
        expect(bodyToDescription(undefined, 'application/json')).toBeUndefined()
    })

    it('converts an event to the annotation shape the renderer draws', () => {
        expect(eventToAnnotation(event({ durationUs: 500 }), channel, 'bundle:marks', 2)).toMatchObject({
            id: 'bundle:marks:4',
            label: 'spike',
            description: 'RC1-3',
            start: 1000,
            duration: 500,
            end: 1500,
            channelIds: [],
            allChannels: true,
            layer_id: 'bundle:marks'
        })
    })

    it('scopes an event to its channels unless it names every one on screen', () => {
        expect(eventToAnnotation(event({ channels: ['0'] }), channel, 'bundle:marks', 2).allChannels).toBe(false)
        expect(eventToAnnotation(event({ channels: ['0', '1'] }), channel, 'bundle:marks', 2).allChannels).toBe(true)
    })

    it('falls back to the channel name for an unlabeled event', () => {
        expect(eventToAnnotation(event({ label: undefined }), channel, 'bundle:marks', 2).label).toBe('Clinical marks')
    })
})
