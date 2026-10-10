"""Ayar dosyasını okur: ayarlar.varsayilan.json + kullanıcının ayarlar.json'u."""
import json
from pathlib import Path

KOK = Path(__file__).resolve().parent.parent


def ayarlari_oku() -> dict:
    ayarlar = json.loads((KOK / "ayarlar.varsayilan.json").read_text("utf-8-sig"))
    kullanici = KOK / "ayarlar.json"
    if kullanici.exists():
        try:
            ayarlar.update(json.loads(kullanici.read_text("utf-8-sig")))
        except (OSError, ValueError):
            pass  # Bozuk dosyada varsayılanlarla devam et
    return ayarlar


def surum() -> str:
    try:
        return (KOK / "SURUM.txt").read_text("utf-8").strip()
    except OSError:
        return "?"
