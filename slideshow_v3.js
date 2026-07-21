const CLIENT_ID = '232709413830-gjmgctle15h91vcm1i9vtb6h5lnrk84o.apps.googleusercontent.com';
let allPhotos = [];
let globalToken = null;
let lastTransitionTime = Date.now();
let pollQueue = [];
let pollInProgress = false;

// ---- IndexedDB helpers ----
const DB_NAME = 'photos_db';
const DB_VERSION = 2;  // bumped for new blob store

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('store')) {
                db.createObjectStore('store', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('blobs')) {
                db.createObjectStore('blobs', { keyPath: 'id' });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function dbPut(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('store', 'readwrite');
        tx.objectStore('store').put({ id: key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function dbGet(key) {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction('store', 'readonly');
        const req = tx.objectStore('store').get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
    });
}

async function dbClear() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('store', 'readwrite');
        tx.objectStore('store').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

// ---- Blob cache (IndexedDB only — no memory overhead) ----
async function cacheBlob(baseUrl, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').put({ id: baseUrl, blob });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function getBlob(baseUrl) {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction('blobs', 'readonly');
        const req = tx.objectStore('blobs').get(baseUrl);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => resolve(null);
    });
}

async function clearBlobs() {
    blobCache.clear();
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}
// ---- End IndexedDB ----

// Watchdog
setInterval(() => {
    if (document.getElementById('slideshow').style.display !== 'none' && Date.now() - lastTransitionTime > 60000) {
        console.error("Slideshow stalled, reloading...");
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
    if (confirm("Reset all photo list?")) {
        clearBlobs().then(() => dbClear()).then(() => location.reload());
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
    
    // Phase 1: Get URLs from Picker
    let allItems = [];
    let nextPageToken = null;
    
    do {
        const url = 'https://photospicker.googleapis.com/v1/mediaItems?sessionId=' + sessionId + (nextPageToken ? '&pageToken=' + nextPageToken : '');
        const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
        if (res.status !== 200) break;
        const data = await res.json();
        if (data.mediaItems) allItems.push(...data.mediaItems);
        nextPageToken = data.nextPageToken;
    } while (nextPageToken);

    if (allItems.length === 0) {
        pollInProgress = false;
        // Keep polling
        setTimeout(() => { pollInProgress = false; processQueue(); }, 3000);
        return;
    }
    
    const newItems = allItems.map(p => ({
        baseUrl: p.mediaFile ? p.mediaFile.baseUrl : p.baseUrl
    })).filter(p => p.baseUrl);
    
    // Phase 2: Download all images as blobs (so they never expire)
    const hb = document.getElementById('heartbeat');
    hb.innerText = 'Downloading 0/' + newItems.length;
    
    let downloaded = 0;
    for (const item of newItems) {
        try {
            const resp = await fetch(item.baseUrl + '=w1920-h1080', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const blob = await resp.blob();
            await cacheBlob(item.baseUrl, blob);
        } catch (e) {
            // Skip failed downloads
        }
        downloaded++;
        if (downloaded % 10 === 0) {
            hb.innerText = 'Downloading ' + downloaded + '/' + newItems.length;
        }
    }
    
    // Phase 3: Add to allPhotos and save
    allPhotos.push(...newItems);
    await dbPut('photos', allPhotos);
    
    console.log("Added", newItems.length, "photos. Total:", allPhotos.length);
    hb.innerText = allPhotos.length;
    
    if (document.getElementById('slideshow').style.display === 'none') {
        startSlideshow(token);
    }
    document.getElementById('add-btn').style.display = 'block';
    
    pollQueue.shift();
    pollInProgress = false;
    processQueue();
}

function startSlideshow(token) {
    document.getElementById('slideshow').style.display = 'block';
    document.getElementById('add-btn').style.display = 'block';
    let idx = Math.floor(Math.random() * allPhotos.length), showingImg1 = true;
    const img1 = document.getElementById('img1'), img2 = document.getElementById('img2');
    const bg1 = document.getElementById('bg1'), bg2 = document.getElementById('bg2');
    
    document.getElementById('heartbeat').innerText = allPhotos.length;
    
    async function next() {
        if (allPhotos.length === 0) return;
        
        const hb = document.getElementById('heartbeat');
        hb.innerText = allPhotos.length;

        const item = allPhotos[idx];
        let objectUrl = null;
        
        // Try to get blob from cache first (no network, never expires)
        let blob = await getBlob(item.baseUrl);
        
        if (!blob) {
            // Fallback: fetch from network (should rarely happen)
            try {
                const resp = await fetch(item.baseUrl + '=w1920-h1080', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                blob = await resp.blob();
                await cacheBlob(item.baseUrl, blob);
            } catch (e) {
                console.error("Failed to load photo, skipping");
                idx = Math.floor(Math.random() * allPhotos.length);
                setTimeout(next, 1000);
                return;
            }
        }
        
        objectUrl = URL.createObjectURL(blob);
        
        try {
            const nextImg = showingImg1 ? img2 : img1;
            const currentImg = showingImg1 ? img1 : img2;
            const nextBg = showingImg1 ? bg2 : bg1;
            const currentBg = showingImg1 ? bg1 : bg2;
            
            nextImg.src = objectUrl;
            nextBg.src = objectUrl;
            
            nextImg.style.opacity = 1;
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


