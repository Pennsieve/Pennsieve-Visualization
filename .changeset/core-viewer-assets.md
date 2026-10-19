---
"@pennsieve-viz/core": minor
---

Add shared viewer-asset helpers: `useViewerAssets` lists a package's ready assets (public discover endpoint, or the authenticated one when given `getToken`) and `useCloudfrontCredentials` renews CloudFront credentials before their policy expires, so long-lived viewers like `OrthogonalFrame` keep loading. Also exports `fetchViewerAssets`, `fetchViewerAssetById`, `buildSignedUrl`, and `cloudfrontExpiryMs`.
