/**
 * Returns the current Amplify access token, or null when @aws-amplify/auth
 * is not installed or no session exists. The import is dynamic so the
 * optional peer dependency stays optional.
 */
export async function useToken() {
    try {
        const { fetchAuthSession } = await import('@aws-amplify/auth')
        const session = await fetchAuthSession()
        return session?.tokens?.accessToken.toString()
    } catch {
        return null
    }
}
