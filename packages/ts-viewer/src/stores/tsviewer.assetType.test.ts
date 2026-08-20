import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// The store reaches for Amplify and a discovery WebSocket on the legacy path; neither exists
// under test, and the point here is only which path gets taken.
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

const { createViewerStore, clearAllViewerStores } = await import('@/stores/tsviewer')
const { TIMESERIES_ZARR, TIMESERIES_WEBSOCKET } = await import('@/composables/streaming/assetTypes')

const BUNDLE = 'https://assets.pennsieve.net/hash/O19/D2049/abc/'
const CHANNELS = [{ id: 'sineA', name: 'Sine A', channelType: 'CONTINUOUS' }]

let instance = 0
const freshStore = () => createViewerStore(`gate-test-${instance++}`)

describe('fetchAndSetActiveViewer routes on viewer-asset type', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
        acquireClient.mockResolvedValue({ url: BUNDLE })
        ensureCatalog.mockResolvedValue({ details: CHANNELS })
        openConnection.mockResolvedValue({ res: [{ id: 'ws-ch' }], status: 'websocket closed' })
    })

    it('reads the bundle for a timeseries-zarr asset, never opening the discovery socket', async () => {
        const store = freshStore()
        await store.fetchAndSetActiveViewer({
            packageId: 'N:package:1',
            viewerAssetId: 'asset-uuid',
            assetType: TIMESERIES_ZARR,
            url: BUNDLE
        })

        expect(acquireClient).toHaveBeenCalledTimes(1)
        expect(acquireClient.mock.calls[0][1]).toBe(BUNDLE)
        expect(openConnection).not.toHaveBeenCalled()
        // toEqual, not toBe: the store's ref wraps the array in a reactive proxy.
        expect(store.activeViewer.channels).toEqual(CHANNELS)
        expect(store.activeViewer.content).toMatchObject({
            id: 'N:package:1',
            viewerAssetId: 'asset-uuid',
            assetType: TIMESERIES_ZARR,
            url: BUNDLE
        })
    })

    it('uses the discovery socket for the pre-existing timeseries asset type', async () => {
        const store = freshStore()
        await store.fetchAndSetActiveViewer({
            packageId: 'N:package:2',
            viewerAssetId: 'asset-uuid',
            assetType: TIMESERIES_WEBSOCKET
        })

        expect(openConnection).toHaveBeenCalledTimes(1)
        expect(acquireClient).not.toHaveBeenCalled()
        expect(store.activeViewer.content!.assetType).toBe(TIMESERIES_WEBSOCKET)
    })

    it('falls back to the socket for an absent or unrecognized asset type', async () => {
        for (const assetType of [undefined, null, 'ome-zarr', 'thumb', 'TIMESERIES-ZARR']) {
            vi.clearAllMocks()
            openConnection.mockResolvedValue({ res: [], status: 'ok' })
            const store = freshStore()
            await store.fetchAndSetActiveViewer({ packageId: 'N:package:3', assetType })
            expect(acquireClient, `assetType=${assetType} must not open a bundle`).not.toHaveBeenCalled()
            expect(openConnection).toHaveBeenCalledTimes(1)
        }
    })

    it('ignores a url when the asset type is not a zarr bundle', async () => {
        // A stale or mistakenly-passed url must never by itself select the Zarr path.
        const store = freshStore()
        await store.fetchAndSetActiveViewer({
            packageId: 'N:package:4',
            assetType: TIMESERIES_WEBSOCKET,
            url: BUNDLE
        })
        expect(acquireClient).not.toHaveBeenCalled()
        expect(openConnection).toHaveBeenCalledTimes(1)
    })

    it('refuses a zarr asset with no url rather than silently falling back', async () => {
        const store = freshStore()
        await expect(
            store.fetchAndSetActiveViewer({ packageId: 'N:package:5', assetType: TIMESERIES_ZARR })
        ).rejects.toThrow(/requires a bundle url/)
        expect(openConnection).not.toHaveBeenCalled()
    })

    it('carries the renewal callback through to the active viewer', async () => {
        const onUrlExpired = async () => BUNDLE
        const store = freshStore()
        await store.fetchAndSetActiveViewer({
            packageId: 'N:package:6',
            assetType: TIMESERIES_ZARR,
            url: BUNDLE,
            onUrlExpired
        })
        expect(acquireClient.mock.calls[0][2]).toEqual({ onUrlExpired })
        // Must survive Pinia's reactive wrapping and stay callable.
        expect(typeof store.activeViewer.content!.onUrlExpired).toBe('function')
        await expect(store.activeViewer.content!.onUrlExpired!()).resolves.toBe(BUNDLE)
    })

    it('disposes the streaming client when the viewer store is cleared', async () => {
        const store = createViewerStore('gate-test-dispose')
        await store.fetchAndSetActiveViewer({
            packageId: 'N:package:7', assetType: TIMESERIES_ZARR, url: BUNDLE
        })
        clearAllViewerStores()
        // The registry key must match the one acquireClient was given, or the client leaks.
        expect(disposeClient).toHaveBeenCalledWith('tsviewer-gate-test-dispose')
        expect(acquireClient.mock.calls[0][0]).toBe('tsviewer-gate-test-dispose')
    })
})
