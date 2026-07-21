const CLIENT_ID = '232709413830-gjmgctle15h91vcm1i9vtb6h5lnrk84o.apps.googleusercontent.com';
let allPhotos = [];
let globalToken = null;
let lastTransitionTime = Date.now();
let pollQueue = [];
let pollInProgress = false;

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
        allPhotos = saved;
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
        document.getElementById('gps-btn').style.display = 'block';
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
    
    while (true) {
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
            const newItems = allItems.map(p => ({
                baseUrl: p.mediaFile ? p.mediaFile.baseUrl : p.baseUrl
            })).filter(p => p.baseUrl);
            
            allPhotos.push(...newItems);
            await dbPut('photos', allPhotos);
            
            console.log("Added", newItems.length, "photos. Total:", allPhotos.length);
            document.getElementById('heartbeat').innerText = allPhotos.length;
            
            if (document.getElementById('slideshow').style.display === 'none') {
                startSlideshow(token);
            }
            document.getElementById('add-btn').style.display = 'block';
            document.getElementById('gps-btn').style.display = 'block';
            break;
        }
        
        await new Promise(r => setTimeout(r, 3000));
    }
    
    pollQueue.shift();
    pollInProgress = false;
    processQueue();
}

// Minimal EXIF GPS reader (no external library needed)
async function testGPS() {
    const item = allPhotos[0];
    if (!item) { alert("No photos loaded"); return; }
    
    try {
        const url = item.baseUrl + '=d';
        const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + globalToken } });
        const buf = await resp.arrayBuffer();
        const dv = new DataView(buf);
        
        // Find EXIF header
        if (dv.getUint16(0) !== 0xFFD8) { alert("Not a JPEG"); return; }
        
        let offset = 2;
        while (offset < buf.byteLength) {
            if (dv.getUint16(offset) === 0xFFE1) {
                const exifLen = dv.getUint16(offset + 2);
                const exifStart = offset + 4;
                const tiffStart = exifStart + 6; // skip "Exif\0\0"
                
                const littleEndian = dv.getUint16(tiffStart) === 0x4949;
                const ifd0Offset = dv.getUint32(tiffStart + 4, littleEndian) + tiffStart;
                
                // Parse IFD0 to find GPS IFD pointer (tag 0x8825)
                let gpsIfdOffset = 0;
                const numEntries = dv.getUint16(ifd0Offset, littleEndian);
                for (let i = 0; i < numEntries; i++) {
                    const entryOff = ifd0Offset + 2 + i * 12;
                    const tag = dv.getUint16(entryOff, littleEndian);
                    if (tag === 0x8825) {
                        gpsIfdOffset = dv.getUint32(entryOff + 8, littleEndian) + tiffStart;
                        break;
                    }
                }
                
                if (!gpsIfdOffset) { alert("No GPS IFD found."); return; }
                
                // Parse GPS IFD
                const gpsEntries = dv.getUint16(gpsIfdOffset, littleEndian);
                let latRef = 'N', lonRef = 'E';
                let latData = null, lonData = null;
                
                for (let i = 0; i < gpsEntries; i++) {
                    const entryOff = gpsIfdOffset + 2 + i * 12;
                    const tag = dv.getUint16(entryOff, littleEndian);
                    const type = dv.getUint16(entryOff + 2, littleEndian);
                    const count = dv.getUint32(entryOff + 4, littleEndian);
                    const valueOff = count > 1 ? dv.getUint32(entryOff + 8, littleEndian) + tiffStart : entryOff + 8;
                    
                    if (tag === 0x0001) { // GPSLatitudeRef
                        latRef = String.fromCharCode(dv.getUint8(valueOff));
                    } else if (tag === 0x0002) { // GPSLatitude
                        latData = [dv.getUint32(valueOff, littleEndian) / dv.getUint32(valueOff + 4, littleEndian),
                                   dv.getUint32(valueOff + 8, littleEndian) / dv.getUint32(valueOff + 12, littleEndian),
                                   dv.getUint32(valueOff + 16, littleEndian) / dv.getUint32(valueOff + 20, littleEndian)];
                    } else if (tag === 0x0003) { // GPSLongitudeRef
                        lonRef = String.fromCharCode(dv.getUint8(valueOff));
                    } else if (tag === 0x0004) { // GPSLongitude
                        lonData = [dv.getUint32(valueOff, littleEndian) / dv.getUint32(valueOff + 4, littleEndian),
                                   dv.getUint32(valueOff + 8, littleEndian) / dv.getUint32(valueOff + 12, littleEndian),
                                   dv.getUint32(valueOff + 16, littleEndian) / dv.getUint32(valueOff + 20, littleEndian)];
                    }
                }
                
                if (latData && lonData) {
                    const lat = latData[0] + latData[1]/60 + latData[2]/3600;
                    const lon = lonData[0] + lonData[1]/60 + lonData[2]/3600;
                    const latStr = (latRef === 'S' ? -lat : lat).toFixed(6);
                    const lonStr = (lonRef === 'W' ? -lon : lon).toFixed(6);
                    alert("GPS found!\nLat: " + latStr + "\nLng: " + lonStr + "\n\nOpen: https://www.openstreetmap.org/?mlat=" + latStr + "&mlon=" + lonStr);
                    window.open("https://www.openstreetmap.org/?mlat=" + latStr + "&mlon=" + lonStr, "_blank");
                } else {
                    alert("No GPS coordinates in the EXIF data.");
                }
                return;
            }
            offset++;
        }
        alert("No EXIF data found in this JPEG.");
    } catch (e) {
        alert("Error: " + e.message);
    }
}

function startSlideshow(token) {
    document.getElementById('slideshow').style.display = 'block';
    document.getElementById('add-btn').style.display = 'block';
    document.getElementById('gps-btn').style.display = 'block';
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

