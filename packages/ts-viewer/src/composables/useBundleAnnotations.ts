// composables/useBundleAnnotations.ts
//
// Annotation layers read from the Zarr bundle's event channels, shaped like the ones the
// Pennsieve API returns so the existing rendering, navigation and hover code draws them
// unchanged.
//
// Bundle layers are read-only. They have no row in the API, so their ids are prefixed
// with BUNDLE_LAYER_PREFIX and every path that writes to the API skips them.
import type { EventChannelInfo, EventRecord } from '@pennsieve/timeseries-zarr-reader'
import { getClient } from './streaming/clientRegistry'
import { hexToRgbA } from '@/utils/annotationUtils'
import type { Annotation, AnnotationLayer } from '@/utils/annotationUtils'

export const BUNDLE_LAYER_PREFIX = 'bundle:'

// Distinct from the API layers' first colors, so the two are told apart at a glance.
const BUNDLE_COLORS = ['#8A6ECF', '#389BAD', '#FF6C21', '#DCC180']

/** Whether a layer, or an annotation's layer id, came from the bundle. */
export function isBundleLayerId(id: number | string | undefined | null): boolean {
    return typeof id === 'string' && id.startsWith(BUNDLE_LAYER_PREFIX)
}

/**
 * The text to show for an event body.
 *
 * A JSON body shows its `description` field when it has one. Anything else, including
 * JSON that does not parse, shows as stored.
 */
export function bodyToDescription(body: string | undefined, mediaType: string): string | undefined {
    if (body === undefined || mediaType !== 'application/json') {
        return body
    }
    try {
        const parsed: unknown = JSON.parse(body)
        const description = (parsed as { description?: unknown } | null)?.description
        if (typeof description === 'string') {
            return description
        }
    } catch {
        // Not JSON after all; fall through and show it raw.
    }
    return body
}

/**
 * Converts one bundle event into the viewer's annotation shape.
 *
 * An event with no channel refs applies to the whole recording, as does one naming
 * every channel on screen.
 */
export function eventToAnnotation(
    event: EventRecord,
    channel: EventChannelInfo,
    layerId: string,
    channelCount: number
): Annotation {
    return {
        id: `${layerId}:${event.index}`,
        name: '',
        label: event.label ?? channel.name,
        description: bodyToDescription(event.body, channel.bodyMediaType),
        start: event.timeUs,
        duration: event.durationUs,
        end: event.timeUs + event.durationUs,
        cStart: null,
        cEnd: null,
        selected: false,
        channelIds: [...event.channels],
        allChannels: event.channels.length === 0 || event.channels.length >= channelCount,
        layer_id: layerId
    }
}

/**
 * Reads every event channel of the viewer's open bundle as a read-only annotation layer.
 *
 * Returns no layers when the viewer has no bundle open. Each channel is read whole, which
 * suits annotation channels of a few thousand marks; a detector channel of millions of
 * events would need the windowed fetch the API layers use.
 *
 * @param storeId The viewer store's id, which is also its reader client's registry key.
 */
export async function loadBundleLayers(storeId: string, channelCount: number): Promise<AnnotationLayer[]> {
    const entry = getClient(storeId)
    if (!entry) {
        return []
    }

    const channels = await entry.client.eventChannels()
    return Promise.all(channels.map(async (channel, i) => {
        const layerId = `${BUNDLE_LAYER_PREFIX}${channel.id}`
        const { events } = await entry.client.queryEvents({
            channel: channel.id,
            startUs: Number.MIN_SAFE_INTEGER,
            endUs: Number.MAX_SAFE_INTEGER,
            priority: 'background'
        })
        const hexColor = BUNDLE_COLORS[i % BUNDLE_COLORS.length]
        return {
            id: layerId,
            name: channel.name,
            description: `${channel.name} (from the recording bundle, read-only)`,
            visible: true,
            selected: false,
            annotations: events.map((event) => eventToAnnotation(event, channel, layerId, channelCount)),
            color: hexToRgbA(hexColor, 0.7),
            hexColor,
            bkColor: hexToRgbA(hexColor, 0.15),
            selColor: hexToRgbA(hexColor, 0.9)
        }
    }))
}
