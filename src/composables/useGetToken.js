// lib: src/composables/useGetToken.ts (or .js)
export async function useGetToken(){
  let mod;
  try {
    // Literal in dev so Vite resolves; @vite-ignore in non-dev to keep it optional
    mod = import.meta?.env?.DEV
      ? await import('@aws-amplify/auth')
      : await import(/* @vite-ignore */ '@aws-amplify/auth');
  } catch (e) {
    console.warn('[useGetToken] @aws-amplify/auth not resolvable:', e);
    return null;
  }

  try {
    if (typeof window === 'undefined') return null; // SSR guard
    const { fetchAuthSession } = mod;
    if (typeof fetchAuthSession !== 'function') return null;

    const session = await fetchAuthSession();

    // Prefer accessToken (matches your app); fall back to idToken
    const token =
      session?.tokens?.accessToken?.toString?.() ??
      session?.tokens?.idToken?.toString?.() ??
      null;

    return token && token.length ? token : null;
  } catch (e) {
    console.warn('[useGetToken] fetchAuthSession failed:', e);
    return null;
  }
}
