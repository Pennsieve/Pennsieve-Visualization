// @/composables/streaming/translate.ts

import { specSignature } from './filters'
import type { ChannelInfo, FilterSpec, MontagePair } from '@pennsieve/timeseries-zarr-reader'
import type { CatalogIndex } from './channelDetails'

/** Separator the viewer puts between a montage pair's two channel NAMES. */
const MONTAGE_SEPARATOR = '<->'

export interface TraceIdentity {
    /** Server channel id exactly as the request carried it. */
    chId: string
    /** Channel label exactly as the request carried it. */
    label: string
    /** The viewer's client-side unique id for the trace. */
    clientId: string
    /** Physical unit from the catalog; '' when unknown. */
    unit: string
}

export interface QueryGroup {
    /** Grouping key; equal keys mean one reader query can serve both traces. */
    key: string
    /** FilterSpec for every trace in the group, or null. */
    filterSpec: FilterSpec | null
    isMontage: boolean
    /** Bundle channel ids; present only when isMontage is false. */
    channels?: string[]
    /** Present only when isMontage is true. */
    montage?: MontagePair[]
    /** Parallel to channels/montage, index for index. */
    traces: TraceIdentity[]
}

/**
 * Reads the filter that applies to one trace.
 *
 * The registry is keyed by CLIENT id, not by server id: the viewer's filter messages carry
 * `selChannels` taken from `viewerChannels[].id`, which is `createVirtualChannel`'s
 * `uniqueId`. Looking a montaged trace up by its server id would silently return the
 * unfiltered spec of its lead channel.
 */
function lookupFilter(filterRegistry: Map<string, FilterSpec> | undefined, key: string): FilterSpec | null {
    if (!filterRegistry || typeof filterRegistry.get !== 'function') {
        return null
    }
    const spec = filterRegistry.get(key)
    return spec === undefined ? null : spec
}

/**
 * Key under which a trace's active filter is stored.
 *
 * Deliberately NOT the reconstructed client id. That id has to be inferred from the label,
 * while the viewer mints it from its own montage state, so the two can disagree -- and when
 * they do, the filter lookup misses silently and the trace renders unfiltered while the user
 * believes a filter is applied. Server id plus label is the one pairing both sides hold
 * directly; it is also exactly what `dataCallback` matches a response on.
 */
export function filterKey(serverId: unknown, label: unknown): string {
    return `${serverId}|${label}`
}

function identityFor(vc: WireVirtualChannel, clientId: string, unit: string): TraceIdentity {
    return {
        chId: vc.id,
        label: vc.name,
        clientId: clientId,
        unit: unit
    }
}

export interface WireVirtualChannel {
    id: string
    name: string
}

interface WireRequest {
    session: unknown
    packageId: unknown
    startTime: number
    endTime: number
    pixelWidth: number
    minMax?: unknown
    virtualChannels?: WireVirtualChannel[]
}

export interface ParsedRequest {
    session: unknown
    packageId: unknown
    startTime: number
    endTime: number
    pixelWidth: number
    raw: boolean
    virtualChannels: WireVirtualChannel[]
}

/**
 * Normalizes one page request from the fake socket into the fields the reader needs.
 *
 * The wire shape is built by `useDataRequests.js` and stringified before `ws.send`, so both
 * a JSON string and an already-parsed object are accepted; the dispatcher may have parsed it
 * once already to route on its shape.
 *
 * `raw` is the INVERSE of the wire's `minMax`: the viewer asks for min/max decimation, the
 * reader takes a flag that forces undecimated samples. An absent `minMax` therefore means
 * `raw: true`, which matches the field's boolean reading, though `useDataRequests` always
 * sends it as literal `true`.
 *
 * `pixelWidth` is microseconds per pixel column and maps straight onto `pixelWidthUs`.
 *
 * @param json Raw JSON string or the parsed request object.
 * @throws {Error} When the input is not parseable JSON or is not a JSON object.
 */
export function parseRequest(json: unknown): ParsedRequest {
    let msg = json as WireRequest

    if (typeof json === 'string') {
        try {
            msg = JSON.parse(json)
        } catch (error) {
            throw new Error(`Unparseable data request: ${(error as SyntaxError).message}`)
        }
    }

    if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
        throw new Error('Data request must be a JSON object with a virtualChannels array')
    }

    return {
        session: msg.session,
        packageId: msg.packageId,
        startTime: msg.startTime,
        endTime: msg.endTime,
        pixelWidth: msg.pixelWidth,
        raw: !msg.minMax,
        virtualChannels: Array.isArray(msg.virtualChannels) ? msg.virtualChannels : []
    }
}

/**
 * Rebuilds the client-side unique id the viewer minted for a requested trace.
 *
 * `createVirtualChannel` produces `${id}_${name}` while a montage is active and the bare
 * server id otherwise, so montage is detected from the NAME containing '<->' and never by
 * inspecting the composite. The composite is not parseable in the other direction: Pennsieve
 * ids look like `N:channel:<uuid>` and can contain both underscores and colons, so an
 * `id_name` string has no unambiguous split point.
 *
 * The client id is what the filter registry and the viewer's channel list are keyed by; the
 * SERVER id is what the reader queries and what a response must echo.
 *
 * @param vc One entry of the request's `virtualChannels`.
 * @returns '' when the entry carries no usable id.
 */
export function reconstructClientId(
    vc: Partial<WireVirtualChannel> | null | undefined,
    catalogIndex?: Pick<CatalogIndex, 'byId'>
): string {
    const id = vc && vc.id !== undefined && vc.id !== null ? String(vc.id) : ''
    const name = vc && typeof vc.name === 'string' ? vc.name : ''
    return isMontageLabel(vc, catalogIndex) ? `${id}_${name}` : id
}

/**
 * Whether a requested trace is montaged.
 *
 * The separator alone is not sufficient: a bundle may legitimately name a plain channel
 * `EEG<->REF`, and `toChannelDetails` passes names through verbatim, so such a channel would
 * be mistaken for a montage, fail to resolve a secondary, and never render. A montage label is
 * a COMPOSITE the viewer built, so it never equals the lead's own catalog name -- comparing
 * against the catalog distinguishes the two cases exactly.
 *
 * Without a catalog (callers that only need the id shape) it falls back to the separator test.
 */
export function isMontageLabel(
    vc: Partial<WireVirtualChannel> | null | undefined,
    catalogIndex?: Pick<CatalogIndex, 'byId'>
): boolean {
    const name = vc && typeof vc.name === 'string' ? vc.name : ''
    if (!name.includes(MONTAGE_SEPARATOR)) {
        return false
    }
    const info = catalogIndex?.byId?.get(vc?.id as string)
    return info ? info.name !== name : true
}

export interface ResolvedMontagePair {
    ok: true
    pair: MontagePair
    leadInfo: ChannelInfo
    secondaryInfo: ChannelInfo
}

export interface RejectedMontagePair {
    ok: false
    reason: string
}

/**
 * Resolves a montaged virtual channel into the reader's `{lead, secondary}` id pair.
 *
 * The lead is addressed by the request's `id` (the montage details the shim synthesized put
 * the lead's server id there) while the secondary exists only as a NAME inside the label, so
 * it is resolved through the catalog's `byName` index.
 *
 * The split is exact-two: `createVirtualChannel` uses `split('<->', 2)` and would silently
 * accept `A<->B<->C`, but the reader's montage key is built from one pair, so a label with
 * more than one separator is rejected here rather than being truncated into a wrong pair.
 *
 * Every failure the reader raises for a montage pair is pre-checked here EXCEPT sample-grid
 * alignment (equal rates but offset sample phases), which cannot be seen in ChannelInfo. That
 * one remains a residual failure and surfaces later as a rejected query, handled by the
 * caller's per-group error path.
 */
export function resolveMontagePair(
    vc: WireVirtualChannel,
    catalogIndex: Pick<CatalogIndex, 'byId' | 'byName'>
): ResolvedMontagePair | RejectedMontagePair {
    const name = vc && typeof vc.name === 'string' ? vc.name : ''
    const parts = name.split(MONTAGE_SEPARATOR)

    if (parts.length !== 2) {
        return { ok: false, reason: `Montage label "${name}" is not exactly "lead<->secondary"` }
    }

    const leadName = parts[0]
    const secondaryName = parts[1]
    const leadInfo = catalogIndex.byId.get(vc.id)

    if (!leadInfo) {
        return { ok: false, reason: `Unknown montage lead channel id "${vc.id}"` }
    }

    const secondaryInfo = catalogIndex.byName.get(secondaryName)

    if (!secondaryInfo) {
        return { ok: false, reason: `Unknown montage secondary channel name "${secondaryName}"` }
    }

    if (leadInfo.kind === 'unit' || secondaryInfo.kind === 'unit') {
        const units = [
            leadInfo.kind === 'unit' ? leadName : null,
            secondaryInfo.kind === 'unit' ? secondaryName : null
        ].filter(Boolean)
        return { ok: false, reason: `Cannot montage unit channel(s): ${units.join(', ')}` }
    }

    if (leadInfo.rateHz !== secondaryInfo.rateHz) {
        return {
            ok: false,
            reason: `Sample rates differ: ${leadName} at ${leadInfo.rateHz} Hz, ` +
                `${secondaryName} at ${secondaryInfo.rateHz} Hz`
        }
    }

    return {
        ok: true,
        pair: { lead: leadInfo.id, secondary: secondaryInfo.id },
        leadInfo: leadInfo,
        secondaryInfo: secondaryInfo
    }
}

/**
 * Splits one page request into the smallest set of reader queries that can serve it.
 *
 * `query()` accepts exactly ONE filter and exactly one of `channels` / `montage`, so traces
 * are grouped by `(filter signature, isMontage)` and each group carries only one of the two
 * arrays. That array is parallel to the group's `traces`: the reader yields one segment per
 * requested trace in request order, so the caller zips yields to identities by position.
 *
 * A group's identities echo the REQUEST's `id` and `name`, never the reader's compound
 * montage key `${leadId}_${leadName}<->${secondaryName}`: the viewer matches a response
 * against its pending channels on serverId plus label, and a compound key matches nothing.
 * A montaged trace takes its unit from the lead channel.
 *
 * Unit channels go to `unitTraces` for a separate `queryUnits` call. Anything the catalog
 * does not know, and any montage pair that cannot be resolved, goes to `invalid`; the caller
 * must still emit one gap per invalid trace or the page's response counter never drains.
 *
 * Group order is first-appearance order over the request's channels, so the same request
 * always produces the same groups in the same sequence.
 *
 * @param req Parsed request.
 * @param filterRegistry Active FilterSpec per client channel id.
 */
export function partitionRequest(
    req: Pick<ParsedRequest, 'virtualChannels'>,
    catalogIndex: Pick<CatalogIndex, 'byId' | 'byName'>,
    filterRegistry?: Map<string, FilterSpec>
): { groups: QueryGroup[]; unitTraces: TraceIdentity[]; invalid: Array<{ identity: TraceIdentity; reason: string }> } {
    const groups: QueryGroup[] = []
    const byKey = new Map<string, QueryGroup>()
    const unitTraces: TraceIdentity[] = []
    const invalid: Array<{ identity: TraceIdentity; reason: string }> = []
    const virtualChannels = req && Array.isArray(req.virtualChannels) ? req.virtualChannels : []

    const addToGroup = (
        isMontage: boolean,
        member: string | MontagePair,
        identity: TraceIdentity,
        filterSpec: FilterSpec | null
    ) => {
        const key = `${specSignature(filterSpec)}|${isMontage ? 'montage' : 'channels'}`
        let group = byKey.get(key)

        if (!group) {
            group = isMontage
                ? { key: key, filterSpec: filterSpec, isMontage: true, montage: [], traces: [] }
                : { key: key, filterSpec: filterSpec, isMontage: false, channels: [], traces: [] }
            byKey.set(key, group)
            groups.push(group)
        }

        if (isMontage) {
            group.montage!.push(member as MontagePair)
        } else {
            group.channels!.push(member as string)
        }
        group.traces.push(identity)
    }

    for (const vc of virtualChannels) {
        if (vc === null || typeof vc !== 'object' || Array.isArray(vc)) {
            invalid.push({
                identity: { chId: undefined, label: undefined, clientId: '', unit: '' } as unknown as TraceIdentity,
                reason: 'Virtual channel entry is not an object'
            })
            continue
        }

        const clientId = reconstructClientId(vc, catalogIndex)

        if (clientId === '') {
            invalid.push({
                identity: identityFor(vc, clientId, ''),
                reason: 'Virtual channel entry has no channel id'
            })
            continue
        }

        const filterSpec = lookupFilter(filterRegistry, filterKey(vc.id, vc.name))

        if (isMontageLabel(vc, catalogIndex)) {
            const resolved = resolveMontagePair(vc, catalogIndex)
            if (!resolved.ok) {
                invalid.push({ identity: identityFor(vc, clientId, ''), reason: resolved.reason })
                continue
            }
            addToGroup(true, resolved.pair, identityFor(vc, clientId, resolved.leadInfo.unit), filterSpec)
            continue
        }

        const info = catalogIndex.byId.get(vc.id)

        if (!info) {
            invalid.push({
                identity: identityFor(vc, clientId, ''),
                reason: `Unknown channel id "${vc.id}"`
            })
            continue
        }

        if (info.kind === 'unit') {
            unitTraces.push(identityFor(vc, clientId, info.unit))
            continue
        }

        addToGroup(false, info.id, identityFor(vc, clientId, info.unit), filterSpec)
    }

    return { groups: groups, unitTraces: unitTraces, invalid: invalid }
}
