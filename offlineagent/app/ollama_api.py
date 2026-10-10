"""Yerel Ollama sunucusuyla konuşan yardımcılar."""
import json
import os

import httpx

OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")


class OllamaHatasi(Exception):
    pass


async def sohbet_akisi(model: str, mesajlar: list[dict], baglam: int, araclar: list[dict] | None = None):
    """Ollama'dan cevabı parça parça getirir: {"t": metin} veya {"tool_calls": [...]}."""
    govde = {"model": model, "messages": mesajlar, "stream": True, "options": {"num_ctx": baglam}}
    if araclar:
        govde["tools"] = araclar
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
                    mesaj = veri.get("message", {})
                    if mesaj.get("content"):
                        yield {"t": mesaj["content"]}
                    if mesaj.get("tool_calls"):
                        yield {"tool_calls": mesaj["tool_calls"]}
                    if veri.get("done"):
                        break
    except httpx.ConnectError as hata:
        raise OllamaHatasi("Ollama'ya bağlanılamadı. Ollama çalışıyor mu?") from hata


def gorsel_oku(model: str, resim_b64: str, istem: str) -> str:
    """Görsel modelle bir resimdeki yazıyı okur (OCR). Senkron; arka plan iş parçacığında çağrılır."""
    yanit = httpx.post(
        f"{OLLAMA}/api/chat",
        json={
            "model": model,
            "stream": False,
            "messages": [{"role": "user", "content": istem, "images": [resim_b64]}],
            "options": {"temperature": 0, "num_ctx": 4096},
        },
        timeout=600,
    )
    yanit.raise_for_status()
    return yanit.json().get("message", {}).get("content", "").strip()
