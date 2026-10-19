/**
 * CloudFront signing credentials as returned by the Pennsieve assets endpoints.
 *
 * They are signed at the asset prefix, so one set covers every object under an asset URL.
 * They expire (an hour, currently); renewing means asking the same endpoint again, not
 * re-authenticating.
 */
export interface CloudfrontCredentials {
  policy: string
  signature: string
  key_pair_id: string
}

/** Whether all three signing fields are present. A public bucket returns none. */
export function hasCloudfrontCredentials(
  cf: Partial<CloudfrontCredentials> | null | undefined,
): cf is CloudfrontCredentials {
  return !!(cf?.policy && cf?.signature && cf?.key_pair_id)
}

/** `Policy=…&Signature=…&Key-Pair-Id=…`, without a leading `?`. */
export function cloudfrontQuery(cf: CloudfrontCredentials): string {
  return `Policy=${cf.policy}&Signature=${cf.signature}&Key-Pair-Id=${cf.key_pair_id}`
}

/**
 * Appends signing params to an asset URL. Returns the URL unchanged when there are no
 * credentials, so unsigned (public bucket) assets pass straight through.
 */
export function buildSignedUrl(
  url: string,
  cf: CloudfrontCredentials | null | undefined,
): string {
  if (!hasCloudfrontCredentials(cf)) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}${cloudfrontQuery(cf)}`
}

/**
 * Reads the expiry out of a CloudFront `Policy`, in epoch milliseconds.
 *
 * The policy is JSON, base64'd, then run through CloudFront's own URL-safe substitution --
 * NOT standard base64url. AWS replaces `+` with `-`, `=` with `_`, and `/` with `~`, so
 * decoding reverses exactly that. Mirrors `policyExpiryMs` in @pennsieve-viz/tsviewer.
 *
 * Returns null on any parse failure; callers treat that as "expiry unknown".
 */
export function cloudfrontExpiryMs(
  cf: Partial<CloudfrontCredentials> | null | undefined,
): number | null {
  try {
    if (!cf?.policy) return null
    const json = atob(cf.policy.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/'))
    const seconds = JSON.parse(json)?.Statement?.[0]?.Condition?.DateLessThan?.['AWS:EpochTime']
    return typeof seconds === 'number' ? seconds * 1000 : null
  } catch {
    return null
  }
}
