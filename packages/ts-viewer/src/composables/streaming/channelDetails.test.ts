import { describe, it, expect, vi, afterEach } from 'vitest'
import { toChannelDetails, buildCatalogIndex, synthesizeMontageDetails } from './channelDetails'
import type { ChannelInfo } from '@pennsieve/timeseries-zarr-reader'

const info = (over: Partial<ChannelInfo> = {}): ChannelInfo => ({
    id: 'ch-1',
    name: 'EEG 1',
    unit: 'uV',
    rateHz: 250,
    startUs: 1704067200000000,
    endUs: 1704067230000000,
    kind: 'continuous',
    ...over
})

const unitInfo = (over: Partial<ChannelInfo> = {}): ChannelInfo => info({
    id: 'ch-u',
    name: 'unitA',
    kind: 'unit',
    endUs: 1704067200000000,
    ...over
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('toChannelDetails', () => {
    it('returns a flat array with no content envelope and the exact legacy key set', () => {
        const details = toChannelDetails([info()])

        expect(Array.isArray(details)).toBe(true)
        expect(details).toHaveLength(1)
        expect(details[0].content).toBeUndefined()
        expect(Object.keys(details[0]).sort()).toEqual([
            'channelType', 'end', 'id', 'name', 'properties', 'rate', 'start', 'unit'
        ])
    })

    it('maps every reader field onto its viewer name', () => {
        const details = toChannelDetails([info({ id: 'abc', name: 'sineA', unit: 'mV', rateHz: 512 })])

        expect(details[0]).toEqual({
            id: 'abc',
            name: 'sineA',
            channelType: 'CONTINUOUS',
            rate: 512,
            unit: 'mV',
            start: 1704067200000000,
            end: 1704067230000000,
            properties: []
        })
    })

    it('emits UPPERCASE channelType for both kinds', () => {
        const details = toChannelDetails([info(), unitInfo()])

        expect(details.map((d) => d.channelType)).toEqual(['CONTINUOUS', 'UNIT'])
    })

    it('passes a unit channel end === start straight through', () => {
        const details = toChannelDetails([unitInfo()])

        expect(details[0].start).toBe(1704067200000000)
        expect(details[0].end).toBe(details[0].start)
    })

    it('gives each channel its own fresh properties array', () => {
        const details = toChannelDetails([info({ id: 'a' }), info({ id: 'b' })])

        expect(details[0].properties).toEqual([])
        expect(details[0].properties).not.toBe(details[1].properties)
    })

    it('returns an empty array for empty input', () => {
        expect(toChannelDetails([])).toEqual([])
    })
})

describe('buildCatalogIndex', () => {
    it('indexes by id and by name and carries the flat details', () => {
        const a = info({ id: 'a', name: 'sineA' })
        const b = unitInfo({ id: 'b', name: 'unitA' })
        const index = buildCatalogIndex([a, b])

        expect(index.byId.get('a')).toBe(a)
        expect(index.byId.get('b')).toBe(b)
        expect(index.byName.get('sineA')).toBe(a)
        expect(index.byName.get('unitA')).toBe(b)
        expect(index.details.map((d) => d.id)).toEqual(['a', 'b'])
        expect(index.details[1].channelType).toBe('UNIT')
    })

    it('keeps the FIRST channel for a duplicated name and warns once naming it', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const first = info({ id: 'a', name: 'dup' })
        const second = info({ id: 'b', name: 'dup' })
        const third = info({ id: 'c', name: 'dup' })
        const index = buildCatalogIndex([first, second, third])

        expect(index.byName.get('dup')).toBe(first)
        expect(index.byId.get('b')).toBe(second)
        expect(index.byId.get('c')).toBe(third)
        expect(index.byId.size).toBe(3)
        expect(index.details).toHaveLength(3)

        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0][0]).toContain('dup')
    })

    it('does not warn when every name is unique', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        buildCatalogIndex([info({ id: 'a', name: 'x' }), info({ id: 'b', name: 'y' })])

        expect(warn).not.toHaveBeenCalled()
    })

    it('handles empty input', () => {
        const index = buildCatalogIndex([])

        expect(index.byId.size).toBe(0)
        expect(index.byName.size).toBe(0)
        expect(index.details).toEqual([])
    })
})

describe('synthesizeMontageDetails', () => {
    const catalog = buildCatalogIndex([
        info({ id: 'id-a', name: 'A', rateHz: 250 }),
        info({ id: 'id-b', name: 'B', rateHz: 250 }),
        info({ id: 'id-c', name: 'C', rateHz: 500 }),
        unitInfo({ id: 'id-u', name: 'U' })
    ])

    it('emits lead id plus a lead<->secondary name for each resolvable pair', () => {
        const { details, dropped } = synthesizeMontageDetails([['A', 'B'], ['B', 'A']], catalog)

        expect(details).toEqual([
            { id: 'id-a', name: 'A<->B' },
            { id: 'id-b', name: 'B<->A' }
        ])
        expect(dropped).toEqual([])
    })

    it('produces a name whose client id matches the reader montage key', () => {
        const { details } = synthesizeMontageDetails([['A', 'B']], catalog)
        const clientId = `${details[0].id}_${details[0].name}`

        expect(clientId).toBe('id-a_A<->B')
    })

    it('drops a pair naming an unknown channel', () => {
        const { details, dropped } = synthesizeMontageDetails([['A', 'ZZZ'], ['QQQ', 'B']], catalog)

        expect(details).toEqual([])
        expect(dropped.map((d) => d.reason)).toEqual(['unknown-channel', 'unknown-channel'])
        expect(dropped[0].pair).toEqual(['A', 'ZZZ'])
        expect(dropped[0].message).toContain('ZZZ')
        expect(dropped[1].message).toContain('QQQ')
    })

    it('drops a pair involving a unit channel', () => {
        const { details, dropped } = synthesizeMontageDetails([['A', 'U'], ['U', 'B']], catalog)

        expect(details).toEqual([])
        expect(dropped.map((d) => d.reason)).toEqual(['unit-channel', 'unit-channel'])
        expect(dropped[0].message).toContain('U')
    })

    it('drops a pair whose rates differ', () => {
        const { details, dropped } = synthesizeMontageDetails([['A', 'C']], catalog)

        expect(details).toEqual([])
        expect(dropped[0].reason).toBe('rate-mismatch')
        expect(dropped[0].message).toContain('250')
        expect(dropped[0].message).toContain('500')
    })

    it('keeps the good pairs when some are dropped', () => {
        const { details, dropped } = synthesizeMontageDetails(
            [['A', 'B'], ['A', 'C'], ['A', 'U'], ['A', 'ZZZ']],
            catalog
        )

        expect(details).toEqual([{ id: 'id-a', name: 'A<->B' }])
        expect(dropped.map((d) => d.reason)).toEqual(['rate-mismatch', 'unit-channel', 'unknown-channel'])
    })

    it('drops a malformed entry instead of throwing', () => {
        const { details, dropped } = synthesizeMontageDetails([['A'], null, 'A,B'], catalog)

        expect(details).toEqual([])
        expect(dropped.map((d) => d.reason)).toEqual(['malformed-pair', 'malformed-pair', 'malformed-pair'])
    })

    it('returns empty results for an empty or missing montage map', () => {
        expect(synthesizeMontageDetails([], catalog)).toEqual({ details: [], dropped: [] })
        expect(synthesizeMontageDetails(undefined, catalog)).toEqual({ details: [], dropped: [] })
    })
})

describe('regression pins found by adversarial review', () => {
    const info = (over: Pick<ChannelInfo, 'id' | 'name'> & Partial<ChannelInfo>): ChannelInfo => ({
        unit: 'uV', rateHz: 1000, startUs: 0, endUs: 1000, kind: 'continuous', ...over
    })

    it('warns once per duplicated name, not once per bundle', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        buildCatalogIndex([
            info({ id: 'a', name: 'x' }), info({ id: 'b', name: 'x' }),
            info({ id: 'c', name: 'y' }), info({ id: 'd', name: 'y' })
        ])
        expect(warn).toHaveBeenCalledTimes(2)
        expect(warn.mock.calls.map((c) => c[0]).join('\n')).toMatch(/x[\s\S]*y|y[\s\S]*x/)
        warn.mockRestore()
    })

    it('names the kept channel and the ignored one the right way round', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        buildCatalogIndex([info({ id: 'a', name: 'dup' }), info({ id: 'b', name: 'dup' })])
        // byName keeps the first, so the message must say so; the inverse sends an operator
        // to fix the wrong channel.
        expect(warn.mock.calls[0][0]).toMatch(/keeping channel a\b[\s\S]*ignoring b\b/)
        warn.mockRestore()
    })
})
