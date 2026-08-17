// Dynamic import so @aws-amplify/auth remains truly optional at runtime.
// Follows the same pattern as packages/core/src/composables/useGetToken.ts.

async function getAuthModule() {
  try {
    return import.meta?.env?.DEV
      ? await import('@aws-amplify/auth')
      : await import(/* @vite-ignore */ '@aws-amplify/auth');
  } catch (e) {
    console.warn('[useToken] @aws-amplify/auth not resolvable:', e);
    return null;
  }
}

export async function useToken() {
  const mod = await getAuthModule();
  if (!mod) return null;

  try {
    const { fetchAuthSession } = mod;
    if (typeof fetchAuthSession !== 'function') return null;

    const session = await fetchAuthSession();
    return session?.tokens?.accessToken?.toString?.() ?? null;
  } catch (error) {
    console.warn('[useToken] fetchAuthSession failed:', error);
    return null;
  }
}

export async function useLogout() {
  const mod = await getAuthModule();
  if (!mod) return;

  try {
    const { signOut } = mod;
    if (typeof signOut === 'function') {
      await signOut();
    }
  } catch (error) {
    console.warn('[useToken] signOut failed:', error);
  }
}
