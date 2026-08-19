// The transport a viewer instance is currently using, shared with descendants.
//
// TSViewer owns the transport: it creates one when the active viewer's content
// is known, replaces it when the asset type changes, and closes it on unmount.
// Descendants read it through this context instead of constructing their own,
// so a viewer never has two connections open at once.
import type { InjectionKey, ShallowRef } from 'vue'
import { inject, provide } from 'vue'
import type { TimeseriesTransport } from '@/transport/TimeseriesTransport'

/** Null until the active viewer's content is known. */
export type TransportRef = ShallowRef<TimeseriesTransport | null>

export const ViewerTransportKey: InjectionKey<TransportRef> = Symbol('tsviewer-transport')

export function provideViewerTransport(transport: TransportRef): void {
    provide(ViewerTransportKey, transport)
}

/**
 * The owning viewer's transport ref. Throws when no TSViewer provided one,
 * rather than silently creating a second connection.
 */
export function useViewerTransport(): TransportRef {
    const transport = inject(ViewerTransportKey, null)
    if (!transport) {
        throw new Error('useViewerTransport: no TSViewer ancestor provided a transport')
    }
    return transport
}
