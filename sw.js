self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

let authToken = null;
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'auth_token') {
        authToken = event.data.token;
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.hostname.endsWith('googleusercontent.com') && authToken) {
        const headers = new Headers(event.request.headers);
        headers.set('Authorization', 'Bearer ' + authToken);
        const newReq = new Request(event.request, { headers });
        event.respondWith(fetch(newReq));
    }
});
