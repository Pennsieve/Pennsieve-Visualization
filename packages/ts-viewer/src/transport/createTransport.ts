// Picks the transport for a viewer asset. This is the only place above the
// transport layer that branches on the asset type.
import { isZarrAssetType } from '@/composables/streaming/assetTypes'
import { createWebsocketTransport } from './websocketTransport'
import { createZarrTransport } from './zarrTransport'
import type { TimeseriesTransport } from './TimeseriesTransport'

export interface CreateTransportDeps {
    /** Client-registry key for the Zarr path; the registry memoizes one client per key. */
    registryKey: string
}

/**
 * Builds the transport an asset type selects: the Zarr reader for
 * `timeseries-zarr`, the legacy streaming WebSocket for everything else.
 *
 * @param assetType Raw `asset_type` from the viewer-asset record.
 */
export function createTransport(
    assetType: string | null | undefined,
    deps: CreateTransportDeps,
): TimeseriesTransport {
    if (isZarrAssetType(assetType)) {
        return createZarrTransport({ registryKey: deps.registryKey })
    }
    return createWebsocketTransport()
}
