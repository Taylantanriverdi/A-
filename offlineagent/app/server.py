"""Offline Agent sunucusu: arayüzü sunar, sohbeti yerel Ollama'ya iletir, belgelerden cevap üretir.

Sadece 127.0.0.1 üzerinde dinler; internete hiçbir istek göndermez.
"""
import json
import os
import re
import sys
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

import ajan
import ses
from ayarlar import KOK, ayarlari_oku, surum
from belge_oku import DESTEKLENEN
from ollama_api import OLLAMA, OllamaHatasi, sohbet_akisi
from rag import BelgeIndeksi

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

indeks = BelgeIndeksi(BELGELER, KOK / "veri" / "indeks", OLLAMA, ayarlari_oku)


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
    yanit = await call_next(request)
    # Tam arayüz (ajan modu dahil) başka sayfaların içine gömülemez. Panellere gömülen
    # ?gomulu=1 sürümünde ajan ve dosya işlemleri kapalıdır.
    gomulebilir = request.url.path in ("/", "/index.html") and request.query_params.get("gomulu") == "1"
    if not gomulebilir and not request.url.path.endswith(".js"):
        yanit.headers["Content-Security-Policy"] = "frame-ancestors 'self'"
        yanit.headers["X-Frame-Options"] = "SAMEORIGIN"
    return yanit


class SohbetIstegi(BaseModel):
    mesajlar: list[dict]
    mod: str = "genel"
    belgeler: bool = False


class AjanIstegi(BaseModel):
    mesajlar: list[dict]
    karar: bool | None = None


def _tam_ad(model: str) -> str:
    return model if ":" in model else f"{model}:latest"


def _temizle(m: dict) -> dict:
    temiz = {"role": m.get("role"), "content": str(m.get("content") or "")}
    if m.get("images"):
        temiz["images"] = [str(r) for r in m["images"]][:4]
    return temiz


async def _hazirla(istek: SohbetIstegi) -> tuple[str, list[dict], list[dict]]:
    ayarlar = ayarlari_oku()
    mod = "kod" if istek.mod == "kod" else "genel"
    gecmis = [_temizle(m) for m in istek.mesajlar if m.get("role") in ("user", "assistant")][-20:]
    if any(m.get("images") for m in gecmis):
        model = ayarlar["gorsel_model"]
    else:
        model = ayarlar["kod_model"] if mod == "kod" else ayarlar["genel_model"]
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


def _baglam() -> int:
    return int(ayarlari_oku()["baglam_uzunlugu"])


def _satir(veri: dict) -> str:
    return json.dumps(veri, ensure_ascii=False) + "\n"


@app.post("/api/sohbet")
async def sohbet(istek: SohbetIstegi):
    async def akis():
        try:
            model, mesajlar, kaynaklar = await _hazirla(istek)
            yield _satir({"model": model, "kaynaklar": kaynaklar})
            async for olay in sohbet_akisi(model, mesajlar, _baglam()):
                if "t" in olay:
                    yield _satir(olay)
            yield _satir({"bitti": True})
        except OllamaHatasi as hata:
            yield _satir({"hata": str(hata)})

    return StreamingResponse(akis(), media_type="application/x-ndjson")


@app.post("/api/ajan")
async def ajan_sohbet(istek: AjanIstegi):
    model = ayarlari_oku()["genel_model"]

    async def akis():
        yield _satir({"model": model})
        async for olay in ajan.ajan_akisi(istek.mesajlar, istek.karar, model, _baglam(), indeks.ara):
            yield _satir(olay)

    return StreamingResponse(akis(), media_type="application/x-ndjson")


@app.post("/api/sor")
async def sor(istek: SohbetIstegi):
    """Akışsız, tek seferlik cevap (diğer programlardan kullanım için)."""
    try:
        model, mesajlar, kaynaklar = await _hazirla(istek)
        cevap = "".join([o["t"] async for o in sohbet_akisi(model, mesajlar, _baglam()) if "t" in o])
    except OllamaHatasi as hata:
        raise HTTPException(502, str(hata)) from hata
    return {"cevap": cevap, "model": model, "kaynaklar": kaynaklar}


@app.post("/api/ses")
async def ses_yazi(ses_dosyasi: UploadFile = File(...)):
    gecici = Path(tempfile.mkstemp(suffix=".webm")[1])
    try:
        gecici.write_bytes(await ses_dosyasi.read())
        metin = await run_in_threadpool(ses.yaziya_cevir, gecici, ayarlari_oku())
    except RuntimeError as hata:
        raise HTTPException(503, str(hata)) from hata
    finally:
        gecici.unlink(missing_ok=True)
    return {"metin": metin}


@app.get("/api/saglik")
async def saglik():
    return {"ok": True}


@app.get("/api/durum")
async def durum():
    ayarlar = ayarlari_oku()
    modeller = {k: ayarlar[f"{k}_model"] for k in ("genel", "kod", "gorsel", "embed")}
    sonuc = {
        "surum": surum(),
        "ollama": False,
        "ollama_surum": None,
        "modeller": modeller,
        "eksik_modeller": list(modeller.values()),
        "ses_modeli": ses.model_var(ayarlar["ses_modeli"]),
        "indeks": indeks.durum(),
        "belge_klasoru": str(BELGELER),
        "calisma_klasoru": str(ajan.CALISMA),
    }
    try:
        async with httpx.AsyncClient(timeout=3) as istemci:
            sonuc["ollama_surum"] = (await istemci.get(f"{OLLAMA}/api/version")).json().get("version")
            yuklu = {m["name"] for m in (await istemci.get(f"{OLLAMA}/api/tags")).json().get("models", [])}
        sonuc["ollama"] = True
        sonuc["eksik_modeller"] = [m for m in modeller.values() if _tam_ad(m) not in yuklu]
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


@app.post("/api/klasor-ac/{hangisi}")
async def klasoru_ac(hangisi: str):
    klasor = {"belgeler": BELGELER, "calisma": ajan.CALISMA}.get(hangisi)
    if not klasor:
        raise HTTPException(404, "Bilinmeyen klasör")
    klasor.mkdir(parents=True, exist_ok=True)
    if sys.platform != "win32":
        raise HTTPException(501, "Sadece Windows'ta desteklenir")
    os.startfile(klasor)  # noqa: S606 - yerel klasörü Gezgin'de açar
    return {"ok": True}


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="arayuz")
