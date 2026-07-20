const CLIENT_ID = '232709413830-gjmgctle15h91vcm1i9vtb6h5lnrk84o.apps.googleusercontent.com';
let allPhotos = [];
let globalToken = null;
let pollInterval = null;
let lastTransitionTime = Date.now();

// 1분 이상 슬라이드가 멈추면 새로고침하는 Watchdog
setInterval(() => {
    // 슬라이드가 표시 중일 때만 검사 (로그인 버튼이 숨겨져 있을 때)
    if (document.getElementById('slideshow').style.display !== 'none' && Date.now() - lastTransitionTime > 60000) {
        console.error("슬라이드 멈춤 감지, 새로고침 시도");
        location.reload();
    }
}, 10000);

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function loadFromStorage() {
    const saved = localStorage.getItem('my_photos');
    const savedToken = localStorage.getItem('auth_token');
    if (saved && savedToken) {
        const urls = JSON.parse(saved);
        allPhotos = urls.map(url => ({ baseUrl: url }));
        globalToken = savedToken;
        return true;
    }
    return false;
}

function resetPhotos() {
    if(confirm("모든 사진 목록을 초기화할까요?")) {
        localStorage.removeItem('my_photos');
        localStorage.removeItem('auth_token');
        location.reload();
    }
}

window.onload = () => {
    if (loadFromStorage()) {
        document.getElementById('login-btn').style.display = 'none';
        startSlideshow(globalToken);
        document.getElementById('add-btn').style.display = 'block';
    }
};

document.getElementById('login-btn').onclick = function() {
    const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
        callback: async (res) => {
            if (res.access_token) {
                globalToken = res.access_token;
                localStorage.setItem('auth_token', res.access_token);
                const session = await fetch('https://photospicker.googleapis.com/v1/sessions', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + res.access_token }
                }).then(r => r.json());
                window.open(session.pickerUri, '_blank');
                document.getElementById('login-btn').style.display = 'none';
                pollPhotos(res.access_token, session.id);
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
        localStorage.removeItem('auth_token');
        document.getElementById('login-btn').style.display = 'block';
        document.getElementById('login-btn').click();
        return;
    }

    const session = await response.json();
    window.open(session.pickerUri, '_blank');
    pollPhotos(globalToken, session.id);
}

async function pollPhotos(token, sessionId) {
    console.log("사진 선택 대기 중...");
    if (pollInterval) clearInterval(pollInterval);
    
    pollInterval = setInterval(async () => {
        let allItems = [];
        let nextPageToken = null;
        
        // 페이지네이션 루프 추가
        do {
            const url = 'https://photospicker.googleapis.com/v1/mediaItems?sessionId=' + sessionId + (nextPageToken ? '&pageToken=' + nextPageToken : '');
            const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
            if (res.status !== 200) break;
            const data = await res.json();
            if (data.mediaItems) allItems.push(...data.mediaItems);
            nextPageToken = data.nextPageToken;
        } while (nextPageToken);

        if (allItems.length > 0) {
            const newUrls = allItems.map(p => p.mediaFile ? p.mediaFile.baseUrl : p.baseUrl);
            // 기존 allPhotos를 덮어쓰지 말고 합치도록 수정
            const uniqueUrls = new Set([...allPhotos.map(p => p.baseUrl), ...newUrls]);
            allPhotos = Array.from(uniqueUrls).map(url => ({ baseUrl: url }));
            
            const urlsOnly = allPhotos.map(p => p.baseUrl);
            localStorage.setItem('my_photos', JSON.stringify(urlsOnly));
            
            shuffleArray(allPhotos);
            console.log("현재 누적 사진 수:", allPhotos.length);
            clearInterval(pollInterval);
            
            // slideshow가 이미 시작되었더라도 업데이트
            if(document.getElementById('slideshow').style.display === 'none') {
                startSlideshow(token);
            }
            document.getElementById('add-btn').style.display = 'block';
        }
    }, 3000);
}

function startSlideshow(token) {
    document.getElementById('slideshow').style.display = 'block';
    document.getElementById('add-btn').style.display = 'block';
    let idx = 0, showingImg1 = true;
    const img1 = document.getElementById('img1'), img2 = document.getElementById('img2');
    const bg1 = document.getElementById('bg1'), bg2 = document.getElementById('bg2');
    
    async function next() {
        if (allPhotos.length === 0) return;
        const item = allPhotos[idx];
        const url = item.baseUrl + '=w1920-h1080';
        
        try {
            const response = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
            const objectUrl = URL.createObjectURL(await response.blob());
            
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
            
            if (currentImg.src.startsWith('blob:')) URL.revokeObjectURL(currentImg.src);
            if (currentBg.src.startsWith('blob:')) URL.revokeObjectURL(currentBg.src);
            
            showingImg1 = !showingImg1;
            idx = (idx + 1) % allPhotos.length;
            
            // 전환 시간 갱신
            lastTransitionTime = Date.now();
            
            // 프리패치 시도 (다음 5장)
            prefetchNext(idx, 5);

            setTimeout(next, 5000); // 5초 후 다음 장
        } catch (e) {
            console.error(e);
            idx = (idx + 1) % allPhotos.length;
            
            // 에러 시에도 감시자가 새로고침할 수 있게 lastTransitionTime을 갱신하지 않음
            // 하지만 너무 자주 재시도하는 것을 막기 위해 짧게 대기
            setTimeout(next, 1000); 
        }
    }

    async function prefetchNext(startIndex, count) {
        for (let i = 0; i < count; i++) {
            const nextIdx = (startIndex + i) % allPhotos.length;
            const item = allPhotos[nextIdx];
            const url = item.baseUrl + '=w1920-h1080';
            // 이미 캐시된(blob) 데이터가 있는지 체크는 복잡하니, 
            // 일단 fetch해서 브라우저 캐시라도 타게 함
            fetch(url, { headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {});
        }
    }

    next();
}