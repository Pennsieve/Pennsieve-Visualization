// @/composables/streaming/channelDetails.ts

import type { ChannelInfo, EventChannelInfo } from '@pennsieve/timeseries-zarr-reader'

/** One flat channel object, as `toChannelDetails` emits it. */
export interface ChannelDetail {
    id: string
    name: string
    channelType: 'CONTINUOUS' | 'UNIT'
    rate: number
    unit: string
    start: number
    end: number
    properties: unknown[]
    /** Never present: `createVirtualChannel` builds the `{content}` envelope from the flat fields. */
    content?: undefined
}

/**
 * Whether an event channel is drawn as a spike raster row.
 *
 * A bundle's event channels cover both sorted spikes and annotations, and the format
 * tells them apart only by what they store: spikes carry waveforms, or a mean waveform
 * per unit. Those become UNIT rows. Every other event channel is an annotation layer.
 */
export function isUnitChannel(info: ChannelInfo): info is EventChannelInfo {
    return info.kind === 'event' && (info.columns.includes('waveforms') || info.hasWaveformMean)
}

/** Whether an event channel is shown as an annotation layer rather than a row. */
export function isAnnotationChannel(info: ChannelInfo): info is EventChannelInfo {
    return info.kind === 'event' && !isUnitChannel(info)
}

/**
 * Maps reader channel metadata onto the flat channel objects the viewer's
 * channel pipeline consumes.
 *
 * The result is a FLAT array, not a `{content: {...}}` envelope: the store puts
 * it straight on `activeViewer.channels`, `TSViewer.initTimeRange` reads
 * `channels[i].start` / `.end` off it, `processChannelData` destructures
 * `{id, name}` off it, and `createVirtualChannel` is what builds the `{content}`
 * envelope from the flat `channelType` / `unit` / `rate` / `start` / `end` /
 * `properties` fields.
 *
 * `channelType` must be the uppercase literals 'CONTINUOUS' / 'UNIT': they flow
 * through `useTimeSeriesData.initChannels` (`type: curC.channelType`) into
 * `useCanvasRenderer.getPointCoords`, which switches on exactly those strings and
 * plots nothing for anything else. 'Neural' names a segment block type elsewhere in
 * the viewer and is not a valid `channelType`.
 *
 * Continuous channels carry their own extent and rate. An event channel has neither
 * in the bundle, so a UNIT row takes the recording's: the span of every continuous
 * channel, and the finest continuous rate, which the renderer divides by. Annotation
 * channels are layers, not rows, and are left out; a bundle holding only event
 * channels therefore yields no rows and a degenerate viewport in `initTimeRange`.
 */
export function toChannelDetails(infos: readonly ChannelInfo[]): ChannelDetail[] {
    let start = Number.POSITIVE_INFINITY
    let end = Number.NEGATIVE_INFINITY
    let rate = 0
    for (const info of infos) {
        if (info.kind === 'continuous') {
            start = Math.min(start, info.startUs)
            end = Math.max(end, info.endUs)
            rate = Math.max(rate, info.rateHz)
        }
    }
    if (!(start <= end)) {
        start = 0
        end = 0
    }

    const details: ChannelDetail[] = []
    for (const info of infos) {
        if (info.kind === 'continuous') {
            details.push({
                id: info.id,
                name: info.name,
                channelType: 'CONTINUOUS',
                rate: info.rateHz,
                unit: info.unit,
                start: info.startUs,
                end: info.endUs,
                properties: []
            })
        } else if (isUnitChannel(info)) {
            details.push({
                id: info.id,
                name: info.name,
                channelType: 'UNIT',
                rate,
                unit: info.unit ?? '',
                start,
                end,
                properties: []
            })
        }
    }
    return details
}

export interface CatalogIndex {
    byId: Map<string, ChannelInfo>
    byName: Map<string, ChannelInfo>
    details: ChannelDetail[]
}

/**
 * Builds the lookup index the shim keeps for the life of a connection.
 *
 * `byName` exists because montage maps address channels by NAME while every
 * reader query addresses them by id. Names are not guaranteed unique in a
 * bundle; the FIRST channel with a given name wins and a warning is emitted
 * once per duplicated name, since a silently ambiguous name would resolve
 * montage pairs to an arbitrary channel.
 *
 * @param infos ChannelInfo[] from `client.channelInfo()`
 */
export function buildCatalogIndex(infos: readonly ChannelInfo[]): CatalogIndex {
    const byId = new Map<string, ChannelInfo>()
    const byName = new Map<string, ChannelInfo>()
    const warned = new Set<string>()

    for (const info of infos) {
        byId.set(info.id, info)

        if (byName.has(info.name)) {
            if (!warned.has(info.name)) {
                warned.add(info.name)
                console.warn(
                    `Duplicate channel name "${info.name}" in bundle catalog; ` +
                    `keeping channel ${byName.get(info.name)!.id} and ignoring ${info.id} for name lookups`
                )
            }
            continue
        }

        byName.set(info.name, info)
    }

    return { byId, byName, details: toChannelDetails(infos) }
}

export interface DroppedMontagePair {
    pair: unknown
    reason: 'malformed-pair' | 'unknown-channel' | 'unit-channel' | 'rate-mismatch'
    message: string
}

/**
 * Synthesizes the `channelDetails` reply the legacy server sent after a montage
 * switch, so `isSwitchingMontage` clears on the Zarr path too.
 *
 * `montageMap` is an array of `[leadName, secondaryName]` NAME pairs, exactly as
 * `createMontagePayload` builds it from `montage.channelPairs`.
 *
 * The emitted `id` is the LEAD's id and the emitted `name` is
 * `lead<->secondary`, so `createVirtualChannel`'s montage branch derives the
 * client id `${leadId}_${leadName}<->${secondaryName}` -- byte-identical to the
 * reader's own montaged `Segment.channel` key.
 *
 * A pair is dropped, with its reason recorded, when either name is unknown to
 * the catalog, either channel is an event channel, or the two native rates differ:
 * the reader throws on all three rather than returning a segment.
 *
 * @param montageMap name pairs from the montage payload
 */
export function synthesizeMontageDetails(
    montageMap: readonly unknown[] | null | undefined,
    catalogIndex: Pick<CatalogIndex, 'byName'>
): { details: Array<{ id: string; name: string }>; dropped: DroppedMontagePair[] } {
    const details: Array<{ id: string; name: string }> = []
    const dropped: DroppedMontagePair[] = []

    if (!Array.isArray(montageMap)) {
        return { details, dropped }
    }

    for (const pair of montageMap) {
        if (!Array.isArray(pair) || pair.length < 2) {
            dropped.push({
                pair,
                reason: 'malformed-pair',
                message: 'Montage entry is not a [lead, secondary] name pair'
            })
            continue
        }

        const [leadName, secondaryName] = pair
        const lead = catalogIndex.byName.get(leadName)
        const secondary = catalogIndex.byName.get(secondaryName)

        if (!lead || !secondary) {
            const missing = [!lead ? leadName : null, !secondary ? secondaryName : null].filter(Boolean)
            dropped.push({
                pair,
                reason: 'unknown-channel',
                message: `Unknown channel name(s): ${missing.join(', ')}`
            })
            continue
        }

        if (lead.kind !== 'continuous' || secondary.kind !== 'continuous') {
            dropped.push({
                pair,
                reason: 'unit-channel',
                message: `Cannot montage event channel(s): ${[
                    lead.kind !== 'continuous' ? leadName : null,
                    secondary.kind !== 'continuous' ? secondaryName : null
                ].filter(Boolean).join(', ')}`
            })
            continue
        }

        if (lead.rateHz !== secondary.rateHz) {
            dropped.push({
                pair,
                reason: 'rate-mismatch',
                message: `Sample rates differ: ${leadName} at ${lead.rateHz} Hz, ${secondaryName} at ${secondary.rateHz} Hz`
            })
            continue
        }

        details.push({ id: lead.id, name: `${leadName}<->${secondaryName}` })
    }

    return { details, dropped }
}
