import { computed } from 'vue'
import { useWebSocket } from '@/composables/useWebSocket'
import { useStreamingClient } from '@/composables/useStreamingClient'

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
 * @param {() => boolean} isZarrSource Re-evaluated on every call; must reflect the CURRENT
 *   viewer asset rather than the one present at setup.
 * @returns {object} The same 15 members `useWebSocket()` returns.
 */
export function useTimeseriesTransport(isZarrSource) {
    const websocketTransport = useWebSocket()
    const zarrTransport = useStreamingClient()

    const active = () => (isZarrSource() ? zarrTransport : websocketTransport)
    const idle = () => (isZarrSource() ? websocketTransport : zarrTransport)

    /** Applies a setter to both transports, so a switch never loses a registration. */
    const onBoth = (name) => (value) => {
        websocketTransport[name](value)
        zarrTransport[name](value)
    }

    return {
        websocket: computed(() => active().websocket.value),
        connectionStatus: computed(() => active().connectionStatus.value),

        openWebsocket: async (...args) => {
            // Release the transport we are switching away from before opening the new one,
            // so a package switch cannot leave a live socket or an open bundle behind.
            await idle().disconnect()
            return await active().openWebsocket(...args)
        },
        send: (...args) => active().send(...args),
        sendMontageMessage: (...args) => active().sendMontageMessage(...args),
        sendFilterMessage: (...args) => active().sendFilterMessage(...args),
        sendDumpBufferRequest: (...args) => active().sendDumpBufferRequest(...args),
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
