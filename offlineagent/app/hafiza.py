"""Kalıcı hafıza: kullanıcı hakkında öğrenilen bilgiler veri/hafiza.json içinde saklanır ve her
sohbette modele hatırlatılır. Bilgiler elle eklenebilir ya da sohbetlerden otomatik çıkarılır.
"""
import json
import threading
import time
import uuid

import httpx

from ayarlar import KOK
from ollama_api import ek_alanlar, secenekler

DEPO = KOK / "veri" / "hafiza.json"
ISTEM_SINIRI = 3000  # modele gönderilecek hafıza metninin en fazla uzunluğu

_kilit = threading.Lock()

CIKARMA_ISTEMI = (
    "Aşağıdaki konuşmada kullanıcı hakkında ileride işe yarayacak KALICI bilgiler var mı? "
    "Örnek: adı, mesleği, iş yeri, çalışanları, aile, tercihleri, alışkanlıkları, süren projeleri. "
    "Geçici şeyleri (bugünkü soru, hava, tek seferlik istekler) ve zaten bilinenleri ALMA. "
    "Her bilgiyi kısa, tek başına anlaşılır bir Türkçe cümle olarak yaz (ör. \"Kullanıcının adı Taylan.\"). "
    'Sadece şu JSON ile cevap ver: {"bilgiler": ["..."]}  Yeni bilgi yoksa {"bilgiler": []}.'
)


def _oku() -> list[dict]:
    try:
        return json.loads(DEPO.read_text("utf-8"))["bilgiler"]
    except (OSError, ValueError, KeyError):
        return []


def _yaz(bilgiler: list[dict]) -> None:
    DEPO.parent.mkdir(parents=True, exist_ok=True)
    gecici = DEPO.with_suffix(".tmp")
    gecici.write_text(json.dumps({"bilgiler": bilgiler}, ensure_ascii=False, indent=1), "utf-8")
    gecici.replace(DEPO)


def liste() -> list[dict]:
    return _oku()


def ekle(metin: str, kaynak: str = "elle") -> dict | None:
    metin = " ".join(metin.split())[:300]
    if len(metin) < 3:
        return None
    with _kilit:
        bilgiler = _oku()
        if any(b["metin"].casefold() == metin.casefold() for b in bilgiler):
            return None
        yeni = {"id": uuid.uuid4().hex[:10], "metin": metin, "kaynak": kaynak, "tarih": time.strftime("%Y-%m-%d %H:%M")}
        bilgiler.append(yeni)
        _yaz(bilgiler)
        return yeni


def guncelle(kimlik: str, metin: str) -> bool:
    with _kilit:
        bilgiler = _oku()
        for b in bilgiler:
            if b["id"] == kimlik:
                b["metin"] = " ".join(metin.split())[:300]
                _yaz(bilgiler)
                return True
        return False


def sil(kimlik: str) -> bool:
    with _kilit:
        bilgiler = _oku()
        kalan = [b for b in bilgiler if b["id"] != kimlik]
        _yaz(kalan)
        return len(kalan) < len(bilgiler)


def istem_metni() -> str:
    """Sistem talimatına eklenecek metin; en yeni bilgiler öncelikli."""
    satirlar, toplam = [], 0
    for b in reversed(_oku()):
        if toplam + len(b["metin"]) > ISTEM_SINIRI:
            break
        satirlar.append(f"- {b['metin']}")
        toplam += len(b["metin"])
    if not satirlar:
        return ""
    return "\n\nKullanıcı hakkında hatırladıkların (gerektiğinde kullan, her seferinde tekrarlama):\n" + "\n".join(reversed(satirlar))


def konusmadan_ogren(ollama_url: str, model: str, soru: str, cevap: str) -> None:
    """Arka planda çalışır: konuşmadan kalıcı bilgileri çıkarıp hafızaya ekler."""
    bilinen = "\n".join(f"- {b['metin']}" for b in _oku()[-40:]) or "(yok)"
    try:
        yanit = httpx.post(
            f"{ollama_url}/api/chat",
            json={
                "model": model,
                "stream": False,
                "format": "json",
                "options": secenekler(num_ctx=4096),
                **ek_alanlar(model),
                "messages": [
                    {"role": "system", "content": CIKARMA_ISTEMI},
                    {"role": "user", "content": f"Zaten bilinenler:\n{bilinen}\n\nKullanıcı: {soru[:2000]}\n\nAsistan: {cevap[:1500]}"},
                ],
            },
            timeout=180,
        )
        yanit.raise_for_status()
        bilgiler = json.loads(yanit.json()["message"]["content"]).get("bilgiler", [])
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        return
    for b in bilgiler[:5]:
        if isinstance(b, str):
            ekle(b, "otomatik")
