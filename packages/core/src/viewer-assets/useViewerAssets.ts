import { ref, shallowRef, computed, watch } from 'vue'
import {
  fetchViewerAssets,
  selectReadyAssets,
  type GetToken,
  type ViewerAsset,
} from './api'
import type { CloudfrontCredentials } from './cloudfront'
import { useCloudfrontCredentials, readSource, type Source } from './useCloudfrontCredentials'

export interface UseViewerAssetsOptions {
  api2Url: string
  /** The package to list assets for. Changing it reloads. */
  packageId: Source<string | null | undefined>
  /** Only needed with `getToken` (private data). */
  datasetId?: Source<string | null | undefined>
  /** Supply for private data; omit for published data, which needs no auth. */
  getToken?: GetToken
  /** Keep only these `asset_type`s, e.g. `['ome-zarr', 'neuroglancer-precomputed']`. */
  assetTypes?: string[]
}

/**
 * Loads a package's ready viewer assets and keeps their CloudFront credentials valid.
 *
 * Renewal relists the package rather than fetching one asset by id: the listing returns a
 * single set of credentials covering every asset in it, which a per-asset response is not
 * guaranteed to do.
 *
 * @example
 * ```vue
 * const { assets, cloudfront } = useViewerAssets({
 *   api2Url,
 *   packageId: () => props.packageId,
 *   assetTypes: ['ome-zarr', 'neuroglancer-precomputed'],
 * })
 * // <OrthogonalFrame :source="assets[0].asset_url" :cloudfront="cloudfront" />
 * ```
 */
export function useViewerAssets({
  api2Url,
  packageId,
  datasetId,
  getToken,
  assetTypes,
}: UseViewerAssetsOptions) {
  const assets = shallowRef<ViewerAsset[]>([])
  const listedCloudfront = shallowRef<CloudfrontCredentials | null>(null)
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  let request = 0

  function list(pkg: string) {
    return fetchViewerAssets({
      api2Url,
      packageId: pkg,
      datasetId: datasetId ? readSource(datasetId) ?? undefined : undefined,
      getToken,
    })
  }

  async function load() {
    const id = ++request
    const pkg = readSource(packageId)
    assets.value = []
    listedCloudfront.value = null
    loadError.value = null
    if (!pkg) {
      loading.value = false
      return
    }

    loading.value = true
    try {
      const result = await list(pkg)
      if (id !== request) return
      assets.value = selectReadyAssets(result.assets, assetTypes)
      listedCloudfront.value = result.cloudfront
    } catch (e) {
      if (id === request) loadError.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (id === request) loading.value = false
    }
  }

  const credentials = useCloudfrontCredentials({
    initial: listedCloudfront,
    renew: async () => {
      const pkg = readSource(packageId)
      return pkg ? (await list(pkg)).cloudfront : null
    },
  })

  watch(
    () => [readSource(packageId), datasetId ? readSource(datasetId) : undefined],
    load,
    { immediate: true },
  )

  return {
    assets,
    cloudfront: credentials.cloudfront,
    loading,
    error: computed(() => loadError.value ?? credentials.error.value),
    /** Renew credentials now. */
    refresh: credentials.refresh,
    /** Relist the package. */
    reload: load,
  }
}
