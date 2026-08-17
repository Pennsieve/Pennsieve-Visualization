// utils/throttle.ts
export interface ThrottleOptions {
    leading?: boolean
    trailing?: boolean
}

export interface Throttled<A extends unknown[], R> {
    (...args: A): R | undefined
    cancel(): void
}

export function createThrottle<A extends unknown[], R>(
    func: (...args: A) => R,
    wait: number,
    options: ThrottleOptions = {},
): Throttled<A, R> {
    let args: A | null = null
    let result: R | undefined
    let timeout: ReturnType<typeof setTimeout> | null = null
    let previous = 0

    const { leading = true, trailing = true } = options

    const later = function() {
        previous = leading === false ? 0 : Date.now()
        timeout = null
        result = func(...(args as A))
        if (!timeout) args = null
    }

    const throttled = function(...callArgs: A) {
        const now = Date.now()
        if (!previous && leading === false) previous = now

        const remaining = wait - (now - previous)
        args = callArgs

        if (remaining <= 0 || remaining > wait) {
            if (timeout) {
                clearTimeout(timeout)
                timeout = null
            }
            previous = now
            result = func(...(args as A))
            if (!timeout) args = null
        } else if (!timeout && trailing !== false) {
            timeout = setTimeout(later, remaining)
        }

        return result
    } as Throttled<A, R>

    throttled.cancel = function() {
        if (timeout) clearTimeout(timeout)
        previous = 0
        timeout = args = null
    }

    return throttled
}
