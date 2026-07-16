import flet as ft
import os, requests, pickle, asyncio, base64, random, time, io
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from PIL import Image, ImageFilter, ImageOps

# --- [설정 정보: 데스크톱 클라이언트 JSON 사용] ---
CLIENT_SECRET_FILE = "client_secret.json"
SCOPES = ['https://www.googleapis.com/auth/photospicker.mediaitems.readonly']

class SmartFrameApp:
    def __init__(self, page: ft.Page):
        self.page = page
        self.creds = None
        self.photos = [] 
        self.current_idx = 0
        self.session_id = None
        self.running = False
        self.slide_interval = 5      
        self.picker_url = ""
        
        # [해결] 세션 종료 시 좀비 루프 방지 핸들러
        self.page.on_disconnect = self.handle_disconnect

    def check_existing_auth(self):
        """저장된 토큰 로드 및 자동 갱신"""
        if os.path.exists('token.pickle'):
            try:
                with open('token.pickle', 'rb') as token:
                    self.creds = pickle.load(token)
                if self.creds and self.creds.expired and self.creds.refresh_token:
                    self.creds.refresh(Request())
                    with open('token.pickle', 'wb') as token:
                        pickle.dump(self.creds, token)
            except: self.creds = None

    async def handle_disconnect(self, e):
        """브라우저 새로고침/종료 시 즉시 루프 중단"""
        self.running = False

    async def init_ui(self):
        """[핵심] 최신 Flet 통합 비동기 문법 적용"""
        self.page.clean()
        self.page.title = "Family Frame 4K v091 Final"
        self.page.bgcolor = "black"
        self.page.padding = 0
        self.check_existing_auth()
        
        # 이미지 레이어 초기화
        tp = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        self.img_bottom = ft.Image(src=tp, fit="contain", expand=True)
        self.img_top = ft.Image(src=tp, fit="contain", opacity=0, animate_opacity=1500, expand=True)
        
        self.interval_text = ft.Text(f"{self.slide_interval}초", size=16, color="white", weight="bold")
        self.interval_slider = ft.Slider(
            min=2, max=60, divisions=58, 
            value=self.slide_interval, on_change=self.set_interval, width=300
        )
        
        # 2단계 버튼 구조 (팝업 차단 우회)
        self.prepare_btn = ft.FilledButton("1. 사진 선택 준비", on_click=self.handle_prepare_picker, width=320, height=50)
        self.launch_btn = ft.FilledButton("구글 포토 창 열기 (클릭!)", on_click=self.handle_launch_picker, width=320, height=50, bgcolor="blue", visible=False)

        self.setup_overlay = ft.Container(
            content=ft.Column([
                ft.Text("4K 시네마틱 액자", size=26, weight="bold", color="white"),
                self.prepare_btn,
                self.launch_btn,
                ft.Column([
                    ft.Row([ft.Text("전환 간격: ", color="white70"), self.interval_text], alignment="center"),
                    self.interval_slider
                ], horizontal_alignment="center", spacing=5),
                ft.FilledButton("2. 슬라이드쇼 시작", icon="play_arrow", on_click=self.start_slideshow, width=320, height=50),
                ft.Text("Sony a7m3 & Fold 7 최적화 버전", size=10, color="white24")
            ], alignment="center", horizontal_alignment="center", spacing=25),
            alignment=ft.Alignment(0, 0), expand=True, bgcolor="#f2000000", visible=True
        )

        # [해결] add_async 대신 await add 사용
        await self.page.add(
            ft.Stack([
                ft.Container(content=self.img_bottom, alignment=ft.Alignment(0, 0), expand=True),
                ft.Container(content=self.img_top, alignment=ft.Alignment(0, 0), expand=True),
                self.setup_overlay
            ], expand=True)
        )

    async def set_interval(self, e): 
        self.slide_interval = int(e.control.value)
        self.interval_text.value = f"{self.slide_interval}초"
        await self.page.update()

    async def handle_prepare_picker(self, e):
        """1단계: 세션 준비"""
        try:
            self.prepare_btn.disabled = True
            self.prepare_btn.text = "준비 중..."
            await self.page.update()

            if not self.creds or not self.creds.valid:
                self.creds = await asyncio.to_thread(lambda: InstalledAppFlow.from_client_secrets_file(
                    CLIENT_SECRET_FILE, SCOPES
                ).run_local_server(port=0))
                with open('token.pickle', 'wb') as token: pickle.dump(self.creds, token)
            
            headers = {'Authorization': f'Bearer {self.creds.token}', 'Content-Type': 'application/json'}
            res = requests.post("https://photospicker.googleapis.com/v1/sessions", headers=headers, json={}).json()
            
            if 'pickerUri' in res:
                self.session_id = res['id']
                self.picker_url = res['pickerUri']
                self.prepare_btn.visible = False
                self.launch_btn.visible = True
            await self.page.update()
        except Exception as ex:
            print(f"준비 에러: {ex}")
            self.prepare_btn.disabled = False
            await self.page.update()

    async def handle_launch_picker(self, e):
        """2단계: 창 열기 (최신 비동기 규격 적용)"""
        if self.picker_url:
            await self.page.launch_url(self.picker_url)
            self.launch_btn.text = "사진 선택 후 이 창을 닫으세요"
            await self.page.update()

    async def start_slideshow(self, e):
        if not self.session_id: return
        await self.refresh_photo_list()
        if self.photos:
            self.setup_overlay.visible = False
            await self.page.update()
            if not self.running:
                self.running = True
                asyncio.create_task(self.run_slideshow_loop())

    async def refresh_photo_list(self):
        """무제한 페이지네이션 로딩"""
        headers = {'Authorization': f'Bearer {self.creds.token}'}
        all_items = []
        next_token = None
        while True:
            url = f"https://photospicker.googleapis.com/v1/mediaItems?sessionId={self.session_id}"
            if next_token: url += f"&pageToken={next_token}"
            resp = await asyncio.to_thread(lambda: requests.get(url, headers=headers).json())
            if 'mediaItems' in resp: all_items.extend(resp['mediaItems'])
            next_token = resp.get('nextPageToken')
            if not next_token or not self.running: break
        self.photos = all_items
        random.shuffle(self.photos)

    def process_image_ssr(self, raw_data):
        """Pillow 4K 전처리"""
        try:
            with Image.open(io.BytesIO(raw_data)) as img:
                img = img.convert("RGB")
                canvas_w, canvas_h = 3840, 2160 
                bg = ImageOps.fit(img, (canvas_w, canvas_h))
                bg = bg.filter(ImageFilter.GaussianBlur(radius=25))
                fg = img.copy()
                fg.thumbnail((canvas_w, canvas_h), Image.Resampling.LANCZOS)
                final = bg.copy()
                offset = ((canvas_w - fg.width) // 2, (canvas_h - fg.height) // 2)
                final.paste(fg, offset)
                buf = io.BytesIO()
                final.save(buf, format="JPEG", quality=80)
                return f"data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode('utf-8')}"
        except: return None

    async def run_slideshow_loop(self):
        """[해결] 세션 연결 상태를 체크하며 안전하게 루프 실행"""
        next_data = await self.fetch_image_data(self.current_idx)
        
        while self.running:
            try:
                start_time = time.time()
                if next_data and self.running:
                    self.img_top.src = next_data
                    await self.page.update()
                    await asyncio.sleep(1.0)
                    self.img_top.opacity = 1
                    await self.page.update()
                    await asyncio.sleep(1.7)
                    self.img_bottom.src = next_data
                    await self.page.update()
                    await asyncio.sleep(0.7)
                    self.img_top.opacity = 0
                    await self.page.update()
                    self.current_idx = (self.current_idx + 1) % len(self.photos)
                
                next_data = await self.fetch_image_data(self.current_idx)
                elapsed = time.time() - start_time
                await asyncio.sleep(max(0.1, self.slide_interval - elapsed))
                
            except Exception:
                self.running = False
                break

    async def fetch_image_data(self, idx):
        if not self.photos: return None
        item = self.photos[idx]
        img_url = f"{item['mediaFile']['baseUrl']}=w3840"
        headers = {'Authorization': f'Bearer {self.creds.token}'}
        try:
            resp = await asyncio.to_thread(lambda: requests.get(img_url, headers=headers))
            if resp.status_code == 200:
                return await asyncio.to_thread(self.process_image_ssr, resp.content)
        except: return None
        return None

async def main(page: ft.Page):
    app = SmartFrameApp(page)
    await app.init_ui()

if __name__ == "__main__":
    # ft.app의 비동기 실행 최신 규격 유지
    ft.app(target=main, view=ft.AppView.WEB_BROWSER, port=8501, host="0.0.0.0")