// Service Worker that appends CloudFront signing params to asset requests.
// Intercepts fetch requests from neuroglancer (including Web Workers).

let cloudfrontParams = '';

// The params grant read access to the open dataset, so they go only to the
// assets CDN itself: an exact host match, never a substring of the URL.
const SIGNED_HOSTS = new Set([
  'assets.pennsieve.io',
  'assets.pennsieve.net',
  'assets.pennsieve.ai',
]);

function isSignedHost(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && SIGNED_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

self.addEventListener('install', () => {
  console.log('[SW] installing');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] activating');
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'set-cloudfront-params') {
    cloudfrontParams = event.data.params;
    console.log('[SW] received cloudfront params');
    if (event.ports[0]) {
      event.ports[0].postMessage('ok');
    }
  }
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (!isSignedHost(url)) return;
  if (cloudfrontParams) {
    const separator = url.includes('?') ? '&' : '?';
    const signedUrl = url + separator + cloudfrontParams;
    console.log('[SW] signing:', url.substring(0, 80) + '...');
    event.respondWith(fetch(signedUrl));
  } else {
    console.log('[SW] NO PARAMS — passing through unsigned:', url.substring(0, 80) + '...');
  }
});
