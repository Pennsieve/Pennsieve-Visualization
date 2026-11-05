import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChannelInfo, EventChannelInfo, EventWindow } from '@pennsieve/timeseries-zarr-reader'

// The reader client the functions under test read through.
const bundle = vi.hoisted(() => ({ client: undefined as unknown }))

vi.mock('./streaming/clientRegistry', () => ({
    getClient: () => (bundle.client ? { client: bundle.client } : undefined)
}))

const {
    isBundleLayerId,
    loadBundleDescription,
    loadBundleLayers,
    queryBundleLayer,
    textToDescription,
    windowToAnnotations
} = await import('./useBundleAnnotations')

afterEach(() => {
    bundle.client = undefined
})

const marks: EventChannelInfo = {
    kind: 'event',
    index: 3,
    id: 'marks',
    name: 'Clinical marks',
    eventCount: 2,
    columns: ['durations', 'labels', 'text'],
    labelNames: ['seizure', 'spike'],
    maxDurationUs: 3000,
    hasWaveformMean: false,
    countLevels: 0
}

const spikes: EventChannelInfo = {
    kind: 'event',
    index: 4,
    id: 'units',
    name: 'Units',
    eventCount: 9,
    columns: ['labels', 'waveforms'],
    hasWaveformMean: true,
    countLevels: 0
}

const eeg: ChannelInfo = {
    kind: 'continuous',
    index: 0,
    id: 'eeg',
    name: 'EEG',
    unit: 'uV',
    rateHz: 250,
    startUs: 0,
    endUs: 1000,
    runs: 1
}

const window = (over: Partial<EventWindow> = {}): EventWindow => ({
    channel: 'marks',
    startUs: 0,
    endUs: 5000,
    times: Float64Array.from([1000, 2000]),
    durations: Float64Array.from([500, 0]),
    labels: Uint16Array.from([1, 0]),
    text: ['{"description":"left temporal spikes","ts_annotation_id":"7"}', 'plain note'],
    ...over
})

/** A client that answers one window per event query and records the queries. */
function openBundle(answer: EventWindow = window()) {
    const queries: unknown[] = []
    bundle.client = {
        channelInfo: async () => [eeg, marks, spikes],
        queryEvents: async function* (params: unknown) {
            queries.push(params)
            yield answer
        }
    }
    return queries
}

describe('useBundleAnnotations', () => {
    it('recognises bundle layer ids and nothing else', () => {
        expect(isBundleLayerId('bundle:marks')).toBe(true)
        expect(isBundleLayerId(12)).toBe(false)
        expect(isBundleLayerId('12')).toBe(false)
        expect(isBundleLayerId(undefined)).toBe(false)
    })

    it('shows a JSON body by its description and anything else as stored', () => {
        expect(textToDescription('{"description":"left temporal spikes"}')).toBe('left temporal spikes')
        expect(textToDescription('{"other":1}')).toBe('{"other":1}')
        expect(textToDescription('{not json')).toBe('{not json')
        expect(textToDescription('plain note')).toBe('plain note')
        expect(textToDescription(undefined)).toBeUndefined()
    })

    it('converts a window to the annotation shape the renderer draws', () => {
        const annotations = windowToAnnotations(window(), marks, 'bundle:marks', 2)

        expect(annotations).toHaveLength(2)
        expect(annotations[0]).toMatchObject({
            id: 'bundle:marks:1000',
            label: 'spike',
            description: 'left temporal spikes',
            start: 1000,
            duration: 500,
            end: 1500,
            channelIds: [],
            allChannels: true,
            layer_id: 'bundle:marks'
        })
        expect(annotations[1]).toMatchObject({ id: 'bundle:marks:2000', label: 'seizure', description: 'plain note', duration: 0 })
    })

    it('scopes an event to its channels unless it names every one on screen', () => {
        const scoped = windowToAnnotations(window({ channels: [['eeg'], ['eeg', 'other']] }), marks, 'bundle:marks', 2)
        expect(scoped[0]).toMatchObject({ channelIds: ['eeg'], allChannels: false })
        expect(scoped[1]).toMatchObject({ channelIds: ['eeg', 'other'], allChannels: true })
    })

    it('falls back to the channel name for an unlabeled event, and to no description without text', () => {
        const bare = windowToAnnotations(window({ labels: undefined, text: undefined }), marks, 'bundle:marks', 2)
        expect(bare[0].label).toBe('Clinical marks')
        expect(bare[0].description).toBeUndefined()
    })

    it('numbers events that share an onset so their ids stay distinct', () => {
        const ids = windowToAnnotations(
            window({ times: Float64Array.from([5, 5, 5]), durations: undefined, labels: undefined, text: undefined }),
            marks, 'bundle:marks', 2
        ).map((a) => a.id)
        expect(ids).toEqual(['bundle:marks:5', 'bundle:marks:5:1', 'bundle:marks:5:2'])
    })

    it('lists the annotation channels as layers, not the spike channels, and reads no annotations', async () => {
        const queries = openBundle()

        const layers = await loadBundleLayers('viewer-1')

        expect(layers.map((l) => [l.id, l.name, l.annotations])).toEqual([
            ['bundle:marks', 'Clinical marks', []]
        ])
        expect(queries).toEqual([])
    })

    it('has no layers when the viewer has no bundle open', async () => {
        expect(await loadBundleLayers('viewer-1')).toEqual([])
    })

    it('reads a layer\'s window with the columns the viewer draws', async () => {
        const queries = openBundle()

        const read = await queryBundleLayer('viewer-1', 'bundle:marks', 0, 5000, 500, 2)

        expect(queries).toEqual([
            { channels: ['marks'], startUs: 0, endUs: 5000, columns: ['durations', 'labels', 'text', 'channels'] }
        ])
        expect(read?.endUs).toBe(5000)
        expect(read?.annotations.map((a) => a.start)).toEqual([1000, 2000])
    })

    it('reads nothing for a layer whose channel the bundle no longer has', async () => {
        openBundle()
        expect(await queryBundleLayer('viewer-1', 'bundle:gone', 0, 5000, 500, 2)).toBeNull()
    })

    it('answers a description request from the annotation itself', async () => {
        openBundle()
        const [annotation] = windowToAnnotations(window(), marks, 'bundle:marks', 2)
        expect(await loadBundleDescription('viewer-1', annotation)).toBe('left temporal spikes')
    })

    it('reads no description for an annotation from the API', async () => {
        openBundle()
        const annotation = { ...windowToAnnotations(window(), marks, 'bundle:marks', 2)[0], layer_id: 12 }
        expect(await loadBundleDescription('viewer-1', annotation)).toBeUndefined()
    })
})
