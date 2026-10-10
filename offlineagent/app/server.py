"""Offline Agent sunucusu: arayüzü sunar, sohbeti yerel Ollama'ya iletir, belgelerden cevap üretir.

Sadece 127.0.0.1 üzerinde dinler; internete hiçbir istek göndermez.
"""
import json
import os
import re
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from ayarlar import KOK, ayarlari_oku, surum
from belge_oku import DESTEKLENEN
from rag import BelgeIndeksi

OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
BELGELER = KOK / "belgeler"
PORT = int(os.environ.get("OFFLINEAGENT_PORT") or ayarlari_oku()["port"])
IZINLI_HOSTLAR = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}

SISTEM = {
    "genel": (
        "Sen Offline Agent adında, tamamen bu bilgisayarda çalışan yardımcı bir asistansın. "
        "Kullanıcı hangi dilde yazarsa o dilde cevap ver; varsayılan dilin Türkçe. "
        "Net ve doğru ol. Emin olmadığın konularda uydurma, bilmediğini açıkça söyle."
    ),
    "kod": (
        "Sen deneyimli bir yazılım geliştirme asistanısın ve tamamen bu bilgisayarda çalışıyorsun. "
        "Çalışan, okunaklı kod yaz; kod bloklarını dil etiketiyle (```python gibi) ver. "
        "Açıklamaları kısa tut ve Türkçe yap."
    ),
}

indeks = BelgeIndeksi(BELGELER, KOK / "veri" / "indeks", OLLAMA, lambda: ayarlari_oku()["embed_model"])


@asynccontextmanager
async def omur(_: FastAPI):
    indeks.yukle()
    indeks.tara_baslat()  # Açılışta yeni/değişen belgeleri işle
    yield


app = FastAPI(title="Offline Agent", lifespan=omur, docs_url=None, redoc_url=None)


@app.middleware("http")
async def yerel_koruma(request: Request, call_next):
    # Başka sitelerin tarayıcı üzerinden bu sunucuya erişmesini engeller
    if request.headers.get("host") not in IZINLI_HOSTLAR:
        return JSONResponse({"hata": "İzin verilmeyen adres"}, status_code=403)
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD") and origin and origin not in {f"http://{h}" for h in IZINLI_HOSTLAR}:
        return JSONResponse({"hata": "İzin verilmeyen kaynak"}, status_code=403)
    return await call_next(request)


class Mesaj(BaseModel):
    role: str
    content: str


class SohbetIstegi(BaseModel):
    mesajlar: list[Mesaj]
    mod: str = "genel"
    belgeler: bool = False


class OllamaHatasi(Exception):
    pass


def _tam_ad(model: str) -> str:
    return model if ":" in model else f"{model}:latest"


async def _hazirla(istek: SohbetIstegi) -> tuple[str, list[dict], list[dict]]:
    ayarlar = ayarlari_oku()
    mod = "kod" if istek.mod == "kod" else "genel"
    model = ayarlar["kod_model"] if mod == "kod" else ayarlar["genel_model"]
    gecmis = [m.model_dump() for m in istek.mesajlar if m.role in ("user", "assistant")][-20:]
    sistem = SISTEM[mod]
    kaynaklar: list[dict] = []
    son_soru = next((m["content"] for m in reversed(gecmis) if m["role"] == "user"), "")
    if istek.belgeler and son_soru:
        try:
            kaynaklar = await run_in_threadpool(indeks.ara, son_soru)
        except httpx.HTTPError as hata:
            raise OllamaHatasi(f"Belge araması yapılamadı: {hata}") from hata
        if kaynaklar:
            bolumler = "\n\n".join(
                f"[{i}] ({k['kaynak']}{', ' + k['sayfa'] if k['sayfa'] else ''})\n{k['metin']}"
                for i, k in enumerate(kaynaklar, 1)
            )
            sistem += (
                "\n\nAşağıda kullanıcının kendi belgelerinden bulunan bölümler var. Cevabını öncelikle bunlara "
                "dayandır ve kullandığın bölümü [1], [2] gibi belirt. Belgelerde cevap yoksa bunu açıkça söyle.\n\n"
                + bolumler
            )
        else:
            sistem += "\n\nKullanıcının belgelerinde bu soruyla ilgili bir bölüm bulunamadı; bunu cevabında belirt."
    return model, [{"role": "system", "content": sistem}, *gecmis], kaynaklar


async def _ollama_akis(model: str, mesajlar: list[dict]):
    govde = {
        "model": model,
        "messages": mesajlar,
        "stream": True,
        "options": {"num_ctx": int(ayarlari_oku()["baglam_uzunlugu"])},
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(None, connect=5)) as istemci:
            async with istemci.stream("POST", f"{OLLAMA}/api/chat", json=govde) as yanit:
                if yanit.status_code != 200:
                    metin = (await yanit.aread()).decode("utf-8", "replace")
                    raise OllamaHatasi(f"Ollama hatası ({yanit.status_code}): {metin[:300]}")
                async for satir in yanit.aiter_lines():
                    if not satir:
                        continue
                    veri = json.loads(satir)
                    if "error" in veri:
                        raise OllamaHatasi(veri["error"])
                    parca = veri.get("message", {}).get("content", "")
                    if parca:
                        yield parca
                    if veri.get("done"):
                        break
    except httpx.ConnectError as hata:
        raise OllamaHatasi("Ollama'ya bağlanılamadı. Ollama çalışıyor mu?") from hata


def _satir(veri: dict) -> str:
    return json.dumps(veri, ensure_ascii=False) + "\n"


@app.post("/api/sohbet")
async def sohbet(istek: SohbetIstegi):
    async def akis():
        try:
            model, mesajlar, kaynaklar = await _hazirla(istek)
            yield _satir({"model": model, "kaynaklar": kaynaklar})
            async for parca in _ollama_akis(model, mesajlar):
                yield _satir({"t": parca})
            yield _satir({"bitti": True})
        except OllamaHatasi as hata:
            yield _satir({"hata": str(hata)})

    return StreamingResponse(akis(), media_type="application/x-ndjson")


@app.post("/api/sor")
async def sor(istek: SohbetIstegi):
    """Akışsız, tek seferlik cevap (diğer programlardan kullanım için)."""
    try:
        model, mesajlar, kaynaklar = await _hazirla(istek)
        cevap = "".join([p async for p in _ollama_akis(model, mesajlar)])
    except OllamaHatasi as hata:
        raise HTTPException(502, str(hata)) from hata
    return {"cevap": cevap, "model": model, "kaynaklar": kaynaklar}


@app.get("/api/saglik")
async def saglik():
    return {"ok": True}


@app.get("/api/durum")
async def durum():
    ayarlar = ayarlari_oku()
    gerekli = [ayarlar["genel_model"], ayarlar["kod_model"], ayarlar["embed_model"]]
    sonuc = {
        "surum": surum(),
        "ollama": False,
        "ollama_surum": None,
        "modeller": {"genel": ayarlar["genel_model"], "kod": ayarlar["kod_model"], "embed": ayarlar["embed_model"]},
        "eksik_modeller": gerekli,
        "indeks": indeks.durum(),
        "belge_klasoru": str(BELGELER),
    }
    try:
        async with httpx.AsyncClient(timeout=3) as istemci:
            sonuc["ollama_surum"] = (await istemci.get(f"{OLLAMA}/api/version")).json().get("version")
            yuklu = {m["name"] for m in (await istemci.get(f"{OLLAMA}/api/tags")).json().get("models", [])}
        sonuc["ollama"] = True
        sonuc["eksik_modeller"] = [m for m in gerekli if _tam_ad(m) not in yuklu]
    except (httpx.HTTPError, ValueError):
        pass
    return sonuc


@app.get("/api/belgeler")
async def belgeler():
    BELGELER.mkdir(parents=True, exist_ok=True)
    return [
        {"ad": y.relative_to(BELGELER).as_posix(), "boyut": y.stat().st_size}
        for y in sorted(BELGELER.rglob("*"))
        if y.is_file() and y.suffix.lower() in DESTEKLENEN
    ]


@app.post("/api/belgeler/yukle")
async def belge_yukle(dosyalar: list[UploadFile] = File(...)):
    BELGELER.mkdir(parents=True, exist_ok=True)
    kaydedilen, atlanan = [], []
    for dosya in dosyalar:
        ad = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", Path(dosya.filename or "").name).strip(" .")
        if not ad or Path(ad).suffix.lower() not in DESTEKLENEN:
            atlanan.append(dosya.filename)
            continue
        with open(BELGELER / ad, "wb") as hedef:
            while parca := await dosya.read(1024 * 1024):
                hedef.write(parca)
        kaydedilen.append(ad)
    if kaydedilen:
        indeks.tara_baslat()
    return {"kaydedilen": kaydedilen, "atlanan": atlanan}


@app.post("/api/belgeler/tara")
async def belge_tara():
    return {"basladi": indeks.tara_baslat(), "indeks": indeks.durum()}


@app.post("/api/belgeler/klasoru-ac")
async def klasoru_ac():
    BELGELER.mkdir(parents=True, exist_ok=True)
    if sys.platform != "win32":
        raise HTTPException(501, "Sadece Windows'ta desteklenir")
    os.startfile(BELGELER)  # noqa: S606 - yerel klasörü Gezgin'de açar
    return {"ok": True}


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="arayuz")
