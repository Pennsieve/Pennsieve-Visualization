// Messages a viewer raises about itself, delivered inside that viewer only.
//
// TSViewer creates one emitter per instance and provides it to its subtree.
// Two viewers mounted on one page each keep their own listeners, so a toast
// raised in one of them is rendered once, by that viewer.
import type { InjectionKey } from 'vue'
import { getCurrentInstance, inject, provide } from 'vue'

/**
 * Text and display options of a user-visible message.
 *
 * Both fields carry the text: every emit site in this package fills
 * `detail.msg`, and a top-level `msg` takes precedence over it. `type` is an
 * element-plus message type, lowercased before use. `duration` is in
 * milliseconds. The text is rendered as HTML.
 */
export interface ViewerMessage {
    msg?: string
    detail?: {
        msg?: string
        type?: string
        showClose?: boolean
        duration?: number
    }
}

/** The events a viewer raises, with the payload each one carries. */
export interface ViewerEvents {
    toast: ViewerMessage
    /** A request failed. Rendered the same way a toast is. */
    ajaxError: ViewerMessage
}

export interface Emitter<E> {
    /** Returns a function that removes this listener. */
    on<K extends keyof E>(event: K, listener: (payload: E[K]) => void): () => void
    emit<K extends keyof E>(event: K, payload: E[K]): void
    /** Drops every listener of every event. */
    clear(): void
}

/** An emitter with no listeners. Its events reach no other emitter. */
export function createEmitter<E>(): Emitter<E> {
    type Listeners = { [K in keyof E]?: Set<(payload: E[K]) => void> }
    let listeners: Listeners = {}

    const on = <K extends keyof E>(event: K, listener: (payload: E[K]) => void): (() => void) => {
        const set = listeners[event] ?? new Set<(payload: E[K]) => void>()
        listeners[event] = set
        set.add(listener)
        return () => {
            set.delete(listener)
        }
    }

    const emit = <K extends keyof E>(event: K, payload: E[K]): void => {
        const set = listeners[event]
        if (!set) {
            return
        }
        // Copied before delivery: a listener is free to unsubscribe here.
        for (const listener of Array.from(set)) {
            listener(payload)
        }
    }

    const clear = (): void => {
        listeners = {}
    }

    return { on, emit, clear }
}

export type ViewerEmitter = Emitter<ViewerEvents>

export const ViewerEmitterKey: InjectionKey<ViewerEmitter> = Symbol('tsviewer-emitter')

export function provideViewerEmitter(emitter: ViewerEmitter): void {
    provide(ViewerEmitterKey, emitter)
}

/**
 * The one emitter for messages raised with no viewer in context.
 *
 * A failure reported from an async catch block has no current component, so
 * `inject` cannot reach a provider and the viewer that made the request cannot
 * be identified. Those messages travel here and every mounted viewer renders
 * them, which is what the module-level bus did for all messages. The fallback
 * exists for that case alone.
 */
export const unscopedViewerEmitter: ViewerEmitter = createEmitter<ViewerEvents>()

/**
 * The owning viewer's emitter, or `unscopedViewerEmitter` when there is none.
 *
 * A component never injects what it provides itself: Vue resolves `inject`
 * against the parent, so the providing TSViewer must hand its emitter to its
 * own listeners directly.
 */
export function useViewerEmitter(): ViewerEmitter {
    // Outside setup `inject` warns and returns the default, so the caller's
    // component is checked first.
    if (!getCurrentInstance()) {
        return unscopedViewerEmitter
    }
    return inject(ViewerEmitterKey, unscopedViewerEmitter)
}
