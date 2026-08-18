// happy-dom has no canvas implementation. Every 2d context is a bag of spies,
// one bag per canvas element, so tests can count draw calls per canvas.
// Assertions may count calls; they must never inspect coordinates or pixels.
import { vi } from 'vitest'

export interface Stub2dContext {
    [method: string]: ReturnType<typeof vi.fn> | unknown
}

const contexts = new WeakMap<HTMLCanvasElement, Stub2dContext>()

function makeContext(canvas: HTMLCanvasElement): Stub2dContext {
    const gradient = { addColorStop: vi.fn() }
    return {
        canvas,
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        rect: vi.fn(),
        arc: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        clearRect: vi.fn(),
        clip: vi.fn(),
        fillText: vi.fn(),
        strokeText: vi.fn(),
        measureText: vi.fn(() => ({ width: 10 })),
        setLineDash: vi.fn(),
        translate: vi.fn(),
        scale: vi.fn(),
        rotate: vi.fn(),
        setTransform: vi.fn(),
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
        putImageData: vi.fn(),
        createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
        createLinearGradient: vi.fn(() => gradient),
        createPattern: vi.fn(() => null),
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        fillStyle: '#000',
        strokeStyle: '#000',
        lineWidth: 1,
        font: '10px sans-serif',
        textAlign: 'left',
        textBaseline: 'alphabetic',
    }
}

HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    let ctx = contexts.get(this)
    if (!ctx) {
        ctx = makeContext(this)
        contexts.set(this, ctx)
    }
    return ctx
} as unknown as typeof HTMLCanvasElement.prototype.getContext

/** The spy context for a canvas, for draw-call counting in tests. */
export function contextFor(canvas: HTMLCanvasElement): Stub2dContext {
    return canvas.getContext('2d') as unknown as Stub2dContext
}
