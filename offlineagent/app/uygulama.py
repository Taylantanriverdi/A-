"""Uygulama sunucusu: kullanıcının kendi web programlarını (ör. PrimerLab .html dosyası) http://localhost:<port+1>
adresinden açar ve onlara bu bilgisayardaki yapay zekayı sağlar.

Neden ayrı bir adres? Bilgisayarda çift tıklanarak açılan .html dosyalarına Ollama güvenlik gereği cevap vermez.
Bu sunucu dosyayı kendisi sunduğu için sayfa ile yapay zeka aynı adreste olur; hiçbir siteye izin açmak gerekmez.
Offline Agent arayüzünden ayrı bir adres (port) kullanılır: bu sayfalar ajanın bilgisayarı yöneten uçlarına
erişemez. Sadece bu bilgisayardan (127.0.0.1) açılabilir; başka sitelerden gelen istekler reddedilir.
"""
import html
import re
import threading
import urllib.parse
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse

from ayarlar import KOK, ayarlari_oku
from ollama_api import OLLAMA

KLASOR = KOK / "uygulamalar"
PORT = int(ayarlari_oku().get("port", 8765)) + 1
IZINLI_HOSTLAR = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
# Sayfaların kullanabileceği Ollama uçları (model indirme/silme gibi yönetim uçları kapalı)
OLLAMA_UCLARI = {("POST", "api/chat"), ("POST", "api/generate"), ("GET", "api/tags"), ("GET", "api/version")}

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def koruma(request: Request, call_next):
    host = request.headers.get("host", "")
    if host not in IZINLI_HOSTLAR:
        return JSONResponse({"hata": "İzin verilmeyen adres"}, status_code=403)
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD") and origin and origin != f"http://{host}":
        return JSONResponse({"hata": "İzin verilmeyen kaynak"}, status_code=403)
    yanit = await call_next(request)
    yanit.headers["Cache-Control"] = "no-cache"
    return yanit


def _dosyalar() -> list[Path]:
    KLASOR.mkdir(parents=True, exist_ok=True)
    return sorted(p for p in KLASOR.iterdir() if p.is_file() and p.suffix.lower() in (".html", ".htm"))


@app.get("/", response_class=HTMLResponse)
async def liste():
    satirlar = "".join(
        f'<li><a href="/{urllib.parse.quote(p.name)}">{html.escape(p.stem)}</a></li>' for p in _dosyalar())
    return (
        "<!doctype html><meta charset='utf-8'><title>Uygulamalar</title>"
        "<body style='font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px'>"
        "<h2>Offline Agent — Uygulamalar</h2>"
        f"<ul>{satirlar or '<li>Henüz uygulama yok.</li>'}</ul>"
        f"<p style='color:#666'>Web programlarınızı (.html) <b>{html.escape(str(KLASOR))}</b> klasörüne koyun. "
        "Buradan açılan programlar bu bilgisayardaki yapay zekayı <code>/ollama</code> adresinden kullanabilir.</p>"
    )


@app.api_route("/ollama/{yol:path}", methods=["GET", "POST"])
async def ollama_vekil(yol: str, request: Request):
    if (request.method, yol) not in OLLAMA_UCLARI:
        raise HTTPException(404, "Bu Ollama ucu kapalı")
    # Cevap parça parça aktarılır: sayfa kelimeleri geldikçe gösterebilir
    istemci = httpx.AsyncClient(timeout=300)
    try:
        istek = istemci.build_request(request.method, f"{OLLAMA}/{yol}", content=await request.body(),
                                      headers={"Content-Type": "application/json"})
        yanit = await istemci.send(istek, stream=True)
    except httpx.HTTPError as hata:
        await istemci.aclose()
        return JSONResponse({"error": f"Ollama'ya ulaşılamadı: {hata}"}, status_code=502)

    async def akis():
        try:
            async for parca in yanit.aiter_raw():
                yield parca
        finally:
            await yanit.aclose()
            await istemci.aclose()

    return StreamingResponse(akis(), status_code=yanit.status_code,
                             media_type=yanit.headers.get("content-type", "application/json"))


@app.get("/{ad}")
async def dosya(ad: str):
    hedef = next((p for p in _dosyalar() if p.name == ad), None)
    if hedef is None or not re.fullmatch(r"[^/\\]+\.html?", ad, re.I):
        raise HTTPException(404, "Bulunamadı")
    return FileResponse(hedef, media_type="text/html")


def baslat() -> None:
    """Ana sunucuyla birlikte arka planda çalışır; sadece bu bilgisayardan erişilebilir."""
    import uvicorn

    sunucu = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="warning"))
    threading.Thread(target=sunucu.run, daemon=True, name="uygulama-sunucusu").start()
