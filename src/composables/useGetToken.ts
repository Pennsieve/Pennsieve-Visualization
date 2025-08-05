import { fetchAuthSession, signOut } from "aws-amplify/auth";

export async function useGetToken(): Promise<string | undefined> {
  try {
    const session = await fetchAuthSession();
    return session?.tokens?.accessToken?.toString();
  } catch (error) {
    console.error("Failed to fetch auth token:", error);
  }
}

export async function useLogout(): Promise<void> {
  try {
    await signOut();
  } catch (error) {
    console.error("Logout failed:", error);
  }
}
