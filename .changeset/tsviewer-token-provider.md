---
"@pennsieve-viz/tsviewer": minor
---

Fixes 401s on Pennsieve API requests (annotation layers, annotations, linked packages) and the streaming socket: the viewer sent `api_key=null` because it imported `@aws-amplify/auth` itself, which a host's production build never resolves and its dev server can load as a second, unconfigured Amplify. The viewer no longer does any auth. Hosts pass their token source once at start with the new `setTokenProvider(async () => token)`; without it, public Zarr bundles still load. `@aws-amplify/auth` is no longer a peer dependency.
