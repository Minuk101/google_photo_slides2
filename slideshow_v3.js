const CLIENT_ID = '232709413830-gjmgctle15h91vcm1i9vtb6h5lnrk84o.apps.googleusercontent.com';
let allPhotos = [];
let globalToken = null;
let lastTransitionTime = Date.now();
let pollQueue = [];
let pollInProgress = false;


// ---- IndexedDB helpers ----
const DB_NAME = 'photos_db';
const DB_VERSION = 2;
const STORE_NAME = 'store';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function dbPut(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ id: key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function dbGet(key) {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
    });
}

async function dbClear() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}
// ---- End IndexedDB ----

// Watchdog
setInterval(() => {
    if (document.getElementById('slideshow').style.display !== 'none' && Date.now() - lastTransitionTime > 60000) {
        console.error('Slideshow stalled, reloading...');
        location.reload();
    }
}, 10000);

async function loadFromStorage() {
    const saved = await dbGet('photos');
    const token = await dbGet('token');
    if (saved && token) {
        allPhotos = saved;
        globalToken = token;
        return true;
    }
    return false;
}

function resetPhotos() {
    if (confirm('Reset all photo list?')) {
        dbClear().then(() => location.reload());
    }
}

window.onload = async () => {
    if (await loadFromStorage()) {
        document.getElementById('login-btn').style.display = 'none';
        startSlideshow(globalToken);
        document.getElementById('add-btn').style.display = 'block';
    }
};

document.getElementById('login-btn').onclick = function() {
    const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
        callback: async (res) => {
            if (res.access_token) {
                globalToken = res.access_token;
                await dbPut('token', res.access_token);
                const session = await fetch('https://photospicker.googleapis.com/v1/sessions', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + res.access_token }
                }).then(r => r.json());
                window.open(session.pickerUri, '_blank');
                document.getElementById('login-btn').style.display = 'none';
                queuePhotos(globalToken, session.id);
            }
        }
    });
    client.requestAccessToken();
};

async function addMorePhotos() {
    if (!globalToken) {
        document.getElementById('login-btn').style.display = 'block';
        document.getElementById('login-btn').click();
        return;
    }
    const response = await fetch('https://photospicker.googleapis.com/v1/sessions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + globalToken }
    });

    if (response.status === 401) {
        await dbPut('token', '');
        document.getElementById('login-btn').style.display = 'block';
        document.getElementById('login-btn').click();
        return;
    }

    const session = await response.json();
    window.open(session.pickerUri, '_blank');
    pollQueue.push({ token: globalToken, sessionId: session.id });
    processQueue();
}

function queuePhotos(token, sessionId) {
    pollQueue.push({ token, sessionId });
    processQueue();
}

async function processQueue() {
    if (pollInProgress) return;
    if (pollQueue.length === 0) return;

    pollInProgress = true;
    const { token, sessionId } = pollQueue[0];

    // Poll quickly for first data
    let allItems = [];
    let nextPageToken = null;

    while (true) {
        const url = 'https://photospicker.googleapis.com/v1/mediaItems?sessionId=' + sessionId + (nextPageToken ? '&pageToken=' + nextPageToken : '');
        const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
        if (res.status !== 200) break;
        const data = await res.json();
        if (data.mediaItems) allItems.push(...data.mediaItems);
        nextPageToken = data.nextPageToken;
        if (nextPageToken) continue; // keep fetching pages immediately
        break; // no more pages — we have all data
    }

    if (allItems.length === 0) {
        // No data yet — poll again quickly
        pollInProgress = false;
        setTimeout(() => { pollInProgress = false; processQueue(); }, 1000);
        return;
    }

    const newItems = allItems.map(p => ({
        baseUrl: p.mediaFile ? p.mediaFile.baseUrl : p.baseUrl
    })).filter(p => p.baseUrl);

    allPhotos.push(...newItems);
    await dbPut('photos', allPhotos);

    console.log('Added', newItems.length, 'photos. Total:', allPhotos.length);
    document.getElementById('heartbeat').innerText = allPhotos.length;

    if (document.getElementById('slideshow').style.display === 'none') {
        startSlideshow(token);
    }
    document.getElementById('add-btn').style.display = 'block';
    pollQueue.shift();
    pollInProgress = false;
    if (pollQueue.length > 0) processQueue();
}

// ---- Prefetch queue: 10 pre-loaded photos, shown in order ----
const prefetchQueue = [];
const prefetchBlobs = new Map();
let prefetchToken = null;
let prefetchWorking = false;

async function refillQueue(token) {
    prefetchToken = token;
    if (prefetchWorking) return;
    prefetchWorking = true;
    
    // Pick random photos not already in the queue
    const usedUrls = new Set(prefetchQueue.map(p => p.baseUrl));
    outer:
    while (prefetchQueue.length < 10 && allPhotos.length > 0) {
        for (let tries = 0; tries < 30; tries++) {
            const pick = allPhotos[Math.floor(Math.random() * allPhotos.length)];
            if (!usedUrls.has(pick.baseUrl)) {
                prefetchQueue.push(pick);
                usedUrls.add(pick.baseUrl);
                continue outer;
            }
        }
        break; // couldn't find any unused after 30 tries
    }
    
    // Fetch one unloaded item
    for (const item of prefetchQueue) {
        if (prefetchBlobs.has(item.baseUrl)) continue;
        try {
            const resp = await fetch(item.baseUrl + '=w1920-h1080', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!resp.ok) throw new Error();
            const blob = await resp.blob();
            prefetchBlobs.set(item.baseUrl, blob);
            break;
        } catch (e) {
            const idx = prefetchQueue.indexOf(item);
            if (idx >= 0) prefetchQueue.splice(idx, 1);
        }
    }
    prefetchWorking = false;
    
    if (prefetchQueue.length < 10) refillQueue(token);
}
// ---- End prefetch ----



function startSlideshow(token) {
    document.getElementById('slideshow').style.display = 'block';
    document.getElementById('add-btn').style.display = 'block';
    let showingImg1 = true;
    const img1 = document.getElementById('img1'), img2 = document.getElementById('img2');
    const bg1 = document.getElementById('bg1'), bg2 = document.getElementById('bg2');

    document.getElementById('heartbeat').innerText = allPhotos.length;
    refillQueue(token);


    let nextBlob = null;  // pre-loaded blob for the next slide
    let nextItem = null;

    async function prepareNext() {
        const tryIdx = Math.floor(Math.random() * allPhotos.length);
        const candidate = allPhotos[tryIdx];
        let blob = getPrefetched(candidate.baseUrl);
        if (!blob) {
            try {
                const resp = await fetch(candidate.baseUrl + '=w1920-h1080', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!resp.ok) throw new Error();
                blob = await resp.blob();
            } catch (e) {
                return;
            }
        }
        nextBlob = blob;
        nextItem = candidate;
    }

    async function next() {
        if (allPhotos.length === 0) return;

        const hb = document.getElementById('heartbeat');
        hb.innerText = allPhotos.length;

        // Show the blob that was prepared during the previous slide
        let blob = nextBlob;
        let item = nextItem;
        nextBlob = null;
        nextItem = null;

        // fallback if first slide or prepareNext failed
        if (!blob || !item) {
            item = allPhotos[Math.floor(Math.random() * allPhotos.length)];
            try {
                const resp = await fetch(item.baseUrl + '=w1920-h1080', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!resp.ok) throw new Error();
                blob = await resp.blob();
            } catch (e) {
                // schedule next attempt ASAP
                setTimeout(next, 500);
                return;
            }
        }

        const objectUrl = URL.createObjectURL(blob);

        try {
            const nextImg = showingImg1 ? img2 : img1;
            const currentImg = showingImg1 ? img1 : img2;
            const nextBg = showingImg1 ? bg2 : bg1;
            const currentBg = showingImg1 ? bg1 : bg2;

            const origins = ['0% 0%', '100% 0%', '0% 100%', '100% 100%', '50% 50%'];
            const origin = origins[Math.floor(Math.random() * origins.length)];
            nextImg.style.transition = 'none';
            nextImg.style.transform = 'scale(1)';
            nextImg.style.transformOrigin = origin;
            nextBg.style.transition = 'none';
            nextBg.style.transform = 'scale(1)';
            void nextImg.offsetHeight;

            nextImg.src = objectUrl;
            nextBg.src = objectUrl;

            nextImg.style.transition = 'transform 5s ease-out, opacity 2s';
            nextImg.style.transform = 'scale(1.05)';
            nextImg.style.opacity = 1;
            nextBg.style.transition = 'opacity 2s';
            nextBg.style.opacity = 1;

            currentImg.style.opacity = 0;
            currentBg.style.opacity = 0;

            setTimeout(() => {
                if (currentImg.src.startsWith('blob:')) URL.revokeObjectURL(currentImg.src);
                if (currentBg.src.startsWith('blob:')) URL.revokeObjectURL(currentBg.src);
            }, 2200);

            showingImg1 = !showingImg1;
            idx = Math.floor(Math.random() * allPhotos.length);

            lastTransitionTime = Date.now();

            // Prepare the next slide's blob in background while current slide is showing
            refillQueue(token);


            setTimeout(next, 5000);
        } catch (e) {
            console.error(e);
            idx = Math.floor(Math.random() * allPhotos.length);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            setTimeout(next, 1000);
        }
    }

    next();
}







