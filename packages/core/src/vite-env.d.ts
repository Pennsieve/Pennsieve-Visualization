/// <reference types="vite/client" />

// Optional peer dependency - declare module to allow dynamic import without type errors
declare module '@aws-amplify/auth' {
  export function fetchAuthSession(): Promise<{
    tokens?: {
      accessToken?: { toString(): string }
      idToken?: { toString(): string }
    }
  }>
}
