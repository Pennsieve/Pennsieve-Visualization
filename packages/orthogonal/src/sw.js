// Service Worker that appends CloudFront signing params to asset requests.
// Intercepts fetch requests from neuroglancer (including Web Workers).

let cloudfrontParams = '';

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
    console.log('[SW] received cloudfront params, length:', cloudfrontParams?.length, 'key_pair_id fragment:', cloudfrontParams?.match(/Key-Pair-Id=([^&]*)/)?.[1]);
    if (event.ports[0]) {
      event.ports[0].postMessage('ok');
    }
  }
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (url.includes('assets.pennsieve')) {
    if (cloudfrontParams) {
      const separator = url.includes('?') ? '&' : '?';
      const signedUrl = url + separator + cloudfrontParams;
      console.log('[SW] signing:', url.substring(0, 80) + '...');
      event.respondWith(fetch(signedUrl));
    } else {
      console.log('[SW] NO PARAMS — passing through unsigned:', url.substring(0, 80) + '...');
    }
  }
});
