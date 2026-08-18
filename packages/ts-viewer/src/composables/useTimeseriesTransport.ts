import { computed } from 'vue'
import type { Ref } from 'vue'
import { useWebSocket } from '@/composables/useWebSocket'
import { useStreamingClient } from '@/composables/useStreamingClient'
import type { WebSocketEventEnvelope, WebSocketSegmentEnvelope } from '@/composables/useWebSocket'
import type { SegmentEnvelope } from '@/composables/streaming/segments'
import type { LegacyFilterMessage } from '@/composables/streaming/filters'

/** The 15 members both `useWebSocket()` and `useStreamingClient()` return. */
export interface TransportSurface {
    websocket: Readonly<Ref<{ readonly readyState: number; send(data: string): void } | null>>
    connectionStatus: Readonly<Ref<'connected' | 'disconnected'>>
    openWebsocket(timeseriesDiscoverApi: string, id: string, userToken: string | null, paramName?: string, packageId?: string | null): Promise<void>
    send(message: unknown): boolean
    sendMontageMessage(montageScheme: unknown): void
    sendFilterMessage(msg: LegacyFilterMessage): void
    sendDumpBufferRequest(): boolean
    disconnect(): Promise<void>
    setClearChannelsCallback(callback: () => void): void
    setActiveId(id: string): void
    setUseMedian(value: boolean): void
    onSegment(handler: (envelope: WebSocketSegmentEnvelope | SegmentEnvelope) => void): void
    onEvent(handler: (envelope: WebSocketEventEnvelope | SegmentEnvelope) => void): void
    onChannelDetails(handler: (details: unknown) => void): void
    onError(handler: (payload: Record<string, unknown>) => void): void
}

type TransportSetterName =
    | 'setClearChannelsCallback'
    | 'setActiveId'
    | 'setUseMedian'
    | 'onSegment'
    | 'onEvent'
    | 'onChannelDetails'
    | 'onError'

/**
 * Presents one `useWebSocket()`-shaped surface over both data transports and dispatches to
 * whichever the current viewer asset selects.
 *
 * Both are instantiated up front. Neither opens anything on construction -- a transport is
 * inert until `openWebsocket` is called -- so the idle one costs a couple of refs.
 *
 * The alternative, choosing one at setup and remounting the canvas when the asset type
 * changes, does not work here: `TSPlotCanvas`'s `onUnmounted` calls `viewerStore.resetViewer()`,
 * which clears `activeViewer`. Remounting on a package switch therefore has the outgoing
 * instance erase the very state the incoming one needs, and the new transport comes up with
 * no bundle url. Dispatching per call keeps one instance alive across the switch.
 *
 * Handler setters are applied to BOTH transports, so a handler registered once at setup is
 * still in place after a switch.
 *
 * @param isZarrSource Re-evaluated on every call; must reflect the CURRENT
 *   viewer asset rather than the one present at setup.
 * @returns The same 15 members `useWebSocket()` returns.
 */
export function useTimeseriesTransport(isZarrSource: () => boolean): TransportSurface {
    const websocketTransport = useWebSocket()
    const zarrTransport = useStreamingClient()

    const active = (): TransportSurface => (isZarrSource() ? zarrTransport : websocketTransport)
    const idle = (): TransportSurface => (isZarrSource() ? websocketTransport : zarrTransport)

    /** Applies a setter to both transports, so a switch never loses a registration. */
    const onBoth = <K extends TransportSetterName>(name: K): TransportSurface[K] =>
        ((value: never) => {
            websocketTransport[name](value)
            zarrTransport[name](value)
        }) as TransportSurface[K]

    return {
        websocket: computed(() => active().websocket.value),
        connectionStatus: computed(() => active().connectionStatus.value),

        openWebsocket: async (...args: Parameters<TransportSurface['openWebsocket']>) => {
            // Release the transport we are switching away from before opening the new one,
            // so a package switch cannot leave a live socket or an open bundle behind.
            await idle().disconnect()
            return await active().openWebsocket(...args)
        },
        send: (...args: Parameters<TransportSurface['send']>) => active().send(...args),
        sendMontageMessage: (...args: Parameters<TransportSurface['sendMontageMessage']>) => active().sendMontageMessage(...args),
        sendFilterMessage: (...args: Parameters<TransportSurface['sendFilterMessage']>) => active().sendFilterMessage(...args),
        sendDumpBufferRequest: (...args: Parameters<TransportSurface['sendDumpBufferRequest']>) => active().sendDumpBufferRequest(...args),
        disconnect: async () => {
            await websocketTransport.disconnect()
            await zarrTransport.disconnect()
        },

        setClearChannelsCallback: onBoth('setClearChannelsCallback'),
        setActiveId: onBoth('setActiveId'),
        setUseMedian: onBoth('setUseMedian'),
        onSegment: onBoth('onSegment'),
        onEvent: onBoth('onEvent'),
        onChannelDetails: onBoth('onChannelDetails'),
        onError: onBoth('onError')
    }
}
