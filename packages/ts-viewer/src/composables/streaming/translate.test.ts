import { describe, it, expect } from 'vitest'
import type { ChannelInfo, FilterSpec } from '@pennsieve/timeseries-zarr-reader'
import { buildCatalogIndex } from './channelDetails'
import { parseRequest, reconstructClientId, resolveMontagePair, partitionRequest, filterKey } from './translate'
import type { QueryGroup, RejectedMontagePair, ResolvedMontagePair } from './translate'

const START_US = 1704067200000000

// Pennsieve node ids carry both colons and underscores, which is what makes the
// viewer's `${id}_${name}` client id unsplittable.
const chan = (id: string, name: string, over: Partial<ChannelInfo> = {}): ChannelInfo => ({
    id,
    name,
    unit: 'uV',
    rateHz: 1000,
    startUs: START_US,
    endUs: START_US + 30000000,
    kind: 'continuous',
    ...over
})

const C3 = 'N:channel:6b7a_1f-42'
const C4 = 'N:channel:8c2d_9e-01'
const CZ = 'N:channel:aa11_bb-22'
const PZ = 'N:channel:cc33_dd-44'
const SPIKES = 'N:channel:ee55_ff-66'

const catalog = buildCatalogIndex([
    chan(C3, 'C3'),
    chan(C4, 'C4', { unit: 'mV' }),
    chan(CZ, 'Cz'),
    chan(PZ, 'Pz', { rateHz: 500 }),
    chan(SPIKES, 'SpikesA', { kind: 'unit', endUs: START_US })
])

// Shape built by useDataRequests.js before JSON.stringify.
const wireRequest = (virtualChannels: unknown[], over: Record<string, unknown> = {}) => ({
    session: 'a.jwt.token',
    minMax: true,
    startTime: START_US,
    endTime: START_US + 5000000,
    packageId: 'N:package:1234_ab',
    pixelWidth: 5000,
    virtualChannels,
    ...over
})

const LOWPASS: FilterSpec = { type: 'lowpass', order: 4, cutoffHz: 60 }
// Same filter, keys written in a different order: must land in the same group.
const LOWPASS_REORDERED: FilterSpec = { cutoffHz: 60, order: 4, type: 'lowpass' }
const HIGHPASS: FilterSpec = { type: 'highpass', order: 4, cutoffHz: 0.5 }

/** Asserts the invariant every emitted group must satisfy for query() to accept it. */
const expectGroupShape = (group: QueryGroup) => {
    const hasChannels = Object.prototype.hasOwnProperty.call(group, 'channels')
    const hasMontage = Object.prototype.hasOwnProperty.call(group, 'montage')
    expect(hasChannels).toBe(!hasMontage)
    expect(hasChannels).toBe(!group.isMontage)
    const members = (hasChannels ? group.channels : group.montage)!
    expect(members.length).toBe(group.traces.length)
    expect(members.length).toBeGreaterThan(0)
}

describe('parseRequest', () => {
    it('parses the JSON string the viewer puts on the wire', () => {
        const req = parseRequest(JSON.stringify(wireRequest([{ id: C3, name: 'C3' }])))
        expect(req).toEqual({
            session: 'a.jwt.token',
            packageId: 'N:package:1234_ab',
            startTime: START_US,
            endTime: START_US + 5000000,
            pixelWidth: 5000,
            raw: false,
            virtualChannels: [{ id: C3, name: 'C3' }]
        })
    })

    it('accepts an already-parsed object', () => {
        const obj = wireRequest([{ id: C3, name: 'C3' }])
        expect(parseRequest(obj)).toEqual(parseRequest(JSON.stringify(obj)))
    })

    it('inverts minMax into raw', () => {
        expect(parseRequest(wireRequest([], { minMax: true })).raw).toBe(false)
        expect(parseRequest(wireRequest([], { minMax: false })).raw).toBe(true)
    })

    it('treats an absent minMax as a raw request', () => {
        const bare = { startTime: 1, endTime: 2, pixelWidth: 3, virtualChannels: [] }
        expect(parseRequest(bare).raw).toBe(true)
    })

    it('defaults virtualChannels to an empty array', () => {
        expect(parseRequest({ startTime: 1, endTime: 2 }).virtualChannels).toEqual([])
        expect(parseRequest({ virtualChannels: 'nope' }).virtualChannels).toEqual([])
    })

    it('throws on unparseable JSON', () => {
        expect(() => parseRequest('{not json')).toThrow(/Unparseable data request/)
    })

    it('throws on JSON that is not an object', () => {
        expect(() => parseRequest('null')).toThrow(/must be a JSON object/)
        expect(() => parseRequest('[1,2]')).toThrow(/must be a JSON object/)
        expect(() => parseRequest('"C3"')).toThrow(/must be a JSON object/)
        expect(() => parseRequest(undefined)).toThrow(/must be a JSON object/)
    })
})

describe('reconstructClientId', () => {
    // Verbatim from useChannelProcessing.js createVirtualChannel, the only place the
    // viewer mints a client-side id.
    const viewerClientId = (id: string, name: string, isViewingMontage: boolean) => (isViewingMontage ? `${id}_${name}` : id)

    it('returns the bare server id for a plain channel', () => {
        expect(reconstructClientId({ id: C3, name: 'C3' })).toBe(C3)
    })

    it('leaves underscores and colons in the id untouched', () => {
        for (const id of [C3, C4, 'N:channel:a_b_c', 'plain_id', 'N:channel:x']) {
            expect(reconstructClientId({ id, name: 'Label' })).toBe(viewerClientId(id, 'Label', false))
        }
    })

    it('rebuilds the montaged composite exactly as the viewer built it', () => {
        for (const id of [C3, 'N:channel:a_b_c', 'plain_id']) {
            const name = 'C3<->C4'
            expect(reconstructClientId({ id, name })).toBe(viewerClientId(id, name, true))
        }
    })

    it('detects montage from the name, never by splitting the composite', () => {
        // An id ending in something that looks like a label must still be treated as plain.
        expect(reconstructClientId({ id: 'N:channel:9f_C3', name: 'Cz' })).toBe('N:channel:9f_C3')
        expect(reconstructClientId({ id: 'N:channel:9f_C3', name: 'Cz<->Pz' }))
            .toBe('N:channel:9f_C3_Cz<->Pz')
    })

    it('returns an empty string when there is no usable id', () => {
        expect(reconstructClientId({ name: 'C3' })).toBe('')
        expect(reconstructClientId(null)).toBe('')
        expect(reconstructClientId(undefined)).toBe('')
    })
})

describe('resolveMontagePair', () => {
    it('resolves lead by id and secondary by name', () => {
        const out = resolveMontagePair({ id: C3, name: 'C3<->Cz' }, catalog) as ResolvedMontagePair
        expect(out.ok).toBe(true)
        expect(out.pair).toEqual({ lead: C3, secondary: CZ })
        expect(out.leadInfo.name).toBe('C3')
        expect(out.secondaryInfo.name).toBe('Cz')
    })

    it('ignores the lead NAME in the label and trusts the request id', () => {
        // The label's lead segment is display text; the id is authoritative.
        const out = resolveMontagePair({ id: C4, name: 'C3<->Cz' }, catalog) as ResolvedMontagePair
        expect(out.ok).toBe(true)
        expect(out.pair).toEqual({ lead: C4, secondary: CZ })
    })

    it('rejects a label with no separator', () => {
        const out = resolveMontagePair({ id: C3, name: 'C3' }, catalog)
        expect(out).toEqual({ ok: false, reason: 'Montage label "C3" is not exactly "lead<->secondary"' })
    })

    it('rejects a label with more than one separator', () => {
        const out = resolveMontagePair({ id: C3, name: 'C3<->Cz<->Pz' }, catalog) as RejectedMontagePair
        expect(out.ok).toBe(false)
        expect(out.reason).toMatch(/is not exactly/)
    })

    it('rejects an unknown lead id', () => {
        const out = resolveMontagePair({ id: 'N:channel:nope_1', name: 'C3<->Cz' }, catalog)
        expect(out).toEqual({ ok: false, reason: 'Unknown montage lead channel id "N:channel:nope_1"' })
    })

    it('rejects an unknown secondary name', () => {
        const out = resolveMontagePair({ id: C3, name: 'C3<->Nope' }, catalog)
        expect(out).toEqual({ ok: false, reason: 'Unknown montage secondary channel name "Nope"' })
    })

    it('rejects a unit channel on either side', () => {
        const asLead = resolveMontagePair({ id: SPIKES, name: 'SpikesA<->C3' }, catalog)
        expect(asLead).toEqual({ ok: false, reason: 'Cannot montage unit channel(s): SpikesA' })

        const asSecondary = resolveMontagePair({ id: C3, name: 'C3<->SpikesA' }, catalog)
        expect(asSecondary).toEqual({ ok: false, reason: 'Cannot montage unit channel(s): SpikesA' })
    })

    it('rejects a rate mismatch', () => {
        const out = resolveMontagePair({ id: C3, name: 'C3<->Pz' }, catalog)
        expect(out).toEqual({
            ok: false,
            reason: 'Sample rates differ: C3 at 1000 Hz, Pz at 500 Hz'
        })
    })
})

describe('partitionRequest', () => {
    it('classifies a mix of plain, montaged, unit and unknown channels', () => {
        const req = parseRequest(wireRequest([
            { id: C3, name: 'C3' },
            { id: C4, name: 'C4<->Cz' },
            { id: SPIKES, name: 'SpikesA' },
            { id: 'N:channel:ghost_9', name: 'Ghost' },
            { id: C3, name: 'C3<->Pz' }
        ]))
        const out = partitionRequest(req, catalog, new Map())

        expect(out.groups).toHaveLength(2)
        out.groups.forEach(expectGroupShape)

        const plain = out.groups.find((g) => !g.isMontage)!
        expect(plain.channels).toEqual([C3])
        expect(plain.traces).toEqual([{ chId: C3, label: 'C3', clientId: C3, unit: 'uV' }])

        const montaged = out.groups.find((g) => g.isMontage)!
        expect(montaged.montage).toEqual([{ lead: C4, secondary: CZ }])
        expect(montaged.traces).toEqual([
            { chId: C4, label: 'C4<->Cz', clientId: `${C4}_C4<->Cz`, unit: 'mV' }
        ])

        expect(out.unitTraces).toEqual([
            { chId: SPIKES, label: 'SpikesA', clientId: SPIKES, unit: 'uV' }
        ])

        expect(out.invalid).toHaveLength(2)
        expect(out.invalid[0].identity.chId).toBe('N:channel:ghost_9')
        expect(out.invalid[0].reason).toBe('Unknown channel id "N:channel:ghost_9"')
        expect(out.invalid[1].identity.label).toBe('C3<->Pz')
        expect(out.invalid[1].reason).toMatch(/Sample rates differ/)
    })

    it('takes a montaged trace unit from the lead, not the secondary', () => {
        const req = parseRequest(wireRequest([
            { id: C3, name: 'C3<->C4' },
            { id: C4, name: 'C4<->C3' }
        ]))
        const out = partitionRequest(req, catalog, new Map())
        expect(out.groups).toHaveLength(1)
        expect(out.groups[0].traces.map((t) => t.unit)).toEqual(['uV', 'mV'])
    })

    it('echoes the request id and label, never the reader compound montage key', () => {
        const req = parseRequest(wireRequest([{ id: C3, name: 'C3<->Cz' }]))
        const trace = partitionRequest(req, catalog, new Map()).groups[0].traces[0]
        expect(trace.chId).toBe(C3)
        expect(trace.label).toBe('C3<->Cz')
        expect(trace.label).not.toContain(C3)
        expect(trace.clientId).toBe(`${C3}_C3<->Cz`)
    })

    it('groups by filter spec, keyed by server id and label', () => {
        const filters = new Map<string, FilterSpec>([
            [filterKey(C3, 'C3'), LOWPASS],
            [filterKey(CZ, 'Cz'), LOWPASS_REORDERED],
            [filterKey(C4, 'C4'), HIGHPASS]
        ])
        const req = parseRequest(wireRequest([
            { id: C3, name: 'C3' },
            { id: CZ, name: 'Cz' },
            { id: C4, name: 'C4' },
            { id: PZ, name: 'Pz' }
        ]))
        const out = partitionRequest(req, catalog, filters)

        expect(out.groups).toHaveLength(3)
        out.groups.forEach(expectGroupShape)
        expect(out.groups[0].channels).toEqual([C3, CZ])
        expect(out.groups[0].filterSpec).toBe(LOWPASS)
        expect(out.groups[1].channels).toEqual([C4])
        expect(out.groups[1].filterSpec).toBe(HIGHPASS)
        expect(out.groups[2].channels).toEqual([PZ])
        expect(out.groups[2].filterSpec).toBe(null)
    })

    it('looks a montaged filter up by its composite label, not the bare lead id', () => {
        const filters = new Map<string, FilterSpec>([[filterKey(C3, 'C3<->Cz'), LOWPASS], [filterKey(C3, 'C3'), HIGHPASS]])
        const req = parseRequest(wireRequest([{ id: C3, name: 'C3<->Cz' }]))
        const out = partitionRequest(req, catalog, filters)
        expect(out.groups[0].filterSpec).toBe(LOWPASS)
    })

    it('never mixes montaged and plain traces even under an identical filter', () => {
        const filters = new Map([[filterKey(C3, 'C3'), LOWPASS], [filterKey(C4, 'C4<->Cz'), LOWPASS_REORDERED]])
        const req = parseRequest(wireRequest([
            { id: C3, name: 'C3' },
            { id: C4, name: 'C4<->Cz' }
        ]))
        const out = partitionRequest(req, catalog, filters)

        expect(out.groups).toHaveLength(2)
        out.groups.forEach(expectGroupShape)
        expect(new Set(out.groups.map((g) => g.key)).size).toBe(2)
    })

    it('keeps channels and traces aligned index for index', () => {
        const filters = new Map([[filterKey(C4, 'C4'), LOWPASS]])
        const req = parseRequest(wireRequest([
            { id: C3, name: 'C3' },
            { id: C4, name: 'C4' },
            { id: CZ, name: 'Cz' },
            { id: PZ, name: 'Pz' }
        ]))
        const out = partitionRequest(req, catalog, filters)

        for (const group of out.groups) {
            expectGroupShape(group)
            group.channels!.forEach((id, i) => {
                expect(group.traces[i].chId).toBe(id)
            })
        }
        expect(out.groups[0].channels).toEqual([C3, CZ, PZ])
        expect(out.groups[1].channels).toEqual([C4])
    })

    it('keeps montage pairs and traces aligned index for index', () => {
        const req = parseRequest(wireRequest([
            { id: C3, name: 'C3<->Cz' },
            { id: C4, name: 'C4<->C3' },
            { id: CZ, name: 'Cz<->C4' }
        ]))
        const group = partitionRequest(req, catalog, new Map()).groups[0]

        expectGroupShape(group)
        expect(group.montage).toEqual([
            { lead: C3, secondary: CZ },
            { lead: C4, secondary: C3 },
            { lead: CZ, secondary: C4 }
        ])
        expect(group.traces.map((t) => t.label)).toEqual(['C3<->Cz', 'C4<->C3', 'Cz<->C4'])
    })

    it('preserves duplicate channels as separate traces', () => {
        const req = parseRequest(wireRequest([
            { id: C3, name: 'C3' },
            { id: C3, name: 'C3' }
        ]))
        const group = partitionRequest(req, catalog, new Map()).groups[0]
        expect(group.channels).toEqual([C3, C3])
        expect(group.traces).toHaveLength(2)
    })

    it('orders groups by first appearance, repeatably', () => {
        const filters = new Map<string, FilterSpec>([[filterKey(C4, 'C4'), HIGHPASS], [filterKey(CZ, 'Cz'), LOWPASS]])
        const req = parseRequest(wireRequest([
            { id: C4, name: 'C4' },
            { id: PZ, name: 'Pz' },
            { id: CZ, name: 'Cz' },
            { id: C3, name: 'C3<->Cz' }
        ]))

        const first = partitionRequest(req, catalog, filters)
        const second = partitionRequest(req, catalog, filters)
        const keys = first.groups.map((g) => g.key)

        expect(keys).toEqual(second.groups.map((g) => g.key))
        expect(keys).toEqual([
            'highpass:4:0.5|channels',
            'unfiltered|channels',
            'lowpass:4:60|channels',
            'unfiltered|montage'
        ])
    })

    it('reports malformed virtual channels as invalid instead of throwing', () => {
        const req = parseRequest(wireRequest([null, 'C3', { name: 'C3' }, { id: C3, name: 'C3' }]))
        const out = partitionRequest(req, catalog, new Map())

        expect(out.groups).toHaveLength(1)
        expect(out.invalid).toHaveLength(3)
        expect(out.invalid[0].reason).toMatch(/not an object/)
        expect(out.invalid[1].reason).toMatch(/not an object/)
        expect(out.invalid[2].reason).toMatch(/no channel id/)
    })

    it('tolerates an absent filter registry', () => {
        const req = parseRequest(wireRequest([{ id: C3, name: 'C3' }]))
        const out = partitionRequest(req, catalog, undefined)
        expect(out.groups[0].filterSpec).toBe(null)
        expect(out.groups[0].key).toBe('unfiltered|channels')
    })

    it('returns empty results for a request with no channels', () => {
        const out = partitionRequest(parseRequest(wireRequest([])), catalog, new Map())
        expect(out).toEqual({ groups: [], unitTraces: [], invalid: [] })
    })
})

describe('regression pins found by adversarial review', () => {
    it('rejects a rate mismatch in either direction', () => {
        // Every montage fixture above has the faster channel as the lead, so an asymmetric
        // comparison survived the suite while letting a bad pair reach the reader, where it
        // throws and drains every well-formed pair sharing its group.
        expect(resolveMontagePair({ id: PZ, name: 'Pz<->C3' }, catalog)).toEqual({
            ok: false,
            reason: 'Sample rates differ: Pz at 500 Hz, C3 at 1000 Hz'
        })
    })

    it('treats a plain channel whose own name contains the separator as plain', () => {
        // A bundle may legitimately name a channel 'EEG<->REF'; toChannelDetails passes names
        // through verbatim, so keying off the separator alone would make it unrenderable.
        const withSeparator = buildCatalogIndex([chan('c9', 'EEG<->REF')])
        const req = parseRequest(wireRequest([{ id: 'c9', name: 'EEG<->REF' }]))
        const out = partitionRequest(req, withSeparator, new Map())

        expect(out.invalid).toEqual([])
        expect(out.groups).toHaveLength(1)
        expect(out.groups[0].isMontage).toBe(false)
        expect(out.groups[0].channels).toEqual(['c9'])
        expect(reconstructClientId({ id: 'c9', name: 'EEG<->REF' }, withSeparator)).toBe('c9')
    })

    it('still classifies a genuine montage on such a channel as montaged', () => {
        const withSeparator = buildCatalogIndex([chan('c9', 'EEG<->REF'), chan(CZ, 'Cz')])
        const req = parseRequest(wireRequest([{ id: 'c9', name: 'EEG<->REF<->Cz' }]))
        const out = partitionRequest(req, withSeparator, new Map())
        // The composite never equals the lead's own catalog name, so it routes as a montage;
        // it is then rejected on the exact-two-parts rule rather than silently mis-paired.
        expect(out.groups).toEqual([])
        expect(out.invalid[0].reason).toMatch(/is not exactly/)
    })

    it('keys filters on server id and label so the lookup cannot drift', () => {
        expect(filterKey(C3, 'C3')).toBe(`${C3}|C3`)
        expect(filterKey(C3, 'C3<->Cz')).not.toBe(filterKey(C3, 'C3'))
    })
})
