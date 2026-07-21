with open("D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js", "r", encoding="utf-8") as f:
    c = f.read()

# Replace the slideshow image loading logic to use direct img src instead of fetch+blob
old = '''        const item = prefetchQueue.shift();
        let objectUrl = null;
        let blob = prefetchBlobs.get(item.baseUrl);
        
        if (blob) {
            prefetchBlobs.delete(item.baseUrl);
        } else {
            try {
                const resp = await fetch(item.baseUrl + '=w1920-h1080', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                blob = await resp.blob();
            } catch (e) {
                setTimeout(next, 500);
                return;
            }
        }

        objectUrl = URL.createObjectURL(blob);'''

new = '''        const item = prefetchQueue.shift();
        const imageUrl = item.baseUrl + '=w1920-h1080';'''

c = c.replace(old, new)

# Replace image src assignment
c = c.replace("nextImg.src = objectUrl;\n            nextBg.src = objectUrl;", "nextImg.src = imageUrl;\n            nextBg.src = imageUrl;")

# Remove blob revoke lines
c = c.replace("""            setTimeout(() => {
                if (currentImg.src.startsWith('blob:')) URL.revokeObjectURL(currentImg.src);
                if (currentBg.src.startsWith('blob:')) URL.revokeObjectURL(currentBg.src);
            }, 2200);""", "")

with open("D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js", "w", encoding="utf-8") as f:
    f.write(c)
print("done")
