// How the Zarr transport answers a page it cannot read. The reader runs for
// real against the committed fixture; an injected fetch refuses chosen keys.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createZarrTransport, MAX_PAGE_FAILURES, FIRST_COOLDOWN_MS, MAX_COOLDOWN_MS } from './zarrTransport'
import { disposeClient } from '@/composables/streaming/clientRegistry'
import { serveBundleFromDisk, channelPathPrefix, BUNDLE_URL, FIXTURE_START, SECOND } from './conformance/fixtureFetch'
import type { PageRequest, TransportError, TransportSegmentEnvelope, VirtualChannelRef } from './TimeseriesTransport'

const SINE_A: VirtualChannelRef = { id: 'sineA', name: 'Sine A' }
const SINE_B: VirtualChannelRef = { id: 'sineB', name: 'Sine B' }
const PAGE = { startTime: FIXTURE_START + 28 * SECOND, endTime: FIXTURE_START + 30 * SECOND, pixelWidth: 4000 }

interface LooseBlock {
    chId?: string
    nrPoints?: number
    parsedData?: unknown
}

const blockOf = (envelope: TransportSegmentEnvelope) => (envelope as { data: LooseBlock }).data

/** A block the viewer caches: the empty span carries its sample rows. */
const isCachedEmpty = (envelope: TransportSegmentEnvelope) => {
    const block = blockOf(envelope)
    return block.nrPoints === 0 && Array.isArray(block.parsedData)
}

/** A gap notice: drains the page counter and is not cached. */
const isNotice = (envelope: TransportSegmentEnvelope) => {
    const block = blockOf(envelope)
    return block.nrPoints === 0 && !('parsedData' in block)
}

let nextRig = 0

async function makeRig(options: { maxRawBytes?: number } = {}) {
    const registryKey = `zarr-failures-${nextRig++}`
    const clock = { value: 1_700_000_000_000 }
    /** Channel path prefixes whose objects answer 403, the way S3 refuses a missing key. */
    const refused = new Set<string>()
    let fetches = 0
    const fetchImpl = async (request: Request): Promise<Response> => {
        fetches++
        const { pathname } = new URL(request.url)
        for (const prefix of refused) {
            if (pathname.startsWith(prefix)) {
                return new Response(null, { status: 403 })
            }
        }
        return serveBundleFromDisk(request)
    }
    const transport = createZarrTransport({ registryKey, fetchImpl, now: () => clock.value, ...options })
    const segments: TransportSegmentEnvelope[] = []
    const errors: TransportError[] = []
    transport.on('segment', (e) => segments.push(e))
    transport.on('error', (e) => errors.push(e))
    await transport.open({ packageId: 'pkg', viewerAssetId: null, url: BUNDLE_URL })

    /** Requests one page and returns the envelopes it produced, one per channel. */
    const requestPage = async (channels: VirtualChannelRef[], overrides: Partial<PageRequest> = {}) => {
        const before = segments.length
        const req: PageRequest = { ...PAGE, minMax: true, channels, ...overrides }
        expect(transport.requestPage(req)).toBe(true)
        await vi.waitFor(() => {
            if (segments.length < before + channels.length) throw new Error('page not drained')
        }, { timeout: 5000 })
        await new Promise((r) => setTimeout(r, 20))
        return segments.slice(before)
    }
    const fetchCount = () => {
        const n = fetches
        fetches = 0
        return n
    }

    return {
        transport,
        clock,
        refused,
        errors,
        requestPage,
        fetchCount,
        async dispose() {
            await transport.close()
            disposeClient(registryKey)
        }
    }
}

describe('zarr transport: pages that cannot be read', () => {
    const rigs: Array<{ dispose(): Promise<void> }> = []
    afterEach(async () => {
        for (const rig of rigs.splice(0)) await rig.dispose()
    })

    it('reads the other channels when one channel of a group cannot be read', async () => {
        const rig = await makeRig()
        rigs.push(rig)
        rig.refused.add(channelPathPrefix(SINE_A.id))
        rig.fetchCount()

        const blocks = await rig.requestPage([SINE_A, SINE_B])

        expect(blocks).toHaveLength(2)
        const byId = new Map(blocks.map((b) => [blockOf(b).chId, b]))
        expect(blockOf(byId.get('sineB')!).nrPoints).toBeGreaterThan(0)
        expect(isNotice(byId.get('sineA')!)).toBe(true)
        expect(rig.errors.length).toBeGreaterThanOrEqual(1)
    })

    it('drains a failed page without a read until its cooldown passes, doubling per failure', async () => {
        const rig = await makeRig()
        rigs.push(rig)
        rig.refused.add(channelPathPrefix(SINE_A.id))

        await rig.requestPage([SINE_A])
        expect(rig.fetchCount()).toBeGreaterThan(0)

        // Inside the first cooldown: drained, nothing fetched.
        expect((await rig.requestPage([SINE_A])).every(isNotice)).toBe(true)
        expect(rig.fetchCount()).toBe(0)

        // Past the first cooldown: read again, fails again.
        rig.clock.value += FIRST_COOLDOWN_MS + 1
        expect((await rig.requestPage([SINE_A])).every(isNotice)).toBe(true)
        expect(rig.fetchCount()).toBeGreaterThan(0)

        // The second cooldown is twice as long, so the same step is still inside it.
        rig.clock.value += FIRST_COOLDOWN_MS + 1
        await rig.requestPage([SINE_A])
        expect(rig.fetchCount()).toBe(0)
        rig.clock.value += FIRST_COOLDOWN_MS
        await rig.requestPage([SINE_A])
        expect(rig.fetchCount()).toBeGreaterThan(0)
    })

    it('records a page as empty after repeated failures and stops reading it', async () => {
        const rig = await makeRig()
        rigs.push(rig)
        rig.refused.add(channelPathPrefix(SINE_A.id))

        let last: TransportSegmentEnvelope[] = []
        for (let attempt = 0; attempt < MAX_PAGE_FAILURES; attempt++) {
            rig.clock.value += MAX_COOLDOWN_MS + 1
            last = await rig.requestPage([SINE_A])
        }
        expect(last.every(isCachedEmpty)).toBe(true)
        expect(rig.errors[rig.errors.length - 1].error).toContain('Gave up on this page')

        rig.fetchCount()
        rig.clock.value += MAX_COOLDOWN_MS + 1
        expect((await rig.requestPage([SINE_A])).every(isCachedEmpty)).toBe(true)
        expect(rig.fetchCount()).toBe(0)
    })

    it('records a page the reader refuses outright as empty on the first attempt', async () => {
        // A raw page for two 1 kHz channels over 2 s is 16 kB, over this cap.
        const rig = await makeRig({ maxRawBytes: 1000 })
        rigs.push(rig)
        rig.fetchCount()

        const blocks = await rig.requestPage([SINE_A, SINE_B], { minMax: false })

        expect(blocks).toHaveLength(2)
        expect(blocks.every(isCachedEmpty)).toBe(true)
        expect(rig.fetchCount()).toBe(0)
        expect(rig.errors).toHaveLength(1)
        expect(rig.errors[0].error).toContain('over the')

        expect((await rig.requestPage([SINE_A, SINE_B], { minMax: false })).every(isCachedEmpty)).toBe(true)
        expect(rig.fetchCount()).toBe(0)
        expect(rig.errors).toHaveLength(1)
    })

    it('reads a recorded page again once the resolution changes', async () => {
        const rig = await makeRig({ maxRawBytes: 1000 })
        rigs.push(rig)
        await rig.requestPage([SINE_A, SINE_B], { minMax: false })
        rig.fetchCount()

        const blocks = await rig.requestPage([SINE_A, SINE_B], { pixelWidth: 4000 })

        expect(blocks.every((b) => blockOf(b).nrPoints! > 0)).toBe(true)
        expect(rig.fetchCount()).toBeGreaterThan(0)
    })

    it('forgets recorded pages when the transport closes', async () => {
        const rig = await makeRig({ maxRawBytes: 1000 })
        rigs.push(rig)
        await rig.requestPage([SINE_A, SINE_B], { minMax: false })

        await rig.transport.close()
        await rig.transport.open({ packageId: 'pkg', viewerAssetId: null, url: BUNDLE_URL })
        rig.fetchCount()
        rig.errors.length = 0

        await rig.requestPage([SINE_A, SINE_B], { minMax: false })
        expect(rig.errors).toHaveLength(1)
    })
})
