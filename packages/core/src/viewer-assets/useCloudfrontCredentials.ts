import { ref, shallowRef, unref, watch, onScopeDispose, type Ref } from 'vue'
import {
  cloudfrontExpiryMs,
  hasCloudfrontCredentials,
  type CloudfrontCredentials,
} from './cloudfront'

/** A plain value, a ref, or a getter. (Vue's own `MaybeRefOrGetter` needs 3.3+.) */
export type Source<T> = T | Ref<T> | (() => T)

export function readSource<T>(source: Source<T>): T {
  return typeof source === 'function' ? (source as () => T)() : unref(source)
}

/** Renew this far ahead of a signature's expiry. CloudFront policies here last an hour. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

/** Wait this long before trying again after a failed renewal. */
const RETRY_MS = 30 * 1000

export interface UseCloudfrontCredentialsOptions {
  /** Credentials the asset was loaded with. A change resets the schedule. */
  initial: Source<CloudfrontCredentials | null | undefined>
  /**
   * Fetches fresh credentials. This is just the same assets request again -- for private
   * data, pass a token getter through to it rather than a stored token.
   */
  renew: () => Promise<CloudfrontCredentials | null | undefined>
}

/**
 * Keeps CloudFront credentials valid for as long as the calling component lives.
 *
 * Renewal is timed from the expiry inside the signed `Policy`, a few minutes early, and is
 * re-checked when a backgrounded tab becomes visible (timers are throttled or paused while
 * hidden, so a laptop that slept past the expiry would otherwise wait for its next tick).
 * Credentials with no readable expiry, or none at all for a public bucket, are never renewed.
 *
 * Each renewal assigns a new object, so `watch`ers on `cloudfront` -- such as
 * `OrthogonalFrame`'s, which forwards it to the embedded viewer -- see the change.
 */
export function useCloudfrontCredentials({ initial, renew }: UseCloudfrontCredentialsOptions) {
  const cloudfront = shallowRef<CloudfrontCredentials | null>(readSource(initial) ?? null)
  const refreshing = ref(false)
  const error = ref<string | null>(null)

  let timer: ReturnType<typeof setTimeout> | undefined
  // Bumped whenever the credentials are replaced from outside, so a renewal that was already
  // in flight for the previous asset cannot overwrite them.
  let generation = 0
  let inFlight: Promise<void> | null = null

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function scheduleIn(delayMs: number) {
    clearTimer()
    timer = setTimeout(refresh, Math.max(0, delayMs))
  }

  function scheduleFromExpiry() {
    const expiresAt = cloudfrontExpiryMs(cloudfront.value)
    if (expiresAt === null) {
      clearTimer()
      return
    }
    scheduleIn(expiresAt - REFRESH_MARGIN_MS - Date.now())
  }

  function isExpiring() {
    const expiresAt = cloudfrontExpiryMs(cloudfront.value)
    return expiresAt !== null && Date.now() >= expiresAt - REFRESH_MARGIN_MS
  }

  function refresh(): Promise<void> {
    if (inFlight) return inFlight

    const gen = generation
    refreshing.value = true
    let run: Promise<void> | undefined
    run = (async () => {
      try {
        const next = await renew()
        if (gen !== generation) return
        if (!hasCloudfrontCredentials(next)) {
          throw new Error('Renewal returned no CloudFront credentials')
        }
        cloudfront.value = { ...next }
        error.value = null
        scheduleFromExpiry()
      } catch (e) {
        if (gen !== generation) return
        error.value = `Credential refresh failed: ${e instanceof Error ? e.message : String(e)}`
        scheduleIn(RETRY_MS)
      } finally {
        if (inFlight === run) {
          inFlight = null
          refreshing.value = false
        }
      }
    })()
    inFlight = run
    return run
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && isExpiring()) refresh()
  }

  watch(
    () => readSource(initial),
    (next) => {
      generation++
      inFlight = null
      refreshing.value = false
      error.value = null
      cloudfront.value = next ?? null
      scheduleFromExpiry()
    },
  )

  scheduleFromExpiry()
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  onScopeDispose(() => {
    generation++
    clearTimer()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  })

  return { cloudfront, refreshing, error, refresh }
}
