"""Otomatik güncelleyici.

Asistanın dosyalarının en yeni sürümünü GitHub'dan indirir ve değişenleri
yerine koyar. Sadece Python'un standart kütüphanesini kullanır; böylece
kurulumdan önce de çalışabilir.

Kullanım:  python guncelle.py
Kapatmak için ASISTAN_GUNCELLEME=0, farklı dal için ASISTAN_DAL=<dal-adı>.
"""

from __future__ import annotations

import hashlib
import io
import os
import shutil
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

DEPO = "Taylantanriverdi/A-"
DAL = os.environ.get("ASISTAN_DAL", "main")
KLASOR = "asistan"  # depodaki klasör
HEDEF = Path(__file__).resolve().parent
ZIP_URL = f"https://codeload.github.com/{DEPO}/zip/refs/heads/{DAL}"
ZAMAN_ASIMI = 20


def _indir(url: str) -> bytes:
    try:
        istek = urllib.request.Request(url, headers={"User-Agent": "kisisel-asistan-guncelleyici"})
        with urllib.request.urlopen(istek, timeout=ZAMAN_ASIMI) as yanit:
            return yanit.read()
    except (ssl.SSLError, urllib.error.URLError) as hata:
        # macOS'ta python.org Python'unda sertifikalar eksik olabilir: curl'e düş.
        curl = shutil.which("curl")
        if not curl:
            raise
        sonuc = subprocess.run(
            [curl, "-fsSL", "--max-time", str(ZAMAN_ASIMI), url], capture_output=True
        )
        if sonuc.returncode != 0:
            raise RuntimeError(f"indirilemedi: {hata}") from hata
        return sonuc.stdout


def _duzenle(ad: str, veri: bytes) -> bytes:
    """Satır sonlarını işletim sistemine göre ayarlar (.bat için CRLF, .sh için LF)."""
    if ad.endswith((".bat", ".cmd")):
        return veri.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    if ad.endswith(".sh"):
        return veri.replace(b"\r\n", b"\n")
    return veri


def _ozet(veri: bytes) -> str:
    return hashlib.sha256(veri).hexdigest()


def guncelle() -> int:
    """Güncellenen dosya sayısını döndürür (hata olursa -1)."""
    if os.environ.get("ASISTAN_GUNCELLEME", "1") == "0":
        return 0
    if (HEDEF.parent / ".git").exists():
        print("ℹ️  Git deposundan çalışıyor; otomatik güncelleme atlandı (git pull kullan).")
        return 0

    print("🔄 Güncellemeler kontrol ediliyor...", end=" ", flush=True)
    try:
        arsiv = zipfile.ZipFile(io.BytesIO(_indir(ZIP_URL)))
    except Exception as hata:  # noqa: BLE001 - internet yoksa mevcut sürümle devam
        print(f"\n⚠️  Güncelleme kontrol edilemedi ({hata}). Mevcut sürümle devam ediliyor.")
        return -1

    degisenler: list[str] = []
    for bilgi in arsiv.infolist():
        if bilgi.is_dir():
            continue
        parcalar = bilgi.filename.split("/")
        # Arşiv yapısı: "<depo>-<dal>/asistan/<dosya...>"
        if len(parcalar) < 3 or parcalar[1] != KLASOR:
            continue
        goreli = Path(*parcalar[2:])
        if goreli.parts[0] in (".venv", "__pycache__"):
            continue
        yeni = _duzenle(goreli.name, arsiv.read(bilgi))
        hedef = HEDEF / goreli
        if hedef.exists() and _ozet(hedef.read_bytes()) == _ozet(yeni):
            continue
        hedef.parent.mkdir(parents=True, exist_ok=True)
        gecici = hedef.with_name(hedef.name + ".yeni")
        gecici.write_bytes(yeni)
        os.replace(gecici, hedef)
        if goreli.suffix in (".sh", ".command"):
            hedef.chmod(0o755)
        degisenler.append(str(goreli))

    if not degisenler:
        print("✅ güncel.")
        return 0

    print(f"\n⬆️  {len(degisenler)} dosya güncellendi: {', '.join(degisenler)}")
    sanal_ortamda = sys.prefix != sys.base_prefix
    if "requirements.txt" in degisenler and sanal_ortamda:
        print("📦 Yeni kütüphaneler kuruluyor...")
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "-q", "--disable-pip-version-check",
             "-r", str(HEDEF / "requirements.txt")],
            check=False,
        )
    return len(degisenler)


if __name__ == "__main__":
    guncelle()
