with open("D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js", "r", encoding="utf-8") as f:
    c = f.read()

# Remove Authorization from refillQueue fetch
c = c.replace(
    "const resp = await fetch(item.baseUrl + '=w1920-h1080', {\n                headers: { 'Authorization': 'Bearer ' + token }\n            });",
    "const resp = await fetch(item.baseUrl + '=w1920-h1080');"
)

# Remove from fallback in next()
c = c.replace(
    "const resp = await fetch(item.baseUrl + '=w1920-h1080', {\n                    headers: { 'Authorization': 'Bearer ' + token }\n                });",
    "const resp = await fetch(item.baseUrl + '=w1920-h1080');"
)

with open("D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js", "w", encoding="utf-8") as f:
    f.write(c)
print("done")
