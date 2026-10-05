"""Ollama (yerel model) yardımcıları: bağlantı, model listesi, indirme ve uzun bağlamlı model türevi.

Ollama varsayılan olarak kısa bir bağlam penceresiyle çalışır; uzun talimatlar ve araç tanımları sessizce
kırpılır ve model "unutkan" davranır. Bu yüzden seçilen modelden, bağlamı büyütülmüş bir türev
(`<model>-otopilot`) oluşturulur ve otopilot onu kullanır.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ONERILEN_MODELLER = [
    # (ad, açıklama) — araç (tool) çağırmayı destekleyen kodlama modelleri
    ("qwen2.5-coder:7b", "8 GB ekran kartı / 16 GB RAM — hızlı, basit işler"),
    ("qwen2.5-coder:14b", "12-16 GB ekran kartı — önerilen denge"),
    ("qwen2.5-coder:32b", "24 GB+ ekran kartı — en iyi kalite, yavaş"),
]
VARSAYILAN_BAGLAM = 32768
TUREV_EKI = "-otopilot"


def adres() -> str:
    host = os.environ.get("OLLAMA_HOST", "127.0.0.1:11434").strip()
    if not host.startswith("http"):
        host = "http://" + host
    return host.rstrip("/").replace("://0.0.0.0", "://127.0.0.1")


def api_adresi() -> str:
    """OpenAI uyumlu uç nokta (asistanın kullandığı)."""
    return adres() + "/v1"


def _istek(yol: str, veri: dict | None = None, zaman_asimi: float = 5):
    istek = urllib.request.Request(adres() + yol, data=json.dumps(veri).encode() if veri is not None else None,
                                   headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(istek, timeout=zaman_asimi) as r:
        return json.loads(r.read() or b"{}")


def calisiyor_mu() -> bool:
    try:
        _istek("/api/tags", zaman_asimi=2)
        return True
    except (urllib.error.URLError, OSError, ValueError):
        return False


def modeller() -> list[str]:
    try:
        return sorted(m.get("name", "") for m in _istek("/api/tags", zaman_asimi=3).get("models", []))
    except (urllib.error.URLError, OSError, ValueError):
        return []


def model_var_mi(model: str) -> bool:
    adlar = set(modeller())
    return model in adlar or (":" not in model and f"{model}:latest" in adlar)


def arac_destegi(model: str) -> bool | None:
    """Model araç çağırmayı destekliyor mu? Ollama bunu bildirmiyorsa None."""
    try:
        bilgi = _istek("/api/show", {"model": model, "name": model}, zaman_asimi=10)
    except (urllib.error.URLError, OSError, ValueError):
        return None
    yetenekler = bilgi.get("capabilities")
    if isinstance(yetenekler, list) and yetenekler:
        return "tools" in yetenekler
    sablon = bilgi.get("template") or ""
    return True if ".Tools" in sablon else None


def ollama_komutu() -> str | None:
    yol = shutil.which("ollama")
    if yol:
        return yol
    if platform.system() == "Windows":
        aday = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe"
        if aday.exists():
            return str(aday)
    return None


def kontrol_et(model: str) -> None:
    """Motor başlamadan önce: Ollama açık mı, model yüklü mü, araç destekliyor mu? Sorun varsa açıklayıcı hata."""
    if not calisiyor_mu():
        raise SystemExit(f"Ollama'ya bağlanılamadı ({adres()}). Ollama uygulamasını başlat "
                         "(Windows'ta Başlat menüsünden 'Ollama'), sonra tekrar dene.")
    if not model_var_mi(model):
        raise SystemExit(f"Ollama'da '{model}' modeli yüklü değil. Yüklemek için: ollama pull {model.removesuffix(TUREV_EKI)}"
                         " — ya da OTOPILOT_BASLAT.bat ile Ollama kurulumunu yeniden çalıştır.")
    if arac_destegi(model) is False:
        raise SystemExit(f"'{model}' modeli araç (tool) kullanmayı desteklemiyor; otopilot bu modelle dosya düzenleyemez. "
                         "Araç destekli bir model seç, örneğin qwen2.5-coder:14b.")


def indir(model: str) -> None:
    komut = ollama_komutu()
    if not komut:
        raise SystemExit("Ollama kurulu değil: https://ollama.com/download")
    print(f"'{model}' indiriliyor (ilk seferde birkaç GB sürebilir)...", flush=True)
    if subprocess.run([komut, "pull", model]).returncode != 0:
        raise SystemExit(f"'{model}' indirilemedi. İnternet bağlantını ve model adını kontrol et.")


def turev_olustur(model: str, baglam: int = VARSAYILAN_BAGLAM) -> str:
    """Bağlamı büyütülmüş model türevini oluşturur ve adını döner (ör. qwen2.5-coder:14b-otopilot)."""
    if model.endswith(TUREV_EKI):
        return model
    komut = ollama_komutu()
    if not komut:
        raise SystemExit("Ollama kurulu değil: https://ollama.com/download")
    turev = model.removesuffix(":latest") + TUREV_EKI  # qwen2.5-coder:14b -> qwen2.5-coder:14b-otopilot
    with tempfile.TemporaryDirectory() as d:
        dosya = Path(d) / "Modelfile"
        dosya.write_text(f"FROM {model}\nPARAMETER num_ctx {baglam}\n", encoding="utf-8")
        r = subprocess.run([komut, "create", turev, "-f", str(dosya)], capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise SystemExit(f"Model türevi oluşturulamadı: {(r.stderr or r.stdout).strip()[-400:]}")
    return turev
