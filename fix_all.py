with open("D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js", "r", encoding="utf-8") as f:
    c = f.read()

# Add sendTokenToSW calls
c = c.replace("globalToken = res.access_token;", "globalToken = res.access_token;\n                if (typeof sendTokenToSW !== \"undefined\") sendTokenToSW(globalToken);")
c = c.replace("globalToken = token;\n        sendTokenToSW(globalToken);\n        return true;", "globalToken = token;\n        if (typeof sendTokenToSW !== \"undefined\") sendTokenToSW(globalToken);\n        return true;")

# Replace the entire slideshow show logic
old = """        const item = prefetchQueue.shift();
        const imageUrl = item.baseUrl + '=w1920-h1080';
        let objectUrl = null;
        try {
                const resp = await fetch(imageUrl, { headers: { "Authorization": "Bearer " + token } });
                if (!resp.ok) throw new Error("HTTP " + resp.status);
                const blob = await resp.blob();
                objectUrl = URL.createObjectURL(blob);
            } catch (e) {
                setTimeout(next, 500);
                return;
            }
            nextImg.src = objectUrl;
            nextBg.src = objectUrl;"""

new = """        const item = prefetchQueue.shift();
        const imageUrl = item.baseUrl + '=w1920-h1080';
        nextImg.src = imageUrl;
        nextBg.src = imageUrl;"""

c = c.replace(old, new)

# Remove blob revoke
old2 = """            setTimeout(() => {
                if (currentImg.src.startsWith("blob:")) URL.revokeObjectURL(currentImg.src);
                if (currentBg.src.startsWith("blob:")) URL.revokeObjectURL(currentBg.src);
            }, 2200);"""
c = c.replace(old2, "")

# Fix catch block
old3 = """        } catch (e) {
            console.error(e);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        }"""
new3 = """        } catch (e) {
            console.error(e);
        }"""
c = c.replace(old3, new3)

with open("D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js", "w", encoding="utf-8") as f:
    f.write(c)
print("done")
