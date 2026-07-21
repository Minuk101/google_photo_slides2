
import re

with open("D:/민욱/구글포토_슬라이드쇼/index.html", "r", encoding="utf-8") as f:
    c = f.read()

old = """        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("sw.js");
        }"""

new = """        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("sw.js");
        }
        function sendTokenToSW(token) {
            navigator.serviceWorker.ready.then(reg => {
                if (reg.active) reg.active.postMessage({ type: "auth_token", token: token });
            });
        }"""

c = c.replace(old, new)

with open("D:/민욱/구글포토_슬라이드쇼/index.html", "w", encoding="utf-8") as f:
    f.write(c)
print("html done")

