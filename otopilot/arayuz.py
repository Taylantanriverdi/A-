"""Otopilot paneli: tarayıcıda canlı izleme ve kontrol.

    python -m otopilot arayuz            # http://127.0.0.1:8765 açılır

Yalnızca bu bilgisayardan erişilebilir (127.0.0.1). Değişiklik yapan istekler, sayfaya gömülü rastgele
bir anahtar ister; böylece başka web siteleri tarayıcın üzerinden otopilota komut gönderemez.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import platform
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import proje as pj
from . import yonetici
from .durum import GOREV, KOK, Durum, tum_projeler

REPO = Path(__file__).resolve().parent.parent
HTML = Path(__file__).with_name("arayuz.html")
ANAHTAR = secrets.token_urlsafe(24)
WINDOWS = platform.system() == "Windows"
_git_onbellek: dict[str, tuple[float, list]] = {}


class Hata(Exception):
    pass


# --------------------------------------------------------------------------- #
# Veri
# --------------------------------------------------------------------------- #

def _bul(ad: str) -> Durum:
    d = next((d for d in tum_projeler() if d.dizin.name == ad), None)
    if not d:
        raise Hata("Proje bulunamadı.")
    return d


def _gorevler(d: Durum) -> list[dict]:
    if not d.gorev_dosyasi.exists():
        return []
    sonuc: list[dict] = []
    for satir in d.gorev_dosyasi.read_text(encoding="utf-8").splitlines():
        if (m := GOREV.match(satir)):
            sonuc.append({"durum": {" ": "bekliyor", "x": "bitti", "!": "basarisiz"}[m.group(2).lower()],
                          "metin": m.group(3).strip(), "not": ""})
        elif sonuc and satir.strip().startswith("- _"):
            sonuc[-1]["not"] = re.sub(r"^- _([^_]*)_\s*", r"\1 · ", satir.strip())
    return sonuc


def _commitler(d: Durum, dal: str) -> list[dict]:
    simdi, anahtar = time.time(), f"{d.proje}|{dal}"
    if anahtar in _git_onbellek and simdi - _git_onbellek[anahtar][0] < 5:
        return _git_onbellek[anahtar][1]
    liste = []
    try:
        r = subprocess.run(["git", "log", dal, "-20", "--format=%h\x1f%s\x1f%cI"], cwd=d.proje, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=10)
        for satir in r.stdout.splitlines():
            parca = satir.split("\x1f")
            if len(parca) == 3:
                liste.append({"hash": parca[0], "mesaj": parca[1], "zaman": parca[2]})
    except (OSError, subprocess.TimeoutExpired):
        pass
    _git_onbellek[anahtar] = (simdi, liste)
    return liste


def proje_ozeti(d: Durum, simdi: dt.datetime) -> dict:
    ayar = d.ayarlari_oku()
    v = d.oku()
    gorevler = _gorevler(d)
    uygun, sebep = yonetici.sirasi_gelebilir(d, simdi)
    return {
        "ad": d.dizin.name,
        "isim": d.proje.name,
        "proje": str(d.proje),
        "otomatik": bool(ayar and ayar.otomatik),
        "asama": v.get("asama"),
        "calisiyor": bool(d.calisiyor_mu()),
        "aktif_gorev": (v.get("aktif") or {}).get("satir"),
        "deneme": (v.get("aktif") or {}).get("deneme", 0),
        "bekle_until": v.get("bekle_until"),
        "bekleme_sebebi": v.get("bekleme_sebebi"),
        "sira_notu": "" if uygun else sebep,
        "sayilar": {k: sum(g["durum"] == k for g in gorevler) for k in ("bitti", "bekliyor", "basarisiz")},
    }


def genel_veri() -> dict:
    simdi = dt.datetime.now().astimezone()
    return {"yonetici": yonetici.yonetici_durumu(),
            "projeler": [proje_ozeti(d, simdi) for d in tum_projeler()],
            "simdi": simdi.isoformat(timespec="seconds")}


def proje_verisi(d: Durum) -> dict:
    ayar = d.ayarlari_oku()
    v = d.oku()
    konsol = ""
    if (d.dizin / "konsol.log").exists():
        konsol = "\n".join((d.dizin / "konsol.log").read_text(encoding="utf-8", errors="replace").splitlines()[-20:])
    return {
        **proje_ozeti(d, dt.datetime.now().astimezone()),
        "veri_dizini": str(d.dizin),
        "ayarlar": ayar.__dict__ if ayar else {},
        "asama_zamani": v.get("asama_zamani"),
        "gorevler": _gorevler(d),
        "olaylar": d.son_olaylar(250),
        "commitler": _commitler(d, ayar.dal) if ayar and d.proje.exists() else [],
        "konsol": konsol,
    }


# --------------------------------------------------------------------------- #
# Eylemler
# --------------------------------------------------------------------------- #

def _ortam() -> dict:
    return {**os.environ, "PYTHONPATH": f"{REPO}{os.pathsep}{os.environ.get('PYTHONPATH', '')}",
            "PYTHONUTF8": "1", "PYTHONUNBUFFERED": "1"}


def _arka_planda(argumanlar: list[str], log: Path) -> None:
    secenek: dict = ({"creationflags": subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP}
                     if WINDOWS else {"start_new_session": True})
    subprocess.Popen([sys.executable, "-m", "otopilot", *argumanlar], cwd=REPO, env=_ortam(),
                     stdin=subprocess.DEVNULL, stdout=log.open("w", encoding="utf-8"),
                     stderr=subprocess.STDOUT, **secenek)


def _oldur(pid: int) -> None:
    if WINDOWS:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        try:
            os.killpg(pid, signal.SIGINT) if os.getpgid(pid) == pid else os.kill(pid, signal.SIGINT)
        except (ProcessLookupError, PermissionError):
            pass


def baslat() -> str:
    if yonetici.yonetici_durumu()["calisiyor"]:
        return "Zaten çalışıyor."
    if not tum_projeler():
        raise Hata("Önce bir proje ekle.")
    KOK.mkdir(parents=True, exist_ok=True)
    _arka_planda(["hepsi"], KOK / "yonetici.log")
    return "Otopilot başlatıldı."


def durdur() -> str:
    y = yonetici.yonetici_durumu()
    durdurulan = 0
    if y["calisiyor"]:
        _oldur(y["pid"])
        durdurulan += 1
    for d in tum_projeler():  # komut satırından tek başına başlatılmış olanlar da dursun
        if (pid := d.calisiyor_mu()):
            _oldur(pid)
            durdurulan += 1
            if WINDOWS:  # zorla sonlandırılan süreç kendi "durdu" kaydını yazamaz
                d.olay("durdu", "⏹  Panelden durduruldu. Başlatınca kaldığı yerden devam eder.", asama="durdu")
    return "Durduruluyor." if durdurulan else "Zaten çalışmıyor."


def klasor_sec() -> str:
    """Bilgisayarda yerel klasör seçme penceresini açar ve seçilen yolu döner."""
    if WINDOWS:
        ps = ("[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; "
              "$f = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; "
              "$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Proje klasorunu sec'; "
              "if ($d.ShowDialog($f) -eq 'OK') { $d.SelectedPath }")
        komut = ["powershell", "-NoProfile", "-STA", "-Command", ps]
    else:
        komut = [sys.executable, "-c", "import tkinter as t; from tkinter import filedialog as f; r=t.Tk(); "
                 "r.withdraw(); r.attributes('-topmost', True); print(f.askdirectory() or '')"]
    try:
        r = subprocess.run(komut, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
    except (OSError, subprocess.TimeoutExpired):
        raise Hata("Klasör seçme penceresi açılamadı; yolu elle yaz.")
    if r.returncode != 0:
        raise Hata("Klasör seçme penceresi açılamadı; yolu elle yaz.")
    return r.stdout.strip()


def proje_cikar(d: Durum) -> str:
    if d.calisiyor_mu():
        raise Hata("Bu proje şu an geliştiriliyor; önce otopilotu durdur.")
    if d.dizin.parent.resolve() != KOK.resolve():
        raise Hata("Geçersiz proje.")
    shutil.rmtree(d.dizin)
    return "Proje listeden çıkarıldı (dosyalarına dokunulmadı)."


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

class Isleyici(BaseHTTPRequestHandler):
    server_version = "Otopilot"

    def log_message(self, *args) -> None:
        pass

    def _host_gecerli(self) -> bool:
        return (self.headers.get("Host") or "").split(":")[0] in ("127.0.0.1", "localhost")

    def _gonder(self, kod: int, govde: bytes, tur: str = "application/json; charset=utf-8") -> None:
        self.send_response(kod)
        self.send_header("Content-Type", tur)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(govde)))
        self.end_headers()
        self.wfile.write(govde)

    def _json(self, kod: int, veri) -> None:
        self._gonder(kod, json.dumps(veri, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self) -> None:
        if not self._host_gecerli():
            return self._gonder(403, b"")
        url = urlparse(self.path)
        try:
            if url.path == "/":
                sayfa = HTML.read_text(encoding="utf-8").replace("__ANAHTAR__", ANAHTAR)
                return self._gonder(200, sayfa.encode("utf-8"), "text/html; charset=utf-8")
            if url.path == "/api/genel":
                return self._json(200, genel_veri())
            if url.path == "/api/proje":
                return self._json(200, proje_verisi(_bul(parse_qs(url.query).get("ad", [""])[0])))
        except Hata as e:
            return self._json(404, {"hata": str(e)})
        self._gonder(404, b"")

    def do_POST(self) -> None:
        if not self._host_gecerli() or self.headers.get("X-Otopilot-Anahtar") != ANAHTAR:
            return self._gonder(403, b"")
        try:
            uzunluk = min(int(self.headers.get("Content-Length") or 0), 200_000)
            v = json.loads(self.rfile.read(uzunluk) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"hata": "Geçersiz istek."})
        try:
            return self._json(200, self._islem(urlparse(self.path).path, v))
        except Hata as e:
            return self._json(400, {"hata": str(e)})
        except (ValueError, OSError, pj.GitHatasi) as e:
            return self._json(400, {"hata": str(e)})

    def _islem(self, yol: str, v: dict) -> dict:
        from .__main__ import proje_ekle

        if yol == "/api/baslat":
            return {"mesaj": baslat()}
        if yol == "/api/durdur":
            return {"mesaj": durdur()}
        if yol == "/api/klasor-sec":
            return {"yol": klasor_sec()}
        if yol == "/api/tara":
            kok = Path(str(v.get("yol", ""))).expanduser()
            if not kok.is_dir():
                raise Hata("Klasör bulunamadı.")
            bulunan = pj.projeleri_tara(kok)
            ekli = {str(d.proje) for d in tum_projeler()}
            for b in bulunan:
                b["ekli"] = str(Path(b["yol"]).resolve()) in ekli
            tur = pj.proje_turu(kok)
            return {"projeler": bulunan, "kendisi_proje": bool(tur), "tur": tur}
        if yol == "/api/proje-ekle":
            sonuc = []
            for p in v.get("yollar") or []:
                try:
                    d, yapilan = proje_ekle(Path(str(p)), str(v.get("hedef") or ""))
                    sonuc.append({"yol": str(d.proje), "ad": d.dizin.name, "tamam": True, "not": ", ".join(yapilan)})
                except (ValueError, OSError, pj.GitHatasi) as e:
                    sonuc.append({"yol": str(p), "tamam": False, "not": str(e)})
            return {"sonuc": sonuc}

        d = _bul(str(v.get("ad", "")))
        if yol == "/api/gorev":
            metin = " ".join(str(v.get("metin", "")).split())
            if not metin:
                raise Hata("Görev metni boş.")
            d.gorev_ekle([metin])
            return {"mesaj": "Görev eklendi."}
        if yol == "/api/ayar":
            a = d.ayarlari_oku()
            if "hedef" in v:
                a.hedef = " ".join(str(v["hedef"]).split())
            if "otomatik" in v:
                a.otomatik = bool(v["otomatik"])
            if "test_komutu" in v:
                a.test_komutu = str(v["test_komutu"]).strip() or None
            d.ayarlari_yaz(a)
            if "otomatik" in v or "hedef" in v:
                d.yaz(dinlen_until=None)  # kullanıcı dokunduysa beklemeden yeniden değerlendirilsin
            return {"mesaj": "Kaydedildi."}
        if yol == "/api/proje-cikar":
            return {"mesaj": proje_cikar(d)}
        raise Hata("Bilinmeyen işlem.")


def calistir(port: int = 8765, tarayici: bool = True) -> None:
    adres = f"http://127.0.0.1:{port}/"
    try:
        sunucu = ThreadingHTTPServer(("127.0.0.1", port), Isleyici)
    except OSError:
        print(f"Panel zaten açık olabilir: {adres}")
        if tarayici:
            webbrowser.open(adres)
        return
    print(f"Otopilot paneli: {adres}  (kapatmak için bu pencereyi kapat veya Ctrl+C)")
    if tarayici:
        threading.Timer(0.8, webbrowser.open, args=(adres,)).start()
    try:
        sunucu.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        sunucu.server_close()
