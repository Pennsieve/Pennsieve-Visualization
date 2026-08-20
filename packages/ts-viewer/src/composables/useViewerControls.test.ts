import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Ref } from 'vue'

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

const { useViewerControls } = await import('@/composables/useViewerControls')
const { createViewerStore } = await import('@/stores/tsviewer')

import type { ViewerChannel, ViewerStore } from '@/stores/tsviewer'
import type { Annotation, AnnotationLayer } from '@/utils/annotationUtils'

type Controls = ReturnType<typeof useViewerControls>

const channel = (id: string, extra: Partial<ViewerChannel> = {}): ViewerChannel =>
    ({ id, label: id, visible: true, selected: false, ...extra })

const layer = (id: number | string, extra: Partial<AnnotationLayer> = {}): AnnotationLayer =>
    ({ id, name: `Layer ${id}`, annotations: [], visible: true, selected: false, ...extra })

const annotation = (
    id: number | string,
    layerId: number | string,
    extra: Partial<Annotation> = {}
): Annotation => ({ id, layer_id: layerId, start: 0, duration: 10, ...extra })

// The layer controls narrow their layer id to string, while store layers carry
// number | string ids. These wrappers call them with the ids the store holds.
const setActiveLayer = (controls: Controls, layerId: number | string) =>
    (controls.setActiveLayer as (id: number | string) => void)(layerId)

const toggleLayerVisibility = (controls: Controls, layerId: number | string) =>
    (controls.toggleLayerVisibility as (id: number | string) => void)(layerId)

let instance = 0
/** Controls plus the store behind them, both for a never-before-used instance id. */
const freshControls = (): { controls: Controls; store: ViewerStore } => {
    const instanceId = `controls-test-${instance++}`
    return { controls: useViewerControls(instanceId), store: createViewerStore(instanceId) }
}

const populated = (): { controls: Controls; store: ViewerStore } => {
    const { controls, store } = freshControls()
    store.setChannels([
        channel('ch-1', { selected: true }),
        channel('ch-2'),
        channel('ch-3', { visible: false })
    ])
    store.setAnnotations([
        layer(1, { annotations: [annotation('a1', 1), annotation('a2', 1)] }),
        layer(2, { annotations: [annotation('b1', 2)] })
    ])
    return { controls, store }
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('exposed state', () => {
    it('reads the channels the store holds', () => {
        const { controls, store } = freshControls()
        store.setChannels([channel('ch-1'), channel('ch-2')])

        expect(controls.channels.value.map(ch => ch.id)).toEqual(['ch-1', 'ch-2'])
    })

    it('follows later store changes rather than snapshotting', () => {
        const { controls, store } = freshControls()
        expect(controls.channels.value).toEqual([])

        store.setChannels([channel('ch-1')])

        expect(controls.channels.value).toHaveLength(1)
    })

    it('reads the annotation layers, active tool, montage scheme and errors', () => {
        const { controls, store } = populated()
        store.setActiveTool('annotate')
        store.setViewerMontageScheme('DOUBLE_BANANA')
        store.setViewerErrors('load failed')

        expect(controls.annotations.value.map(l => l.id)).toEqual([1, 2])
        expect(controls.activeTool.value).toBe('annotate')
        expect(controls.montageScheme.value).toBe('DOUBLE_BANANA')
        expect(controls.errors.value).toBe('load failed')
    })

    it('reads the merged viewer config', () => {
        const { controls, store } = freshControls()
        store.setViewerConfig({ apiUrl: 'https://api.example.test' })
        store.setViewerConfig({ timeSeriesApi: 'https://ts.example.test' })

        expect(controls.viewerConfig.value.apiUrl).toBe('https://api.example.test')
        expect(controls.viewerConfig.value.timeSeriesApi).toBe('https://ts.example.test')
    })

    it('reads the active viewer content', () => {
        const { controls, store } = freshControls()
        store.setActiveViewer({ content: {
            id: 'N:package:1', viewerAssetId: 'asset-uuid', idType: 'viewerAsset',
            assetType: 'timeseries-zarr', url: 'https://bundle.example.test/', onUrlExpired: null
        } })

        expect(controls.viewer.value.content!.id).toBe('N:package:1')
    })

    it('lists the selected channels', () => {
        const { controls } = populated()

        expect(controls.selectedChannels.value.map(ch => ch.id)).toEqual(['ch-1'])
    })

    it('refuses a write to a state ref and keeps the store value', () => {
        const { controls, store } = populated()
        const writable = controls.channels as unknown as Ref<ViewerChannel[]>

        writable.value = []

        expect(controls.channels.value).toHaveLength(3)
        expect(store.viewerChannels).toHaveLength(3)
    })

    it('refuses a write to a channel reached through the state ref', () => {
        const { controls, store } = populated()
        const writable = controls.channels as unknown as Ref<ViewerChannel[]>

        writable.value[0].visible = false

        expect(store.viewerChannels[0].visible).toBe(true)
    })

    it('refuses a write to an annotation layer reached through the state ref', () => {
        const { controls, store } = populated()
        const writable = controls.annotations as unknown as Ref<AnnotationLayer[]>

        writable.value[0].visible = false

        expect(store.viewerAnnotations[0].visible).toBe(true)
    })

    it('refuses a write to the config reached through the state ref', () => {
        const { controls, store } = freshControls()
        store.setViewerConfig({ apiUrl: 'https://api.example.test' })
        const writable = controls.viewerConfig as unknown as Ref<Record<string, unknown>>

        writable.value.apiUrl = 'https://evil.example.test'

        expect(store.config.apiUrl).toBe('https://api.example.test')
    })
})

describe('state queries', () => {
    it('returns the channel with the given id', () => {
        const { controls } = populated()

        expect(controls.getChannel('ch-2')!.label).toBe('ch-2')
    })

    it('returns undefined for an unknown channel id', () => {
        const { controls } = populated()

        expect(controls.getChannel('nope')).toBeUndefined()
    })

    it('returns the annotation with the given id from any layer', () => {
        const { controls } = populated()

        expect(controls.getAnnotation('b1')!.layer_id).toBe(2)
    })

    it('returns undefined for an unknown annotation id', () => {
        const { controls } = populated()

        expect(controls.getAnnotation('ghost')).toBeUndefined()
    })

    it('returns the selected annotation layer', () => {
        const { controls, store } = populated()
        store.setActiveAnnotationLayer(2)

        expect(controls.getActiveLayer()!.id).toBe(2)
    })

    it('falls back to the first layer when none is selected', () => {
        const { controls } = populated()

        expect(controls.getActiveLayer()!.id).toBe(1)
        expect(warn).toHaveBeenCalled()
    })

    it('returns null for an active layer when there are no layers', () => {
        const { controls } = freshControls()

        expect(controls.getActiveLayer()).toBeNull()
    })

    it('lists only the visible channels', () => {
        const { controls } = populated()

        expect(controls.getVisibleChannels().map(ch => ch.id)).toEqual(['ch-1', 'ch-2'])
    })

    it('snapshots channels, selection, annotations, layer, tool, scheme and errors', () => {
        const { controls, store } = populated()
        store.setActiveAnnotationLayer(1)
        store.setActiveTool('pan')
        store.setViewerMontageScheme('DOUBLE_BANANA')
        store.setViewerErrors(null)

        const state = controls.getState()

        expect(state.channels.map(ch => ch.id)).toEqual(['ch-1', 'ch-2', 'ch-3'])
        expect(state.selectedChannels.map(ch => ch.id)).toEqual(['ch-1'])
        expect(state.annotations.map(l => l.id)).toEqual([1, 2])
        expect(state.activeLayer!.id).toBe(1)
        expect(state.activeTool).toBe('pan')
        expect(state.montageScheme).toBe('DOUBLE_BANANA')
        expect(state.errors).toBeNull()
    })

    it('rebuilds the snapshot on every call', () => {
        const { controls, store } = populated()
        const before = controls.getState()

        store.setActiveTool('annotate')
        const after = controls.getState()

        expect(before.activeTool).toBe('pointer')
        expect(after.activeTool).toBe('annotate')
    })
})

describe('channel selection', () => {
    it('selects the named channels and clears the rest', () => {
        const { controls, store } = populated()

        controls.selectChannels(['ch-2', 'ch-3'])

        expect(store.viewerSelectedChannels.map(ch => ch.id)).toEqual(['ch-2', 'ch-3'])
    })

    it('adds to the existing selection when appending', () => {
        const { controls, store } = populated()

        controls.selectChannels(['ch-2'], true)

        expect(store.viewerSelectedChannels.map(ch => ch.id)).toEqual(['ch-1', 'ch-2'])
    })

    it('clears every selection when given an empty list', () => {
        const { controls, store } = populated()

        controls.selectChannels([])

        expect(store.viewerSelectedChannels).toEqual([])
    })

    it('ignores channel ids the viewer does not hold', () => {
        const { controls, store } = populated()

        controls.selectChannels(['nope'])

        expect(store.viewerSelectedChannels).toEqual([])
        expect(store.viewerChannels).toHaveLength(3)
    })

    it('keeps the other channel fields when changing the selection', () => {
        const { controls, store } = populated()

        controls.selectChannels(['ch-3'])

        expect(store.viewerChannels[2]).toMatchObject({ id: 'ch-3', label: 'ch-3', visible: false })
    })

    it('clears the selection on request', () => {
        const { controls, store } = populated()

        controls.clearChannelSelection()

        expect(store.viewerSelectedChannels).toEqual([])
        expect(store.viewerChannels.map(ch => ch.id)).toEqual(['ch-1', 'ch-2', 'ch-3'])
    })
})

describe('channel visibility', () => {
    it('toggles a channel and asks for a rerender', () => {
        const { controls, store } = populated()

        controls.toggleChannelVisibility('ch-1')

        expect(store.viewerChannels[0].visible).toBe(false)
        expect(store.needsRerender!.cause).toBe('channel-visibility')
    })

    it('toggles a hidden channel back on', () => {
        const { controls, store } = populated()

        controls.toggleChannelVisibility('ch-3')

        expect(store.viewerChannels[2].visible).toBe(true)
    })

    it('does nothing and asks for no rerender for an unknown channel id', () => {
        const { controls, store } = populated()

        controls.toggleChannelVisibility('nope')

        expect(store.needsRerender).toBeNull()
    })

    it('sets visibility to the value given', () => {
        const { controls, store } = populated()

        controls.setChannelVisibility('ch-2', false)
        controls.setChannelVisibility('ch-3', true)

        expect(store.viewerChannels[1].visible).toBe(false)
        expect(store.viewerChannels[2].visible).toBe(true)
    })

    it('asks for a rerender even when the channel id is unknown', () => {
        // pins current behavior; see report
        const { controls, store } = populated()

        controls.setChannelVisibility('nope', false)

        expect(store.needsRerender!.cause).toBe('channel-visibility')
    })

    it('shows every channel with a single rerender request', () => {
        const { controls, store } = populated()

        controls.showAllChannels()

        expect(store.viewerChannels.every(ch => ch.visible)).toBe(true)
        expect(store.needsRerender!.cause).toBe('channel-visibility')
    })

    it('hides every channel', () => {
        const { controls, store } = populated()

        controls.hideAllChannels()

        expect(store.viewerChannels.some(ch => ch.visible)).toBe(false)
        expect(controls.getVisibleChannels()).toEqual([])
    })

    it('asks for no rerender when there are no channels to show', () => {
        const { controls, store } = freshControls()

        controls.showAllChannels()

        expect(store.needsRerender!.cause).toBe('channel-visibility')
    })
})

describe('annotation controls', () => {
    it('makes the named annotation the active one', () => {
        const { controls, store } = populated()

        controls.selectAnnotation('a2')

        expect(store.activeAnnotation.id).toBe('a2')
        expect(store.viewerAnnotations[0].annotations[1].selected).toBe(true)
    })

    it('leaves the active annotation alone for an unknown id', () => {
        const { controls, store } = populated()
        controls.selectAnnotation('a1')

        controls.selectAnnotation('ghost')

        expect(store.activeAnnotation.id).toBe('a1')
    })

    it('sets the active annotation layer', () => {
        const { controls, store } = populated()

        setActiveLayer(controls, 2)

        expect(store.activeAnnotationLayer).toBe(2)
        expect(controls.getActiveLayer()!.id).toBe(2)
    })

    it('accepts a string layer id as its signature declares', () => {
        const { controls, store } = freshControls()
        store.setAnnotations([layer('seizures'), layer('spikes')])

        controls.setActiveLayer('spikes')

        expect(controls.getActiveLayer()!.id).toBe('spikes')
    })

    it('accepts a numeric layer id at runtime although the signature narrows it to string', () => {
        // pins current behavior; see report
        const { controls, store } = populated()

        setActiveLayer(controls, 1)
        toggleLayerVisibility(controls, 1)

        expect(store.activeAnnotationLayer).toBe(1)
        expect(store.viewerAnnotations[0].visible).toBe(false)
    })

    it('toggles layer visibility and asks for a rerender', () => {
        const { controls, store } = populated()

        toggleLayerVisibility(controls, 1)

        expect(store.viewerAnnotations[0].visible).toBe(false)
        expect(store.needsRerender!.cause).toBe('layer-visibility')

        toggleLayerVisibility(controls, 1)

        expect(store.viewerAnnotations[0].visible).toBe(true)
    })

    it('does nothing and asks for no rerender for an unknown layer id', () => {
        const { controls, store } = populated()

        toggleLayerVisibility(controls, 99)

        expect(store.needsRerender).toBeNull()
        expect(store.viewerAnnotations.every(l => l.visible)).toBe(true)
    })
})

describe('tool and viewer controls', () => {
    it('sets the active tool', () => {
        const { controls, store } = freshControls()

        controls.setActiveTool('annotate')

        expect(store.viewerActiveTool).toBe('annotate')
        expect(controls.activeTool.value).toBe('annotate')
    })

    it('merges config without dropping earlier keys', () => {
        const { controls, store } = freshControls()

        controls.setConfig({ apiUrl: 'https://api.example.test' })
        controls.setConfig({ timeSeriesApi: 'https://ts.example.test' })

        expect(store.config).toEqual({
            apiUrl: 'https://api.example.test',
            timeSeriesApi: 'https://ts.example.test'
        })
    })

    it('replaces the active viewer wholesale', () => {
        const { controls, store } = freshControls()

        controls.setActiveViewer({ content: { id: 'N:package:1' } })
        controls.setActiveViewer({ content: { id: 'N:package:2' } })

        expect(store.activeViewer.content!.id).toBe('N:package:2')
    })

    it('asks for a rerender with the cause external by default', () => {
        const { controls, store } = freshControls()

        controls.triggerRerender()

        expect(store.needsRerender!.cause).toBe('external')
        expect(typeof store.needsRerender!.timestamp).toBe('number')
    })

    it('asks for a rerender with the cause given', () => {
        const { controls, store } = freshControls()

        controls.triggerRerender('host-resize')

        expect(store.needsRerender!.cause).toBe('host-resize')
    })

    it('resets the viewer state reachable through the controls', () => {
        const { controls, store } = populated()
        store.setActiveTool('annotate')
        store.setViewerMontageScheme('DOUBLE_BANANA')
        store.setViewerErrors('load failed')
        controls.setConfig({ apiUrl: 'https://api.example.test' })

        controls.reset()

        expect(controls.channels.value).toEqual([])
        expect(controls.annotations.value).toEqual([])
        expect(controls.selectedChannels.value).toEqual([])
        expect(controls.activeTool.value).toBe('pointer')
        expect(controls.montageScheme.value).toBe('NOT_MONTAGED')
        expect(controls.errors.value).toBeNull()
        expect(controls.viewerConfig.value).toEqual({})
        expect(controls.viewer.value).toEqual({})
    })
})

describe('instance binding', () => {
    it('exposes the same store instance the id maps to', () => {
        const instanceId = `controls-store-${instance++}`

        expect(useViewerControls(instanceId).store).toBe(createViewerStore(instanceId))
    })

    it('shares state between two control handles for one instance id', () => {
        const instanceId = `controls-shared-${instance++}`
        const first = useViewerControls(instanceId)
        const second = useViewerControls(instanceId)

        first.selectChannels([])
        second.setActiveTool('pan')

        expect(first.activeTool.value).toBe('pan')
    })

    it('keeps two instance ids isolated', () => {
        const first = useViewerControls(`controls-iso-a-${instance++}`)
        const second = useViewerControls(`controls-iso-b-${instance++}`)
        first.store.setChannels([channel('only-in-a')])

        first.setActiveTool('annotate')

        expect(second.activeTool.value).toBe('pointer')
        expect(second.channels.value).toEqual([])
        expect(first.channels.value.map(ch => ch.id)).toEqual(['only-in-a'])
    })

    it('binds to the default instance when no id is given', () => {
        const controls = useViewerControls()

        expect(controls.store).toBe(createViewerStore('default'))
    })
})
