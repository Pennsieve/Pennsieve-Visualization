// Shared conformance suite both transport implementations run. The assertions
// here ARE the transport contract; a new backend passes this suite or it does
// not ship.
import { describe, it, expect, vi } from 'vitest'
import type {
    TimeseriesTransport,
    TransportOpenOptions,
    TransportSegmentEnvelope,
    VirtualChannelRef,
    PageRequest,
} from '../TimeseriesTransport'
import type { ChannelDetail } from '@/composables/streaming/channelDetails'

export interface TransportHarness {
    transport: TimeseriesTransport
    openOptions: TransportOpenOptions
    /** Channels the backend has data for; at least two. */
    channels: VirtualChannelRef[]
    /** A channel the backend yields no data for in the requested page. */
    emptyChannel?: VirtualChannelRef
    /** Whether this backend drains empty channels with gap envelopes. */
    drainsEmptyChannel: boolean
    /** A page range the backend has data for, microseconds. */
    page: { startTime: number; endTime: number; pixelWidth: number }
    dispose(): Promise<void>
}

interface LooseBlock {
    chId?: string
    source?: string
    label?: string
    name?: string
    requestedSamplePeriod?: number
}

function channelKey(envelope: TransportSegmentEnvelope): string {
    const data = (envelope as { data?: LooseBlock }).data
    return data?.chId ?? data?.source ?? data?.label ?? data?.name ?? 'unknown'
}

function collectEnvelopes(transport: TimeseriesTransport): TransportSegmentEnvelope[] {
    const seen: TransportSegmentEnvelope[] = []
    transport.on('segment', (e) => seen.push(e))
    transport.on('event', (e) => seen.push(e))
    return seen
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
    await vi.waitFor(() => {
        if (!predicate()) throw new Error(`timed out waiting for ${what}`)
    }, { timeout: timeoutMs })
}

export function runTransportConformance(
    name: string,
    makeHarness: () => Promise<TransportHarness>,
): void {
    describe(`transport conformance: ${name}`, () => {
        it('opens, reports connected, and emits channelDetails once with flat rows', async () => {
            const h = await makeHarness()
            try {
                const detailBatches: ChannelDetail[][] = []
                h.transport.on('channelDetails', (d) => detailBatches.push(d))
                await h.transport.open(h.openOptions)
                expect(h.transport.status.value).toBe('connected')
                await waitFor(() => detailBatches.length >= 1, 'channelDetails')
                expect(detailBatches).toHaveLength(1)
                expect(Array.isArray(detailBatches[0])).toBe(true)
                const ids = detailBatches[0].map((d) => d.id)
                for (const ch of h.channels) expect(ids).toContain(ch.id)
            } finally {
                await h.dispose()
            }
        })

        it('rejects requestPage before open with false and no emissions', async () => {
            const h = await makeHarness()
            try {
                const seen = collectEnvelopes(h.transport)
                const ok = h.transport.requestPage(makeRequest(h))
                expect(ok).toBe(false)
                await new Promise((r) => setTimeout(r, 20))
                expect(seen).toHaveLength(0)
            } finally {
                await h.dispose()
            }
        })

        it('returns from requestPage before any handler fires', async () => {
            const h = await makeHarness()
            try {
                await h.transport.open(h.openOptions)
                let fired = false
                h.transport.on('segment', () => { fired = true })
                h.transport.on('event', () => { fired = true })
                const ok = h.transport.requestPage(makeRequest(h))
                expect(ok).toBe(true)
                // Synchronous window: nothing may have fired yet.
                expect(fired).toBe(false)
            } finally {
                await h.dispose()
            }
        })

        it('answers exactly one envelope per requested channel for a page', async () => {
            const h = await makeHarness()
            try {
                await h.transport.open(h.openOptions)
                const seen = collectEnvelopes(h.transport)
                const req = makeRequest(h)
                expect(h.transport.requestPage(req)).toBe(true)
                await waitFor(() => seen.length >= h.channels.length, 'one envelope per channel')
                // Settle: no extra envelopes trickle in.
                await new Promise((r) => setTimeout(r, 50))
                const byChannel = new Map<string, number>()
                for (const e of seen) {
                    const key = channelKey(e)
                    byChannel.set(key, (byChannel.get(key) ?? 0) + 1)
                }
                expect(seen).toHaveLength(h.channels.length)
                for (const count of byChannel.values()) expect(count).toBe(1)
            } finally {
                await h.dispose()
            }
        })

        it('echoes pageStart and requestedSamplePeriod exactly', async () => {
            const h = await makeHarness()
            try {
                await h.transport.open(h.openOptions)
                const seen = collectEnvelopes(h.transport)
                const req = makeRequest(h)
                h.transport.requestPage(req)
                await waitFor(() => seen.length >= h.channels.length, 'envelopes')
                for (const e of seen) {
                    expect(e.pageStart).toBe(req.startTime)
                    const data = (e as { data?: LooseBlock }).data
                    if (data?.requestedSamplePeriod !== undefined) {
                        expect(data.requestedSamplePeriod).toBe(req.pixelWidth)
                    }
                }
            } finally {
                await h.dispose()
            }
        })

        it('drains a channel with no data instead of leaving its page pending', async () => {
            const h = await makeHarness()
            if (!h.emptyChannel || !h.drainsEmptyChannel) {
                await h.dispose()
                return
            }
            try {
                await h.transport.open(h.openOptions)
                const seen = collectEnvelopes(h.transport)
                const req: PageRequest = { ...makeRequest(h), channels: [h.emptyChannel] }
                h.transport.requestPage(req)
                await waitFor(() => seen.length >= 1, 'gap envelope for the empty channel')
                expect(seen).toHaveLength(1)
                expect(seen[0].pageStart).toBe(req.startTime)
            } finally {
                await h.dispose()
            }
        })

        it('accepts a re-request for the same page after dumpBuffer', async () => {
            const h = await makeHarness()
            try {
                await h.transport.open(h.openOptions)
                const seen = collectEnvelopes(h.transport)
                const req = makeRequest(h)
                h.transport.requestPage(req)
                expect(h.transport.dumpBuffer()).toBe(true)
                const before = seen.length
                expect(h.transport.requestPage(req)).toBe(true)
                await waitFor(() => seen.length >= before + h.channels.length, 're-request envelopes')
                const fresh = seen.slice(before)
                for (const e of fresh) expect(e.pageStart).toBe(req.startTime)
            } finally {
                await h.dispose()
            }
        })

        it('answers a montage switch with a channelDetails emission', async () => {
            const h = await makeHarness()
            try {
                const detailBatches: ChannelDetail[][] = []
                h.transport.on('channelDetails', (d) => detailBatches.push(d))
                await h.transport.open(h.openOptions)
                await waitFor(() => detailBatches.length >= 1, 'initial channelDetails')
                h.transport.setMontage({
                    montage: 'NOT_MONTAGED',
                    packageId: h.openOptions.packageId,
                    montageMap: [],
                })
                await waitFor(() => detailBatches.length >= 2, 'montage channelDetails reply')
            } finally {
                await h.dispose()
            }
        })

        it('closes idempotently and can open again', async () => {
            const h = await makeHarness()
            try {
                await h.transport.open(h.openOptions)
                await h.transport.close()
                await h.transport.close()
                expect(h.transport.status.value).toBe('disconnected')
                await h.transport.open(h.openOptions)
                expect(h.transport.status.value).toBe('connected')
                const seen = collectEnvelopes(h.transport)
                h.transport.requestPage(makeRequest(h))
                await waitFor(() => seen.length >= h.channels.length, 'envelopes after reopen')
            } finally {
                await h.dispose()
            }
        })
    })
}

function makeRequest(h: TransportHarness): PageRequest {
    return {
        startTime: h.page.startTime,
        endTime: h.page.endTime,
        pixelWidth: h.page.pixelWidth,
        minMax: true,
        channels: h.channels,
    }
}
