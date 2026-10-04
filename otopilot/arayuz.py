"""Otopilot arayüzü: tarayıcıda canlı izleme ve kontrol paneli.

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
import signal
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .durum import GOREV, KOK, Durum

REPO = Path(__file__).resolve().parent.parent
HTML = Path(__file__).with_name("arayuz.html")
ANAHTAR = secrets.token_urlsafe(24)
_git_onbellek: dict[str, tuple[float, list]] = {}


def _projeler() -> list[Durum]:
    if not KOK.exists():
        return []
    sonuc = []
    for dizin in KOK.iterdir():
        ayar = dizin / "ayarlar.json"
        if ayar.exists():
            try:
                proje = Path(json.loads(ayar.read_text(encoding="utf-8"))["proje"])
            except (json.JSONDecodeError, KeyError, OSError):
                continue
            d = Durum(proje)
            if d.dizin == dizin:
                sonuc.append(d)

    def son_hareket(d: Durum) -> float:
        dosyalar = [d.olay_dosyasi, d.durum_dosyasi, d.ayar_dosyasi]
        return max((f.stat().st_mtime for f in dosyalar if f.exists()), default=0)

    return sorted(sonuc, key=son_hareket, reverse=True)


def _bul(ad: str) -> Durum | None:
    return next((d for d in _projeler() if d.dizin.name == ad), None)


def _gorevler(d: Durum) -> list[dict]:
    if not d.gorev_dosyasi.exists():
        return []
    sonuc: list[dict] = []
    baslik = ""
    for satir in d.gorev_dosyasi.read_text(encoding="utf-8").splitlines():
        if satir.startswith("## "):
            baslik = satir[3:].strip()
        elif (m := GOREV.match(satir)):
            sonuc.append({"durum": {" ": "bekliyor", "x": "bitti", "!": "basarisiz"}[m.group(2).lower()],
                          "metin": m.group(3).strip(), "not": "", "baslik": baslik})
        elif sonuc and satir.strip().startswith("- _"):
            sonuc[-1]["not"] = re.sub(r"^- _([^_]*)_\s*", r"\1 · ", satir.strip())
    return sonuc


def _commitler(d: Durum, dal: str) -> list[dict]:
    simdi = time.time()
    anahtar = f"{d.proje}|{dal}"
    if anahtar in _git_onbellek and simdi - _git_onbellek[anahtar][0] < 5:
        return _git_onbellek[anahtar][1]
    liste = []
    try:
        r = subprocess.run(["git", "log", dal, "-15", "--format=%h\x1f%s\x1f%cI"], cwd=d.proje,
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10)
        for satir in r.stdout.splitlines():
            parca = satir.split("\x1f")
            if len(parca) == 3:
                liste.append({"hash": parca[0], "mesaj": parca[1], "zaman": parca[2]})
    except (OSError, subprocess.TimeoutExpired):
        pass
    _git_onbellek[anahtar] = (simdi, liste)
    return liste


def _konsol_sonu(d: Durum) -> str:
    f = d.dizin / "konsol.log"
    if not f.exists():
        return ""
    return "\n".join(f.read_text(encoding="utf-8", errors="replace").splitlines()[-25:])


def durum_verisi(d: Durum) -> dict:
    ayar = d.ayarlari_oku()
    v = d.oku()
    gorevler = _gorevler(d)
    olaylar = d.son_olaylar(300)
    bugun = dt.date.today().isoformat()
    pid = d.calisiyor_mu()
    return {
        "ad": d.dizin.name,
        "proje": str(d.proje),
        "veri_dizini": str(d.dizin),
        "calisiyor": bool(pid),
        "pid": pid,
        "ayarlar": ayar.__dict__ if ayar else {},
        "durum": {k: v.get(k) for k in ("aktif", "asama", "asama_zamani", "bekle_until", "bekleme_sebebi",
                                         "toplam_maliyet", "taban_hatasi")},
        "gorevler": gorevler,
        "olaylar": olaylar,
        "commitler": _commitler(d, ayar.dal) if ayar and d.proje.exists() else [],
        "istatistik": {
            "bitti": sum(g["durum"] == "bitti" for g in gorevler),
            "bekliyor": sum(g["durum"] == "bekliyor" for g in gorevler),
            "basarisiz": sum(g["durum"] == "basarisiz" for g in gorevler),
            "bugun": sum(o.get("tur") == "commit" and o.get("zaman", "").startswith(bugun) for o in olaylar),
        },
        "konsol": "" if pid else _konsol_sonu(d),
        "simdi": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
    }


def baslat(d: Durum) -> str:
    if d.calisiyor_mu():
        return "Zaten çalışıyor."
    ayar = d.ayarlari_oku()
    if not ayar or (not ayar.hedef and not d.siradaki_gorev() and not d.aktif_gorev()):
        raise ValueError("Önce bir hedef yaz veya görev ekle.")
    konsol = (d.dizin / "konsol.log").open("w", encoding="utf-8")
    ortam = {**os.environ, "PYTHONPATH": f"{REPO}{os.pathsep}{os.environ.get('PYTHONPATH', '')}",
             "PYTHONUTF8": "1", "PYTHONUNBUFFERED": "1"}
    secenek: dict = {}
    if platform.system() == "Windows":
        secenek["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        secenek["start_new_session"] = True
    subprocess.Popen([sys.executable, "-m", "otopilot", "baslat", str(d.proje)], cwd=REPO, env=ortam,
                     stdin=subprocess.DEVNULL, stdout=konsol, stderr=subprocess.STDOUT, **secenek)
    return "Başlatıldı."


def durdur(d: Durum) -> str:
    pid = d.calisiyor_mu()
    if not pid:
        return "Zaten çalışmıyor."
    if platform.system() == "Windows":
        # Alt süreçleriyle (testler, kabuk) birlikte sonlandır; durum diskte olduğu için kaldığı yerden devam eder
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
        d.olay("durdu", "⏹  Arayüzden durduruldu. Başlatınca kaldığı yerden devam eder.", asama="durdu")
    else:
        try:
            os.killpg(pid, signal.SIGINT) if os.getpgid(pid) == pid else os.kill(pid, signal.SIGINT)
        except ProcessLookupError:
            pass
    return "Durduruluyor."


class Isleyici(BaseHTTPRequestHandler):
    server_version = "Otopilot"

    def log_message(self, *args) -> None:  # konsolu istek kayıtlarıyla doldurma
        pass

    def _host_gecerli(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost")

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
        if url.path == "/":
            sayfa = HTML.read_text(encoding="utf-8").replace("__ANAHTAR__", ANAHTAR)
            return self._gonder(200, sayfa.encode("utf-8"), "text/html; charset=utf-8")
        if url.path == "/api/projeler":
            return self._json(200, [{"ad": d.dizin.name, "proje": str(d.proje), "calisiyor": bool(d.calisiyor_mu())}
                                    for d in _projeler()])
        if url.path == "/api/durum":
            ad = parse_qs(url.query).get("ad", [""])[0]
            d = _bul(ad) if ad else next(iter(_projeler()), None)
            if not d:
                return self._json(404, {"hata": "Proje bulunamadı."})
            return self._json(200, durum_verisi(d))
        self._gonder(404, b"")

    def do_POST(self) -> None:
        if not self._host_gecerli() or self.headers.get("X-Otopilot-Anahtar") != ANAHTAR:
            return self._gonder(403, b"")
        try:
            uzunluk = min(int(self.headers.get("Content-Length") or 0), 100_000)
            veri = json.loads(self.rfile.read(uzunluk) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"hata": "Geçersiz istek."})
        d = _bul(str(veri.get("ad", "")))
        if not d:
            return self._json(404, {"hata": "Proje bulunamadı."})
        try:
            yol = urlparse(self.path).path
            if yol == "/api/baslat":
                return self._json(200, {"mesaj": baslat(d)})
            if yol == "/api/durdur":
                return self._json(200, {"mesaj": durdur(d)})
            if yol == "/api/gorev":
                metin = " ".join(str(veri.get("metin", "")).split())
                if not metin:
                    raise ValueError("Görev metni boş.")
                d.gorev_ekle([metin])
                return self._json(200, {"mesaj": "Görev eklendi."})
            if yol == "/api/hedef":
                ayar = d.ayarlari_oku()
                ayar.hedef = " ".join(str(veri.get("hedef", "")).split())
                d.ayarlari_yaz(ayar)
                return self._json(200, {"mesaj": "Hedef kaydedildi."})
        except ValueError as e:
            return self._json(400, {"hata": str(e)})
        self._gonder(404, b"")


def calistir(port: int = 8765, tarayici: bool = True) -> None:
    adres = f"http://127.0.0.1:{port}/"
    try:
        sunucu = ThreadingHTTPServer(("127.0.0.1", port), Isleyici)
    except OSError:
        print(f"Arayüz zaten açık olabilir: {adres}")
        if tarayici:
            webbrowser.open(adres)
        return
    print(f"Otopilot arayüzü: {adres}  (kapatmak için bu pencereyi kapat veya Ctrl+C)")
    if tarayici:
        threading.Timer(0.8, webbrowser.open, args=(adres,)).start()
    try:
        sunucu.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        sunucu.server_close()
