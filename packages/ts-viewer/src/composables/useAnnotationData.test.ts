import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Annotation, AnnotationLayer, LinkedPackageDTO } from '@/utils/annotationUtils'
import type { ActiveViewerContent, ViewerStore } from '@/stores/tsviewer'

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

const { useAnnotationData } = await import('@/composables/useAnnotationData')
const { createViewerStore } = await import('@/stores/tsviewer')

const API_URL = 'https://api.pennsieve.io'
const PACKAGE_ID = 'N:package:seizures'

interface AnnotationPayload {
    id: number | string
    label: string
    description?: string
    start: number
    end: number
    channelIds: string[]
    layerId: number | string
    userId?: number | string
    linkedPackage?: string
}

interface RecordedRequest {
    url: string
    method: string
    headers: Record<string, string>
}

let requests: RecordedRequest[] = []
let respond: (url: string) => Response
let instanceSeq = 0

const emit = vi.fn<(event: 'annotationsReceived') => void>()

const props = (tsEnd: number) => ({ tsEnd, constants: { LIMITANNFETCH: 500 } })
const activeViewer = { content: { id: PACKAGE_ID } }

const payload = (
    annotations: AnnotationPayload[],
    linkedPackages: Record<string, LinkedPackageDTO> = {}
) => ({ annotations: { results: annotations }, linkedPackages })

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

const layer = (id: number, annotations: Annotation[] = []): AnnotationLayer => ({
    id,
    name: `Layer ${id}`,
    annotations,
    selected: id === 1
})

const annotationUrl = (layerId: number, start: number, end: number) =>
    `${API_URL}/timeseries/${PACKAGE_ID}/layers/${layerId}/annotations`
    + `?api_key=a.jwt.token&id=${PACKAGE_ID}&start=${start}&end=${end}&layerId=${layerId}&limit=500`

const freshStore = (layers: AnnotationLayer[] = [layer(1)]): ViewerStore => {
    const store = createViewerStore(`annotation-data-${instanceSeq++}`)
    store.setViewerConfig({ apiUrl: API_URL })
    store.setActiveViewer({ content: content(PACKAGE_ID), channels: [] })
    store.setChannels([
        { id: 'ch1', selected: true, visible: true },
        { id: 'ch2', selected: true, visible: true }
    ])
    store.setAnnotations(layers)
    return store
}

beforeEach(() => {
    setActivePinia(createPinia())
    requests = []
    emit.mockClear()
    respond = () => jsonResponse(payload([]))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        requests.push({
            url,
            method: init?.method ?? 'GET',
            headers: (init?.headers ?? {}) as Record<string, string>
        })
        return respond(url)
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('checkAnnotationRange requests', () => {
    it('asks each layer for annotations from the viewport start to the end of the timeseries', async () => {
        const store = freshStore([layer(1), layer(2)])
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)

        expect(requests.map(request => request.url)).toEqual([
            annotationUrl(1, 0, 1000),
            annotationUrl(2, 0, 1000)
        ])
        expect(requests[0].method).toBe('GET')
        expect(requests[0].headers['Content-type']).toBe('application/json')
    })

    it('floors a fractional viewport start into the request', async () => {
        const store = freshStore()
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(10.9, 20, props(1000.6), activeViewer, emit)

        expect(requests[0].url).toBe(annotationUrl(1, 10, 1000))
    })

    it('records the requested span in the range cache', async () => {
        const store = freshStore()
        const { checkAnnotationRange, cachedAnnRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)

        expect(cachedAnnRange.value).toEqual([{ start: 0, end: 1000 }])
    })

    it('issues no request for a viewport already inside a cached range', async () => {
        const store = freshStore()
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)
        await checkAnnotationRange(10, 50, props(1000), activeViewer, emit)

        expect(requests).toHaveLength(1)
    })

    it('requests only the uncached tail when the viewport starts inside a cached range', async () => {
        const store = freshStore()
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)
        await checkAnnotationRange(500, 1500, props(2000), activeViewer, emit)

        expect(requests).toHaveLength(2)
        expect(requests[1].url).toBe(annotationUrl(1, 1000, 2000))
    })

    it('requests a viewport that lies past every cached range', async () => {
        const store = freshStore()
        const { checkAnnotationRange, cachedAnnRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)
        await checkAnnotationRange(1500, 1600, props(2000), activeViewer, emit)

        expect(requests[1].url).toBe(annotationUrl(1, 1500, 2000))
        expect(cachedAnnRange.value).toEqual([
            { start: 0, end: 1000 },
            { start: 1500, end: 2000 }
        ])
    })

    it('stops the request at the start of a cached range that lies ahead', async () => {
        const store = freshStore()
        const { checkAnnotationRange, cachedAnnRange } = useAnnotationData(store)

        await checkAnnotationRange(1500, 1600, props(2000), activeViewer, emit)
        await checkAnnotationRange(0, 100, props(2000), activeViewer, emit)

        expect(requests[1].url).toBe(annotationUrl(1, 0, 1500))
        expect(cachedAnnRange.value).toEqual([
            { start: 0, end: 1500 },
            { start: 1500, end: 2000 }
        ])
    })

    it('makes no request once the cached ranges reach the end of the timeseries', async () => {
        const store = freshStore([layer(1, [{ id: 'x', start: 10, duration: 5, layer_id: 1 }])])
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)
        await checkAnnotationRange(1000, 1100, props(1000), activeViewer, emit)

        expect(requests).toHaveLength(1)
    })

    it('makes no request for a viewport that two adjacent cached ranges cover together', async () => {
        const store = freshStore()
        respond = () => jsonResponse(payload([
            { id: 'a', label: 'One', start: 1600, end: 1610, channelIds: [], layerId: 1 }
        ]))
        const { checkAnnotationRange, cachedAnnRange } = useAnnotationData(store)

        await checkAnnotationRange(1500, 1600, props(2000), activeViewer, emit)
        await checkAnnotationRange(1000, 1100, props(2000), activeViewer, emit)
        await checkAnnotationRange(0, 100, props(2000), activeViewer, emit)
        expect(cachedAnnRange.value).toEqual([
            { start: 0, end: 1000 },
            { start: 1000, end: 1500 },
            { start: 1500, end: 2000 }
        ])
        expect(requests).toHaveLength(3)

        await checkAnnotationRange(500, 1200, props(2000), activeViewer, emit)

        expect(requests).toHaveLength(3)
    })

    it('skips a layer that has no id and still requests the others', async () => {
        const store = freshStore([layer(1), layer(2)])
        store.viewerAnnotations[1].id = ''
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)

        expect(requests.map(request => request.url)).toEqual([annotationUrl(1, 0, 1000)])
    })

    it('caches the span when there is no layer to request, and never revisits it', async () => {
        // pins current behavior; see report
        const store = freshStore([])
        const { checkAnnotationRange, cachedAnnRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)
        expect(requests).toHaveLength(0)
        expect(cachedAnnRange.value).toEqual([{ start: 0, end: 1000 }])

        store.setAnnotations([layer(1)])
        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)
        expect(requests).toHaveLength(0)
    })
})

describe('checkAnnotationRange response mapping', () => {
    it('maps a server annotation onto its layer and derives the duration', async () => {
        const store = freshStore()
        respond = () => jsonResponse(payload([{
            id: 5, label: 'Spike', description: 'a burst', start: 100, end: 150,
            channelIds: ['ch1'], layerId: 1, userId: 'user-7'
        }]))
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 200, props(1000), activeViewer, emit)

        const stored = store.viewerAnnotations[0].annotations
        expect(stored).toHaveLength(1)
        expect(stored[0]).toMatchObject({
            id: 5,
            label: 'Spike',
            description: 'a burst',
            start: 100,
            end: 150,
            duration: 50,
            layer_id: 1,
            userId: 'user-7',
            selected: false,
            allChannels: false,
            cStart: null,
            cEnd: null
        })
    })

    it('files each annotation under the layer named in the payload', async () => {
        const store = freshStore([layer(1), layer(2)])
        respond = url => url.includes('layers/1')
            ? jsonResponse(payload([
                { id: 'a', label: 'One', start: 10, end: 20, channelIds: [], layerId: 1 },
                { id: 'b', label: 'Two', start: 30, end: 40, channelIds: [], layerId: 2 }
            ]))
            : jsonResponse(payload([]))
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)

        expect(store.viewerAnnotations[0].annotations.map(ann => ann.id)).toEqual(['a'])
        expect(store.viewerAnnotations[1].annotations.map(ann => ann.id)).toEqual(['b'])
    })

    it('appends to the annotations a layer already holds', async () => {
        const store = freshStore([layer(1, [{ id: 'old', start: 0, duration: 5, layer_id: 1 }])])
        respond = () => jsonResponse(payload([
            { id: 'new', label: 'New', start: 100, end: 110, channelIds: [], layerId: 1 }
        ]))
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 200, props(1000), activeViewer, emit)

        expect(store.viewerAnnotations[0].annotations.map(ann => ann.id)).toEqual(['old', 'new'])
    })

    it('marks an annotation that names every channel as covering all channels', async () => {
        const store = freshStore()
        respond = () => jsonResponse(payload([{
            id: 5, label: 'All', start: 0, end: 10, channelIds: ['ch1', 'ch2'], layerId: 1
        }]))
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)

        expect(store.viewerAnnotations[0].annotations[0].allChannels).toBe(true)
    })

    it('marks a montaged annotation as covering all channels only when it names more than the viewer shows', async () => {
        const store = freshStore()
        store.setViewerMontageScheme('BIPOLAR_LONGITUDINAL')
        respond = () => jsonResponse(payload([
            { id: 'equal', label: 'Equal', start: 0, end: 10, channelIds: ['a', 'b'], layerId: 1 },
            { id: 'more', label: 'More', start: 20, end: 30, channelIds: ['a', 'b', 'c'], layerId: 1 }
        ]))
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)

        const stored = store.viewerAnnotations[0].annotations
        expect(stored[0].allChannels).toBe(false)
        expect(stored[1].allChannels).toBe(true)
    })

    it('resolves a linked package into its content id and keeps the whole record', async () => {
        const store = freshStore()
        const dto: LinkedPackageDTO = {
            content: { id: 'N:package:content' },
            objects: { view: [{ content: { fileType: 'PNG', id: 'view-1', packageId: 'N:package:key' } }] }
        }
        respond = () => jsonResponse(payload(
            [{
                id: 5, label: 'Linked', start: 0, end: 10, channelIds: [], layerId: 1,
                linkedPackage: 'N:package:key'
            }],
            { 'N:package:key': dto }
        ))
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)

        const stored = store.viewerAnnotations[0].annotations[0]
        expect(stored.linkedPackage).toBe('N:package:content')
        expect(stored.linkedPackageDTO).toEqual(dto)
    })

    it('leaves the linked package id empty when the response describes no such package', async () => {
        const store = freshStore()
        respond = () => jsonResponse(payload([{
            id: 5, label: 'Linked', start: 0, end: 10, channelIds: [], layerId: 1,
            linkedPackage: 'N:package:missing'
        }]))
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)

        const stored = store.viewerAnnotations[0].annotations[0]
        expect(stored.linkedPackage).toBe('')
        expect(stored.linkedPackageDTO).toBeUndefined()
    })

    it('treats a null response body as a response with no annotations', async () => {
        const store = freshStore()
        respond = () => new Response('null', { status: 200, headers: { 'Content-type': 'application/json' } })
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)

        expect(store.viewerAnnotations[0].annotations).toEqual([])
        expect(emit).toHaveBeenCalledTimes(1)
    })

    it('emits annotationsReceived for every layer response, including empty ones', async () => {
        const store = freshStore([layer(1), layer(2)])
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)

        expect(emit.mock.calls).toEqual([['annotationsReceived'], ['annotationsReceived']])
    })

    it('caches the full requested span when the response fills the fetch limit', async () => {
        // pins current behavior; see report
        const store = freshStore()
        const results: AnnotationPayload[] = Array.from({ length: 500 }, (_, i) => ({
            id: i, label: `ann-${i}`, start: i, end: i + 1, channelIds: [], layerId: 1
        }))
        respond = () => jsonResponse(payload(results))
        const { checkAnnotationRange, cachedAnnRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)
        await checkAnnotationRange(600, 700, props(1000), activeViewer, emit)

        expect(store.viewerAnnotations[0].annotations).toHaveLength(500)
        expect(cachedAnnRange.value).toEqual([{ start: 0, end: 1000 }])
        expect(requests).toHaveLength(1)
    })
})

describe('checkAnnotationRange failures', () => {
    it('caches the span and reports to the console when a layer request fails', async () => {
        // pins current behavior; see report
        const store = freshStore()
        respond = () => jsonResponse({ message: 'server on fire' }, 500)
        const { checkAnnotationRange, cachedAnnRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)
        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)

        expect(requests).toHaveLength(1)
        expect(cachedAnnRange.value).toEqual([{ start: 0, end: 1000 }])
        expect(store.viewerAnnotations[0].annotations).toHaveLength(0)
        expect(emit).not.toHaveBeenCalled()
        expect(console.error).toHaveBeenCalled()
    })

    it('requests the remaining layers after one of them fails', async () => {
        const store = freshStore([layer(1), layer(2)])
        respond = url => url.includes('layers/1')
            ? jsonResponse({ message: 'nope' }, 500)
            : jsonResponse(payload([
                { id: 'b', label: 'Two', start: 0, end: 10, channelIds: [], layerId: 2 }
            ]))
        const { checkAnnotationRange } = useAnnotationData(store)

        await checkAnnotationRange(0, 100, props(1000), activeViewer, emit)

        expect(requests).toHaveLength(2)
        expect(store.viewerAnnotations[1].annotations.map(ann => ann.id)).toEqual(['b'])
    })
})

describe('getChannelId', () => {
    it('returns the channel id unchanged when no montage is applied', () => {
        const store = freshStore()
        const { getChannelId } = useAnnotationData(store)

        expect(getChannelId({ id: 'CH_A' })).toBe('CH_A')
    })

    it('returns the part before the first underscore while a montage is applied', () => {
        const store = freshStore()
        store.setViewerMontageScheme('BIPOLAR_LONGITUDINAL')
        const { getChannelId } = useAnnotationData(store)

        expect(getChannelId({ id: 'CH_A' })).toBe('CH')
    })

    it('returns an empty string for a channel with no id', () => {
        const store = freshStore()
        const { getChannelId } = useAnnotationData(store)

        expect(getChannelId({})).toBe('')
    })
})

describe('findNextAnnotation', () => {
    const spaced = () => layer(1, [
        { id: 'a', start: 10, duration: 5 },
        { id: 'b', start: 20, duration: 5 },
        { id: 'c', start: 30, duration: 5 }
    ])

    it('returns the first annotation when the current time precedes them all', () => {
        const { findNextAnnotation } = useAnnotationData(freshStore([spaced()]))

        expect(findNextAnnotation(2)?.id).toBe('a')
    })

    it('returns the next annotation from inside the first interval', () => {
        const { findNextAnnotation } = useAnnotationData(freshStore([spaced()]))

        expect(findNextAnnotation(12)?.id).toBe('b')
    })

    it('skips an annotation that starts exactly at the current time', () => {
        const { findNextAnnotation } = useAnnotationData(freshStore([spaced()]))

        expect(findNextAnnotation(20)?.id).toBe('c')
    })

    it('returns the next annotation for a time in a gap', () => {
        const { findNextAnnotation } = useAnnotationData(freshStore([spaced()]))

        expect(findNextAnnotation(25)?.id).toBe('c')
    })

    it('returns null for a time after them all', () => {
        const { findNextAnnotation } = useAnnotationData(freshStore([spaced()]))

        expect(findNextAnnotation(100)).toBeNull()
    })

    it('returns null when the current time is the last annotation start', () => {
        const { findNextAnnotation } = useAnnotationData(freshStore([spaced()]))

        expect(findNextAnnotation(30)).toBeNull()
    })

    it('returns null when the active layer holds no annotations', () => {
        const { findNextAnnotation } = useAnnotationData(freshStore([layer(1)]))

        expect(findNextAnnotation(10)).toBeNull()
    })

    it('returns null when there is no layer at all', () => {
        const { findNextAnnotation } = useAnnotationData(freshStore([]))

        expect(findNextAnnotation(10)).toBeNull()
    })
})

describe('findPreviousAnnotation', () => {
    const spaced = () => layer(1, [
        { id: 'a', start: 10, duration: 5 },
        { id: 'b', start: 20, duration: 5 },
        { id: 'c', start: 30, duration: 5 }
    ])

    it('returns the annotation that started before the current time', () => {
        const { findPreviousAnnotation } = useAnnotationData(freshStore([spaced()]))

        expect(findPreviousAnnotation(15)?.id).toBe('a')
    })

    it('skips an annotation that starts exactly at the current time', () => {
        const { findPreviousAnnotation } = useAnnotationData(freshStore([spaced()]))

        expect(findPreviousAnnotation(30)?.id).toBe('b')
    })

    it('returns null for a time before them all', () => {
        const { findPreviousAnnotation } = useAnnotationData(freshStore([spaced()]))

        expect(findPreviousAnnotation(5)).toBeNull()
    })

    it('returns the closest earlier annotation for a time in a gap', () => {
        const { findPreviousAnnotation } = useAnnotationData(freshStore([spaced()]))

        expect(findPreviousAnnotation(35)?.id).toBe('c')
    })

    it('returns null when the active layer holds no annotations', () => {
        const { findPreviousAnnotation } = useAnnotationData(freshStore([layer(1)]))

        expect(findPreviousAnnotation(10)).toBeNull()
    })

    it('returns null when there is no layer at all', () => {
        const { findPreviousAnnotation } = useAnnotationData(freshStore([]))

        expect(findPreviousAnnotation(10)).toBeNull()
    })
})
