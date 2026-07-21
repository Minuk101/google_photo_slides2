const CLIENT_ID = '232709413830-gjmgctle15h91vcm1i9vtb6h5lnrk84o.apps.googleusercontent.com';let allPhotos = [];let globalToken = null;let lastTransitionTime = Date.now();let pollQueue = [];let pollInProgress = false;function updateAuth(token) {
    globalToken = token;    if (window._swReg && window._swReg.active) {
        window._swReg.active.postMessage({
 type: "auth_token", token: token });    } else {
        window._pendingToken = token;    }}// ---- IndexedDB helpers ----const DB_NAME = 'photos_db';const DB_VERSION = 2;const STORE_NAME = 'store';function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);        req.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(STORE_NAME, {
 keyPath: 'id' });        };
        req.onsuccess = (e) => resolve(e.target.result);        req.onerror = (e) => reject(e.target.error);    });
}async function dbPut(key, value) {
    const db = await openDB();    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');        tx.objectStore(STORE_NAME).put({
 id: key, value });        tx.oncomplete = () => resolve();        tx.onerror = (e) => reject(e.target.error);    });
}async function dbGet(key) {
    const db = await openDB();    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');        const req = tx.objectStore(STORE_NAME).get(key);        req.onsuccess = () => resolve(req.result ? req.result.value : null);        req.onerror = () => resolve(null);    });
}async function dbClear() {
    const db = await openDB();    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');        tx.objectStore(STORE_NAME).clear();        tx.oncomplete = () => resolve();        tx.onerror = (e) => reject(e.target.error);    });
}// ---- End IndexedDB ----// WatchdogsetInterval(() => {
    if (document.getElementById('slideshow').style.display !== 'none' && Date.now() - lastTransitionTime > 60000) {
        console.error('Slideshow stalled, reloading...');        location.reload();    }}, 10000);async function loadFromStorage() {
    const saved = await dbGet('photos');    const token = await dbGet('token');    if (saved && token) {
        allPhotos = saved;        updateAuth(token);        return true;    }    return false;
}function resetPhotos() {
    if (confirm('Reset all photo list?')) {
        dbClear().then(() => location.reload());    }}window.onload = async () => {
    if (await loadFromStorage()) {
        document.getElementById('login-btn').style.display = 'none';        startSlideshow(globalToken);        document.getElementById('add-btn').style.display = 'block';    }};
document.getElementById('login-btn').onclick = function() {
    const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,        scope: 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',        callback: async (res) => {
            if (res.access_token) {
                updateAuth(res.access_token);                await dbPut('token', res.access_token);                const session = await fetch('https://photospicker.googleapis.com/v1/sessions', {
                    method: 'POST',                    headers: {
 'Authorization': 'Bearer ' + res.access_token }                }).then(r => r.json());                window.open(session.pickerUri, '_blank');                document.getElementById('login-btn').style.display = 'none';                queuePhotos(globalToken, session.id);            }        }    });    client.requestAccessToken();
};
async function addMorePhotos() {
    if (!globalToken) {
        document.getElementById('login-btn').style.display = 'block';        document.getElementById('login-btn').click();        return;    }    const response = await fetch('https://photospicker.googleapis.com/v1/sessions', {
        method: 'POST',        headers: {
 'Authorization': 'Bearer ' + globalToken }    });    if (response.status === 401) {
        await dbPut('token', '');        document.getElementById('login-btn').style.display = 'block';        document.getElementById('login-btn').click();        return;    }    const session = await response.json();    window.open(session.pickerUri, '_blank');    pollQueue.push({
 token: globalToken, sessionId: session.id });    processQueue();
}function queuePhotos(token, sessionId) {
    pollQueue.push({
 token, sessionId });    processQueue();
}async function processQueue() {
    if (pollInProgress) return;    if (pollQueue.length === 0) return;    pollInProgress = true;    const {
 token, sessionId } = pollQueue[0];    let allItems = [];    let nextPageToken = null;    while (true) {
        const url = 'https://photospicker.googleapis.com/v1/mediaItems?sessionId=' + sessionId + (nextPageToken ? '&pageToken=' + nextPageToken : '');        const res = await fetch(url, {
 headers: {
 'Authorization': 'Bearer ' + token } });        if (res.status !== 200) break;        const data = await res.json();        if (data.mediaItems) allItems.push(...data.mediaItems);        nextPageToken = data.nextPageToken;        if (!nextPageToken) break;    }    if (allItems.length === 0) {
        pollInProgress = false;        setTimeout(() => {
 pollInProgress = false; processQueue(); }, 1000);        return;    }    const newItems = allItems.map(p => ({
        baseUrl: p.mediaFile ? p.mediaFile.baseUrl : p.baseUrl    })).filter(p => p.baseUrl);    allPhotos.push(...newItems);    await dbPut('photos', allPhotos);    console.log('Added', newItems.length, 'photos. Total:', allPhotos.length);    document.getElementById('heartbeat').innerText = allPhotos.length;    if (document.getElementById('slideshow').style.display === 'none') {
        startSlideshow(token);    }    document.getElementById('add-btn').style.display = 'block';    pollQueue.shift();    pollInProgress = false;    if (pollQueue.length > 0) processQueue();
}// ---- Slideshow queue ----const slideQueue = [];function refillQueue() {
    const usedUrls = new Set(slideQueue.map(p => p.baseUrl));    while (slideQueue.length < 10 && allPhotos.length > 0) {
        for (let tries = 0; tries < 30; tries++) {
            const pick = allPhotos[Math.floor(Math.random() * allPhotos.length)];            if (!usedUrls.has(pick.baseUrl)) {
                slideQueue.push(pick);                usedUrls.add(pick.baseUrl);                break;            }        }    }}function startSlideshow(token) {
    document.getElementById('slideshow').style.display = 'block';    document.getElementById('add-btn').style.display = 'block';    let showingImg1 = true;    const img1 = document.getElementById('img1'), img2 = document.getElementById('img2');    const bg1 = document.getElementById('bg1'), bg2 = document.getElementById('bg2');    document.getElementById('heartbeat').innerText = allPhotos.length;    async function next() {
        if (allPhotos.length === 0) return;        refillQueue();        const item = slideQueue.length > 0 ? slideQueue.shift() : allPhotos[Math.floor(Math.random() * allPhotos.length)];        let objectUrl = null;        try {
            // prefetch�� blob�� ������ ���, ������ fallback            const controller = new AbortController();            const timeoutId = setTimeout(() => controller.abort(), 3000);            let resp;            try {
                resp = await fetch(item.baseUrl + '=w1920-h1080', {
                     headers: {
 'Authorization': 'Bearer ' + token },                    signal: controller.signal                 });            } finally {
                clearTimeout(timeoutId);            }            if (!resp.ok) throw new Error('HTTP ' + resp.status);            const blob = await resp.blob();            objectUrl = URL.createObjectURL(blob);            const nextImg = showingImg1 ? img2 : img1;            const currentImg = showingImg1 ? img1 : img2;            const nextBg = showingImg1 ? bg2 : bg1;            const currentBg = showingImg1 ? bg1 : bg2;            const origins = ['0% 0%', '100% 0%', '0% 100%', '100% 100%', '50% 50%'];            const origin = origins[Math.floor(Math.random() * origins.length)];            nextImg.style.transition = 'none';            nextImg.style.transform = 'scale(1)';            nextImg.style.transformOrigin = origin;            nextBg.style.transition = 'none';            nextBg.style.transform = 'scale(1)';            void nextImg.offsetHeight;            nextImg.src = objectUrl;            nextBg.src = objectUrl;            nextImg.style.transition = 'transform 5s ease-out, opacity 2s';            nextImg.style.transform = 'scale(1.05)';            nextImg.style.opacity = 1;            nextBg.style.transition = 'opacity 2s';            nextBg.style.opacity = 1;            currentImg.style.opacity = 0;            currentBg.style.opacity = 0;            setTimeout(next, 5000);            setTimeout(() => {
                if (currentImg.src.startsWith('blob:')) URL.revokeObjectURL(currentImg.src);                if (currentBg.src.startsWith('blob:')) URL.revokeObjectURL(currentBg.src);            }, 2200);            showingImg1 = !showingImg1;            lastTransitionTime = Date.now();        } catch (e) {
            console.error('Slide error:', e.message || e);            if (objectUrl) URL.revokeObjectURL(objectUrl);            setTimeout(next, 5000);        }                   }    next();
}