// Auth stays in the host app: it hands over its token source via setTokenProvider.
// Without one, requests carry no token, which is fine for public Zarr bundles.

export type TokenProvider = () => Promise<string | null | undefined>

let tokenProvider: TokenProvider | null = null

/** Sets the function every API request gets its token from. Call once at app start. */
export function setTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider
}

export async function useToken(): Promise<string | null> {
  if (!tokenProvider) return null;

  try {
    return (await tokenProvider()) || null;
  } catch (error) {
    console.warn('[useToken] token provider failed:', error);
    return null;
  }
}
