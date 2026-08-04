import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { StreamingClient } from '@pennsieve/timeseries-zarr-reader'
import { FileStore } from '@pennsieve/timeseries-zarr-reader/node'
import { buildCatalogIndex } from './channelDetails'
import { parseRequest, partitionRequest } from './translate'
import { buildContinuousSegm, buildNeuralSegm } from './segments'

/**
 * Exercises the adapter's request-to-block pipeline against the real committed bundle,
 * rather than against hand-built segments. The per-module tests pin each transform; this
 * pins that they compose into what the viewer actually consumes.
 *
 * Reads through FileStore because the suite runs in Node; the store is the only piece
 * swapped out relative to the browser, and store parity is covered by the reader's own tests.
 */
const BUNDLE = fileURLToPath(new URL('../../../../../test-data/sample-timeseries.zarr', import.meta.url))
const START = 1704067200000000
const SECOND = 1000000

/** Drives one page through the pipeline exactly as the shim does. */
async function runPage(client, catalogIndex, wire) {
    const req = parseRequest(wire)
    const { groups, unitTraces, invalid } = partitionRequest(req, catalogIndex, new Map())
    const blocks = []

    for (const group of groups) {
        const options = {
            startUs: req.startTime,
            endUs: req.endTime,
            pixelWidthUs: req.pixelWidth,
            raw: req.raw,
        }
        if (group.isMontage) {
            options.montage = group.montage
        } else {
            options.channels = group.channels
        }
        if (group.filterSpec) {
            options.filter = group.filterSpec
        }

        let index = 0
        for await (const segment of client.query(options)) {
            blocks.push(buildContinuousSegm(segment, group.traces[index], req, {}))
            index++
        }
    }

    for (const trace of unitTraces) {
        for await (const batch of client.queryUnits({
            channels: [trace.chId],
            startUs: req.startTime,
            endUs: req.endTime,
            pixelWidthUs: req.pixelWidth,
        })) {
            blocks.push(buildNeuralSegm(batch, trace, req))
        }
    }

    return { req, blocks, invalid }
}

describe('adapter pipeline against the committed bundle', () => {
    let client
    let catalogIndex

    beforeAll(async () => {
        client = new StreamingClient({ store: new FileStore(BUNDLE) })
        catalogIndex = buildCatalogIndex(await client.channelInfo())
    })

    it('maps the bundle catalog to flat viewer channel details', () => {
        expect(catalogIndex.details).toEqual([
            { id: 'sineA', name: 'Sine A', channelType: 'CONTINUOUS', rate: 1000, unit: 'uV', start: START, end: START + 30 * SECOND, properties: [] },
            { id: 'sineB', name: 'Sine B', channelType: 'CONTINUOUS', rate: 1000, unit: 'uV', start: START, end: START + 30 * SECOND, properties: [] },
            { id: 'noise', name: 'Noise', channelType: 'CONTINUOUS', rate: 1000, unit: 'uV', start: START, end: START + 30 * SECOND, properties: [] },
            { id: 'unitA', name: 'Unit A', channelType: 'UNIT', rate: 30000, unit: 'uV', start: START, end: START, properties: [] },
        ])
    })

    it('emits exactly one block per requested trace, keyed to the page', async () => {
        const { blocks } = await runPage(client, catalogIndex, {
            session: null,
            minMax: true,
            startTime: START,
            endTime: START + 15 * SECOND,
            packageId: 'pkg',
            pixelWidth: 20000,
            virtualChannels: [
                { id: 'sineA', name: 'Sine A' },
                { id: 'sineB', name: 'Sine B' },
                { id: 'unitA', name: 'Unit A' },
            ],
        })

        expect(blocks).toHaveLength(3)
        for (const block of blocks) {
            expect(block.pageStart).toBe(START)
            expect(block.pageEnd).toBe(START + 15 * SECOND)
            expect(block.cData).toHaveLength(3)
            expect(block.cData[0]).toHaveLength(block.nrPoints)
        }
        expect(blocks.map((b) => b.chId)).toEqual(['sineA', 'sineB', 'unitA'])
        // dataCallback matches on serverId AND label, so both must echo the request.
        expect(blocks.map((b) => b.label)).toEqual(['Sine A', 'Sine B', 'Unit A'])
        expect(blocks[2].type).toBe('Neural')
        // The fixture places 200 spikes at start + (i+1)*137 ms, so a 15 s page holds 109.
        expect(blocks[2].nrPoints).toBe(109)
        expect(blocks[2].parsedData[0][0]).toBe(START + 137000)
    })

    it('returns every spike when the window covers the whole recording', async () => {
        const { blocks } = await runPage(client, catalogIndex, {
            minMax: true,
            startTime: START,
            endTime: START + 30 * SECOND,
            pixelWidth: 60000,
            virtualChannels: [{ id: 'unitA', name: 'Unit A' }],
        })

        expect(blocks[0].nrPoints).toBe(200)
        expect(blocks[0].unit).toBe('uV')
        expect(blocks[0].startTs).toBe(START)
    })

    it('negates y values relative to the raw signal', async () => {
        const { blocks } = await runPage(client, catalogIndex, {
            minMax: false,
            startTime: START,
            endTime: START + 20000,
            pixelWidth: 1000,
            virtualChannels: [{ id: 'sineA', name: 'Sine A' }],
        })

        const block = blocks[0]
        expect(block.isMinMax).toBe(false)
        expect(block.nrPoints).toBe(20)
        for (let i = 0; i < block.nrPoints; i++) {
            const t = (i * block.samplePeriod) / 1e6
            // The fixture's sineA is 50*sin(2*pi*5*t); the block must carry its negation.
            expect(block.parsedData[1][i]).toBeCloseTo(-50 * Math.sin(2 * Math.PI * 5 * t), 4)
            expect(block.parsedData[0][i]).toBe(block.startTs + i * block.samplePeriod)
        }
        expect(block.nrValidPoints).toBe(20)
    })

    it('tiles adjacent pages with no duplicated timestamp and no hole', async () => {
        const pageSize = 7 * SECOND
        const wireFor = (pageStart) => ({
            minMax: true,
            startTime: pageStart,
            endTime: pageStart + pageSize,
            pixelWidth: 5000,
            virtualChannels: [{ id: 'sineA', name: 'Sine A' }],
        })

        const first = (await runPage(client, catalogIndex, wireFor(START))).blocks[0]
        const second = (await runPage(client, catalogIndex, wireFor(START + pageSize))).blocks[0]

        expect(first.nrPoints).toBeGreaterThan(0)
        expect(second.nrPoints).toBeGreaterThan(0)

        // Each page keeps only bins starting inside its own half-open window.
        for (const [block, pageStart] of [[first, START], [second, START + pageSize]]) {
            for (let i = 0; i < block.nrPoints; i++) {
                expect(block.parsedData[0][i]).toBeGreaterThanOrEqual(pageStart)
                expect(block.parsedData[0][i]).toBeLessThan(pageStart + pageSize)
            }
        }

        const lastOfFirst = first.parsedData[0][first.nrPoints - 1]
        const firstOfSecond = second.parsedData[0][0]
        expect(firstOfSecond).toBeGreaterThan(lastOfFirst)
        expect(firstOfSecond - lastOfFirst).toBeCloseTo(first.samplePeriod, 6)
    })

    it('routes a montaged request through the reader and echoes the viewer identity', async () => {
        const { blocks, invalid } = await runPage(client, catalogIndex, {
            minMax: true,
            startTime: START,
            endTime: START + SECOND,
            pixelWidth: 4000,
            virtualChannels: [{ id: 'sineA', name: 'Sine A<->Sine B' }],
        })

        expect(invalid).toHaveLength(0)
        expect(blocks).toHaveLength(1)
        // Identity is the viewer's, never the reader's compound montage key.
        expect(blocks[0].chId).toBe('sineA')
        expect(blocks[0].label).toBe('Sine A<->Sine B')
        expect(blocks[0].nrPoints).toBeGreaterThan(0)
    })

    it('reports an unresolvable channel as invalid instead of throwing', async () => {
        const { blocks, invalid } = await runPage(client, catalogIndex, {
            minMax: true,
            startTime: START,
            endTime: START + SECOND,
            pixelWidth: 4000,
            virtualChannels: [
                { id: 'sineA', name: 'Sine A' },
                { id: 'ghost', name: 'Ghost' },
            ],
        })

        expect(blocks).toHaveLength(1)
        expect(invalid).toHaveLength(1)
        expect(invalid[0].identity.chId).toBe('ghost')
        expect(invalid[0].reason).toMatch(/ghost/i)
    })

    it('yields no points for a window past the end of the recording', async () => {
        const { blocks } = await runPage(client, catalogIndex, {
            minMax: true,
            startTime: START + 60 * SECOND,
            endTime: START + 75 * SECOND,
            pixelWidth: 20000,
            virtualChannels: [{ id: 'sineA', name: 'Sine A' }],
        })

        expect(blocks).toHaveLength(1)
        expect(blocks[0].nrPoints).toBe(0)
        expect(blocks[0].pageStart).toBe(START + 60 * SECOND)
    })
})
