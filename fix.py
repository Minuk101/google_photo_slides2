import re

with open("D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js", "r", encoding="utf-8") as f:
    c = f.read()

# Replace all ensurePrefetch with ensurePrefetch + prepareNext
c = c.replace("ensurePrefetch(token);", "ensurePrefetch(token);\n            prepareNext();", 3)

with open("D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js", "w", encoding="utf-8") as f:
    f.write(c)
print("done")
