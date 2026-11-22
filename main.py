from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, UploadFile, File
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse
from contextlib import asynccontextmanager
import hashlib
from functools import lru_cache
import json
from pathlib import Path
from typing import List

from auth import (
    verify_token, create_token, verify_password,
    is_configured, password_error, create_initial_password, set_password,
)
from fonts import FONTS_DIR, FONT_MEDIA_TYPES, MAX_FONT_BYTES, font_path, is_valid_font_name, list_fonts
from state import (
    get_state, update_state, init_db, ROUNDS, DEFAULT_THEME, FONT_SIZES,
    cache_player, cache_event, get_player_cache, get_event_cache,
)


class ConnectionManager:
    def __init__(self):
        self.connections: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.connections:
            self.connections.remove(ws)

    async def broadcast(self, data: dict):
        message = json.dumps(data)
        dead = []
        for ws in self.connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.connections.remove(ws)


manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


@lru_cache(maxsize=None)
def static_url(path: str) -> str:
    """/static URL with a content hash, so a changed file never hits a stale CDN cache entry."""
    digest = hashlib.md5((Path("static") / path).read_bytes()).hexdigest()[:10]
    return f"/static/{path}?v={digest}"


templates.env.globals["static_url"] = static_url


def _require_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = auth[7:]
    if not verify_token(token):
        raise HTTPException(status_code=401, detail="Invalid token")
    return token


@app.get("/", response_class=HTMLResponse)
async def scoreboard(request: Request):
    state = await get_state()
    return templates.TemplateResponse(request, "scoreboard.html", {"state": state})


@app.get("/control", response_class=HTMLResponse)
async def control_page(request: Request):
    if not is_configured():
        return RedirectResponse("/setup", status_code=303)
    return templates.TemplateResponse(request, "control.html", {"rounds": ROUNDS})


@app.get("/setup", response_class=HTMLResponse)
async def setup_page(request: Request):
    if is_configured():
        return RedirectResponse("/control", status_code=303)
    return templates.TemplateResponse(request, "setup.html", {})


@app.get("/appearance", response_class=HTMLResponse)
async def appearance_page(request: Request):
    if not is_configured():
        return RedirectResponse("/setup", status_code=303)
    return templates.TemplateResponse(request, "appearance.html", {"default_theme": DEFAULT_THEME, "font_sizes": FONT_SIZES})


@app.post("/auth/login")
async def login(request: Request):
    body = await request.json()
    if not verify_password(body.get("password", "")):
        raise HTTPException(status_code=401, detail="Invalid password")
    return {"token": create_token()}


@app.post("/auth/setup")
async def auth_setup(request: Request):
    body = await request.json()
    password = body.get("password", "")
    if is_configured():
        raise HTTPException(status_code=409, detail="Password already set")
    err = password_error(password)
    if err:
        raise HTTPException(status_code=400, detail=err)
    if not create_initial_password(password):
        raise HTTPException(status_code=409, detail="Password already set")
    return {"token": create_token()}


@app.post("/auth/change-password")
async def change_password(request: Request):
    _require_token(request)
    body = await request.json()
    if not verify_password(body.get("current_password", "")):
        raise HTTPException(status_code=403, detail="Current password is incorrect")
    err = password_error(body.get("new_password", ""))
    if err:
        raise HTTPException(status_code=400, detail=err)
    set_password(body["new_password"])
    return {"token": create_token()}


@app.get("/api/state")
async def api_state(request: Request):
    _require_token(request)
    return await get_state()


@app.post("/api/update")
async def api_update(request: Request):
    _require_token(request)
    body = await request.json()
    state = await update_state(body)
    if "player1_name" in body:
        await cache_player(body["player1_name"])
    if "player2_name" in body:
        await cache_player(body["player2_name"])
    if "event_name" in body:
        await cache_event(body["event_name"])
    await manager.broadcast(state)
    return state


@app.get("/api/players")
async def api_players(request: Request):
    _require_token(request)
    return await get_player_cache()


@app.get("/api/events")
async def api_events(request: Request):
    _require_token(request)
    return await get_event_cache()


@app.get("/api/fonts")
async def api_fonts(request: Request):
    _require_token(request)
    return list_fonts()


@app.post("/api/fonts")
async def api_upload_font(request: Request, file: UploadFile = File(...)):
    _require_token(request)
    name = Path(file.filename or "").name
    if not is_valid_font_name(name):
        raise HTTPException(status_code=400, detail="Unsupported font file")
    data = await file.read(MAX_FONT_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_FONT_BYTES:
        raise HTTPException(status_code=413, detail="Font too large (max 10 MB)")
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    (FONTS_DIR / name).write_bytes(data)
    return {"name": name, "fonts": list_fonts()}


@app.get("/fonts/{name}")
async def get_font(name: str):
    p = font_path(name)
    if p is None:
        raise HTTPException(status_code=404, detail="Font not found")
    return FileResponse(p, media_type=FONT_MEDIA_TYPES[p.suffix.lower()], headers={"Cache-Control": "no-cache"})


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    state = await get_state()
    await websocket.send_text(json.dumps(state))
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
