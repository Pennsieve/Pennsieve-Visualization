import emitter from 'tiny-emitter/instance'

interface EventBusApi {
    $emit(event: string, ...args: unknown[]): void
    $on(event: string, callback: (...args: any[]) => void, ctx?: unknown): void
    $off(event: string, callback?: (...args: any[]) => void): void
    $once(event: string, callback: (...args: any[]) => void, ctx?: unknown): void
}

const EventBus: EventBusApi = {
    $emit: (...args) => emitter.emit(...args),
    $on: (...args) => emitter.on(...args),
    $off: (...args) => emitter.off(...args),
    $once: (...args) => emitter.once(...args),
}

export default EventBus
