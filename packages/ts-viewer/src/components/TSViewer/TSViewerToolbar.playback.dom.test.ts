// The toolbar mounted on its own, to pin what playback emits. The full TSViewer tree
// drives the same button, but the timer needs fake clocks and the tree's other timers
// do not survive them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TSViewerToolbar from '@/components/TSViewer/TSViewerToolbar.vue'
import { MAX_PLAYBACK_STEP_US, MIN_PLAYBACK_TICK_MS, PLAYBACK_TICK_MS } from '@/utils/playbackStep'

const TS_START = 0
const TS_END = 600_000_000

describe('toolbar playback', () => {
    let wrapper: VueWrapper | null = null

    beforeEach(() => {
        vi.useFakeTimers()
        setActivePinia(createPinia())
    })

    afterEach(() => {
        wrapper?.unmount()
        wrapper = null
        vi.useRealTimers()
        document.body.innerHTML = ''
    })

    async function mountToolbar(duration: number, start = TS_START, tsEnd: number | null = TS_END) {
        wrapper = mount(TSViewerToolbar, {
            props: { maxDuration: TS_END, duration, start, globalZoomMult: 1, tsEnd },
            attachTo: document.body
        })
        await flushPromises()
        return wrapper
    }

    /**
     * Clicks play, runs `ticks` timer firings, and returns the starts emitted.
     *
     * Each emitted start is written back as the prop, which is what the parent does.
     * Without it every tick reads the same start and steps from the same place.
     */
    async function play(ticks: number): Promise<number[]> {
        await wrapper!.find('button[name="playback-toggle"]').trigger('click')
        const starts: number[] = []
        for (let i = 0; i < ticks; i++) {
            await vi.advanceTimersByTimeAsync(PLAYBACK_TICK_MS)
            const emitted = (wrapper!.emitted('setStart') ?? []) as number[][]
            if (emitted.length > starts.length) {
                const next = emitted[emitted.length - 1][0]
                starts.push(next)
                await wrapper!.setProps({ start: next })
            }
        }
        return starts
    }

    it('steps the fixed second at a window wider than the step', async () => {
        await mountToolbar(15_000_000)
        const starts = await play(2)

        expect(starts[0]).toBe(TS_START + MAX_PLAYBACK_STEP_US)
        expect(starts[1]).toBe(TS_START + 2 * MAX_PLAYBACK_STEP_US)
    })

    it('steps less than the window at a span narrower than the fixed second', async () => {
        const duration = 100_000
        await mountToolbar(duration)
        const starts = await play(3)

        expect(starts.length).toBeGreaterThan(0)
        let previous = TS_START
        for (const start of starts) {
            expect(start - previous).toBeLessThanOrEqual(duration)
            previous = start
        }
    })

    it('advances no faster than the base period at 1x', async () => {
        await mountToolbar(15_000_000)
        await wrapper!.find('button[name="playback-toggle"]').trigger('click')

        await vi.advanceTimersByTimeAsync(PLAYBACK_TICK_MS - 1)
        expect(wrapper!.emitted('setStart')).toBeUndefined()

        await vi.advanceTimersByTimeAsync(1)
        expect(wrapper!.emitted('setStart')).toHaveLength(1)
    })

    it('ticks at the floor period at the fastest speed', async () => {
        await mountToolbar(15_000_000)
        ;(wrapper!.vm as unknown as { selectedPlaySpeed: number }).selectedPlaySpeed = 10
        await flushPromises()

        await wrapper!.find('button[name="playback-toggle"]').trigger('click')
        await vi.advanceTimersByTimeAsync(MIN_PLAYBACK_TICK_MS)

        expect(wrapper!.emitted('setStart')).toHaveLength(1)
    })

    it('stops at the last start the recording allows', async () => {
        const duration = 15_000_000
        await mountToolbar(duration, TS_END - duration - 500_000)
        const starts = await play(4)

        expect(starts[starts.length - 1]).toBe(TS_END - duration)
        // No tick runs after the one that reached the end.
        await vi.advanceTimersByTimeAsync(PLAYBACK_TICK_MS * 4)
        expect(wrapper!.emitted('setStart')).toHaveLength(starts.length)
    })

    it('runs no timer after the toolbar unmounts', async () => {
        await mountToolbar(15_000_000)
        await wrapper!.find('button[name="playback-toggle"]').trigger('click')
        await vi.advanceTimersByTimeAsync(PLAYBACK_TICK_MS)
        expect(vi.getTimerCount()).toBeGreaterThan(0)

        wrapper!.unmount()
        await vi.advanceTimersByTimeAsync(PLAYBACK_TICK_MS * 5)

        expect(vi.getTimerCount()).toBe(0)
    })
})
