/**
 * useNiiSource — resolves a Pennsieve package to a NiiViewer-ready URL.
 *
 * This composable is meant to live in the consuming app (e.g. pennsieve-app),
 * not in the viz library. It's here as a reference implementation.
 *
 * Usage:
 *   const { url, zarrLevel, needsConversion, fileSizeMB, error, loading } =
 *     useNiiSource({ pkgId, apiUrl, getToken })
 *
 * Then bind to NiiViewer:
 *   <NiiViewer v-if="url" :url="url" :zarr-level="zarrLevel" />
 *   <p v-else-if="needsConversion">Run conversion workflow ({{ fileSizeMB }}MB)</p>
 */
import { ref, onMounted, type Ref } from 'vue'

const MAX_DIRECT_LOAD_BYTES = 200 * 1024 * 1024 // 200 MB

interface NiiSourceOptions {
  pkgId: string
  apiUrl: string
  /** Function that returns an auth token (or null for public data) */
  getToken: () => Promise<string | null>
}

interface NiiSourceResult {
  url: Ref<string>
  zarrLevel: Ref<number | undefined>
  needsConversion: Ref<boolean>
  fileSizeMB: Ref<number>
  error: Ref<string>
  loading: Ref<boolean>
}

export function useNiiSource(options: NiiSourceOptions): NiiSourceResult {
  const url = ref('')
  const zarrLevel = ref<number | undefined>(undefined)
  const needsConversion = ref(false)
  const fileSizeMB = ref(0)
  const error = ref('')
  const loading = ref(true)

  async function fetchWithToken(endpoint: string) {
    const token = await options.getToken()
    const sep = endpoint.includes('?') ? '&' : '?'
    const fullUrl = token ? `${endpoint}${sep}api_key=${token}` : endpoint
    const r = await fetch(fullUrl)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  }

  onMounted(async () => {
    try {
      // 1. Get viewer assets for this package
      const assets = await fetchWithToken(
        `${options.apiUrl}/packages/${options.pkgId}/view`
      )

      // 2. Look for a zarr view asset first
      const zarrAsset = assets.find((a: any) =>
        (a.content?.name ?? '').toLowerCase().includes('.zarr')
      )

      if (zarrAsset) {
        const fileData = await fetchWithToken(
          `${options.apiUrl}/packages/${options.pkgId}/files/${zarrAsset.content.id}`
        )
        url.value = fileData.url
        zarrLevel.value = 0
        return
      }

      // 3. No zarr — fall back to source file
      const sourceAsset = assets[0]
      if (!sourceAsset?.content?.id) {
        error.value = 'No viewable files found for this package.'
        return
      }

      const fileData = await fetchWithToken(
        `${options.apiUrl}/packages/${options.pkgId}/files/${sourceAsset.content.id}`
      )
      const sourceUrl: string = fileData.url

      // 4. Check file size
      try {
        const head = await fetch(sourceUrl, { method: 'HEAD' })
        const sizeBytes = Number(head.headers.get('content-length') || 0)
        if (sizeBytes > MAX_DIRECT_LOAD_BYTES) {
          needsConversion.value = true
          fileSizeMB.value = Math.round(sizeBytes / (1024 * 1024))
          return
        }
      } catch {
        // HEAD failed — try loading anyway
      }

      url.value = sourceUrl
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to resolve NIfTI source.'
    } finally {
      loading.value = false
    }
  })

  return { url, zarrLevel, needsConversion, fileSizeMB, error, loading }
}
