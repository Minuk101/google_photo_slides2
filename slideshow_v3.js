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

// Debug EXIF parser
async function testGPS() {
    const item = allPhotos[0];
    if (!item) { alert("No photos loaded"); return; }
    
    try {
        const url = item.baseUrl + '=d';
        const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + globalToken } });
        const buf = await resp.arrayBuffer();
        const dv = new DataView(buf);
        
        let msg = "Size: " + (buf.byteLength / 1024).toFixed(0) + "KB\n";
        
        // Check file signature
        const sig = dv.getUint16(0).toString(16);
        msg += "Signature: 0x" + sig + "\n";
        if (sig !== "ffd8") { alert(msg + "\nNot a JPEG. It's " + sig); return; }
        
        // Read first APP marker
        const app1 = dv.getUint16(2).toString(16);
        msg += "First marker at 2: 0x" + app1 + "\n";
        
        // Check for Exif header
        let offset = 2;
        let appFound = false;
        while (offset < Math.min(buf.byteLength, 50000)) {
            const marker = dv.getUint16(offset);
            if (marker === 0xFFE1) {
                appFound = true;
                const len = dv.getUint16(offset + 2);
                msg += "APP1 found at " + offset + ", len=" + len + "\n";
                
                const exifId = String.fromCharCode(dv.getUint8(offset + 4), dv.getUint8(offset + 5), dv.getUint8(offset + 6), dv.getUint8(offset + 7), dv.getUint8(offset + 8), dv.getUint8(offset + 9));
                msg += "Exif ID: '" + exifId + "'\n";
                
                if (exifId !== "Exif\0\0") { alert(msg + "\nNo Exif header"); return; }
                
                const tiffStart = offset + 10;
                const byteOrder = dv.getUint16(tiffStart).toString(16);
                msg += "TIFF byte order: 0x" + byteOrder + "\n";
                
                const le = byteOrder === "4949";
                const magic = dv.getUint16(tiffStart + 2, le).toString(16);
                msg += "TIFF magic: 0x" + magic + "\n";
                
                if (magic !== "002a" && magic !== "2a00") { alert(msg + "\nNot TIFF"); return; }
                
                const ifd0Off = dv.getUint32(tiffStart + 4, le);
                msg += "IFD0 offset: " + ifd0Off + "\n";
                
                const ifd0Start = tiffStart + ifd0Off;
                const numEntries = dv.getUint16(ifd0Start, le);
                msg += "IFD0 entries: " + numEntries + "\n";
                
                let gpsIfdOff = null;
                for (let i = 0; i < numEntries; i++) {
                    const entryOff = ifd0Start + 2 + i * 12;
                    const tag = dv.getUint16(entryOff, le).toString(16);
                    if (tag === "8825") {
                        gpsIfdOff = dv.getUint32(entryOff + 8, le);
                        msg += "GPS IFD pointer found: " + gpsIfdOff + "\n";
                        break;
                    }
                }
                
                if (gpsIfdOff === null) {
                    // Try to parse SubIFD (tag 0x8769 for ExifIFD, which may contain GPS)
                    msg += "No GPS tag in IFD0. Checking other tags...\n";
                    for (let i = 0; i < numEntries; i++) {
                        const entryOff = ifd0Start + 2 + i * 12;
                        const tag = dv.getUint16(entryOff, le).toString(16);
                        const type = dv.getUint16(entryOff + 2, le);
                        msg += "  Tag: 0x" + tag + " Type:" + type + "\n";
                    }
                    alert(msg);
                    return;
                }
                
                const gpsStart = tiffStart + gpsIfdOff;
                const gpsEntries = dv.getUint16(gpsStart, le);
                msg += "GPS IFD entries: " + gpsEntries + "\n";
                
                let latData = null, lonData = null, latRef = "N", lonRef = "E";
                
                for (let i = 0; i < gpsEntries; i++) {
                    const entryOff = gpsStart + 2 + i * 12;
                    const tag = dv.getUint16(entryOff, le);
                    const type = dv.getUint16(entryOff + 2, le);
                    const count = dv.getUint32(entryOff + 4, le);
                    
                    msg += "  GPS tag: 0x" + tag.toString(16) + " type:" + type + " count:" + count + "\n";
                    
                    const valueOff = count > 1 ? tiffStart + dv.getUint32(entryOff + 8, le) : entryOff + 8;
                    
                    if (tag === 0x01) {
                        latRef = String.fromCharCode(dv.getUint8(valueOff));
                    } else if (tag === 0x02) {
                        latData = [
                            dv.getUint32(valueOff, le) / dv.getUint32(valueOff + 4, le),
                            dv.getUint32(valueOff + 8, le) / dv.getUint32(valueOff + 12, le),
                            dv.getUint32(valueOff + 16, le) / dv.getUint32(valueOff + 20, le)
                        ];
                    } else if (tag === 0x03) {
                        lonRef = String.fromCharCode(dv.getUint8(valueOff));
                    } else if (tag === 0x04) {
                        lonData = [
                            dv.getUint32(valueOff, le) / dv.getUint32(valueOff + 4, le),
                            dv.getUint32(valueOff + 8, le) / dv.getUint32(valueOff + 12, le),
                            dv.getUint32(valueOff + 16, le) / dv.getUint32(valueOff + 20, le)
                        ];
                    }
                }
                
                if (latData && lonData) {
                    const lat = latData[0] + latData[1]/60 + latData[2]/3600;
                    const lon = lonData[0] + lonData[1]/60 + lonData[2]/3600;
                    const latStr = (latRef === "S" ? -lat : lat).toFixed(6);
                    const lonStr = (lonRef === "W" ? -lon : lon).toFixed(6);
                    msg += "\nGPS found!\nLat: " + latStr + "\nLng: " + lonStr;
                    alert(msg + "\n\nOpening OpenStreetMap...");
                    window.open("https://www.openstreetmap.org/?mlat=" + latStr + "&mlon=" + lonStr, "_blank");
                } else {
                    msg += "\nGPS tags incomplete. lat=" + (!!latData) + " lon=" + (!!lonData);
                    alert(msg);
                }
                return;
            }
            offset++;
            if (offset > buf.byteLength - 2) break;
        }
        
        if (!appFound) {
            msg += "\nNo APP1 EXIF marker found in first 50KB.";
            // Check if there are any APP markers at all
            let markers = [];
            for (let i = 2; i < Math.min(buf.byteLength - 1, 200); i++) {
                if (dv.getUint8(i) === 0xFF && (dv.getUint8(i+1) & 0xF0) === 0xE0) {
                    markers.push("0x" + dv.getUint16(i).toString(16));
                }
            }
            msg += "\nFound APP markers nearby: " + (markers.length ? markers.join(", ") : "none");
        }
        
        alert(msg);
    } catch (e) {
        alert("Error: " + e.message + "\n\n" + e.stack);
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


