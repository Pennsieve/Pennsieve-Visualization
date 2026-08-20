import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { AnnotationLayer } from '@/utils/annotationUtils'
import type { ActiveViewerContent, ViewerStore } from '@/stores/tsviewer'
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

const { useAnnotationLayers } = await import('@/composables/useAnnotationLayers')
const { createViewerStore } = await import('@/stores/tsviewer')
const { unscopedViewerEmitter } = await import('@/events/emitter')

const API_URL = 'https://api.pennsieve.io'
const PACKAGE_ID = 'N:package:seizures'
const LAYERS_URL = `${API_URL}/timeseries/${PACKAGE_ID}/layers?api_key=a.jwt.token`

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

const emit = vi.fn<(event: 'annLayersInitialized' | 'closeAnnotationLayerWindow') => void>()

const activeViewer = { content: { id: PACKAGE_ID } }

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

const layer = (id: number, hexColor = '#18BA62'): AnnotationLayer => ({
    id,
    name: `Layer ${id}`,
    annotations: [],
    visible: true,
    selected: id === 1,
    hexColor,
    color: 'rgba(24,186,98,0.7)'
})

const freshStore = (layers: AnnotationLayer[] = []): ViewerStore => {
    const store = createViewerStore(`annotation-layers-${instanceSeq++}`)
    store.setViewerConfig({ apiUrl: API_URL })
    store.setActiveViewer({ content: content(PACKAGE_ID), channels: [] })
    if (layers.length > 0) {
        store.setAnnotations(layers)
    }
    return store
}

/** Resolves with the rejection reason, which is the raw Response for a failed request. */
const rejectionOf = async (pending: Promise<unknown>): Promise<unknown> =>
    pending.then(
        () => { throw new Error('expected the call to reject') },
        (reason: unknown) => reason
    )

beforeEach(() => {
    setActivePinia(createPinia())
    requests = []
    toasts = []
    ajaxErrors = []
    emit.mockClear()
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

describe('loadLayers', () => {
    it('requests the layers of the active viewer and puts them in the store', async () => {
        const store = freshStore()
        respond = () => jsonResponse({
            results: [
                { id: 1, name: 'Seizures', description: 'onsets', color: '#FF0000' },
                { id: 2, name: 'Artifacts' }
            ]
        })
        const { loadLayers, annLayerInfo } = useAnnotationLayers(store)

        const response = await loadLayers(activeViewer, emit)

        expect(requests).toHaveLength(1)
        expect(requests[0].url).toBe(LAYERS_URL)
        expect(requests[0].method).toBe('GET')
        expect(requests[0].body).toBeUndefined()

        expect(store.viewerAnnotations).toHaveLength(2)
        expect(store.viewerAnnotations[0]).toMatchObject({
            id: 1,
            name: 'Seizures',
            description: 'onsets',
            visible: true,
            selected: true,
            hexColor: '#FF0000',
            color: 'rgba(255,0,0,0.7)',
            bkColor: 'rgba(255,0,0,0.15)',
            selColor: 'rgba(255,0,0,0.9)'
        })
        expect(store.viewerAnnotations[0].annotations).toEqual([])
        expect(store.viewerAnnotations[1].selected).toBe(false)
        expect(emit.mock.calls).toEqual([['annLayersInitialized']])
        expect(annLayerInfo.value).toHaveLength(2)
        expect(response).toEqual({
            results: [
                { id: 1, name: 'Seizures', description: 'onsets', color: '#FF0000' },
                { id: 2, name: 'Artifacts' }
            ]
        })
    })

    it('colors a layer that has no color from the palette position it arrives in', async () => {
        const store = freshStore()
        respond = () => jsonResponse({ results: [{ id: 1, name: 'First' }, { id: 2, name: 'Second' }] })
        const { loadLayers, defaultColors } = useAnnotationLayers(store)

        await loadLayers(activeViewer, emit)

        expect(store.viewerAnnotations[0].hexColor).toBe(defaultColors.value[0])
        expect(store.viewerAnnotations[1].hexColor).toBe(defaultColors.value[1])
    })

    it('returns null and issues no request when the active viewer has no package id', async () => {
        const store = freshStore()
        const { loadLayers } = useAnnotationLayers(store)

        await expect(loadLayers(null, emit)).resolves.toBeNull()
        await expect(loadLayers({}, emit)).resolves.toBeNull()
        await expect(loadLayers({ content: {} }, emit)).resolves.toBeNull()
        expect(requests).toHaveLength(0)
        expect(emit).not.toHaveBeenCalled()
    })

    it('creates no default layer when the server reports an empty layer list', async () => {
        // pins current behavior; see report
        const store = freshStore()
        respond = () => jsonResponse({ results: [] })
        const { loadLayers, annLayerInfo } = useAnnotationLayers(store)

        await loadLayers(activeViewer, emit)

        expect(requests).toHaveLength(1)
        expect(store.viewerAnnotations).toEqual([])
        expect(emit).not.toHaveBeenCalled()
        expect(toasts).toEqual([])
        expect(annLayerInfo.value).toEqual([])
    })

    it('creates no default layer when the response carries no results at all', async () => {
        // pins current behavior; see report
        const store = freshStore()
        respond = () => jsonResponse({})
        const { loadLayers, annLayerInfo } = useAnnotationLayers(store)

        await loadLayers(activeViewer, emit)

        expect(requests).toHaveLength(1)
        expect(store.viewerAnnotations).toEqual([])
        expect(annLayerInfo.value).toBeUndefined()
    })

    it('throws and raises a session-expired message when the layer request is unauthorized', async () => {
        const store = freshStore()
        respond = () => jsonResponse({ message: 'no token' }, 401)
        const { loadLayers } = useAnnotationLayers(store)

        const failure = await rejectionOf(loadLayers(activeViewer, emit)) as Response
        expect(failure.status).toBe(401)
        expect(store.viewerAnnotations).toEqual([])
        expect(ajaxErrors).toHaveLength(1)
        expect(ajaxErrors[0].detail?.msg).toBe('Session expired. Sign in again to continue.')
    })
})

describe('createAnnotationLayer', () => {
    it('posts the layer, adds it to the store and makes it the active layer', async () => {
        const store = freshStore()
        respond = () => jsonResponse({ id: 12, name: 'Seizures', color: '#E94B4B', description: 'onsets' })
        const { createAnnotationLayer } = useAnnotationLayers(store)

        const created = await createAnnotationLayer(
            { name: 'Seizures', color: '#E94B4B', description: 'onsets' },
            activeViewer,
            emit
        )

        expect(requests).toHaveLength(1)
        expect(requests[0].url).toBe(LAYERS_URL)
        expect(requests[0].method).toBe('POST')
        expect(requests[0].body).toEqual({
            name: 'Seizures',
            color: '#E94B4B',
            description: 'onsets'
        })

        expect(created!.id).toBe(12)
        expect(store.viewerAnnotations).toHaveLength(1)
        expect(store.viewerAnnotations[0]).toMatchObject({
            id: 12,
            name: 'Seizures',
            visible: true,
            selected: true,
            hexColor: '#E94B4B',
            color: 'rgba(233,75,75,0.7)',
            bkColor: 'rgba(233,75,75,0.15)',
            selColor: 'rgba(233,75,75,0.9)'
        })
        expect(store.viewerAnnotations[0].annotations).toEqual([])
        expect(store.activeAnnotationLayer).toBe(12)
        expect(toasts).toHaveLength(1)
        expect(toasts[0].detail?.msg).toBe("'Seizures' Layer Created")
        expect(emit.mock.calls).toEqual([['closeAnnotationLayerWindow']])
    })

    it('sends the layer name as the description when none is given', async () => {
        const store = freshStore()
        respond = () => jsonResponse({ id: 13, name: 'Artifacts', color: '#18BA62' })
        const { createAnnotationLayer } = useAnnotationLayers(store)

        await createAnnotationLayer({ name: 'Artifacts', color: '#18BA62' }, activeViewer)

        expect(requests[0].body).toEqual({
            name: 'Artifacts',
            color: '#18BA62',
            description: 'Artifacts'
        })
    })

    it('deselects the layers that were already in the store', async () => {
        const store = freshStore([layer(1)])
        respond = () => jsonResponse({ id: 12, name: 'Seizures', color: '#E94B4B' })
        const { createAnnotationLayer } = useAnnotationLayers(store)

        await createAnnotationLayer({ name: 'Seizures', color: '#E94B4B' }, activeViewer)

        expect(store.viewerAnnotations.map(l => [l.id, l.selected])).toEqual([[1, false], [12, true]])
    })

    it('closes the layer window and reports the failure when the create is rejected', async () => {
        const store = freshStore()
        respond = () => jsonResponse({ message: 'no token' }, 401)
        const { createAnnotationLayer } = useAnnotationLayers(store)

        const failure = await rejectionOf(
            createAnnotationLayer({ name: 'Seizures', color: '#E94B4B' }, activeViewer, emit)
        ) as Response

        expect(failure.status).toBe(401)
        expect(store.viewerAnnotations).toEqual([])
        expect(toasts).toEqual([])
        expect(ajaxErrors[0].detail?.msg).toBe('Session expired. Sign in again to continue.')
        expect(emit.mock.calls).toEqual([['closeAnnotationLayerWindow']])
    })

    it('throws and stores nothing when the created layer comes back with no color', async () => {
        // pins current behavior; see report
        const store = freshStore()
        respond = () => jsonResponse({ id: 14, name: 'Colorless' })
        const { createAnnotationLayer } = useAnnotationLayers(store)

        const failure = await rejectionOf(
            createAnnotationLayer({ name: 'Colorless', color: '#18BA62' }, activeViewer, emit)
        ) as Error

        expect(failure.message).toBe('Bad Hex')
        expect(store.viewerAnnotations).toEqual([])
        expect(emit.mock.calls).toEqual([['closeAnnotationLayerWindow']])
    })

    it('returns null and leaves the layer window open when there is no active viewer', async () => {
        // pins current behavior; see report
        const store = freshStore()
        const { createAnnotationLayer } = useAnnotationLayers(store)

        await expect(createAnnotationLayer({ name: 'Seizures', color: '#E94B4B' }, null, emit))
            .resolves.toBeNull()
        expect(requests).toHaveLength(0)
        expect(emit).not.toHaveBeenCalled()
    })
})

describe('deleteLayer', () => {
    it('deletes the layer on the server and removes it from the store', async () => {
        const store = freshStore([layer(1), layer(2)])
        respond = () => new Response('', { status: 200 })
        const { deleteLayer } = useAnnotationLayers(store)

        await deleteLayer(2, activeViewer)

        expect(requests).toHaveLength(1)
        expect(requests[0].url).toBe(`${API_URL}/timeseries/${PACKAGE_ID}/layers/2?api_key=a.jwt.token`)
        expect(requests[0].method).toBe('DELETE')
        expect(store.viewerAnnotations.map(l => l.id)).toEqual([1])
        expect(toasts).toHaveLength(1)
        expect(toasts[0].detail?.msg).toBe('Layer deleted successfully')
    })

    it('throws and keeps the layer when the delete is rejected', async () => {
        const store = freshStore([layer(1), layer(2)])
        respond = () => jsonResponse({ message: 'no token' }, 401)
        const { deleteLayer } = useAnnotationLayers(store)

        const failure = await rejectionOf(deleteLayer(2, activeViewer)) as Response

        expect(failure.status).toBe(401)
        expect(store.viewerAnnotations.map(l => l.id)).toEqual([1, 2])
        expect(toasts).toEqual([])
        expect(ajaxErrors).toHaveLength(1)
    })

    it('returns null and issues no request when there is no active viewer', async () => {
        const store = freshStore([layer(1)])
        const { deleteLayer } = useAnnotationLayers(store)

        await expect(deleteLayer(1, null)).resolves.toBeNull()
        expect(requests).toHaveLength(0)
        expect(store.viewerAnnotations).toHaveLength(1)
    })
})

describe('updateLayerColor', () => {
    it('puts the new color and recolors the layer in the store', async () => {
        const store = freshStore([layer(1)])
        respond = () => jsonResponse({ id: 1, color: '#0D4EFF' })
        const { updateLayerColor } = useAnnotationLayers(store)

        const response = await updateLayerColor(1, '#0D4EFF', activeViewer)

        expect(requests).toHaveLength(1)
        expect(requests[0].url).toBe(`${API_URL}/timeseries/${PACKAGE_ID}/layers/1?api_key=a.jwt.token`)
        expect(requests[0].method).toBe('PUT')
        expect(requests[0].body).toEqual({ color: '#0D4EFF' })
        expect(store.viewerAnnotations[0]).toMatchObject({
            hexColor: '#0D4EFF',
            color: 'rgba(13,78,255,0.7)',
            bkColor: 'rgba(13,78,255,0.15)',
            selColor: 'rgba(13,78,255,0.9)'
        })
        expect(response).toEqual({ id: 1, color: '#0D4EFF' })
    })

    it('sends the request but adds nothing when the layer is not in the store', async () => {
        const store = freshStore([layer(1)])
        respond = () => jsonResponse({ id: 99, color: '#0D4EFF' })
        const { updateLayerColor } = useAnnotationLayers(store)

        await updateLayerColor(99, '#0D4EFF', activeViewer)

        expect(requests).toHaveLength(1)
        expect(store.viewerAnnotations.map(l => l.id)).toEqual([1])
    })

    it('keeps the old color when the update is rejected', async () => {
        const store = freshStore([layer(1, '#18BA62')])
        respond = () => jsonResponse({ message: 'no token' }, 401)
        const { updateLayerColor } = useAnnotationLayers(store)

        const failure = await rejectionOf(updateLayerColor(1, '#0D4EFF', activeViewer)) as Response

        expect(failure.status).toBe(401)
        expect(store.viewerAnnotations[0].hexColor).toBe('#18BA62')
    })

    it('returns null and issues no request when there is no active viewer', async () => {
        const store = freshStore([layer(1)])
        const { updateLayerColor } = useAnnotationLayers(store)

        await expect(updateLayerColor(1, '#0D4EFF', null)).resolves.toBeNull()
        expect(requests).toHaveLength(0)
    })
})

describe('updateLayerVisibility', () => {
    it('hides a layer in the store without any request', () => {
        const store = freshStore([layer(1), layer(2)])
        const { updateLayerVisibility } = useAnnotationLayers(store)

        updateLayerVisibility(2, false)

        expect(store.viewerAnnotations.map(l => l.visible)).toEqual([true, false])
        expect(requests).toHaveLength(0)
    })

    it('leaves every layer alone for an unknown layer id', () => {
        const store = freshStore([layer(1), layer(2)])
        const { updateLayerVisibility } = useAnnotationLayers(store)

        updateLayerVisibility(99, false)

        expect(store.viewerAnnotations.map(l => l.visible)).toEqual([true, true])
    })
})

describe('selectLayer', () => {
    it('selects the named layer, deselects the others and makes it active', () => {
        const store = freshStore([layer(1), layer(2), layer(3)])
        const { selectLayer } = useAnnotationLayers(store)

        selectLayer(3)

        expect(store.viewerAnnotations.map(l => l.selected)).toEqual([false, false, true])
        expect(store.activeAnnotationLayer).toBe(3)
    })

    it('deselects every layer when the layer id is unknown', () => {
        // pins current behavior; see report
        const store = freshStore([layer(1), layer(2)])
        const { selectLayer } = useAnnotationLayers(store)

        selectLayer(99)

        expect(store.viewerAnnotations.map(l => l.selected)).toEqual([false, false])
    })
})
