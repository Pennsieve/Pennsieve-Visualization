import { describe, it, expect, vi, afterEach } from 'vitest'
import { toChannelDetails, buildCatalogIndex, synthesizeMontageDetails, isUnitChannel, isAnnotationChannel } from './channelDetails'
import type { ChannelInfo, ContinuousChannelInfo, EventChannelInfo } from '@pennsieve/timeseries-zarr-reader'

const START = 1704067200000000

const info = (over: Partial<ContinuousChannelInfo> = {}): ChannelInfo => ({
    kind: 'continuous',
    index: 0,
    id: 'ch-1',
    name: 'EEG 1',
    unit: 'uV',
    rateHz: 250,
    startUs: START,
    endUs: START + 30000000,
    runs: 1,
    ...over
})

/** A sorted-spikes channel: an event channel with waveforms, drawn as a row. */
const unitInfo = (over: Partial<EventChannelInfo> = {}): ChannelInfo => ({
    kind: 'event',
    index: 9,
    id: 'ch-u',
    name: 'unitA',
    unit: 'uV',
    eventCount: 200,
    columns: ['labels'],
    hasWaveformMean: true,
    countLevels: 0,
    ...over
})

/** An annotation channel: an event channel with no waveforms, shown as a layer. */
const marksInfo = (over: Partial<EventChannelInfo> = {}): ChannelInfo => ({
    kind: 'event',
    index: 10,
    id: 'ch-m',
    name: 'marks',
    eventCount: 3,
    columns: ['durations', 'text'],
    hasWaveformMean: false,
    countLevels: 0,
    ...over
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('channel kinds', () => {
    it('tells spike channels from annotation channels by their waveforms', () => {
        expect(isUnitChannel(unitInfo())).toBe(true)
        expect(isUnitChannel(unitInfo({ columns: ['waveforms'], hasWaveformMean: false }))).toBe(true)
        expect(isUnitChannel(marksInfo())).toBe(false)
        expect(isUnitChannel(info())).toBe(false)
        expect(isAnnotationChannel(marksInfo())).toBe(true)
        expect(isAnnotationChannel(unitInfo())).toBe(false)
        expect(isAnnotationChannel(info())).toBe(false)
    })
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
            start: START,
            end: START + 30000000,
            properties: []
        })
    })

    it('emits UPPERCASE channelType for both row kinds', () => {
        const details = toChannelDetails([info(), unitInfo()])

        expect(details.map((d) => d.channelType)).toEqual(['CONTINUOUS', 'UNIT'])
    })

    it('gives a unit row the recording\'s extent and its finest rate', () => {
        const details = toChannelDetails([
            unitInfo(),
            info({ id: 'a', startUs: START, endUs: START + 10, rateHz: 250 }),
            info({ id: 'b', startUs: START + 5, endUs: START + 30, rateHz: 1000 })
        ])

        expect(details[0]).toEqual({
            id: 'ch-u', name: 'unitA', channelType: 'UNIT', rate: 1000, unit: 'uV', start: START, end: START + 30, properties: []
        })
    })

    it('gives a unit row a degenerate extent when the bundle has no continuous channel', () => {
        const details = toChannelDetails([unitInfo({ unit: undefined })])
        expect(details[0]).toMatchObject({ start: 0, end: 0, rate: 0, unit: '' })
    })

    it('leaves annotation channels out: they are layers, not rows', () => {
        expect(toChannelDetails([marksInfo(), info(), marksInfo({ id: 'ch-n' })]).map((d) => d.id)).toEqual(['ch-1'])
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
    it('indexes every channel by id and by name and carries the flat details of the rows', () => {
        const a = info({ id: 'a', name: 'sineA' })
        const b = unitInfo({ id: 'b', name: 'unitA' })
        const m = marksInfo({ id: 'm', name: 'marks' })
        const index = buildCatalogIndex([a, b, m])

        expect(index.byId.get('a')).toBe(a)
        expect(index.byId.get('b')).toBe(b)
        expect(index.byId.get('m')).toBe(m)
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
        unitInfo({ id: 'id-u', name: 'U' }),
        marksInfo({ id: 'id-m', name: 'M' })
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

    it('drops a pair involving an event channel, spikes or annotations', () => {
        const { details, dropped } = synthesizeMontageDetails([['A', 'U'], ['U', 'B'], ['A', 'M']], catalog)

        expect(details).toEqual([])
        expect(dropped.map((d) => d.reason)).toEqual(['unit-channel', 'unit-channel', 'unit-channel'])
        expect(dropped[0].message).toContain('U')
        expect(dropped[2].message).toContain('M')
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
    const pinned = (over: Pick<ChannelInfo, 'id' | 'name'>): ChannelInfo => info({ startUs: 0, endUs: 1000, rateHz: 1000, ...over })

    it('warns once per duplicated name, not once per bundle', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        buildCatalogIndex([
            pinned({ id: 'a', name: 'x' }), pinned({ id: 'b', name: 'x' }),
            pinned({ id: 'c', name: 'y' }), pinned({ id: 'd', name: 'y' })
        ])
        expect(warn).toHaveBeenCalledTimes(2)
        expect(warn.mock.calls.map((c) => c[0]).join('\n')).toMatch(/x[\s\S]*y|y[\s\S]*x/)
        warn.mockRestore()
    })

    it('names the kept channel and the ignored one the right way round', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        buildCatalogIndex([pinned({ id: 'a', name: 'dup' }), pinned({ id: 'b', name: 'dup' })])
        // byName keeps the first, so the message must say so; the inverse sends an operator
        // to fix the wrong channel.
        expect(warn.mock.calls[0][0]).toMatch(/keeping channel a\b[\s\S]*ignoring b\b/)
        warn.mockRestore()
    })
})
