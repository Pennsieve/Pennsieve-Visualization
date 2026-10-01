import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventChannelInfo, EventRecord } from '@pennsieve/timeseries-zarr-reader'

// The reader client the functions under test read through.
const bundle = vi.hoisted(() => ({ client: undefined as unknown }))

vi.mock('./streaming/clientRegistry', () => ({
    getClient: () => (bundle.client ? { client: bundle.client } : undefined)
}))

const {
    bodyToDescription,
    eventToAnnotation,
    isBundleLayerId,
    loadBundleDescription,
    loadBundleLayers
} = await import('./useBundleAnnotations')

afterEach(() => {
    bundle.client = undefined
})

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
    body: '{"description":"left temporal spikes","source_id":"7"}',
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
        expect(bodyToDescription('{"description":"left temporal spikes"}', 'application/json')).toBe('left temporal spikes')
        expect(bodyToDescription('{"other":1}', 'application/json')).toBe('{"other":1}')
        expect(bodyToDescription('not json', 'application/json')).toBe('not json')
        expect(bodyToDescription('{"description":"x"}', 'text/plain')).toBe('{"description":"x"}')
        expect(bodyToDescription(undefined, 'application/json')).toBeUndefined()
    })

    it('converts an event to the annotation shape the renderer draws', () => {
        expect(eventToAnnotation(event({ durationUs: 500 }), channel, 'bundle:marks', 2)).toMatchObject({
            id: 'bundle:marks:4',
            label: 'spike',
            description: 'left temporal spikes',
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

    it('lists the bundle\'s layers without reading any annotations', async () => {
        const queryEvents = vi.fn()
        bundle.client = { eventChannels: async () => [channel], queryEvents }

        const layers = await loadBundleLayers('viewer-1')

        expect(layers.map((l) => [l.id, l.name, l.annotations])).toEqual([
            ['bundle:marks', 'Clinical marks', []]
        ])
        expect(queryEvents).not.toHaveBeenCalled()
    })

    it('has no layers when the viewer has no bundle open', async () => {
        expect(await loadBundleLayers('viewer-1')).toEqual([])
    })

    it('reads one annotation\'s description by the event it came from', async () => {
        const eventBody = vi.fn(async () => '{"description":"left temporal spikes"}')
        bundle.client = { eventChannels: async () => [channel], eventBody }
        const annotation = eventToAnnotation(event({ body: undefined }), channel, 'bundle:marks', 2)

        expect(annotation.description).toBeUndefined()
        expect(await loadBundleDescription('viewer-1', annotation)).toBe('left temporal spikes')
        expect(eventBody).toHaveBeenCalledWith({ channel: 'marks', index: 4 })
    })

    it('reads no description for an annotation from the API', async () => {
        const eventBody = vi.fn()
        bundle.client = { eventChannels: async () => [channel], eventBody }
        const annotation = { ...eventToAnnotation(event(), channel, 'bundle:marks', 2), layer_id: 12 }

        expect(await loadBundleDescription('viewer-1', annotation)).toBeUndefined()
        expect(eventBody).not.toHaveBeenCalled()
    })
})
