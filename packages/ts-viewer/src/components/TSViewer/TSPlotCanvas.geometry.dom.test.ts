// The plot canvas mounted on its own, to pin the relation between its backing store and
// the CSS box it is drawn into. The full TSViewer tree cannot carry these assertions:
// happy-dom reports no layout, so cHeight arrives as NaN through the real measure path.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { shallowRef } from 'vue'
import TSPlotCanvas from '@/components/TSViewer/TSPlotCanvas.vue'
import { ViewerTransportKey } from '@/state/viewerTransportContext'

const C_HEIGHT = 400
const C_WIDTH = 900

// TSPlotCanvas subtracts 20 from cHeight for the axis strip below the plot.
const P_HEIGHT = C_HEIGHT - 20

describe('plot canvas geometry', () => {
    let wrapper: VueWrapper | null = null

    afterEach(() => {
        wrapper?.unmount()
        wrapper = null
        vi.unstubAllGlobals()
        document.body.innerHTML = ''
    })

    async function mountCanvas(devicePixelRatio: number) {
        vi.stubGlobal('devicePixelRatio', devicePixelRatio)
        setActivePinia(createPinia())
        wrapper = mount(TSPlotCanvas, {
            props: {
                cHeight: C_HEIGHT,
                cWidth: C_WIDTH,
                start: 0,
                duration: 15_000_000,
                constants: { XOFFSET: 0, USEMEDIAN: false, PREFETCHPAGES: 2 },
                rsPeriod: 1000,
                ts_start: 0,
                ts_end: 60_000_000,
                globalZoomMult: 1,
                activeViewer: { channels: [] }
            },
            global: { provide: { [ViewerTransportKey as symbol]: shallowRef(null) } },
            attachTo: document.body
        })
        await flushPromises()
        return wrapper.findAll('canvas')
    }

    it('sizes the backing store to the CSS box times the device pixel ratio', async () => {
        const canvases = await mountCanvas(2)
        expect(canvases).toHaveLength(2)
        for (const canvas of canvases) {
            const el = canvas.element as HTMLCanvasElement
            expect(el.style.height).toBe(`${P_HEIGHT}px`)
            expect(el.style.width).toBe(`${C_WIDTH}px`)
            expect(el.height).toBe(2 * P_HEIGHT)
            expect(el.width).toBe(2 * C_WIDTH)
        }
    })

    it('follows a device pixel ratio of one', async () => {
        const canvases = await mountCanvas(1)
        const el = canvases[0].element as HTMLCanvasElement
        expect(el.height).toBe(P_HEIGHT)
        expect(el.width).toBe(C_WIDTH)
    })
})
