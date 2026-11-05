// composables/useBundleAnnotations.ts
//
// Annotation layers read from the Zarr bundle's event channels, shaped like the ones the
// Pennsieve API returns so the existing rendering, navigation and hover code draws them
// unchanged.
//
// Bundle layers are read-only. They have no row in the API, so their ids are prefixed
// with BUNDLE_LAYER_PREFIX and every path that writes to the API skips them.
//
// Annotations arrive a window at a time, like the API's. Each window carries every
// column the channel stores, text included; a TS-Zarr 1.0 text column is one array
// read beside the times.
import type { EventChannelInfo, EventWindow } from '@pennsieve/timeseries-zarr-reader'
import { getClient } from './streaming/clientRegistry'
import { isAnnotationChannel } from './streaming/channelDetails'
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
 * The text to show for an event.
 *
 * An extractor that writes JSON bodies puts the note under `description`; that is shown
 * on its own. Anything else, including JSON without one, shows as stored.
 */
export function textToDescription(text: string | undefined): string | undefined {
    if (text === undefined || !text.startsWith('{')) {
        return text
    }
    try {
        const parsed: unknown = JSON.parse(text)
        const description = (parsed as { description?: unknown } | null)?.description
        if (typeof description === 'string') {
            return description
        }
    } catch {
        // Not JSON after all; fall through and show it raw.
    }
    return text
}

/**
 * Converts one window of a bundle event channel into the viewer's annotation shape.
 *
 * An annotation's id is its layer and onset time, so the same event read in two
 * overlapping windows dedupes; events sharing an onset are numbered. An event with no
 * channel scope applies to the whole recording, as does one naming every channel on
 * screen.
 */
export function windowToAnnotations(
    window: EventWindow,
    channel: EventChannelInfo,
    layerId: string,
    channelCount: number
): Annotation[] {
    const annotations: Annotation[] = []
    let previousTime = Number.NaN
    let tie = 0
    for (let i = 0; i < window.times.length; i++) {
        const timeUs = window.times[i]
        tie = timeUs === previousTime ? tie + 1 : 0
        previousTime = timeUs
        const duration = window.durations?.[i] ?? 0
        const labelIndex = window.labels?.[i]
        const label = labelIndex === undefined ? undefined : channel.labelNames?.[labelIndex]
        const channels = window.channels?.[i] ?? []
        annotations.push({
            id: tie === 0 ? `${layerId}:${timeUs}` : `${layerId}:${timeUs}:${tie}`,
            name: '',
            label: label ?? channel.name,
            description: textToDescription(window.text?.[i]),
            start: timeUs,
            duration,
            end: timeUs + duration,
            cStart: null,
            cEnd: null,
            selected: false,
            channelIds: [...channels],
            allChannels: channels.length === 0 || channels.length >= channelCount,
            layer_id: layerId
        })
    }
    return annotations
}

/**
 * Lists the viewer's open bundle's annotation channels as empty, read-only layers.
 *
 * Reads only the catalog the client already holds. The annotations themselves arrive
 * through queryBundleLayer as the viewer moves. Spike channels are rows, not layers,
 * and are left out. Returns no layers when the viewer has no bundle open.
 *
 * @param storeId The viewer store's id, which is also its reader client's registry key.
 */
export async function loadBundleLayers(storeId: string): Promise<AnnotationLayer[]> {
    const entry = getClient(storeId)
    if (!entry) {
        return []
    }

    const channels = (await entry.client.channelInfo()).filter(isAnnotationChannel)
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
    /** Every annotation before this time is in the window. */
    endUs: number
}

/**
 * Reads a bundle layer's annotations in [startUs, endUs), including intervals that
 * opened before the window and are still running.
 *
 * The reader has no fetch limit, so `limit` is accepted for the API path's sake and
 * the whole window is read. Returns null when the viewer no longer has a bundle open
 * or the layer's channel is gone.
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
    const channel = (await entry.client.channelInfo())
        .find((c): c is EventChannelInfo => c.kind === 'event' && c.id === channelId)
    if (!channel) {
        return null
    }

    for await (const window of entry.client.queryEvents({
        channels: [channelId],
        startUs,
        endUs,
        columns: ['durations', 'labels', 'text', 'channels']
    })) {
        return {
            annotations: windowToAnnotations(window, channel, layerId, channelCount),
            endUs: window.endUs
        }
    }
    return null
}

/**
 * The description of one bundle annotation.
 *
 * Kept for the annotation dialog, which asks when a description is missing. A window
 * carries its text, so there is nothing further to read: an annotation without a
 * description comes from a channel that stores no text.
 */
export async function loadBundleDescription(storeId: string, annotation: Annotation): Promise<string | undefined> {
    if (!getClient(storeId) || !isBundleLayerId(annotation.layer_id)) {
        return undefined
    }
    return annotation.description
}
