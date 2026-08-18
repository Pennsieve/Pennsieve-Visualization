// Characterization tests: pin the montage payload createMontagePayload builds
// today, before the architecture refactor. The payload is sent as JSON, so the
// snapshots pin the serialized form.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { useChannelProcessing } from './useChannelProcessing'
import type { WorkspaceMontage } from './useChannelProcessing'
import type { ChannelDetail } from './streaming/channelDetails'

const doubleBanana: WorkspaceMontage = {
    name: 'DOUBLE_BANANA',
    channelPairs: [
        { name: 'Fp1-F7', channels: ['Fp1', 'F7'] },
        { name: 'F7-T3', channels: ['F7', 'T3'] },
        { channels: ['T3', 'T5'] }
    ]
}

const setup = (montages: WorkspaceMontage[] = [], scheme = 'NOT_MONTAGED') => {
    const baseChannels = ref<ChannelDetail[] | undefined>(undefined)
    const activeViewer = ref<{ content: { id: string } } | null | undefined>(
        { content: { id: 'N:package:pkg-1' } }
    )
    return useChannelProcessing(baseChannels, ref(scheme), ref(montages), activeViewer)
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('createMontagePayload', () => {
    it('builds the NOT_MONTAGED payload with an empty montage map', () => {
        const { createMontagePayload } = setup()

        const payload = createMontagePayload('NOT_MONTAGED')

        expect(JSON.stringify(payload)).toMatchInlineSnapshot(`"{"montage":"NOT_MONTAGED","packageId":"N:package:pkg-1","montageMap":[]}"`)
    })

    it('resolves a custom scheme from the workspace montages into channel pair rows', () => {
        const { createMontagePayload } = setup([doubleBanana], 'DOUBLE_BANANA')

        const payload = createMontagePayload('DOUBLE_BANANA')

        expect(JSON.stringify(payload)).toMatchInlineSnapshot(`"{"montage":"CUSTOM_MONTAGE","packageId":"N:package:pkg-1","montageMap":[["Fp1","F7"],["F7","T3"],["T3","T5"]]}"`)
    })

    it('returns null for a scheme missing from the workspace montages', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { createMontagePayload } = setup([doubleBanana])

        expect(createMontagePayload('NO_SUCH_MONTAGE')).toBeNull()
    })
})
