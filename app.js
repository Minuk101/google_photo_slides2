const CLIENT_ID = '232709413830-gjmgctle15h91vcm1i9vtb6h5lnrk84o.apps.googleusercontent.com';
let allPhotos = [];
let globalToken = null;
let pollInterval = null;

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            alert(`전체화면 오류: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
}

document.getElementById('login-btn').onclick = function() {
    const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
        callback: async (res) => {
            if (res.access_token) {
                globalToken = res.access_token;
                createAndOpenSession(res.access_token);
                document.getElementById('login-btn').style.display = 'none';
            }
        }
    });
    client.requestAccessToken();
};

async function addMorePhotos() {
    if (!globalToken) return;
    createAndOpenSession(globalToken);
}

async function createAndOpenSession(token) {
    const session = await fetch('https://photospicker.googleapis.com/v1/sessions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
    }).then(r => r.json());
    window.open(session.pickerUri, '_blank');
    pollPhotos(token, session.id);
}

async function pollPhotos(token, sessionId) {
    console.log("사진 선택 대기 중...");
    if (pollInterval) clearInterval(pollInterval);
    
    pollInterval = setInterval(async () => {
        const res = await fetch('https://photospicker.googleapis.com/v1/mediaItems?sessionId=' + sessionId, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.status !== 200) return;
        const data = await res.json();
        if (data.mediaItems?.length > 0) {
            allPhotos.push(...data.mediaItems);
            shuffleArray(allPhotos);
            console.log("현재 누적 사진 수:", allPhotos.length);
            clearInterval(pollInterval);
            
            if(document.getElementById('slideshow').style.display === 'none') {
                startSlideshow(token);
                document.getElementById('add-btn').style.display = 'block';
            }
        }
    }, 3000);
}

function startSlideshow(token) {
    document.getElementById('slideshow').style.display = 'block';
    let idx = 0, showingImg1 = true;
    const img1 = document.getElementById('img1'), img2 = document.getElementById('img2'), bg = document.getElementById('bg-layer');
    
    async function next() {
        if (allPhotos.length === 0) return;
        const item = allPhotos[idx];
        const url = (item.mediaFile ? item.mediaFile.baseUrl : item.baseUrl) + '=w1920-h1080';
        
        try {
            const response = await fetch(url, { headers: 'Authorization: Bearer ' + token });
            const objectUrl = URL.createObjectURL(await response.blob());
            
            bg.style.backgroundImage = 'url("' + objectUrl + '")';
            
            const nextImg = showingImg1 ? img2 : img1;
            const currentImg = showingImg1 ? img1 : img2;
            
            nextImg.src = objectUrl;
            nextImg.style.opacity = 1;
            currentImg.style.opacity = 0;
            
            if (currentImg.src.startsWith('blob:')) URL.revokeObjectURL(currentImg.src);
            
            showingImg1 = !showingImg1;
            idx = (idx + 1) % allPhotos.length;
        } catch (e) {
            console.error(e);
            idx = (idx + 1) % allPhotos.length;
            next();
        }
    }
    
    next();
    setInterval(next, 5000);
}