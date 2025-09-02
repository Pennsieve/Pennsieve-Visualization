export async function useGetToken() {
    const moduleName = '@aws-amplify/auth';
    let mod
    try {
      // prevent static analysis so Rollup/Vite won't pre-bundle it
      mod = await import(/* @vite-ignore */ moduleName);
    } catch {
      // Amplify not installed in host — return a safe fallback
      return { token: null, provider: 'none' };
    }
  
    const { fetchAuthSession } = mod;
    const session = await fetchAuthSession();
    const token = session?.tokens?.idToken?.toString?.() ?? null;
    return { token, provider: 'amplify' };
  }