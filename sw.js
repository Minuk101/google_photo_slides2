let authToken = null;

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'auth_token') {
        authToken = event.data.token;
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.hostname.endsWith('googleusercontent.com') && authToken) {
        const newHeaders = new Headers(event.request.headers);
        newHeaders.set('Authorization', 'Bearer ' + authToken);
        const newRequest = new Request(event.request, { headers: newHeaders });
        event.respondWith(fetch(newRequest));
    }
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
