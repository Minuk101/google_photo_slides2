const CLIENT_ID = '232709413830-gjmgctle15h91vcm1i9vtb6h5lnrk84o.apps.googleusercontent.com';
let allPhotos = [];
let globalToken = null;
let pollInterval = null;
let lastTransitionTime = Date.now();

// ---- IndexedDB helpers ----
const DB_NAME = 'photos_db';
const DB_VERSION = 1;
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
        console.error("Slideshow stalled, reloading...");
        location.reload();
    }
}, 10000);

async function loadFromStorage() {
    const saved = await dbGet('photos');
    const token = await dbGet('token');
    if (saved && token) {
        if (typeof saved[0] === 'string') {
            allPhotos = saved.map(url => ({ id: null, baseUrl: url }));
        } else {
            allPhotos = saved;
        }
        globalToken = token;
        return true;
    }
    return false;
}

function resetPhotos() {
    if (confirm("Reset all photo list?")) {
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
                pollPhotos(res.access_token, session.id);
            }
        }
    });
    client.requestAccessToken();
};

async function addMorePhotos() {
    const dbg = document.getElementById('debug');
    dbg.style.display = 'block';
    dbg.innerText = 'Step 1: addMorePhotos called';
    if (!globalToken) {
        dbg.innerText = 'Step X: no token, re-login';
        document.getElementById('login-btn').style.display = 'block';
        document.getElementById('login-btn').click();
        return;
    }
    try {
        dbg.innerText = 'Step 2: creating picker session...';
        const response = await fetch('https://photospicker.googleapis.com/v1/sessions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + globalToken }
        });
        dbg.innerText = 'Step 3: session status = ' + response.status;
        if (response.status === 401) {
            dbg.innerText = 'Step 3b: token expired';
            await dbPut('token', '');
            document.getElementById('login-btn').style.display = 'block';
            document.getElementById('login-btn').click();
            return;
        }
        const session = await response.json();
        dbg.innerText = 'Step 4: pickerUri = ' + (session.pickerUri ? 'OK' : 'MISSING') + ' sessionId = ' + (session.id || '?');
        window.open(session.pickerUri, '_blank');
        pollPhotos(globalToken, session.id);
    } catch (e) {
        dbg.innerText = 'ERROR: ' + e.message;
    }
}

async function pollPhotos(token, sessionId) {
    const dbg = document.getElementById('debug');
    dbg.innerText = 'Poll: waiting for selection (sessionId=' + sessionId + ')';
    if (pollInterval) clearInterval(pollInterval);
    
    pollInterval = setInterval(async () => {
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

        if (allItems.length > 0) {
            dbg.innerText = 'Poll: got ' + allItems.length + ' items. Existing: ' + allPhotos.length;
            
            const newItems = allItems.map(p => ({
                id: p.id,
                baseUrl: p.mediaFile ? p.mediaFile.baseUrl : p.baseUrl,
                filename: p.mediaFile ? p.mediaFile.filename : null
            })).filter(p => p.baseUrl);
            
            // Debug: show sample IDs
            let sampleExisting = allPhotos.filter(p => p.id).slice(0, 2).map(p => p.id).join(', ');
            let sampleNew = newItems.slice(0, 3).map(p => p.id).join(', ');
            let idCountNew = newItems.filter(p => p.id).length;
            let idNewSet = new Set(newItems.filter(p => p.id).map(p => p.id)).size;
            let idExistSet = new Set(allPhotos.filter(p => p.id).map(p => p.id)).size;
            dbg.innerText = 'New IDs: ' + idCountNew + '/' + newItems.length + ' have id. Unique new: ' + idNewSet + ' | Existing unique: ' + idExistSet + ' | Samples: [' + sampleNew + '] | Old samples: [' + sampleExisting + ']';
            
            const existingIds = new Set(allPhotos.filter(p => p.id).map(p => p.id));
            const existingUrls = new Set(allPhotos.filter(p => !p.id).map(p => p.baseUrl));
            
            let added = 0;
            for (const item of newItems) {
                if (item.id && existingIds.has(item.id)) continue;
                if (!item.id && existingUrls.has(item.baseUrl)) continue;
                allPhotos.push(item);
                added++;
                if (item.id) existingIds.add(item.id);
                else existingUrls.add(item.baseUrl);
            }
            
            await dbPut('photos', allPhotos);
            
            document.getElementById('heartbeat').innerText = allPhotos.length;
            clearInterval(pollInterval);
            
            if (document.getElementById('slideshow').style.display === 'none') {
                startSlideshow(token);
            }
            document.getElementById('add-btn').style.display = 'block';
        }
    }, 3000);
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
        const url = item.baseUrl + '=w1920-h1080';
        let objectUrl = null;
        
        try {
            const response = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
            const blob = await response.blob();
            objectUrl = URL.createObjectURL(blob);
            
            const nextImg = showingImg1 ? img2 : img1;
            const currentImg = showingImg1 ? img1 : img2;
            const nextBg = showingImg1 ? bg2 : bg1;
            const currentBg = showingImg1 ? bg1 : bg2;
            
            nextImg.src = objectUrl;
            nextBg.src = objectUrl;
            
            nextImg.style.opacity = 1;
            nextBg.style.opacity = 0.6;
            
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

