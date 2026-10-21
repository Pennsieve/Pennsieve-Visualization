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

/** First retry after a failed renewal; doubles per consecutive failure up to MAX_RETRY_MS. */
const RETRY_MS = 30 * 1000
const MAX_RETRY_MS = 10 * 60 * 1000

/**
 * Never renew again sooner than this after a renewal, even if the new policy is already
 * near expiry (a client clock far ahead, or a backend reusing a policy). Without it the
 * next renewal would be scheduled immediately, over and over.
 */
const MIN_RENEW_INTERVAL_MS = 60 * 1000

/** setTimeout fires immediately for delays longer than this (~24.8 days). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1

/** HTTP statuses a retry won't fix: the asset is gone or access has changed. */
const PERMANENT_STATUSES = [401, 403, 404]

function isPermanentFailure(e: unknown): boolean {
  const { status, permanent } = (e ?? {}) as { status?: number; permanent?: boolean }
  return permanent === true || (status !== undefined && PERMANENT_STATUSES.includes(status))
}

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
 * A failed renewal is retried with backoff (30 s doubling to 10 min). Failures a retry won't
 * fix -- 401/403/404, or a renewal that comes back with no credentials -- stop the schedule;
 * the next attempt is when the tab becomes visible again, `refresh()` is called, or new
 * credentials arrive from outside.
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
  let failures = 0

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function scheduleIn(delayMs: number) {
    clearTimer()
    timer = setTimeout(refresh, Math.min(Math.max(0, delayMs), MAX_TIMEOUT_MS))
  }

  function scheduleFromExpiry(minDelayMs = 0) {
    const expiresAt = cloudfrontExpiryMs(cloudfront.value)
    if (expiresAt === null) {
      clearTimer()
      return
    }
    scheduleIn(Math.max(expiresAt - REFRESH_MARGIN_MS - Date.now(), minDelayMs))
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
          // Public data has nothing to renew
          if (!hasCloudfrontCredentials(cloudfront.value)) {
            clearTimer()
            return
          }
          throw Object.assign(new Error('Renewal returned no CloudFront credentials'), {
            permanent: true,
          })
        }
        cloudfront.value = { ...next }
        error.value = null
        failures = 0
        scheduleFromExpiry(MIN_RENEW_INTERVAL_MS)
      } catch (e) {
        if (gen !== generation) return
        error.value = `Credential refresh failed: ${e instanceof Error ? e.message : String(e)}`
        if (isPermanentFailure(e)) {
          clearTimer()
          return
        }
        failures++
        scheduleIn(Math.min(RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS))
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
      failures = 0
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
