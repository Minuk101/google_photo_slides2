import re

with open("D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js", "r", encoding="utf-8") as f:
    c = f.read()

# Simplify refillQueue
old = """async function refillQueue(token) {
    prefetchToken = token;
    if (prefetchWorking) return;
    prefetchWorking = true;
    
    const usedUrls = new Set(prefetchQueue.map(p => p.baseUrl));
    while (prefetchQueue.length < 10 && allPhotos.length > 0) {
        for (let tries = 0; tries < 30; tries++) {
            const pick = allPhotos[Math.floor(Math.random() * allPhotos.length)];
            if (!usedUrls.has(pick.baseUrl)) {
                prefetchQueue.push(pick);
                usedUrls.add(pick.baseUrl);
                break;
            }
        }
    }
    
    for (const item of prefetchQueue) {
        if (prefetchBlobs.has(item.baseUrl)) continue;
        try {
            const resp = await fetch(item.baseUrl + '=w1920-h1080');
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
}"""

new = """async function refillQueue(token) {
    if (prefetchWorking) return;
    prefetchWorking = true;
    
    const usedUrls = new Set(prefetchQueue.map(p => p.baseUrl));
    while (prefetchQueue.length < 10 && allPhotos.length > 0) {
        for (let tries = 0; tries < 30; tries++) {
            const pick = allPhotos[Math.floor(Math.random() * allPhotos.length)];
            if (!usedUrls.has(pick.baseUrl)) {
                prefetchQueue.push(pick);
                usedUrls.add(pick.baseUrl);
                break;
            }
        }
    }
    
    // Warm browser cache
    const notFetched = prefetchQueue.filter(p => !p._fetched);
    if (notFetched.length > 0) {
        const item = notFetched[0];
        item._fetched = true;
        fetch(item.baseUrl + '=w1920-h1080', { mode: 'no-cors' }).catch(() => {});
    }
    
    prefetchWorking = false;
    if (prefetchQueue.length < 10) refillQueue(token);
}"""

c = c.replace(old, new)

# Remove unused vars
c = c.replace("const prefetchBlobs = new Map();\n", "")

with open("D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js", "w", encoding="utf-8") as f:
    f.write(c)
print("done")
