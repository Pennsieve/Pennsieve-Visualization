import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Same isolation as tsviewer.assetType.test.ts: the store reaches for Amplify, a
// discovery WebSocket and the Zarr client registry, none of which exist under test.
const acquireClient = vi.fn()
const ensureCatalog = vi.fn()
const disposeClient = vi.fn()
const openConnection = vi.fn()

vi.mock('@/composables/useToken', () => ({
    useToken: vi.fn(async () => 'a.jwt.token'),
    useLogout: vi.fn()
}))

vi.mock('@/composables/useChannelDataRequest', () => ({
    useChannelDataRequest: () => ({ openConnection })
}))

vi.mock('@/composables/streaming/clientRegistry', () => ({
    acquireClient: (...args: unknown[]) => acquireClient(...args),
    ensureCatalog: (...args: unknown[]) => ensureCatalog(...args),
    disposeClient: (...args: unknown[]) => disposeClient(...args)
}))

const {
    createViewerStore,
    clearViewerStore,
    clearAllViewerStores
} = await import('@/stores/tsviewer')
type StoreModule = typeof import('@/stores/tsviewer')

import type { ViewerChannel, ViewerStore } from '@/stores/tsviewer'
import type { Annotation, AnnotationLayer } from '@/utils/annotationUtils'
import type { WorkspaceMontage } from '@/composables/useChannelProcessing'

const channel = (id: string, extra: Partial<ViewerChannel> = {}): ViewerChannel =>
    ({ id, label: id, visible: true, selected: false, ...extra })

const layer = (id: number | string, extra: Partial<AnnotationLayer> = {}): AnnotationLayer =>
    ({ id, name: `Layer ${id}`, annotations: [], visible: true, selected: false, ...extra })

const annotation = (
    id: number | string,
    layerId: number | string,
    extra: Partial<Annotation> = {}
): Annotation => ({ id, layer_id: layerId, start: 0, duration: 10, ...extra })

let instance = 0
const freshStore = (): ViewerStore => createViewerStore(`actions-test-${instance++}`)

let warn: MockInstance<typeof console.warn>
let error: MockInstance<typeof console.error>

beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('setChannels', () => {
    it('replaces the whole channel list', () => {
        const store = freshStore()
        store.setChannels([channel('a'), channel('b')])
        store.setChannels([channel('c')])

        expect(store.viewerChannels.map(ch => ch.id)).toEqual(['c'])
    })

    it('stores channels without validating or backfilling them', () => {
        const store = freshStore()
        store.setChannels([{ id: 'bare' }])

        expect(store.viewerChannels[0]).toEqual({ id: 'bare' })
    })

    it('accepts an empty list', () => {
        const store = freshStore()
        store.setChannels([channel('a')])
        store.setChannels([])

        expect(store.viewerChannels).toEqual([])
    })
})

describe('setAnnotations', () => {
    it('keeps well formed layers unchanged', () => {
        const store = freshStore()
        const layers = [layer(1, { name: 'Seizures' }), layer(2)]

        store.setAnnotations(layers)

        expect(store.viewerAnnotations.map(l => l.id)).toEqual([1, 2])
        expect(store.viewerAnnotations[0].name).toBe('Seizures')
    })

    it('generates a string id for a layer that has none', () => {
        const store = freshStore()
        // Hosts pass layers straight from unchecked API JSON, which is what the
        // runtime backfill exists for.
        const idless = { name: 'No id', annotations: [] } as unknown as AnnotationLayer

        store.setAnnotations([idless])

        expect(typeof store.viewerAnnotations[0].id).toBe('string')
        expect(store.viewerAnnotations[0].id).toBeTruthy()
        expect(warn).toHaveBeenCalled()
    })

    it('backfills a missing annotations array', () => {
        const store = freshStore()
        const noAnnotations = { id: 4, name: 'Empty' } as unknown as AnnotationLayer

        store.setAnnotations([noAnnotations])

        expect(store.viewerAnnotations[0].annotations).toEqual([])
    })

    it('names a layer after its id when the name is missing', () => {
        const store = freshStore()

        store.setAnnotations([{ id: 9, annotations: [] }])

        expect(store.viewerAnnotations[0].name).toBe('Layer 9')
    })

    it('keeps a layer whose id is 0 and names it after that id', () => {
        const store = freshStore()

        store.setAnnotations([{ id: 0, annotations: [] }])

        expect(store.viewerAnnotations[0].id).toBe(0)
        expect(store.viewerAnnotations[0].name).toBe('Layer 0')
    })

    it('writes the backfilled fields onto the layer objects the caller passed', () => {
        // pins current behavior; see report
        const store = freshStore()
        const caller: AnnotationLayer = { id: 5, annotations: [] }

        store.setAnnotations([caller])

        expect(caller.name).toBe('Layer 5')
    })
})

describe('setActiveAnnotationLayer', () => {
    const twoLayers = () => [layer(1), layer(2)]

    it('selects the requested layer', () => {
        const store = freshStore()
        store.setAnnotations(twoLayers())

        store.setActiveAnnotationLayer(2)

        expect(store.viewerAnnotations.find(l => l.id === 2)!.selected).toBe(true)
        expect(store.activeAnnotationLayer).toBe(2)
    })

    it('clears the selected flag on every other layer', () => {
        const store = freshStore()
        store.setAnnotations(twoLayers())

        store.setActiveAnnotationLayer(1)
        store.setActiveAnnotationLayer(2)

        expect(store.viewerAnnotations.filter(l => l.selected).map(l => l.id)).toEqual([2])
    })

    it('accepts the layer id 0', () => {
        const store = freshStore()
        store.setAnnotations([layer(0), layer(1)])

        store.setActiveAnnotationLayer(0)

        expect(store.viewerAnnotations[0].selected).toBe(true)
        expect(store.activeAnnotationLayer).toBe(0)
    })

    it('refuses an empty layer id and leaves the active layer alone', () => {
        const store = freshStore()
        store.setAnnotations(twoLayers())
        store.setActiveAnnotationLayer(1)

        store.setActiveAnnotationLayer('')

        expect(store.activeAnnotationLayer).toBe(1)
        expect(store.viewerAnnotations[0].selected).toBe(true)
        expect(error).toHaveBeenCalled()
    })

    it('leaves no layer selected when the layer id is unknown', () => {
        // pins current behavior; see report
        const store = freshStore()
        store.setAnnotations(twoLayers())
        store.setActiveAnnotationLayer(1)

        store.setActiveAnnotationLayer(99)

        expect(store.viewerAnnotations.filter(l => l.selected)).toEqual([])
        expect(store.activeAnnotationLayer).toBe(99)
        expect(error).toHaveBeenCalled()
    })
})

describe('setActiveAnnotation', () => {
    const populated = () => [
        layer(1, { annotations: [annotation('a1', 1), annotation('a2', 1)] }),
        layer(2, { annotations: [annotation('b1', 2)] })
    ]

    it('marks the matching annotation as selected', () => {
        const store = freshStore()
        store.setAnnotations(populated())

        store.setActiveAnnotation(annotation('a2', 1))

        expect(store.viewerAnnotations[0].annotations[1].selected).toBe(true)
    })

    it('stores the annotation as the active one', () => {
        const store = freshStore()
        store.setAnnotations(populated())
        const target = annotation('b1', 2)

        store.setActiveAnnotation(target)

        expect(store.activeAnnotation.id).toBe('b1')
    })

    it('clears the selected flag on annotations in every layer', () => {
        const store = freshStore()
        store.setAnnotations(populated())
        store.setActiveAnnotation(annotation('b1', 2))

        store.setActiveAnnotation(annotation('a1', 1))

        const selected = store.viewerAnnotations.flatMap(l => l.annotations).filter(a => a.selected)
        expect(selected.map(a => a.id)).toEqual(['a1'])
    })

    it('stores an annotation whose layer is unknown without selecting anything', () => {
        const store = freshStore()
        store.setAnnotations(populated())

        store.setActiveAnnotation(annotation('ghost', 77))

        expect(store.activeAnnotation.id).toBe('ghost')
        expect(store.viewerAnnotations.flatMap(l => l.annotations).filter(a => a.selected)).toEqual([])
    })

    it('never selects an annotation whose id is 0', () => {
        // pins current behavior; see report
        const store = freshStore()
        store.setAnnotations([layer(1, { annotations: [annotation(0, 1)] })])

        store.setActiveAnnotation(annotation(0, 1))

        expect(store.activeAnnotation.id).toBe(0)
        expect(store.viewerAnnotations[0].annotations[0].selected).toBeFalsy()
    })
})

describe('setActiveTool', () => {
    it('starts on the pointer tool and records the new tool', () => {
        const store = freshStore()
        expect(store.viewerActiveTool).toBe('pointer')

        store.setActiveTool('annotate')

        expect(store.viewerActiveTool).toBe('annotate')
    })
})

describe('createLayer', () => {
    it('appends the layer with defaults for the fields the caller omitted', () => {
        const store = freshStore()

        store.createLayer({ id: 7 } as unknown as AnnotationLayer)

        expect(store.viewerAnnotations[0]).toMatchObject({
            id: 7,
            name: 'Layer 7',
            description: '',
            visible: true,
            selected: false,
            annotations: []
        })
    })

    it('keeps the values the caller supplied', () => {
        const store = freshStore()

        store.createLayer(layer(7, { name: 'Spikes', description: 'notes', visible: false, hexColor: '#ff0000' }))

        expect(store.viewerAnnotations[0]).toMatchObject({
            name: 'Spikes',
            description: 'notes',
            visible: false,
            hexColor: '#ff0000'
        })
    })

    it('accepts the layer id 0', () => {
        const store = freshStore()

        store.createLayer({ id: 0, annotations: [] })

        expect(store.viewerAnnotations.map(l => l.id)).toEqual([0])
    })

    it('refuses a layer with no id', () => {
        const store = freshStore()

        store.createLayer({ name: 'No id', annotations: [] } as unknown as AnnotationLayer)

        expect(store.viewerAnnotations).toEqual([])
        expect(error).toHaveBeenCalled()
    })

    it('appends a second layer with an id that is already taken', () => {
        // pins current behavior; see report
        const store = freshStore()
        store.createLayer(layer(7, { name: 'First' }))
        store.createLayer(layer(7, { name: 'Second' }))

        expect(store.viewerAnnotations).toHaveLength(2)

        store.updateLayer(layer(7, { name: 'Renamed' }))

        expect(store.viewerAnnotations.map(l => l.name)).toEqual(['Renamed', 'Second'])
    })
})

describe('updateLayer', () => {
    it('merges the update into the existing layer', () => {
        const store = freshStore()
        store.setAnnotations([layer(1, { name: 'Old', annotations: [annotation('a1', 1)] })])

        store.updateLayer(layer(1, { name: 'New', annotations: [] }))

        expect(store.viewerAnnotations[0].name).toBe('New')
    })

    it('keeps fields the update does not mention', () => {
        const store = freshStore()
        store.setAnnotations([layer(1, { name: 'Old', hexColor: '#00ff00' })])

        store.updateLayer({ id: 1, name: 'New' } as unknown as AnnotationLayer)

        expect(store.viewerAnnotations[0].hexColor).toBe('#00ff00')
    })

    it('ignores an update for an unknown layer id', () => {
        const store = freshStore()
        store.setAnnotations([layer(1)])

        store.updateLayer(layer(99, { name: 'Ghost' }))

        expect(store.viewerAnnotations.map(l => l.id)).toEqual([1])
    })
})

describe('deleteLayer', () => {
    it('removes the matching layer and keeps the rest', () => {
        const store = freshStore()
        store.setAnnotations([layer(1), layer(2), layer(3)])

        store.deleteLayer({ id: 2 })

        expect(store.viewerAnnotations.map(l => l.id)).toEqual([1, 3])
    })

    it('ignores an unknown layer id', () => {
        const store = freshStore()
        store.setAnnotations([layer(1)])

        store.deleteLayer({ id: 99 })

        expect(store.viewerAnnotations).toHaveLength(1)
    })
})

describe('createAnnotation', () => {
    it('appends the annotation to its layer', () => {
        const store = freshStore()
        store.setAnnotations([layer(1, { annotations: [annotation('a1', 1)] })])

        store.createAnnotation(annotation('a2', 1, { start: 500 }))

        expect(store.viewerAnnotations[0].annotations.map(a => a.id)).toEqual(['a1', 'a2'])
    })

    it('makes the new annotation the active and selected one', () => {
        const store = freshStore()
        store.setAnnotations([layer(1, { annotations: [annotation('a1', 1, { selected: true })] })])

        store.createAnnotation(annotation('a2', 1))

        expect(store.activeAnnotation.id).toBe('a2')
        expect(store.viewerAnnotations[0].annotations[1].selected).toBe(true)
        expect(store.viewerAnnotations[0].annotations[0].selected).toBe(false)
    })

    it('ignores an annotation whose layer_id matches no layer', () => {
        const store = freshStore()
        store.setAnnotations([layer(1)])

        store.createAnnotation(annotation('ghost', 77))

        expect(store.viewerAnnotations[0].annotations).toEqual([])
        expect(store.activeAnnotation).toEqual({})
    })

    it('creates the annotations array when the layer has none', () => {
        const store = freshStore()
        const bare = { id: 1, name: 'Bare' } as unknown as AnnotationLayer
        store.viewerAnnotations.push(bare)

        store.createAnnotation(annotation('a1', 1))

        expect(store.viewerAnnotations[0].annotations.map(a => a.id)).toEqual(['a1'])
    })
})

describe('updateAnnotation', () => {
    it('replaces the annotation carrying the same id', () => {
        const store = freshStore()
        store.setAnnotations([layer(1, { annotations: [annotation('a1', 1), annotation('a2', 1)] })])

        store.updateAnnotation(annotation('a2', 1, { start: 999, label: 'edited' }))

        expect(store.viewerAnnotations[0].annotations[1].start).toBe(999)
        expect(store.viewerAnnotations[0].annotations[1].label).toBe('edited')
    })

    it('ignores an unknown annotation id', () => {
        const store = freshStore()
        store.setAnnotations([layer(1, { annotations: [annotation('a1', 1)] })])

        store.updateAnnotation(annotation('ghost', 1, { start: 999 }))

        expect(store.viewerAnnotations[0].annotations.map(a => a.id)).toEqual(['a1'])
        expect(store.viewerAnnotations[0].annotations[0].start).toBe(0)
    })

    it('ignores an unknown layer id', () => {
        const store = freshStore()
        store.setAnnotations([layer(1, { annotations: [annotation('a1', 1)] })])

        store.updateAnnotation(annotation('a1', 77, { start: 999 }))

        expect(store.viewerAnnotations[0].annotations[0].start).toBe(0)
    })

    it('moves the annotation to the layer the update names', () => {
        const store = freshStore()
        store.setAnnotations([
            layer(1, { annotations: [annotation('a1', 1)] }),
            layer(2, { annotations: [] })
        ])

        store.updateAnnotation(annotation('a1', 2))

        expect(store.viewerAnnotations[0].annotations).toEqual([])
        expect(store.viewerAnnotations[1].annotations.map(a => a.id)).toEqual(['a1'])
        expect(store.viewerAnnotations[1].annotations[0].layer_id).toBe(2)
    })

    it('orders the target layer by start time after a move into it', () => {
        const store = freshStore()
        store.setAnnotations([
            layer(1, { annotations: [annotation('a1', 1, { start: 500 })] }),
            layer(2, {
                annotations: [annotation('b1', 2, { start: 100 }), annotation('b2', 2, { start: 900 })]
            })
        ])

        store.updateAnnotation(annotation('a1', 2, { start: 500 }))

        expect(store.viewerAnnotations[1].annotations.map(a => a.id)).toEqual(['b1', 'a1', 'b2'])
    })
})

describe('deleteAnnotation', () => {
    it('removes the annotation from its layer', () => {
        const store = freshStore()
        store.setAnnotations([layer(1, { annotations: [annotation('a1', 1), annotation('a2', 1)] })])

        store.deleteAnnotation(annotation('a1', 1))

        expect(store.viewerAnnotations[0].annotations.map(a => a.id)).toEqual(['a2'])
    })

    it('ignores an unknown annotation id', () => {
        const store = freshStore()
        store.setAnnotations([layer(1, { annotations: [annotation('a1', 1)] })])

        store.deleteAnnotation(annotation('ghost', 1))

        expect(store.viewerAnnotations[0].annotations).toHaveLength(1)
    })

    it('ignores an unknown layer id', () => {
        const store = freshStore()
        store.setAnnotations([layer(1, { annotations: [annotation('a1', 1)] })])

        store.deleteAnnotation(annotation('a1', 77))

        expect(store.viewerAnnotations[0].annotations).toHaveLength(1)
    })
})

describe('channel property updates', () => {
    it('sets an arbitrary property on the matching channel', () => {
        const store = freshStore()
        store.setChannels([channel('a'), channel('b')])

        store.updateChannelProperty('b', 'rowScale', 4)

        expect(store.viewerChannels[1].rowScale).toBe(4)
        expect(store.viewerChannels[0].rowScale).toBeUndefined()
    })

    it('adds a property the channel did not have', () => {
        const store = freshStore()
        store.setChannels([{ id: 'a' }])

        store.updateChannelProperty('a', 'hover', true)

        expect(store.viewerChannels[0].hover).toBe(true)
    })

    it('ignores an unknown channel id', () => {
        const store = freshStore()
        store.setChannels([channel('a')])

        store.updateChannelProperty('nope', 'rowScale', 4)

        expect(store.viewerChannels).toHaveLength(1)
        expect(store.viewerChannels[0].rowScale).toBeUndefined()
    })

    it('sets visibility, selection and filter on the named channel', () => {
        const store = freshStore()
        store.setChannels([channel('a')])

        store.updateChannelVisibility('a', false)
        store.updateChannelSelection('a', true)
        store.updateChannelFilter('a', { type: 'bandpass', low: 1, high: 70 })

        expect(store.viewerChannels[0].visible).toBe(false)
        expect(store.viewerChannels[0].selected).toBe(true)
        expect(store.viewerChannels[0].filter).toEqual({ type: 'bandpass', low: 1, high: 70 })
    })

    it('clears a filter when passed null', () => {
        const store = freshStore()
        store.setChannels([channel('a', { filter: { type: 'bandpass' } })])

        store.updateChannelFilter('a', null)

        expect(store.viewerChannels[0].filter).toBeNull()
    })
})

describe('validateAnnotationLayers', () => {
    it('accepts well formed layers', () => {
        const store = freshStore()
        store.setAnnotations([layer(1), layer(0)])

        expect(store.validateAnnotationLayers()).toBe(true)
        expect(error).not.toHaveBeenCalled()
    })

    it('accepts an empty layer list', () => {
        const store = freshStore()

        expect(store.validateAnnotationLayers()).toBe(true)
    })

    it('backfills a missing annotations array and still reports success', () => {
        const store = freshStore()
        store.viewerAnnotations.push({ id: 1, name: 'Bare' } as unknown as AnnotationLayer)

        expect(store.validateAnnotationLayers()).toBe(true)
        expect(store.viewerAnnotations[0].annotations).toEqual([])
        expect(warn).toHaveBeenCalled()
    })

    it('reports failure for a layer with no id', () => {
        const store = freshStore()
        store.viewerAnnotations.push({ name: 'No id', annotations: [] } as unknown as AnnotationLayer)

        expect(store.validateAnnotationLayers()).toBe(false)
        expect(error).toHaveBeenCalled()
    })
})

describe('resetViewer', () => {
    const populate = (store: ViewerStore) => {
        store.setChannels([channel('a', { selected: true })])
        store.setAnnotations([layer(1, { annotations: [annotation('a1', 1)] })])
        store.setActiveAnnotationLayer(1)
        store.setActiveAnnotation(annotation('a1', 1))
        store.setActiveTool('annotate')
        store.setViewerMontageScheme('DOUBLE_BANANA')
        store.setCustomMontageMap({ Fp1: 'F7' })
        store.setWorkspaceMontages([{ name: 'DOUBLE_BANANA', channelPairs: [] }])
        store.setViewerErrors(new Error('boom'))
        store.setViewerConfig({ apiUrl: 'https://api.example.test' })
        store.setActiveViewer({ content: {
            id: 'N:package:1', viewerAssetId: null, idType: 'package',
            assetType: null, url: null, onUrlExpired: null
        } })
    }

    it('clears every piece of viewer state back to its initial value', () => {
        const store = freshStore()
        populate(store)

        store.resetViewer()

        expect(store.viewerChannels).toEqual([])
        expect(store.viewerAnnotations).toEqual([])
        expect(store.viewerMontageScheme).toBe('NOT_MONTAGED')
        expect(store.customMontageMap).toEqual({})
        expect(store.workspaceMontages).toEqual([])
        expect(store.viewerErrors).toBeNull()
        expect(store.activeAnnotationLayer).toEqual({})
        expect(store.activeAnnotation).toEqual({})
        expect(store.viewerActiveTool).toBe('pointer')
        expect(store.activeViewer).toEqual({})
        expect(store.config).toEqual({})
    })

    it('empties the config object in place so held references stay valid', () => {
        const store = freshStore()
        const held = store.config
        populate(store)

        store.resetViewer()

        expect(store.config).toBe(held)
        expect(Object.keys(held)).toEqual([])
    })

    it('leaves a pending rerender trigger in place', () => {
        // pins current behavior; see report
        const store = freshStore()
        store.triggerRerender('channel-visibility')

        store.resetViewer()

        expect(store.needsRerender).not.toBeNull()
        expect(store.needsRerender!.cause).toBe('channel-visibility')
    })
})

describe('rerender trigger', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('records the cause and the time of the request', () => {
        const store = freshStore()

        store.triggerRerender('filter-change')

        expect(store.needsRerender).toEqual({
            cause: 'filter-change',
            timestamp: Date.parse('2026-01-01T00:00:00.000Z')
        })
    })

    it('replaces a pending trigger with the newest one', () => {
        const store = freshStore()
        store.triggerRerender('first')
        vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))

        store.triggerRerender('second')

        expect(store.needsRerender!.cause).toBe('second')
        expect(store.needsRerender!.timestamp).toBe(Date.parse('2026-01-01T00:00:01.000Z'))
    })

    it('starts with no trigger and clears back to none', () => {
        const store = freshStore()
        expect(store.needsRerender).toBeNull()

        store.triggerRerender('external')
        store.resetRerenderTrigger()

        expect(store.needsRerender).toBeNull()
    })
})

describe('isTSFileProcessed', () => {
    it('reports a READY record as processed', () => {
        const store = freshStore()

        expect(store.isTSFileProcessed()({ content: { state: 'READY' } })).toBe(true)
    })

    it('reports any other state as not processed', () => {
        const store = freshStore()
        const isProcessed = store.isTSFileProcessed()

        expect(isProcessed({ content: { state: 'PROCESSING' } })).toBe(false)
        expect(isProcessed({ content: {} })).toBe(false)
        expect(isProcessed({})).toBe(false)
        expect(isProcessed()).toBe(false)
    })

    it('returns a predicate rather than a boolean, so callers invoke it twice', () => {
        const store = freshStore()

        expect(typeof store.isTSFileProcessed()).toBe('function')
    })
})

describe('getMontageMessageByName', () => {
    const montages: WorkspaceMontage[] = [
        { name: 'DOUBLE_BANANA', channelPairs: [{ name: 'Fp1-F7', channels: ['Fp1', 'F7'] }] },
        { name: 'REFERENTIAL', channelPairs: [] }
    ]

    it('returns the montage with the given name', () => {
        const store = freshStore()
        store.setWorkspaceMontages(montages)

        expect(store.getMontageMessageByName('REFERENTIAL')).toMatchObject({ name: 'REFERENTIAL' })
    })

    it('returns undefined for a name that is not in the workspace', () => {
        const store = freshStore()
        store.setWorkspaceMontages(montages)

        expect(store.getMontageMessageByName('NO_SUCH_MONTAGE')).toBeUndefined()
    })

    it('returns undefined when no montages are loaded', () => {
        const store = freshStore()

        expect(store.getMontageMessageByName('DOUBLE_BANANA')).toBeUndefined()
    })
})

describe('viewerSelectedChannels', () => {
    it('lists only the channels flagged as selected, in channel order', () => {
        const store = freshStore()
        store.setChannels([channel('a', { selected: true }), channel('b'), channel('c', { selected: true })])

        expect(store.viewerSelectedChannels.map(ch => ch.id)).toEqual(['a', 'c'])
    })

    it('follows a selection change made through updateChannelSelection', () => {
        const store = freshStore()
        store.setChannels([channel('a'), channel('b')])
        expect(store.viewerSelectedChannels).toEqual([])

        store.updateChannelSelection('b', true)

        expect(store.viewerSelectedChannels.map(ch => ch.id)).toEqual(['b'])
    })
})

describe('getViewerActiveLayer', () => {
    it('returns the selected layer', () => {
        const store = freshStore()
        store.setAnnotations([layer(1), layer(2)])
        store.setActiveAnnotationLayer(2)

        expect(store.getViewerActiveLayer()!.id).toBe(2)
    })

    it('falls back to the first layer and warns when none is selected', () => {
        const store = freshStore()
        store.setAnnotations([layer(1), layer(2)])

        expect(store.getViewerActiveLayer()!.id).toBe(1)
        expect(warn).toHaveBeenCalled()
    })

    it('returns null when there are no layers', () => {
        const store = freshStore()

        expect(store.getViewerActiveLayer()).toBeNull()
    })
})

describe('getAnnotationById', () => {
    const layers = () => [
        layer(1, { annotations: [annotation('a1', 1), annotation(2, 1)] }),
        layer(2, { annotations: [annotation('b1', 2)] })
    ]

    it('finds an annotation in any layer', () => {
        const store = freshStore()
        store.setAnnotations(layers())

        expect(store.getAnnotationById('b1')!.layer_id).toBe(2)
    })

    it('returns undefined for an id that no layer holds', () => {
        const store = freshStore()
        store.setAnnotations(layers())

        expect(store.getAnnotationById('ghost')).toBeUndefined()
    })

    it('does not match a numeric id against its string form', () => {
        const store = freshStore()
        store.setAnnotations(layers())

        expect(store.getAnnotationById(2)).toBeDefined()
        expect(store.getAnnotationById('2')).toBeUndefined()
    })

    it('skips layers with no annotations array', () => {
        const store = freshStore()
        store.viewerAnnotations.push({ id: 1 } as unknown as AnnotationLayer)
        store.viewerAnnotations.push(layer(2, { annotations: [annotation('b1', 2)] }))

        expect(store.getAnnotationById('b1')).toBeDefined()
    })
})

describe('store instance cache', () => {
    it('returns the same store for the same instance id', () => {
        expect(createViewerStore('cache-same')).toBe(createViewerStore('cache-same'))
    })

    it('keeps two instance ids isolated', () => {
        const first = createViewerStore('cache-a')
        const second = createViewerStore('cache-b')

        first.setChannels([channel('only-in-a')])
        first.setActiveTool('annotate')

        expect(second.viewerChannels).toEqual([])
        expect(second.viewerActiveTool).toBe('pointer')
        expect(first.viewerChannels.map(ch => ch.id)).toEqual(['only-in-a'])
    })

    it('resets the state and disposes the client when one instance is cleared', () => {
        const store = createViewerStore('cache-clear-one')
        store.setChannels([channel('a')])

        clearViewerStore('cache-clear-one')

        expect(store.viewerChannels).toEqual([])
        expect(disposeClient).toHaveBeenCalledWith('tsviewer-cache-clear-one')
        expect(createViewerStore('cache-clear-one').viewerChannels).toEqual([])
    })

    it('disposes the client for an instance that was never created', () => {
        expect(() => clearViewerStore('never-created')).not.toThrow()
        expect(disposeClient).toHaveBeenCalledWith('tsviewer-never-created')
    })

    it('leaves other instances alone when one is cleared', () => {
        const kept = createViewerStore('cache-kept')
        createViewerStore('cache-dropped')
        kept.setChannels([channel('a')])

        clearViewerStore('cache-dropped')

        expect(kept.viewerChannels.map(ch => ch.id)).toEqual(['a'])
    })

    it('resets every instance and disposes every client when all are cleared', () => {
        const first = createViewerStore('cache-all-1')
        const second = createViewerStore('cache-all-2')
        first.setChannels([channel('a')])
        second.setActiveTool('annotate')

        clearAllViewerStores()

        expect(first.viewerChannels).toEqual([])
        expect(second.viewerActiveTool).toBe('pointer')
        expect(disposeClient).toHaveBeenCalledWith('tsviewer-cache-all-1')
        expect(disposeClient).toHaveBeenCalledWith('tsviewer-cache-all-2')
    })
})

describe('instance id defaults', () => {
    // A fresh module gives each of these tests the un-warned state, since the
    // warn-once flags live at module scope.
    const freshModule = async (): Promise<StoreModule> => {
        vi.resetModules()
        const mod = await import('@/stores/tsviewer')
        setActivePinia(createPinia())
        return mod
    }

    it('warns once about the default instance and not again', async () => {
        const mod = await freshModule()

        mod.createViewerStore()
        expect(warn).toHaveBeenCalledTimes(1)
        expect(String(warn.mock.calls[0][0])).toContain('default store instance')

        mod.createViewerStore()
        mod.createViewerStore('default')
        expect(warn).toHaveBeenCalledTimes(1)
    })

    it('does not warn for a named instance', async () => {
        const mod = await freshModule()

        mod.createViewerStore('named')

        expect(warn).not.toHaveBeenCalled()
    })
})
