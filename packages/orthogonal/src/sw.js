// Service Worker that appends CloudFront signing params to asset requests.
// Intercepts fetch requests from neuroglancer (including Web Workers).

let cloudfrontParams = '';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'set-cloudfront-params') {
    cloudfrontParams = event.data.params;
    if (event.ports[0]) {
      event.ports[0].postMessage('ok');
    }
  }
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (url.includes('assets.pennsieve') && cloudfrontParams) {
    const separator = url.includes('?') ? '&' : '?';
    const signedUrl = url + separator + cloudfrontParams;
    event.respondWith(fetch(signedUrl));
  }
});
