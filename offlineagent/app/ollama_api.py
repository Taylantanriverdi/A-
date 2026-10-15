"""Yerel Ollama sunucusuyla konuşan yardımcılar."""
import json
import os

import httpx

OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
# Model boşta kalınca bellekten atılmasın (yeniden yükleme her seferinde birkaç saniye sürer)
BELLEKTE_TUT = "30m"
# Cevaptan önce "düşünebilen" model aileleri; düşünme kapalıyken çok daha hızlı cevap verirler
DUSUNEN_MODELLER = ("qwen3", "deepseek-r1", "magistral")
# Rastgelelik kapalı: aynı soruya her seferinde aynı (en olası) cevap verilir
SABIT = {"temperature": 0, "seed": 42}
# Cevap uzunluğu sınırı (düşünme dahil); model kendini tekrar eden bir döngüye girerse sonsuza kadar yazmasın
EN_FAZLA_CEVAP = 4096


def secenekler(**ek) -> dict:
    return {**SABIT, **ek}


def ek_alanlar(model: str, dusun: bool = False) -> dict:
    """Her Ollama isteğine eklenen alanlar: bellekte tutma süresi ve (destekliyorsa) düşünme ayarı."""
    alanlar = {"keep_alive": BELLEKTE_TUT}
    ad = model.casefold()
    if any(ad.startswith(aile) for aile in DUSUNEN_MODELLER) and "coder" not in ad and "vl" not in ad:
        alanlar["think"] = dusun
    return alanlar


class OllamaHatasi(Exception):
    pass


async def sohbet_akisi(model: str, mesajlar: list[dict], baglam: int, araclar: list[dict] | None = None,
                       dusun: bool = False):
    """Ollama'dan cevabı parça parça getirir: {"t": metin} veya {"tool_calls": [...]}."""
    govde = {"model": model, "messages": mesajlar, "stream": True,
             "options": secenekler(num_ctx=baglam, num_predict=EN_FAZLA_CEVAP),
             **ek_alanlar(model, dusun)}
    if araclar:
        govde["tools"] = araclar
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(None, connect=5)) as istemci:
            for deneme in range(2):
                async with istemci.stream("POST", f"{OLLAMA}/api/chat", json=govde) as yanit:
                    if yanit.status_code != 200:
                        metin = (await yanit.aread()).decode("utf-8", "replace")
                        # Eski Ollama ya da düşünmeyi desteklemeyen model: düşünme alanı olmadan tekrar dene
                        if deneme == 0 and "think" in metin.lower() and "think" in govde:
                            govde.pop("think")
                            continue
                        raise OllamaHatasi(f"Ollama hatası ({yanit.status_code}): {metin[:300]}")
                    async for parca in _satirlar(yanit):
                        yield parca
                    return
    except httpx.ConnectError as hata:
        raise OllamaHatasi("Ollama'ya bağlanılamadı. Ollama çalışıyor mu?") from hata


async def _satirlar(yanit):
    """Ollama akışındaki satırları metin, araç çağrısı ve "düşünüyor" olaylarına çevirir."""
    dusunce_bildirildi = False
    async for satir in yanit.aiter_lines():
        if not satir:
            continue
        veri = json.loads(satir)
        if "error" in veri:
            raise OllamaHatasi(veri["error"])
        mesaj = veri.get("message", {})
        if mesaj.get("thinking") and not dusunce_bildirildi:  # model cevaptan önce düşünüyor (arayüzde gösterilir)
            dusunce_bildirildi = True
            yield {"dusunuyor": True}
        if mesaj.get("content"):
            yield {"t": mesaj["content"]}
        if mesaj.get("tool_calls"):
            yield {"tool_calls": mesaj["tool_calls"]}
        if veri.get("done"):
            break


def gorsel_oku(model: str, resim_b64: str, istem: str) -> str:
    """Görsel modelle bir resimdeki yazıyı okur (OCR). Senkron; arka plan iş parçacığında çağrılır."""
    yanit = httpx.post(
        f"{OLLAMA}/api/chat",
        json={
            "model": model,
            "stream": False,
            "messages": [{"role": "user", "content": istem, "images": [resim_b64]}],
            "options": secenekler(num_ctx=4096),
            **ek_alanlar(model),
        },
        timeout=600,
    )
    yanit.raise_for_status()
    return yanit.json().get("message", {}).get("content", "").strip()
