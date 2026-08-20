import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Annotation, AnnotationLayer } from '@/utils/annotationUtils'
import type { ActiveViewerContent, ViewerStore } from '@/stores/tsviewer'
import type { ChannelDetail } from '@/composables/streaming/channelDetails'
import type { ViewerMessage } from '@/events/emitter'

// The viewer store pulls in Amplify and the streaming client registry on import;
// neither exists in the node project and neither is exercised here.
vi.mock('@/composables/useToken', () => ({
    useToken: async () => 'a.jwt.token',
    useLogout: async () => undefined
}))

vi.mock('@/composables/useChannelDataRequest', () => ({
    useChannelDataRequest: () => ({ openConnection: async () => ({ res: [], status: 'ok' }) })
}))

vi.mock('@/composables/streaming/clientRegistry', () => ({
    acquireClient: async () => ({ url: '' }),
    ensureCatalog: async () => ({ details: [] }),
    disposeClient: () => undefined
}))

const { useTsAnnotation } = await import('@/composables/useTsAnnotation')
const { createViewerStore } = await import('@/stores/tsviewer')
const { unscopedViewerEmitter } = await import('@/events/emitter')

const API_URL = 'https://api.pennsieve.io'
const PACKAGE_ID = 'N:package:seizures'

interface RecordedRequest {
    url: string
    method: string
    headers: Record<string, string>
    body?: Record<string, unknown>
}

let requests: RecordedRequest[] = []
let respond: (url: string) => Response
let toasts: ViewerMessage[] = []
let ajaxErrors: ViewerMessage[] = []
let unsubscribes: Array<() => void> = []
let instanceSeq = 0

const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-type': 'application/json' } })

const content = (id: string): ActiveViewerContent => ({
    id,
    viewerAssetId: null,
    idType: 'package',
    assetType: null,
    url: null,
    onUrlExpired: null
})

const channelDetail = (id: string): ChannelDetail => ({
    id,
    name: id,
    channelType: 'CONTINUOUS',
    rate: 250,
    unit: 'uV',
    start: 0,
    end: 1_000_000,
    properties: []
})

const layer = (id: number, annotations: Annotation[] = []): AnnotationLayer => ({
    id,
    name: `Layer ${id}`,
    annotations,
    selected: id === 1
})

/** Resolves with the rejection reason, which is the raw Response for a failed request. */
const rejectionOf = async (pending: Promise<unknown>): Promise<unknown> =>
    pending.then(
        () => { throw new Error('expected the call to reject') },
        (reason: unknown) => reason
    )

const freshStore = (): ViewerStore => {
    const store = createViewerStore(`ts-annotation-${instanceSeq++}`)
    store.setViewerConfig({ apiUrl: API_URL })
    store.setActiveViewer({ content: content(PACKAGE_ID), channels: [] })
    store.setChannels([
        { id: 'ch1', selected: true, visible: true },
        { id: 'ch2', selected: true, visible: true }
    ])
    store.setAnnotations([layer(1)])
    return store
}

beforeEach(() => {
    setActivePinia(createPinia())
    requests = []
    toasts = []
    ajaxErrors = []
    respond = () => jsonResponse({})
    unsubscribes = [
        unscopedViewerEmitter.on('toast', message => toasts.push(message)),
        unscopedViewerEmitter.on('ajaxError', message => ajaxErrors.push(message))
    ]
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        requests.push({
            url,
            method: init?.method ?? 'GET',
            headers: (init?.headers ?? {}) as Record<string, string>,
            body: typeof init?.body === 'string'
                ? (JSON.parse(init.body) as Record<string, unknown>)
                : undefined
        })
        return respond(url)
    })
})

afterEach(() => {
    unsubscribes.forEach(off => off())
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('addAnnotation', () => {
    it('posts the annotation to its layer and stores the server copy', async () => {
        const store = freshStore()
        respond = () => jsonResponse({
            id: 42,
            label: 'Spike',
            description: 'a burst',
            start: 100,
            end: 150,
            channelIds: ['ch1', 'ch2'],
            userId: 'user-7'
        })

        const { addAnnotation } = useTsAnnotation(store)
        const created = await addAnnotation({
            label: 'Spike',
            description: 'a burst',
            start: 100,
            duration: 50,
            layer_id: 1,
            channelIds: ['ch1', 'ch2']
        })

        expect(requests).toHaveLength(1)
        expect(requests[0].url).toBe(
            `${API_URL}/timeseries/${PACKAGE_ID}/layers/1/annotations?api_key=a.jwt.token`
        )
        expect(requests[0].method).toBe('POST')
        expect(requests[0].headers['Content-Type']).toBe('application/json')
        expect(requests[0].body).toEqual({
            label: 'Spike',
            name: 'Spike',
            description: 'a burst',
            start: 100,
            end: 150,
            channelIds: ['ch1', 'ch2']
        })

        expect(created.id).toBe(42)
        expect(created.duration).toBe(50)
        expect(created.selected).toBe(true)
        expect(created.userId).toBe('user-7')
        expect(store.viewerAnnotations[0].annotations).toHaveLength(1)
        expect(store.viewerAnnotations[0].annotations[0].id).toBe(42)
        expect(store.activeAnnotation.id).toBe(42)
    })

    it('sends every channel of the active viewer when allChannels is set', async () => {
        const store = freshStore()
        store.setActiveViewer({
            content: content(PACKAGE_ID),
            channels: [channelDetail('ch1'), channelDetail('ch2'), channelDetail('ch3')]
        })
        respond = () => jsonResponse({ id: 1, label: 'All', start: 0, end: 10 })

        const { addAnnotation } = useTsAnnotation(store)
        await addAnnotation({ label: 'All', start: 0, duration: 10, layer_id: 1, allChannels: true })

        expect(requests[0].body!.channelIds).toEqual(['ch1', 'ch2', 'ch3'])
    })

    it('sends the given channelIds unchanged when the annotation names them', async () => {
        const store = freshStore()
        store.setActiveViewer({
            content: content(PACKAGE_ID),
            channels: [channelDetail('ch1'), channelDetail('ch2'), channelDetail('ch3')]
        })
        respond = () => jsonResponse({ id: 1, label: 'Some', start: 0, end: 10 })

        const { addAnnotation } = useTsAnnotation(store)
        await addAnnotation({ label: 'Some', start: 0, duration: 10, layer_id: 1, channelIds: ['ch3'] })

        expect(requests[0].body!.channelIds).toEqual(['ch3'])
    })

    it('falls back to the channels that are both selected and visible', async () => {
        const store = freshStore()
        store.setChannels([
            { id: 'ch1', selected: true, visible: true },
            { id: 'ch2', selected: true, visible: false },
            { id: 'ch3', selected: false, visible: true }
        ])
        respond = () => jsonResponse({ id: 1, label: 'Sel', start: 0, end: 10 })

        const { addAnnotation } = useTsAnnotation(store)
        const created = await addAnnotation({ label: 'Sel', start: 0, duration: 10, layer_id: 1 })

        expect(requests[0].body!.channelIds).toEqual(['ch1'])
        expect(created.allChannels).toBe(false)
    })

    it('marks the annotation as covering all channels when it names as many as the viewer shows', async () => {
        const store = freshStore()
        respond = () => jsonResponse({ id: 1, label: 'Both', start: 0, end: 10, channelIds: ['ch1', 'ch2'] })

        const { addAnnotation } = useTsAnnotation(store)
        const created = await addAnnotation({
            label: 'Both', start: 0, duration: 10, layer_id: 1, channelIds: ['ch1', 'ch2']
        })

        expect(created.allChannels).toBe(true)
    })

    it('marks an annotation created with no channels as covering all channels', async () => {
        // pins current behavior; see report
        const store = freshStore()
        store.setChannels([
            { id: 'ch1', selected: false, visible: true },
            { id: 'ch2', selected: false, visible: true }
        ])
        respond = () => jsonResponse({ id: 1, label: 'None', start: 0, end: 10, channelIds: [] })

        const { addAnnotation } = useTsAnnotation(store)
        const created = await addAnnotation({ label: 'None', start: 0, duration: 10, layer_id: 1 })

        expect(requests[0].body!.channelIds).toEqual([])
        expect(created.allChannels).toBe(true)
    })

    it('prefers the channelIds in the response over the ones requested', async () => {
        const store = freshStore()
        respond = () => jsonResponse({ id: 1, label: 'Srv', start: 0, end: 10, channelIds: ['server-ch'] })

        const { addAnnotation } = useTsAnnotation(store)
        const created = await addAnnotation({
            label: 'Srv', start: 0, duration: 10, layer_id: 1, channelIds: ['ch1']
        })

        expect(created.channelIds).toEqual(['server-ch'])
    })

    it('turns a negative duration into a range that ends at the given start', async () => {
        const store = freshStore()
        respond = () => jsonResponse({ id: 1, label: 'Back', start: 60, end: 100 })

        const { addAnnotation } = useTsAnnotation(store)
        await addAnnotation({ label: 'Back', start: 100, duration: -40, layer_id: 1 })

        expect(requests[0].body!.start).toBe(60)
        expect(requests[0].body!.end).toBe(100)
    })

    it('floors fractional start and end times', async () => {
        const store = freshStore()
        respond = () => jsonResponse({ id: 1, label: 'Frac', start: 10, end: 30 })

        const { addAnnotation } = useTsAnnotation(store)
        await addAnnotation({ label: 'Frac', start: 10.9, duration: 20.4, layer_id: 1 })

        expect(requests[0].body!.start).toBe(10)
        expect(requests[0].body!.end).toBe(31)
    })

    it('derives the duration from end minus start when no duration is given', async () => {
        const store = freshStore()
        respond = () => jsonResponse({ id: 1, label: 'Span', start: 200, end: 275 })

        const { addAnnotation } = useTsAnnotation(store)
        await addAnnotation({ label: 'Span', start: 200, end: 275, layer_id: 1 })

        expect(requests[0].body!.end).toBe(275)
    })

    it('copies the linked package id from the response', async () => {
        const store = freshStore()
        respond = () => jsonResponse({
            id: 1, label: 'Linked', start: 0, end: 10, linkedPackage: 'N:package:linked'
        })

        const { addAnnotation } = useTsAnnotation(store)
        const created = await addAnnotation({ label: 'Linked', start: 0, duration: 10, layer_id: 1 })

        expect(created.linkedPackage).toBe('N:package:linked')
    })

    it('leaves linkedPackage unset when the response has none', async () => {
        const store = freshStore()
        respond = () => jsonResponse({ id: 1, label: 'Plain', start: 0, end: 10 })

        const { addAnnotation } = useTsAnnotation(store)
        const created = await addAnnotation({ label: 'Plain', start: 0, duration: 10, layer_id: 1 })

        expect('linkedPackage' in created).toBe(false)
    })

    it('keeps the layer annotations ordered by start time after inserting', async () => {
        const store = freshStore()
        store.setAnnotations([layer(1, [
            { id: 'a', start: 100, duration: 10 },
            { id: 'c', start: 300, duration: 10 }
        ])])
        respond = () => jsonResponse({ id: 'b', label: 'Mid', start: 200, end: 210 })

        const { addAnnotation } = useTsAnnotation(store)
        await addAnnotation({ label: 'Mid', start: 200, duration: 10, layer_id: 1 })

        expect(store.viewerAnnotations[0].annotations.map(ann => ann.start)).toEqual([100, 200, 300])
    })

    it('sorts only the layer the new annotation belongs to', async () => {
        const store = freshStore()
        store.setAnnotations([
            layer(1, [{ id: 'a', start: 300, duration: 10 }, { id: 'b', start: 100, duration: 10 }]),
            layer(2, [{ id: 'x', start: 50, duration: 10 }])
        ])
        respond = () => jsonResponse({ id: 'y', label: 'Early', start: 10, end: 20 })

        const { addAnnotation } = useTsAnnotation(store)
        await addAnnotation({ label: 'Early', start: 10, duration: 10, layer_id: 2 })

        expect(store.viewerAnnotations[1].annotations.map(ann => ann.id)).toEqual(['y', 'x'])
        expect(store.viewerAnnotations[0].annotations.map(ann => ann.id)).toEqual(['a', 'b'])
    })

    it('returns the created annotation but stores nothing when its layer is unknown', async () => {
        // pins current behavior; see report
        const store = freshStore()
        store.setAnnotations([])
        respond = () => jsonResponse({ id: 77, label: 'Orphan', start: 0, end: 10 })

        const { addAnnotation } = useTsAnnotation(store)
        const created = await addAnnotation({ label: 'Orphan', start: 0, duration: 10, layer_id: 99 })

        expect(created.id).toBe(77)
        expect(store.viewerAnnotations).toEqual([])
    })

    it('uses the active annotation in the store when none is passed', async () => {
        const store = freshStore()
        store.setActiveAnnotation({ label: 'Active', start: 500, duration: 25, layer_id: 1 })
        respond = () => jsonResponse({ id: 9, label: 'Active', start: 500, end: 525 })

        const { addAnnotation } = useTsAnnotation(store)
        await addAnnotation()

        expect(requests[0].body!.label).toBe('Active')
        expect(store.viewerAnnotations[0].annotations[0].id).toBe(9)
    })

    it('rejects an annotation with no layer_id', async () => {
        const store = freshStore()
        const { addAnnotation } = useTsAnnotation(store)

        await expect(addAnnotation({ label: 'Orphan', start: 0, duration: 10 }))
            .rejects.toThrow(TypeError)
        expect(requests).toHaveLength(0)
    })

    it('rejects an annotation that already has an id', async () => {
        const store = freshStore()
        const { addAnnotation } = useTsAnnotation(store)

        await expect(addAnnotation({ id: 5, label: 'Existing', start: 0, duration: 10, layer_id: 1 }))
            .rejects.toThrow(/already exists/)
        expect(requests).toHaveLength(0)
    })

    it('rejects an annotation with no label', async () => {
        const store = freshStore()
        const { addAnnotation } = useTsAnnotation(store)

        await expect(addAnnotation({ start: 0, duration: 10, layer_id: 1 }))
            .rejects.toThrow('Annotation label is required')
        expect(requests).toHaveLength(0)
    })

    it('rejects an annotation with no start time', async () => {
        const store = freshStore()
        const { addAnnotation } = useTsAnnotation(store)

        await expect(addAnnotation({ label: 'NoStart', duration: 10, layer_id: 1 }))
            .rejects.toThrow('Annotation start time is required')
        expect(requests).toHaveLength(0)
    })

    it('rejects with the failed response and adds nothing to the layer when the create fails', async () => {
        const store = freshStore()
        respond = () => new Response('layer is read only', { status: 403 })

        const { addAnnotation } = useTsAnnotation(store)
        const failure = await rejectionOf(
            addAnnotation({ label: 'Denied', start: 0, duration: 10, layer_id: 1 })
        ) as Response

        expect(failure.status).toBe(403)
        expect(store.viewerAnnotations[0].annotations).toHaveLength(0)
        await vi.waitFor(() => {
            expect(ajaxErrors.map(message => message.detail?.msg))
                .toEqual(['Request failed with status 403'])
        })
    })

    it('raises the message the server sent when the create is rejected', async () => {
        const store = freshStore()
        respond = () => jsonResponse({ message: 'annotation overlaps another' }, 409)

        const { addAnnotation } = useTsAnnotation(store)
        await rejectionOf(addAnnotation({ label: 'Denied', start: 0, duration: 10, layer_id: 1 }))

        await vi.waitFor(() => {
            expect(ajaxErrors).toHaveLength(1)
        })
        expect(ajaxErrors[0].detail).toEqual({ type: 'info', msg: 'annotation overlaps another' })
    })

    it('raises a session expired message when the create is unauthorized', async () => {
        const store = freshStore()
        respond = () => new Response('nope', { status: 401 })

        const { addAnnotation } = useTsAnnotation(store)
        const failure = await rejectionOf(
            addAnnotation({ label: 'Denied', start: 0, duration: 10, layer_id: 1 })
        ) as Response

        expect(failure.status).toBe(401)
        expect(ajaxErrors.map(message => message.detail?.msg))
            .toEqual(['Session expired. Sign in again to continue.'])
        expect(toasts).toEqual([])
        expect(console.error).toHaveBeenCalled()
    })
})

describe('updateAnnotation', () => {
    const stored = (): Annotation => ({
        id: 7, label: 'Old', description: 'was', start: 100, duration: 50, end: 150,
        layer_id: 1, channelIds: ['ch1']
    })

    it('puts the annotation to its own endpoint and replaces it in the store', async () => {
        const store = freshStore()
        store.setAnnotations([layer(1, [stored()])])
        respond = () => jsonResponse({ id: 7, label: 'New', description: 'is', start: 100, end: 200 })

        const { updateAnnotation } = useTsAnnotation(store)
        await updateAnnotation({ ...stored(), label: 'New', description: 'is' })

        expect(requests).toHaveLength(1)
        expect(requests[0].url).toBe(
            `${API_URL}/timeseries/${PACKAGE_ID}/layers/1/annotations/7?api_key=a.jwt.token`
        )
        expect(requests[0].method).toBe('PUT')
        expect(requests[0].body).toEqual({
            name: 'New',
            label: 'New',
            description: 'is',
            start: 100,
            end: 150,
            channelIds: ['ch1']
        })

        const updated = store.viewerAnnotations[0].annotations[0]
        expect(updated.label).toBe('New')
        expect(updated.duration).toBe(100)
        expect(updated.layer_id).toBe(1)
    })

    it('returns the server result rather than the merged annotation', async () => {
        const store = freshStore()
        store.setAnnotations([layer(1, [stored()])])
        respond = () => jsonResponse({ id: 7, label: 'New', start: 100, end: 200 })

        const { updateAnnotation } = useTsAnnotation(store)
        const result = await updateAnnotation(stored())

        expect(result).toEqual({ id: 7, label: 'New', start: 100, end: 200 })
    })

    it('sends an empty channel list when the annotation names no channels', async () => {
        const store = freshStore()
        store.setAnnotations([layer(1, [stored()])])
        respond = () => jsonResponse({ id: 7, label: 'Old', start: 100, end: 150 })

        const { updateAnnotation } = useTsAnnotation(store)
        await updateAnnotation({ id: 7, label: 'Old', start: 100, duration: 50, layer_id: 1 })

        expect(requests[0].body!.channelIds).toEqual([])
    })

    it('turns a negative duration into a range that ends at the given start', async () => {
        const store = freshStore()
        store.setAnnotations([layer(1, [stored()])])
        respond = () => jsonResponse({ id: 7, label: 'Old', start: 80, end: 100 })

        const { updateAnnotation } = useTsAnnotation(store)
        await updateAnnotation({ id: 7, label: 'Old', start: 100, duration: -20, layer_id: 1 })

        expect(requests[0].body!.start).toBe(80)
        expect(requests[0].body!.end).toBe(100)
    })

    it('derives the duration from end minus start when no duration is given', async () => {
        const store = freshStore()
        store.setAnnotations([layer(1, [stored()])])
        respond = () => jsonResponse({ id: 7, label: 'Old', start: 100, end: 400 })

        const { updateAnnotation } = useTsAnnotation(store)
        await updateAnnotation({ id: 7, label: 'Old', start: 100, end: 400, layer_id: 1 })

        expect(requests[0].body!.end).toBe(400)
        expect(store.viewerAnnotations[0].annotations[0].duration).toBe(300)
    })

    it('uses the active annotation in the store when none is passed', async () => {
        const store = freshStore()
        store.setAnnotations([layer(1, [stored()])])
        store.setActiveAnnotation({ ...stored(), label: 'FromStore' })
        respond = () => jsonResponse({ id: 7, label: 'FromStore', start: 100, end: 150 })

        const { updateAnnotation } = useTsAnnotation(store)
        await updateAnnotation()

        expect(requests[0].url).toBe(
            `${API_URL}/timeseries/${PACKAGE_ID}/layers/1/annotations/7?api_key=a.jwt.token`
        )
        expect(requests[0].body!.label).toBe('FromStore')
        expect(store.viewerAnnotations[0].annotations[0].label).toBe('FromStore')
    })

    it('rejects an annotation that has no id', async () => {
        const store = freshStore()
        const { updateAnnotation } = useTsAnnotation(store)

        await expect(updateAnnotation({ label: 'New', start: 0, duration: 10, layer_id: 1 }))
            .rejects.toThrow(TypeError)
        expect(requests).toHaveLength(0)
    })

    it('rejects an annotation that has no layer_id', async () => {
        const store = freshStore()
        const { updateAnnotation } = useTsAnnotation(store)

        await expect(updateAnnotation({ id: 7, label: 'New', start: 0, duration: 10 }))
            .rejects.toThrow(/Missing layer_id/)
        expect(requests).toHaveLength(0)
    })

    it('leaves the stored annotation untouched and raises a message when the update fails', async () => {
        const store = freshStore()
        store.setAnnotations([layer(1, [stored()])])
        respond = () => new Response('gone', { status: 404 })

        const { updateAnnotation } = useTsAnnotation(store)
        const failure = await rejectionOf(updateAnnotation({ ...stored(), label: 'New' })) as Response

        expect(failure.status).toBe(404)
        expect(store.viewerAnnotations[0].annotations[0].label).toBe('Old')
        await vi.waitFor(() => {
            expect(ajaxErrors.map(message => message.detail?.msg))
                .toEqual(['Request failed with status 404'])
        })
    })
})

describe('removeAnnotation', () => {
    it('deletes the annotation and drops it from its layer', async () => {
        const store = freshStore()
        store.setAnnotations([layer(1, [
            { id: 7, start: 100, duration: 10, layer_id: 1 },
            { id: 8, start: 200, duration: 10, layer_id: 1 }
        ])])
        respond = () => new Response('', { status: 200 })

        const { removeAnnotation } = useTsAnnotation(store)
        const result = await removeAnnotation({ id: 7, start: 100, duration: 10, layer_id: 1 })

        expect(result).toBe(true)
        expect(requests).toHaveLength(1)
        expect(requests[0].url).toBe(
            `${API_URL}/timeseries/${PACKAGE_ID}/layers/1/annotations/7?api_key=a.jwt.token`
        )
        expect(requests[0].method).toBe('DELETE')
        expect(requests[0].body).toBeUndefined()
        expect(store.viewerAnnotations[0].annotations.map(ann => ann.id)).toEqual([8])
    })

    it('sends the delete to the layer named by the annotation layer object', async () => {
        const store = freshStore()
        store.setAnnotations([layer(1), layer(2)])
        respond = () => new Response('', { status: 200 })

        const { removeAnnotation } = useTsAnnotation(store)
        await removeAnnotation({ id: 9, start: 0, duration: 10, layer: layer(2) })

        expect(requests[0].url).toBe(
            `${API_URL}/timeseries/${PACKAGE_ID}/layers/2/annotations/9?api_key=a.jwt.token`
        )
    })

    it('keeps the store copy when the annotation carries a layer object and no layer_id', async () => {
        // pins current behavior; see report
        const store = freshStore()
        store.setAnnotations([layer(2, [{ id: 9, start: 0, duration: 10 }])])
        respond = () => new Response('', { status: 200 })

        const { removeAnnotation } = useTsAnnotation(store)
        await removeAnnotation({ id: 9, start: 0, duration: 10, layer: layer(2) })

        expect(requests).toHaveLength(1)
        expect(store.viewerAnnotations[0].annotations.map(ann => ann.id)).toEqual([9])
    })

    it('rejects an annotation with no id', async () => {
        const store = freshStore()
        const { removeAnnotation } = useTsAnnotation(store)

        await expect(removeAnnotation({ start: 0, duration: 10, layer_id: 1 }))
            .rejects.toThrow(TypeError)
        expect(requests).toHaveLength(0)
    })

    it('rejects an annotation with neither a layer nor a layer_id', async () => {
        const store = freshStore()
        const { removeAnnotation } = useTsAnnotation(store)

        await expect(removeAnnotation({ id: 7, start: 0, duration: 10 }))
            .rejects.toThrow(/Missing layer_id/)
        expect(requests).toHaveLength(0)
    })

    it('keeps the annotation in the store and raises a message when the delete fails', async () => {
        const store = freshStore()
        store.setAnnotations([layer(1, [{ id: 7, start: 100, duration: 10, layer_id: 1 }])])
        respond = () => new Response('boom', { status: 500 })

        const { removeAnnotation } = useTsAnnotation(store)
        const failure = await rejectionOf(
            removeAnnotation({ id: 7, start: 100, duration: 10, layer_id: 1 })
        ) as Response

        expect(failure.status).toBe(500)
        expect(store.viewerAnnotations[0].annotations).toHaveLength(1)
        await vi.waitFor(() => {
            expect(ajaxErrors.map(message => message.detail?.msg))
                .toEqual(['Request failed with status 500'])
        })
    })
})

describe('sortAnns', () => {
    it('orders annotations by start time in place', () => {
        const store = freshStore()
        const { sortAnns } = useTsAnnotation(store)
        const anns: Annotation[] = [
            { id: 'c', start: 300, duration: 1 },
            { id: 'a', start: 100, duration: 1 },
            { id: 'b', start: 100, duration: 5 }
        ]

        sortAnns(anns)

        expect(anns.map(ann => ann.start)).toEqual([100, 100, 300])
    })
})
