import { describe, expect, it, vi } from 'vitest'
import { createEmitter, unscopedViewerEmitter, useViewerEmitter } from '@/events/emitter'
import type { ViewerEvents } from '@/events/emitter'

describe('createEmitter', () => {
    it('delivers a payload to every listener of that event', () => {
        const emitter = createEmitter<ViewerEvents>()
        const first = vi.fn()
        const second = vi.fn()
        emitter.on('toast', first)
        emitter.on('toast', second)

        emitter.emit('toast', { detail: { msg: 'saved' } })

        expect(first).toHaveBeenCalledTimes(1)
        expect(first).toHaveBeenCalledWith({ detail: { msg: 'saved' } })
        expect(second).toHaveBeenCalledTimes(1)
    })

    it('delivers nothing to a listener of another event', () => {
        const emitter = createEmitter<ViewerEvents>()
        const onAjaxError = vi.fn()
        emitter.on('ajaxError', onAjaxError)

        emitter.emit('toast', { msg: 'saved' })

        expect(onAjaxError).not.toHaveBeenCalled()
    })

    it('emits to no listener when the event has none', () => {
        const emitter = createEmitter<ViewerEvents>()

        expect(() => emitter.emit('toast', { msg: 'saved' })).not.toThrow()
    })

    it('stops delivery once the function on returned runs', () => {
        const emitter = createEmitter<ViewerEvents>()
        const listener = vi.fn()
        const unsubscribe = emitter.on('toast', listener)

        unsubscribe()
        emitter.emit('toast', { msg: 'saved' })

        expect(listener).not.toHaveBeenCalled()
    })

    it('keeps the other listener when one unsubscribes', () => {
        const emitter = createEmitter<ViewerEvents>()
        const kept = vi.fn()
        const dropped = vi.fn()
        emitter.on('toast', kept)
        const unsubscribe = emitter.on('toast', dropped)

        unsubscribe()
        emitter.emit('toast', { msg: 'saved' })

        expect(kept).toHaveBeenCalledTimes(1)
        expect(dropped).not.toHaveBeenCalled()
    })

    it('delivers to a listener that unsubscribes during the same emit', () => {
        const emitter = createEmitter<ViewerEvents>()
        const second = vi.fn()
        const unsubscribes: Array<() => void> = []
        const first = vi.fn(() => {
            unsubscribes.forEach((unsubscribe) => unsubscribe())
        })
        unsubscribes.push(emitter.on('toast', first))
        unsubscribes.push(emitter.on('toast', second))

        emitter.emit('toast', { msg: 'saved' })

        expect(first).toHaveBeenCalledTimes(1)
        expect(second).toHaveBeenCalledTimes(1)
    })

    it('drops every listener of every event on clear', () => {
        const emitter = createEmitter<ViewerEvents>()
        const onToast = vi.fn()
        const onAjaxError = vi.fn()
        emitter.on('toast', onToast)
        emitter.on('ajaxError', onAjaxError)

        emitter.clear()
        emitter.emit('toast', { msg: 'saved' })
        emitter.emit('ajaxError', { detail: { type: 'error', msg: 'failed' } })

        expect(onToast).not.toHaveBeenCalled()
        expect(onAjaxError).not.toHaveBeenCalled()
    })

    it('accepts listeners again after clear', () => {
        const emitter = createEmitter<ViewerEvents>()
        emitter.on('toast', vi.fn())
        emitter.clear()

        const listener = vi.fn()
        emitter.on('toast', listener)
        emitter.emit('toast', { msg: 'saved' })

        expect(listener).toHaveBeenCalledTimes(1)
    })

    it('delivers an event to its own listeners only', () => {
        const first = createEmitter<ViewerEvents>()
        const second = createEmitter<ViewerEvents>()
        const onFirst = vi.fn()
        const onSecond = vi.fn()
        first.on('toast', onFirst)
        second.on('toast', onSecond)

        first.emit('toast', { msg: 'from the first viewer' })

        expect(onFirst).toHaveBeenCalledTimes(1)
        expect(onSecond).not.toHaveBeenCalled()
    })

    it('leaves the listeners of another emitter in place on clear', () => {
        const first = createEmitter<ViewerEvents>()
        const second = createEmitter<ViewerEvents>()
        const onSecond = vi.fn()
        second.on('toast', onSecond)

        first.clear()
        second.emit('toast', { msg: 'saved' })

        expect(onSecond).toHaveBeenCalledTimes(1)
    })
})

describe('useViewerEmitter', () => {
    it('returns the unscoped emitter outside a component', () => {
        expect(useViewerEmitter()).toBe(unscopedViewerEmitter)
    })
})
