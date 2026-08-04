// @/composables/streaming/channelDetails.js

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
 * plots nothing for anything else. (Do not trust `validateChannelConfig`, which
 * also allows 'Neural' -- it has no call sites and the renderer rejects it.)
 *
 * Invariant inherited from the reader: a unit channel reports `endUs === startUs`,
 * so its `end === start` here. A bundle containing only unit channels therefore
 * yields a degenerate viewport (ts_start === ts_end) in `initTimeRange`.
 *
 * @param {Array<{id: string, name: string, unit: string, rateHz: number, startUs: number, endUs: number, kind: 'continuous'|'unit'}>} infos
 * @returns {Array<{id: string, name: string, channelType: 'CONTINUOUS'|'UNIT', rate: number, unit: string, start: number, end: number, properties: Array}>}
 */
export function toChannelDetails(infos) {
    return infos.map((info) => ({
        id: info.id,
        name: info.name,
        channelType: info.kind === 'unit' ? 'UNIT' : 'CONTINUOUS',
        rate: info.rateHz,
        unit: info.unit,
        start: info.startUs,
        end: info.endUs,
        properties: []
    }))
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
 * @param {Array<Object>} infos ChannelInfo[] from `client.channelInfo()`
 * @returns {{byId: Map<string, Object>, byName: Map<string, Object>, details: Array<Object>}}
 */
export function buildCatalogIndex(infos) {
    const byId = new Map()
    const byName = new Map()
    const warned = new Set()

    for (const info of infos) {
        byId.set(info.id, info)

        if (byName.has(info.name)) {
            if (!warned.has(info.name)) {
                warned.add(info.name)
                console.warn(
                    `Duplicate channel name "${info.name}" in bundle catalog; ` +
                    `keeping channel ${byName.get(info.name).id} and ignoring ${info.id} for name lookups`
                )
            }
            continue
        }

        byName.set(info.name, info)
    }

    return { byId, byName, details: toChannelDetails(infos) }
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
 * the catalog, either channel is a unit channel, or the two native rates differ:
 * the reader throws on all three rather than returning a segment.
 *
 * @param {Array<[string, string]>} montageMap name pairs from the montage payload
 * @param {{byName: Map<string, Object>}} catalogIndex
 * @returns {{details: Array<{id: string, name: string}>, dropped: Array<{pair: Array, reason: 'malformed-pair'|'unknown-channel'|'unit-channel'|'rate-mismatch', message: string}>}}
 */
export function synthesizeMontageDetails(montageMap, catalogIndex) {
    const details = []
    const dropped = []

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

        if (lead.kind === 'unit' || secondary.kind === 'unit') {
            dropped.push({
                pair,
                reason: 'unit-channel',
                message: `Cannot montage unit channel(s): ${[
                    lead.kind === 'unit' ? leadName : null,
                    secondary.kind === 'unit' ? secondaryName : null
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
