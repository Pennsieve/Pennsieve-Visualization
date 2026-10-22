// composables/useBundleAnnotations.ts
//
// Annotation layers read from the Zarr bundle's event channels, shaped like the ones the
// Pennsieve API returns so the existing rendering, navigation and hover code draws them
// unchanged.
//
// Bundle layers are read-only. They have no row in the API, so their ids are prefixed
// with BUNDLE_LAYER_PREFIX and every path that writes to the API skips them.
//
// Annotations arrive a window at a time, like the API's, and without bodies: drawing a
// mark needs none, and bodies are most of a channel's bytes. A body is read when an
// annotation is opened.
import type { EventChannelInfo, EventRecord } from '@pennsieve/timeseries-zarr-reader'
import { getClient } from './streaming/clientRegistry'
import { hexToRgbA } from '@/utils/annotationUtils'
import type { Annotation, AnnotationLayer } from '@/utils/annotationUtils'

export const BUNDLE_LAYER_PREFIX = 'bundle:'

// Distinct from the API layers' first colors, so the two are told apart at a glance.
const BUNDLE_COLORS = ['#8A6ECF', '#389BAD', '#FF6C21', '#DCC180']

/** Whether a layer, or an annotation's layer id, came from the bundle. */
export function isBundleLayerId(id: number | string | undefined | null): id is string {
    return typeof id === 'string' && id.startsWith(BUNDLE_LAYER_PREFIX)
}

/** The bundle event channel a bundle layer was read from. */
function eventChannelId(layerId: string): string {
    return layerId.slice(BUNDLE_LAYER_PREFIX.length)
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
 * Lists the viewer's open bundle's event channels as empty, read-only annotation layers.
 *
 * Reads only the catalog the client already holds. The annotations themselves arrive
 * through queryBundleLayer as the viewer moves. Returns no layers when the viewer has no
 * bundle open.
 *
 * @param storeId The viewer store's id, which is also its reader client's registry key.
 */
export async function loadBundleLayers(storeId: string): Promise<AnnotationLayer[]> {
    const entry = getClient(storeId)
    if (!entry) {
        return []
    }

    const channels = await entry.client.eventChannels()
    return channels.map((channel, i) => {
        const hexColor = BUNDLE_COLORS[i % BUNDLE_COLORS.length]
        return {
            id: `${BUNDLE_LAYER_PREFIX}${channel.id}`,
            name: channel.name,
            description: `${channel.name} (from the recording bundle, read-only)`,
            visible: true,
            selected: false,
            annotations: [],
            color: hexToRgbA(hexColor, 0.7),
            hexColor,
            bkColor: hexToRgbA(hexColor, 0.15),
            selColor: hexToRgbA(hexColor, 0.9)
        }
    })
}

/** One window of a bundle layer's annotations. */
export interface BundleLayerWindow {
    annotations: Annotation[]
    /** Every annotation before this time is in the window; a limit can stop it short. */
    endUs: number
}

/**
 * Reads up to `limit` of a bundle layer's annotations in [startUs, endUs), without bodies.
 *
 * Returns null when the viewer no longer has a bundle open.
 */
export async function queryBundleLayer(
    storeId: string,
    layerId: string,
    startUs: number,
    endUs: number,
    limit: number,
    channelCount: number
): Promise<BundleLayerWindow | null> {
    const entry = getClient(storeId)
    if (!entry) {
        return null
    }

    const channelId = eventChannelId(layerId)
    const [channels, window] = await Promise.all([
        entry.client.eventChannels(),
        entry.client.queryEvents({ channel: channelId, startUs, endUs, limit, bodies: false })
    ])
    const channel = channels.find((c) => c.id === channelId)
    if (!channel) {
        return null
    }
    return {
        annotations: window.events.map((event) => eventToAnnotation(event, channel, layerId, channelCount)),
        endUs: window.endUs
    }
}

/**
 * Reads the description of one bundle annotation, which windows arrive without.
 *
 * Undefined when the annotation's channel stores no bodies or the bundle is gone.
 */
export async function loadBundleDescription(storeId: string, annotation: Annotation): Promise<string | undefined> {
    const entry = getClient(storeId)
    const layerId = annotation.layer_id
    if (!entry || !isBundleLayerId(layerId)) {
        return undefined
    }

    // eventToAnnotation builds the id as `${layerId}:${index}`.
    const index = Number(String(annotation.id).slice(layerId.length + 1))
    const channelId = eventChannelId(layerId)
    const [channels, body] = await Promise.all([
        entry.client.eventChannels(),
        entry.client.eventBody({ channel: channelId, index })
    ])
    const mediaType = channels.find((c) => c.id === channelId)?.bodyMediaType ?? 'text/plain'
    return bodyToDescription(body, mediaType)
}
