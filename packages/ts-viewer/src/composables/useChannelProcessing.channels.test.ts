import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { useChannelProcessing } from './useChannelProcessing'
import type { WorkspaceMontage } from './useChannelProcessing'
import type { ChannelDetail } from './streaming/channelDetails'

const detail = (id: string, extra: Partial<ChannelDetail> = {}): ChannelDetail => ({
    id,
    name: id,
    channelType: 'CONTINUOUS',
    rate: 512,
    unit: 'uV',
    start: 0,
    end: 10_000_000,
    properties: [],
    ...extra
})

const doubleBanana: WorkspaceMontage = {
    name: 'DOUBLE_BANANA',
    channelPairs: [
        { name: 'Fp1-F7 pair', channels: ['Fp1', 'F7'] },
        { channels: ['F7', 'T3'] },
        { name: 'Single', channels: ['T3'] },
        { name: 'Triple', channels: ['T3', 'T5', 'O1'] }
    ]
}

const PACKAGE_ID = 'N:package:pkg-1'

interface SetupOptions {
    baseChannels?: ChannelDetail[]
    scheme?: string
    montages?: WorkspaceMontage[]
}

const setup = (options: SetupOptions = {}) => {
    const baseChannels = ref<ChannelDetail[] | undefined>(options.baseChannels)
    const scheme = ref(options.scheme ?? 'NOT_MONTAGED')
    const montages = ref<WorkspaceMontage[]>(options.montages ?? [])
    const activeViewer = ref<{ content: { id: string } } | null | undefined>({ content: { id: PACKAGE_ID } })

    return {
        ...useChannelProcessing(baseChannels, scheme, montages, activeViewer),
        baseChannels,
        scheme,
        montages,
        activeViewer
    }
}

/** A montage session over Fp1, F7 and T3, as synthesizeMontageDetails feeds it. */
const montaged = (extra: SetupOptions = {}) => setup({
    baseChannels: [detail('lead-1', { name: 'Fp1' }), detail('lead-2', { name: 'F7' })],
    scheme: 'DOUBLE_BANANA',
    montages: [doubleBanana],
    ...extra
})

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('createVirtualChannel without a montage', () => {
    it('uses the server channel id for both the client id and the server id', () => {
        const { createVirtualChannel } = setup()

        const { content } = createVirtualChannel('sineA', 'Sine A', detail('sineA'))

        expect(content.id).toBe('sineA')
        expect(content.serverId).toBe('sineA')
        expect(content.baseChannelId).toBe('sineA')
    })

    it('copies the metadata of the base channel into the envelope', () => {
        const { createVirtualChannel } = setup()
        const base = detail('sineA', { channelType: 'UNIT', rate: 1024, unit: 'mV', start: 100, end: 200 })

        const { content } = createVirtualChannel('sineA', 'Sine A', base)

        expect(content).toMatchObject({
            name: 'Sine A',
            label: 'Sine A',
            channelType: 'UNIT',
            rate: 1024,
            unit: 'mV',
            start: 100,
            end: 200
        })
    })

    it('uses the channel name as the display name', () => {
        const { createVirtualChannel } = setup()

        expect(createVirtualChannel('sineA', 'Sine A', detail('sineA')).content.displayName).toBe('Sine A')
    })

    it('reports the channel as not montaged', () => {
        const { createVirtualChannel } = setup()

        const { content } = createVirtualChannel('sineA', 'Sine A', detail('sineA'))

        expect(content.isMontaged).toBe(false)
        expect(content.montageScheme).toBe('NOT_MONTAGED')
    })

    it('carries the base channel properties through', () => {
        const { createVirtualChannel } = setup()
        const properties = [{ key: 'gain', value: 2 }]

        const virtual = createVirtualChannel('sineA', 'Sine A', detail('sineA', { properties }))

        expect(virtual.properties).toBe(properties)
    })

    it('substitutes an empty property list when the base channel has none', () => {
        const { createVirtualChannel } = setup()
        // Channel details arriving over the discovery socket are unchecked JSON.
        const base = { ...detail('sineA'), properties: undefined } as unknown as ChannelDetail

        expect(createVirtualChannel('sineA', 'Sine A', base).properties).toEqual([])
    })
})

describe('createVirtualChannel with a montage', () => {
    it('builds a client id from the lead channel id and the pair name', () => {
        const { createVirtualChannel } = montaged()

        const { content } = createVirtualChannel('lead-1', 'Fp1<->F7', detail('lead-1', { name: 'Fp1' }))

        expect(content.id).toBe('lead-1_Fp1<->F7')
        expect(content.serverId).toBe('lead-1')
    })

    it('names the montage scheme on every channel it builds', () => {
        const { createVirtualChannel } = montaged()

        const { content } = createVirtualChannel('lead-1', 'Fp1<->F7', detail('lead-1'))

        expect(content.isMontaged).toBe(true)
        expect(content.montageScheme).toBe('DOUBLE_BANANA')
    })

    it('takes the display name from the matching montage pair', () => {
        const { createVirtualChannel } = montaged()

        const { content } = createVirtualChannel('lead-1', 'Fp1<->F7', detail('lead-1'))

        expect(content.displayName).toBe('Fp1-F7 pair')
        expect(content.label).toBe('Fp1<->F7')
    })

    it('joins the two channel names when the montage pair has no name', () => {
        const { createVirtualChannel } = montaged()

        expect(createVirtualChannel('lead-2', 'F7<->T3', detail('lead-2')).content.displayName).toBe('F7-T3')
    })

    it('joins the two channel names when the pair is not in the montage', () => {
        const { createVirtualChannel } = montaged()

        expect(createVirtualChannel('lead-9', 'O1<->O2', detail('lead-9')).content.displayName).toBe('O1-O2')
    })

    it('joins the two channel names when the montage lists the pair in the other order', () => {
        const { createVirtualChannel } = montaged()

        expect(createVirtualChannel('lead-1', 'F7<->Fp1', detail('lead-1')).content.displayName).toBe('F7-Fp1')
    })

    it('keeps the raw name as the display name when it holds no pair separator', () => {
        const { createVirtualChannel } = montaged()

        const { content } = createVirtualChannel('lead-1', 'Fp1', detail('lead-1'))

        expect(content.displayName).toBe('Fp1')
        expect(content.id).toBe('lead-1_Fp1')
    })

    it('ignores a montage pair that does not list exactly two channels', () => {
        const { createVirtualChannel } = montaged()

        expect(createVirtualChannel('lead-3', 'T3<->T5', detail('lead-3')).content.displayName).toBe('T3-T5')
        expect(createVirtualChannel('lead-3', 'T3<->', detail('lead-3')).content.displayName).toBe('T3-')
    })

    it('falls back to joining the names when the montage definition is missing', () => {
        const { createVirtualChannel } = montaged({ montages: [] })

        expect(createVirtualChannel('lead-1', 'Fp1<->F7', detail('lead-1')).content.displayName).toBe('Fp1-F7')
    })
})

describe('getDisplayName caching', () => {
    it('caches one entry per channel pair and scheme', () => {
        const { getDisplayName, getProcessingStats } = montaged()

        getDisplayName('Fp1', 'F7')
        getDisplayName('Fp1', 'F7')
        getDisplayName('F7', 'T3')

        expect(getProcessingStats().montageCacheSize).toBe(2)
    })

    it('resolves a pair from a montage named explicitly rather than the active scheme', () => {
        const { getDisplayName } = setup({ montages: [doubleBanana] })

        expect(getDisplayName('Fp1', 'F7', 'DOUBLE_BANANA')).toBe('Fp1-F7 pair')
    })

    it('drops both caches when the montage scheme changes', async () => {
        const { getDisplayName, findBaseChannel, scheme, getProcessingStats } = montaged()
        getDisplayName('Fp1', 'F7')
        findBaseChannel('lead-1')
        expect(getProcessingStats().montageCacheSize).toBe(1)
        expect(getProcessingStats().cacheSize).toBe(1)

        scheme.value = 'NOT_MONTAGED'
        await nextTick()

        expect(getProcessingStats().montageCacheSize).toBe(0)
        expect(getProcessingStats().cacheSize).toBe(0)
    })
})

describe('processChannelData', () => {
    const details = [{ id: 'sineA', name: 'Sine A' }, { id: 'sineB', name: 'Sine B' }]

    it('builds one virtual channel per detail row', () => {
        const { processChannelData } = setup({ baseChannels: [detail('sineA'), detail('sineB')] })

        const virtuals = processChannelData(details)

        expect(virtuals.map(v => v!.content.id)).toEqual(['sineA', 'sineB'])
        expect(virtuals.map(v => v!.content.name)).toEqual(['Sine A', 'Sine B'])
    })

    it('counts the channels it processed', () => {
        const { processChannelData, getProcessingStats } = setup({ baseChannels: [detail('sineA'), detail('sineB')] })

        processChannelData(details)

        expect(getProcessingStats()).toMatchObject({ totalChannels: 2, processedChannels: 2, errors: 0 })
    })

    it('returns an empty list and warns when given something that is not an array', () => {
        const { processChannelData } = setup({ baseChannels: [detail('sineA')] })

        expect(processChannelData(null)).toEqual([])
        expect(processChannelData(undefined)).toEqual([])
        expect(warn).toHaveBeenCalledTimes(2)
    })

    it('leaves the previous statistics alone when the input is not an array', () => {
        const { processChannelData, getProcessingStats } = setup({ baseChannels: [detail('sineA')] })
        processChannelData([{ id: 'sineA', name: 'Sine A' }])

        processChannelData(null)

        expect(getProcessingStats().processedChannels).toBe(1)
    })

    it('drops a row whose base channel is not loaded and counts it as an error', () => {
        const { processChannelData, getProcessingStats } = setup({ baseChannels: [detail('sineA')] })

        const virtuals = processChannelData(details)

        expect(virtuals.map(v => v!.content.id)).toEqual(['sineA'])
        expect(getProcessingStats()).toMatchObject({ totalChannels: 2, processedChannels: 1, errors: 1 })
        expect(warn).toHaveBeenCalled()
    })

    it('drops every row when no base channels are loaded at all', () => {
        const { processChannelData, getProcessingStats } = setup()

        expect(processChannelData(details)).toEqual([])
        expect(getProcessingStats().errors).toBe(2)
    })

    it('counts a row that throws while being built and keeps going', () => {
        const { processChannelData, getProcessingStats } = montaged()
        // A montaged row with no name reaches name.split in createVirtualChannel.
        const rows = [{ id: 'lead-1' }, { id: 'lead-2', name: 'F7<->T3' }] as unknown as { id: string; name: string }[]

        const virtuals = processChannelData(rows)

        expect(virtuals.map(v => v!.content.serverId)).toEqual(['lead-2'])
        expect(getProcessingStats()).toMatchObject({ totalChannels: 2, processedChannels: 1, errors: 1 })
        expect(error).toHaveBeenCalled()
    })

    it('resets the processed and error counts on each call', () => {
        const { processChannelData, getProcessingStats } = setup({ baseChannels: [detail('sineA')] })
        processChannelData(details)
        expect(getProcessingStats().errors).toBe(1)

        processChannelData([{ id: 'sineA', name: 'Sine A' }])

        expect(getProcessingStats()).toMatchObject({ totalChannels: 1, processedChannels: 1, errors: 0 })
    })

    it('keeps adding to the montage channel count across calls', () => {
        // pins current behavior; see report. montageChannels is never reset.
        const { processChannelData, getProcessingStats } = montaged()
        const rows = [{ id: 'lead-1', name: 'Fp1<->F7' }]

        processChannelData(rows)
        processChannelData(rows)

        expect(getProcessingStats().montageChannels).toBe(2)
        expect(getProcessingStats().processedChannels).toBe(1)
    })

    it('leaves the montage channel count at zero without a montage', () => {
        const { processChannelData, getProcessingStats } = setup({ baseChannels: [detail('sineA')] })

        processChannelData([{ id: 'sineA', name: 'Sine A' }])

        expect(getProcessingStats().montageChannels).toBe(0)
    })

    it('records how long the last run took', () => {
        const { processChannelData, getProcessingStats } = setup({ baseChannels: [detail('sineA')] })

        processChannelData([{ id: 'sineA', name: 'Sine A' }])

        expect(getProcessingStats().lastProcessingTime).toBeGreaterThanOrEqual(0)
    })

    it('caches each base channel lookup', () => {
        const { processChannelData, getProcessingStats } = setup({ baseChannels: [detail('sineA'), detail('sineB')] })

        processChannelData(details)
        processChannelData(details)

        expect(getProcessingStats().cacheSize).toBe(2)
    })

    it('reports the statistics as read only', () => {
        const { processingStats, processChannelData } = setup({ baseChannels: [detail('sineA')] })
        processChannelData([{ id: 'sineA', name: 'Sine A' }])
        const writable = processingStats as unknown as { processedChannels: number }

        writable.processedChannels = 99

        expect(processingStats.processedChannels).toBe(1)
    })

    it('clears the caches and the statistics on request', () => {
        const { processChannelData, clearCaches, getProcessingStats } = montaged()
        processChannelData([{ id: 'lead-1', name: 'Fp1<->F7' }])

        clearCaches()

        expect(getProcessingStats()).toMatchObject({
            totalChannels: 0,
            processedChannels: 0,
            montageChannels: 0,
            errors: 0,
            lastProcessingTime: 0,
            cacheSize: 0,
            montageCacheSize: 0
        })
    })
})

describe('createMontagePayload', () => {
    it('reports no montage and an empty map for NOT_MONTAGED', () => {
        const { createMontagePayload } = setup({ montages: [doubleBanana] })

        expect(createMontagePayload('NOT_MONTAGED')).toEqual({
            montage: 'NOT_MONTAGED',
            packageId: PACKAGE_ID,
            montageMap: []
        })
    })

    it('lists the channel pairs of a workspace montage in definition order', () => {
        const { createMontagePayload } = setup({ montages: [doubleBanana], scheme: 'DOUBLE_BANANA' })

        expect(createMontagePayload('DOUBLE_BANANA')).toEqual({
            montage: 'CUSTOM_MONTAGE',
            packageId: PACKAGE_ID,
            montageMap: [['Fp1', 'F7'], ['F7', 'T3'], ['T3'], ['T3', 'T5', 'O1']]
        })
    })

    it('copies a pair that does not list exactly two channels without complaint', () => {
        const oddPairs: WorkspaceMontage = { name: 'ODD', channelPairs: [{ channels: [] }, { channels: ['A'] }] }
        const { createMontagePayload } = setup({ montages: [oddPairs] })

        const payload = createMontagePayload('ODD')

        expect(payload!.montageMap).toEqual([[], ['A']])
        expect(warn).not.toHaveBeenCalled()
    })

    it('returns null and warns for a scheme the workspace does not define', () => {
        const { createMontagePayload } = setup({ montages: [doubleBanana] })

        expect(createMontagePayload('NO_SUCH_MONTAGE')).toBeNull()
        expect(warn).toHaveBeenCalled()
    })

    it('returns null for a custom scheme when no montages are loaded', () => {
        const { createMontagePayload } = setup()

        expect(createMontagePayload('DOUBLE_BANANA')).toBeNull()
    })

    it('reports an undefined package id when no viewer is active', () => {
        const activeViewer = ref<{ content: { id: string } } | null | undefined>(null)
        const { createMontagePayload } = useChannelProcessing(
            ref(undefined), ref('NOT_MONTAGED'), ref([doubleBanana]), activeViewer
        )

        expect(createMontagePayload('NOT_MONTAGED')).toEqual({
            montage: 'NOT_MONTAGED',
            packageId: undefined,
            montageMap: []
        })
        expect(createMontagePayload('DOUBLE_BANANA')).toMatchObject({ montage: 'CUSTOM_MONTAGE' })
    })

    it('throws for a custom scheme when the active viewer carries no content', () => {
        // pins current behavior; see report. The store's activeViewer starts as {},
        // and TSPlotCanvas casts it to the shape this composable declares.
        const activeViewer = ref({} as unknown as { content: { id: string } })
        const { createMontagePayload } = useChannelProcessing(
            ref(undefined), ref('DOUBLE_BANANA'), ref([doubleBanana]), activeViewer
        )

        expect(() => createMontagePayload('DOUBLE_BANANA')).toThrow(TypeError)
        expect(createMontagePayload('NOT_MONTAGED')).toMatchObject({ montage: 'NOT_MONTAGED' })
    })
})

describe('getChannelId', () => {
    it('returns the client side channel id', () => {
        const { getChannelId } = montaged()

        expect(getChannelId({ id: 'lead-1_Fp1<->F7' })).toBe('lead-1_Fp1<->F7')
    })

    it('returns an empty string for a missing channel', () => {
        const { getChannelId } = setup()

        expect(getChannelId(null)).toBe('')
        expect(getChannelId(undefined)).toBe('')
        expect(getChannelId({})).toBe('')
    })
})

describe('montage state', () => {
    it('reports whether a montage is active', () => {
        expect(setup().isViewingMontage.value).toBe(false)
        expect(montaged().isViewingMontage.value).toBe(true)
    })

    it('follows a scheme change', async () => {
        const { isViewingMontage, scheme } = setup()

        scheme.value = 'DOUBLE_BANANA'
        await nextTick()

        expect(isViewingMontage.value).toBe(true)
    })

    it('resolves the current montage definition only while a montage is active', () => {
        expect(setup({ montages: [doubleBanana] }).currentMontage.value).toBeNull()
        expect(montaged().currentMontage.value).toMatchObject({ name: 'DOUBLE_BANANA' })
    })

    it('reports no current montage when the active scheme is not in the workspace', () => {
        const { currentMontage } = setup({ scheme: 'MISSING', montages: [doubleBanana] })

        expect(currentMontage.value).toBeUndefined()
    })

    it('exposes the channel pairs of the current montage', () => {
        expect(montaged().montageChannelPairs.value).toEqual(doubleBanana.channelPairs)
        expect(setup().montageChannelPairs.value).toEqual({})
    })
})
