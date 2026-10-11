"""PrimerLab köprüsü: aynı bilgisayardaki PrimerLab'ın Primer AI'ına soru sorar, önerdiği işlemleri uygular.

PrimerLab (V56 ve sonrası) ilk açılışta App_Data\\Secrets\\offline-agent.anahtar dosyasını oluşturur;
istekler bu anahtarla ve sadece bu bilgisayardan kabul edilir. Veri değiştiren her işlem kullanıcı
Offline Agent'ta onayladıktan sonra uygulanır.
"""
import time
from pathlib import Path

import httpx

from ayarlar import ayarlari_oku

BASLIK = "X-PrimerLab-Asistan"
_durum_onbellek: tuple[float, dict] | None = None


class PrimerLabHatasi(Exception):
    pass


def _ayar() -> tuple[str, Path]:
    ayarlar = ayarlari_oku()
    adres = str(ayarlar.get("primerlab_adresi") or "http://127.0.0.1:5169").rstrip("/")
    dosya = Path(str(ayarlar.get("primerlab_anahtar") or r"C:\PrimerLab\Uygulama\App_Data\Secrets\offline-agent.anahtar"))
    return adres, dosya


def kurulu() -> bool:
    return _ayar()[1].exists()


def _istek(yontem: str, yol: str, govde: dict | None = None, zaman_asimi: float = 300) -> dict:
    adres, dosya = _ayar()
    try:
        anahtar = dosya.read_text("utf-8").strip()
    except OSError as hata:
        raise PrimerLabHatasi(
            f"PrimerLab bağlantı anahtarı bulunamadı ({dosya}). PrimerLab V56 kurulu ve en az bir kez açılmış olmalı."
        ) from hata
    try:
        yanit = httpx.request(yontem, adres + yol, json=govde, headers={BASLIK: anahtar}, timeout=zaman_asimi)
    except httpx.ConnectError as hata:
        raise PrimerLabHatasi("PrimerLab'a bağlanılamadı. PrimerLab açık mı? (masaüstündeki Primer Lab kısayolu)") from hata
    except httpx.TimeoutException as hata:
        raise PrimerLabHatasi("PrimerLab zamanında cevap vermedi.") from hata
    if yanit.status_code == 401:
        raise PrimerLabHatasi("PrimerLab bağlantıyı reddetti. PrimerLab V56 veya sonrası gerekli.")
    if yanit.status_code != 200:
        raise PrimerLabHatasi(f"PrimerLab hatası ({yanit.status_code}): {yanit.text[:300]}")
    return yanit.json()


def durum() -> dict:
    """Kenar çubuğu için bağlantı durumu (30 sn önbellekli, PrimerLab kapalıysa hızlıca döner)."""
    global _durum_onbellek
    if _durum_onbellek and time.monotonic() - _durum_onbellek[0] < 30:
        return _durum_onbellek[1]
    if not kurulu():
        sonuc = {"kurulu": False, "bagli": False}
    else:
        try:
            veri = _istek("GET", "/api/yerel-asistan/durum", zaman_asimi=2)
            sonuc = {"kurulu": True, "bagli": True, "surum": veri.get("surum"), "yapay_zeka": veri.get("yapayZeka")}
        except PrimerLabHatasi as hata:
            sonuc = {"kurulu": True, "bagli": False, "hata": str(hata)}
    _durum_onbellek = (time.monotonic(), sonuc)
    return sonuc


def sor(istek: str, gecmis: list[dict] | None = None, model: str | None = None) -> dict:
    """Primer AI'a sorar: {"cevap", "islemler": [{"islem": {...}, "etiket": "..."}]}"""
    return _istek("POST", "/api/yerel-asistan/sor", {
        "mesaj": istek,
        "model": model,
        "gecmis": [{"rol": m["role"], "icerik": m["content"]} for m in (gecmis or [])
                   if m.get("role") in ("user", "assistant") and m.get("content")][-6:],
    })


def uygula(islem: dict) -> dict:
    return _istek("POST", "/api/yerel-asistan/uygula", {"islem": islem}, zaman_asimi=60)
