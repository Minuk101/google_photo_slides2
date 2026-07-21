import re

with open('D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js', 'r', encoding='utf-8') as f:
    c = f.read()

# Replace the inside of the timeout callback to also call prepareNext
c = c.replace('ensurePrefetch(token);
            setTimeout(next, 5000);', 'ensurePrefetch(token);
            prepareNext();
            setTimeout(next, 5000);')

# Also call prepareNext before the first next()
c = c.replace('    ensurePrefetch(token);
    prepareNext();
    
    async function next() {', '    ensurePrefetch(token);
    prepareNext();
    async function next() {')

with open('D:/민욱/구글포토_슬라이드쇼/slideshow_v3.js', 'w', encoding='utf-8') as f:
    f.write(c)
print('done')
