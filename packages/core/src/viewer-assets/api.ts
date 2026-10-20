import type { CloudfrontCredentials } from './cloudfront'

/** A viewer asset record from the Pennsieve packages service. */
export interface ViewerAsset {
  id: string
  asset_type: string
  asset_url: string
  status: string
  name?: string
  [key: string]: unknown
}

export interface ViewerAssetList {
  assets: ViewerAsset[]
  cloudfront: CloudfrontCredentials | null
}

export interface SingleViewerAsset {
  asset: ViewerAsset | null
  cloudfront: CloudfrontCredentials | null
}

/** Resolves a bearer token at call time. Return null to send no Authorization header. */
export type GetToken = () => Promise<string | null | undefined>

export interface FetchViewerAssetsOptions {
  api2Url: string
  packageId: string
  /**
   * Supplying this selects the authenticated endpoint (`/packages/assets`), which is how
   * private workspace data is read. Omit it for published data (`/packages/discover/assets`).
   * It is called on every request, so a token that rotated since the last call is picked up.
   */
  getToken?: GetToken
  /** Required by the authenticated endpoint; ignored by discover. */
  datasetId?: string
}

async function getJson(url: string, getToken?: GetToken): Promise<any | null> {
  const headers: Record<string, string> = {}
  if (getToken) {
    const token = await getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const response = await fetch(url, { headers, credentials: 'omit' })
  // 404 means the package has no viewer assets -- an expected case, not an error.
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Viewer asset request failed: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

/**
 * Lists a package's viewer assets along with CloudFront credentials for them.
 * Calling it again is also how discover (public) credentials are renewed.
 */
export async function fetchViewerAssets({
  api2Url,
  packageId,
  getToken,
  datasetId,
}: FetchViewerAssetsOptions): Promise<ViewerAssetList> {
  const pkg = encodeURIComponent(packageId)
  let url: string
  if (getToken) {
    if (!datasetId) throw new Error('datasetId is required for the authenticated assets endpoint')
    url = `${api2Url}/packages/assets?dataset_id=${encodeURIComponent(datasetId)}&package_id=${pkg}`
  } else {
    url = `${api2Url}/packages/discover/assets?package_id=${pkg}`
  }

  const data = await getJson(url, getToken)
  return {
    assets: data?.assets ?? [],
    cloudfront: data?.cloudfront ?? null,
  }
}

/**
 * Fetches one viewer asset by id (authenticated endpoint). Lighter than relisting when all
 * that is needed is fresh credentials for an asset already on screen.
 */
export async function fetchViewerAssetById({
  api2Url,
  assetId,
  datasetId,
  getToken,
}: {
  api2Url: string
  assetId: string
  datasetId: string
  getToken: GetToken
}): Promise<SingleViewerAsset> {
  const url = `${api2Url}/packages/assets/${encodeURIComponent(assetId)}?dataset_id=${encodeURIComponent(datasetId)}`
  const data = await getJson(url, getToken)
  return {
    asset: data?.asset ?? null,
    cloudfront: data?.cloudfront ?? null,
  }
}

/**
 * Keeps ready assets of the given types, dropping duplicates by URL (the listing can
 * return the same bundle more than once).
 */
export function selectReadyAssets(assets: ViewerAsset[], assetTypes?: string[]): ViewerAsset[] {
  const seen = new Set<string>()
  return assets.filter((a) => {
    if (assetTypes && !assetTypes.includes(a.asset_type)) return false
    if (a.status !== 'ready') return false
    if (seen.has(a.asset_url)) return false
    seen.add(a.asset_url)
    return true
  })
}
