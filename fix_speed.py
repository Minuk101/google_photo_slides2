import re
with open('D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js', 'r', encoding='utf-8') as f:
    c = f.read()

# Remove all speed-btn display lines
c = re.sub(r"document\.getElementById\('speed-(?:down|up)'\)\.style\.display = 'block';\s*", "", c)

# Add back in exactly two places
c = c.replace(
    "function startSlideshow(token) {",
    "function startSlideshow(token) {\n    document.getElementById('speed-down').style.display = 'block';\n    document.getElementById('speed-up').style.display = 'block';",
    1
)

c = c.replace(
    "document.getElementById('add-btn').style.display = 'block';",
    "document.getElementById('add-btn').style.display = 'block';\n    document.getElementById('speed-down').style.display = 'block';\n    document.getElementById('speed-up').style.display = 'block';",
    1
)

# Fix zoom scale
c = c.replace("scale(1.15)", "scale(1.05)")

with open('D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js', 'w', encoding='utf-8') as f:
    f.write(c)
print('done')
