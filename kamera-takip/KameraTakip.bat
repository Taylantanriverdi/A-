@echo off
chcp 65001 >nul
setlocal
title Kamera Hareket Takibi v18
REM ================================================================
REM  Kamera Hareket Takibi - tek dosyada kurulum ve çalıştırma
REM  Bu dosyaya çift tıklayın, her şeyi kendisi yapar:
REM   1) Python yoksa kurar
REM   2) Gerekli kütüphaneleri kurar
REM   3) Takip programını hazırlar
REM   4) go2rtc'yi indirip başlatır, Xiaomi girişi için tarayıcıyı açar
REM   5) Kamera eklenince tarama ve yüz takibini başlatır
REM ================================================================

set "BAT_YOLU=%~f0"
set "KLASOR=%LOCALAPPDATA%\KameraTakip"
set "PYTHONIOENCODING=utf-8"
if not exist "%KLASOR%" mkdir "%KLASOR%"

echo.
echo Kamera Takip v18
echo.
echo [1/4] Python denetleniyor...
set "PY="
py -3 -c "import sys" >nul 2>&1 && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>&1 && set "PY=python"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe""
if defined PY goto python_var

echo Python bulunamadı, kuruluyor (birkaç dakika sürebilir)...
where winget >nul 2>&1
if errorlevel 1 goto python_elle
winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
if not exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" goto python_elle
set "PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe""

:python_var
echo Python hazır.

echo.
echo [2/4] Kütüphaneler kuruluyor (ilk seferde biraz sürer)...
%PY% -m pip install --disable-pip-version-check --quiet --upgrade opencv-python numpy requests pillow edge-tts gTTS imageio-ffmpeg
if errorlevel 1 (
  echo HATA: Kütüphaneler kurulamadı. İnternet bağlantınızı kontrol edin.
  pause
  exit /b 1
)

echo.
echo [3/4] Takip programı hazırlanıyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=[IO.File]::ReadAllText($env:BAT_YOLU); $p=$c -split '::PYTHON_KODU_BURADA::'; [IO.File]::WriteAllText($env:KLASOR + '\takip.py', $p[$p.Length-1].TrimStart())"
if not exist "%KLASOR%\takip.py" (
  echo HATA: takip.py oluşturulamadı.
  pause
  exit /b 1
)

echo.
echo [4/4] Kameraya bağlanılıyor ve takip başlatılıyor...
echo       Takip penceresinden çıkmak için: Q veya Esc
cd /d "%KLASOR%"
%PY% takip.py --kaynak go2rtc --maske-saat --kaydet "%USERPROFILE%\Videos\KameraTakip" --yuz-klasor "%USERPROFILE%\Pictures\KameraTakip"
echo.
echo Hareket videoları  : %USERPROFILE%\Videos\KameraTakip
echo Yüz fotoğrafları   : %USERPROFILE%\Pictures\KameraTakip
pause
exit /b 0

:python_elle
echo.
echo Python otomatik olarak kurulamadı.
echo Lütfen https://www.python.org/downloads/ adresinden Python'u kurun,
echo kurulumda "Add Python to PATH" kutusunu işaretleyin, sonra bu dosyayı yeniden çalıştırın.
start "" https://www.python.org/downloads/
pause
exit /b 1

REM ---- Aşağısı Python kodudur, bat tarafından çalıştırılmaz ----
::PYTHON_KODU_BURADA::
#!/usr/bin/env python3
"""
Hareketli nesne takibi - Xiaomi (veya herhangi bir) IP kamera icin.

Kaynak olarak RTSP adresi, video dosyasi ya da USB kamera numarasi verilebilir:
    python takip.py --kaynak rtsp://127.0.0.1:8554/xiaomi
    python takip.py --kaynak kayit.mp4
    python takip.py --kaynak 0
    python takip.py --kaynak go2rtc     # go2rtc'yi indirir, baslatir, Xiaomi kamerayi bekler

Doner (PTZ) kamerada: kamera duzensiz sekilde surekli tarama yapar, yuz gorunce
durur ve yuzu ekranin ortasinda tutacak sekilde kamerayi dondurerek takip eder.
Motor komutlari go2rtc'nin Xiaomi girisiyle bulut uzerinden gonderilir; hangi
komutun kamerayi hangi yone cevirdigi ilk calistirmada goruntuden olculur.

Sabit kamerada:
  1) Arka plan cikarma (MOG2) ile sahnede hareket olup olmadigina bakilir.
  2) Hareket gorulunce YuNet yuz dedektoru calisir ve yuz aranir.
  3) Bulunan yuzler kareden kareye ayni numarayla takip edilir, yeni bir yuz
     yakalaninca fotografi kaydedilir. Yuz kaybolunca tekrar hareket beklenir.
"""
SURUM = "v18"  # her guncellemede artirilir; kamerada ve pencere basliginda gorunur

import argparse
import base64
import hashlib
import json
import os
import platform
import random
import re
import struct
import threading
import urllib.error
import urllib.parse
import subprocess
import sys
import time
import urllib.request
import webbrowser
import zipfile
from collections import OrderedDict, deque
from datetime import datetime

import cv2
import numpy as np


class MerkezTakipci:
    """Basit merkez-nokta (centroid) takipcisi: nesnelere kalici ID verir."""

    def __init__(self, max_kayip=20, max_mesafe=120, iz_uzunlugu=40):
        self.sonraki_id = 1
        self.nesneler = OrderedDict()   # id -> (cx, cy)
        self.kutular = {}               # id -> (x, y, w, h)
        self.kayip = {}                 # id -> kac karedir gorulmedi
        self.izler = {}                 # id -> deque[(cx, cy)]
        self.max_kayip = max_kayip
        self.max_mesafe = max_mesafe
        self.iz_uzunlugu = iz_uzunlugu

    def _ekle(self, merkez, kutu):
        i = self.sonraki_id
        self.sonraki_id += 1
        self.nesneler[i] = merkez
        self.kutular[i] = kutu
        self.kayip[i] = 0
        self.izler[i] = deque([merkez], maxlen=self.iz_uzunlugu)

    def _sil(self, i):
        for d in (self.nesneler, self.kutular, self.kayip, self.izler):
            d.pop(i, None)

    def guncelle(self, kutular):
        if not kutular:
            for i in list(self.kayip):
                self.kayip[i] += 1
                if self.kayip[i] > self.max_kayip:
                    self._sil(i)
            return self.nesneler

        merkezler = np.array([(x + w // 2, y + h // 2) for x, y, w, h in kutular], dtype=int)

        if not self.nesneler:
            for m, k in zip(merkezler, kutular):
                self._ekle((int(m[0]), int(m[1])), k)
            return self.nesneler

        idler = list(self.nesneler.keys())
        eski = np.array(list(self.nesneler.values()))
        mesafe = np.linalg.norm(eski[:, None, :] - merkezler[None, :, :], axis=2)

        satirlar = mesafe.min(axis=1).argsort()
        sutunlar = mesafe.argmin(axis=1)[satirlar]
        kullanilan_s, kullanilan_c = set(), set()
        for s, c in zip(satirlar, sutunlar):
            if s in kullanilan_s or c in kullanilan_c:
                continue
            if mesafe[s, c] > self.max_mesafe:
                continue
            i = idler[s]
            self.nesneler[i] = (int(merkezler[c][0]), int(merkezler[c][1]))
            self.kutular[i] = kutular[c]
            self.kayip[i] = 0
            self.izler[i].append(self.nesneler[i])
            kullanilan_s.add(s)
            kullanilan_c.add(c)

        for s in set(range(len(idler))) - kullanilan_s:
            i = idler[s]
            self.kayip[i] += 1
            if self.kayip[i] > self.max_kayip:
                self._sil(i)
        for c in set(range(len(merkezler))) - kullanilan_c:
            self._ekle((int(merkezler[c][0]), int(merkezler[c][1])), kutular[c])
        return self.nesneler


GO2RTC_API = "http://127.0.0.1:1984"
GO2RTC_YAML = """api:
  listen: ":1984"
rtsp:
  listen: ":8554"
"""


def _go2rtc_dosyasi():
    sistem, mimari = platform.system(), platform.machine().lower()
    arm = mimari in ("arm64", "aarch64")
    if sistem == "Windows":
        return "go2rtc_win_arm64.zip" if arm else "go2rtc_win64.zip", "go2rtc.exe"
    if sistem == "Darwin":
        return "go2rtc_mac_arm64.zip" if arm else "go2rtc_mac_amd64.zip", "go2rtc"
    return "go2rtc_linux_arm64" if arm else "go2rtc_linux_amd64", "go2rtc"


def _akislar():
    try:
        with urllib.request.urlopen(GO2RTC_API + "/api/streams", timeout=2) as r:
            return json.loads(r.read().decode() or "{}") or {}
    except Exception:
        return None  # go2rtc calismiyor


XIAOMI_BOLGELER = [("sg", "Singapore"), ("de", "Europe"), ("cn", "China"),
                   ("ru", "Russia"), ("us", "United States"), ("i2", "India")]


def _api(yol, yontem="GET", zaman=15):
    istek = urllib.request.Request(GO2RTC_API + yol, method=yontem)
    with urllib.request.urlopen(istek, timeout=zaman) as r:
        return r.read().decode()


def _xiaomi_hesaplari():
    try:
        return json.loads(_api("/api/xiaomi", zaman=3) or "[]") or []
    except Exception:
        return []


def xiaomi_kamera_ekle(kullanici):
    """Giris yapilmis Xiaomi hesabinda tum bolgeleri tarar, ilk kamerayi
    go2rtc'ye 'xiaomi' adiyla ekler (go2rtc bunu go2rtc.yaml'a kaydeder)."""
    print("Xiaomi hesab\u0131 bulundu (%s), kamera aran\u0131yor..." % kullanici)
    for kod, ad in XIAOMI_BOLGELER:
        try:
            veri = json.loads(_api("/api/xiaomi?id=%s&region=%s" % (kullanici, kod)))
        except Exception:
            print("  %-14s kamera yok" % ad)
            continue
        kaynaklar = veri.get("sources") or []
        if not kaynaklar:
            print("  %-14s kamera yok" % ad)
            continue
        k = kaynaklar[0]
        print("  %-14s BULUNDU: %s (%s)" % (ad, k.get("name"), k.get("info")))
        _api("/api/streams?name=xiaomi&src=" + urllib.request.quote(k["url"], safe=""), "PUT")
        print("Kamera go2rtc'ye eklendi.")
        return True
    print("Bu hesapta kamera bulunamad\u0131. Kamera ba\u015fka bir Xiaomi hesab\u0131nda olabilir.")
    return False


def ffmpeg_yolu():
    """FFmpeg (go2rtc'nin kameraya ses gondermesi icin). pip paketi imageio-ffmpeg ile gelir."""
    try:
        import imageio_ffmpeg
        yol = imageio_ffmpeg.get_ffmpeg_exe()
        return yol if yol and os.path.exists(yol) else None
    except Exception:
        return None


def _bosluksuz_yol(yol):
    """Windows kisa yol adi (C:\\PROGRA~1\\...): boslukla bolunmesin."""
    if " " not in yol or os.name != "nt":
        return yol
    try:
        import ctypes
        tampon = ctypes.create_unicode_buffer(1024)
        if ctypes.windll.kernel32.GetShortPathNameW(yol, tampon, 1024):
            return tampon.value
    except Exception:
        pass
    return yol


def go2rtc_ffmpeg_ayarla(yaml_yolu):
    """go2rtc.yaml'a FFmpeg'in yerini yazar. Degisiklik yapildiysa True.
    go2rtc FFmpeg yolunu bosluktan boler ("C:/Program Files/..." -> "C:/Program"):
    bu yuzden FFmpeg'i go2rtc klasorune (bosluksuz yere) kopyalariz."""
    kaynak = ffmpeg_yolu()
    if not kaynak or not os.path.exists(yaml_yolu):
        return False
    import shutil
    hedef = os.path.join(os.path.dirname(os.path.abspath(yaml_yolu)),
                         "ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    try:
        if not os.path.exists(hedef) or os.path.getsize(hedef) != os.path.getsize(kaynak):
            shutil.copy2(kaynak, hedef)
            os.chmod(hedef, 0o755)
        ff = hedef
    except OSError as e:
        print("FFmpeg kopyalanamad\u0131 (%s), oldu\u011fu yerden kullan\u0131lacak." % e)
        ff = kaynak
    ff = _bosluksuz_yol(ff)
    if " " in ff:
        print("Uyar\u0131: FFmpeg yolunda bo\u015fluk var, kamera hoparl\u00f6r\u00fc \u00e7al\u0131\u015fmayabilir: " + ff)
    ff = ff.replace("\\", "/")
    metin = open(yaml_yolu, encoding="utf-8").read()
    # ffmpeg bolumunu bastan yaz: FFmpeg yolu + Xiaomi hoparlor uyarlamasi.
    # go2rtc'nin Xiaomi surucusu hoparlore 8 kHz (40 ms = 320 bayt) PCMA yollar ama kanali
    # kameranin mikrofon bicimiyle (PCMA/16000) acar. 16 kHz ses yollarsak kamera iki kat
    # veri alir ve cizirti olur. Bu ayar sesi 8 kHz'e indirip 16000 etiketiyle yollar.
    bolum = ('ffmpeg:\n  bin: "%s"\n'
             '  xiaomi_hoparlor: "-c:a pcm_alaw -af aresample=8000,asetrate=16000 -ar:a 16000 -ac:a 1"\n' % ff)
    satirlar, atla = [], False
    for satir in metin.splitlines():
        if re.match(r"^ffmpeg:\s*$", satir):
            atla = True
            continue
        if atla and (satir.startswith((" ", "\t")) or not satir.strip()):
            continue
        atla = False
        satirlar.append(satir)
    yeni_metin = "\n".join(satirlar).rstrip("\n") + "\n\n" + bolum
    if yeni_metin == metin:
        return False
    with open(yaml_yolu, "w", encoding="utf-8") as f:
        f.write(yeni_metin)
    return True


GO2RTC_YAMA = "v1.9.15-xiaomi-ses-1"
GO2RTC_YAMA_URL = "https://github.com/Taylantanriverdi/A-/releases/latest/download/go2rtc-xiaomi-ses.exe"


def go2rtc_yamali_kur(klasor, exe_yolu):
    """Xiaomi hoparlor duzeltmeli go2rtc'yi indirir (Windows). go2rtc calismiyorken cagrilmali."""
    if os.name != "nt":
        return False
    isaret = os.path.join(klasor, "yama.txt")
    try:
        if open(isaret).read().strip() == GO2RTC_YAMA and os.path.exists(exe_yolu):
            return True
    except OSError:
        pass
    try:
        print("Hoparl\u00f6r d\u00fczeltmeli go2rtc indiriliyor...")
        gecici = exe_yolu + ".yeni"
        model_indir(GO2RTC_YAMA_URL, gecici, "D\u00fczeltilmi\u015f go2rtc", lambda m: None, en_az=10000000)
        os.replace(gecici, exe_yolu)
        with open(isaret, "w") as f:
            f.write(GO2RTC_YAMA)
        print("D\u00fczeltilmi\u015f go2rtc kuruldu (%s)." % GO2RTC_YAMA)
        return True
    except Exception as e:
        print("D\u00fczeltilmi\u015f go2rtc indirilemedi (%s); orijinal go2rtc kullan\u0131lacak." % str(e)[:80])
        return False


def go2rtc_hazirla(klasor):
    """go2rtc'yi gerekirse indirir ve baslatir, kamera eklenene kadar bekler.
    Donus: (rtsp adresi, baslatilan surec veya None)"""
    klasor = os.path.abspath(klasor)
    os.makedirs(klasor, exist_ok=True)
    dosya, exe = _go2rtc_dosyasi()
    exe_yolu = os.path.join(klasor, exe)
    yaml_yolu = os.path.join(klasor, "go2rtc.yaml")
    surec = None

    # Kameraya ses gonderebilmek icin go2rtc'nin FFmpeg'i bilmesi gerekir. Onceki bir
    # calistirmadan kalan go2rtc eski ayarlarla calisiyor olabilir: kapatip yeniden baslat.
    go2rtc_ffmpeg_ayarla(yaml_yolu)
    if _akislar() is not None:
        print("\u00c7al\u0131\u015fan go2rtc g\u00fcncel ayarlarla yeniden ba\u015flat\u0131l\u0131yor...")
        try:
            _api("/api/exit?code=0", "POST", 5)
        except Exception:
            pass
        for _ in range(30):
            if _akislar() is None:
                break
            time.sleep(0.5)
        else:
            print("Uyar\u0131: eski go2rtc kapanmad\u0131; kamera hoparl\u00f6r\u00fc \u00e7al\u0131\u015fmayabilir.")
        time.sleep(1.0)

    if _akislar() is None:
        go2rtc_yamali_kur(klasor, exe_yolu)
        if not os.path.exists(exe_yolu):
            url = "https://github.com/AlexxIT/go2rtc/releases/latest/download/" + dosya
            print("go2rtc indiriliyor:", url)
            hedef = os.path.join(klasor, dosya)
            urllib.request.urlretrieve(url, hedef)
            if dosya.endswith(".zip"):
                with zipfile.ZipFile(hedef) as z:
                    z.extract(exe, klasor)
                os.remove(hedef)
            else:
                os.replace(hedef, exe_yolu)
            os.chmod(exe_yolu, 0o755)
        if not os.path.exists(yaml_yolu):
            with open(yaml_yolu, "w") as f:
                f.write(GO2RTC_YAML)
            go2rtc_ffmpeg_ayarla(yaml_yolu)
        print("go2rtc ba\u015flat\u0131l\u0131yor...")
        log = open(os.path.join(klasor, "go2rtc.log"), "a")
        surec = subprocess.Popen([exe_yolu, "-config", yaml_yolu], cwd=klasor,
                                 stdout=log, stderr=subprocess.STDOUT)
        for _ in range(30):
            if _akislar() is not None:
                break
            if surec.poll() is not None:
                raise SystemExit("go2rtc a\u00e7\u0131lamad\u0131, go2rtc.log dosyas\u0131na bak\u0131n.")
            time.sleep(0.5)
        else:
            raise SystemExit("go2rtc yan\u0131t vermiyor (1984 numaral\u0131 port dolu olabilir).")

    akislar = _akislar() or {}
    if not akislar:
        print()
        print("=" * 64)
        print(" Kamera hen\u00fcz eklenmemi\u015f. Taray\u0131c\u0131da go2rtc a\u00e7\u0131lacak:")
        print("   1) A\u015fa\u011f\u0131da Xiaomi'ye t\u0131klay\u0131n")
        print("   2) Xiaomi Home hesab\u0131n\u0131zla giri\u015f yap\u0131n (login'e YALNIZCA B\u0130R KEZ bas\u0131n,")
        print("      gelen kodu yaz\u0131p send'e bas\u0131n)")
        print(" Giri\u015f yap\u0131nca kamera KEND\u0130L\u0130\u011e\u0130NDEN bulunup eklenir ve takip")
        print(" ba\u015flar. Bu pencereyi kapatmay\u0131n.")
        print("=" * 64)
        webbrowser.open("http://localhost:1984/add.html")
        taranan = set()
        while not akislar:
            time.sleep(3)
            akislar = _akislar() or {}
            if not akislar:
                for kullanici in _xiaomi_hesaplari():
                    if kullanici not in taranan:
                        taranan.add(kullanici)
                        if xiaomi_kamera_ekle(kullanici):
                            akislar = _akislar() or {}
                            break
    ad = next(iter(akislar))
    print("Kamera yay\u0131n\u0131 bulundu:", ad)
    return "rtsp://127.0.0.1:8554/" + urllib.request.quote(ad), surec


def kaynak_ac(kaynak):
    if kaynak.isdigit():
        return cv2.VideoCapture(int(kaynak))
    if kaynak.startswith("rtsp://"):
        # RTSP icin TCP daha kararli (gri/bozuk kare azalir)
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
        return cv2.VideoCapture(kaynak, cv2.CAP_FFMPEG)
    return cv2.VideoCapture(kaynak)


YUNET_DOSYA = "face_detection_yunet_2023mar.onnx"
YUNET_URLLER = [
    "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/" + YUNET_DOSYA,
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/" + YUNET_DOSYA,
]


class YuzDedektor:
    """OpenCV YuNet yuz dedektoru (model ilk calistirmada indirilir, ~230 KB)."""

    def __init__(self, klasor, esik=0.75):
        yol = os.path.join(klasor, YUNET_DOSYA)
        if not os.path.exists(yol) or os.path.getsize(yol) < 100000:
            for url in YUNET_URLLER:
                try:
                    print("Y\u00fcz bulma modeli indiriliyor...")
                    urllib.request.urlretrieve(url, yol)
                    if os.path.getsize(yol) > 100000:
                        break
                except Exception as e:
                    print("  \u0130ndirilemedi:", e)
            else:
                raise SystemExit("Y\u00fcz bulma modeli indirilemedi. \u0130nternet ba\u011flant\u0131n\u0131z\u0131 kontrol edin.")
        self.det = cv2.FaceDetectorYN.create(yol, "", (320, 320), esik, 0.3, 50)
        self.boyut = None
        self.ham = []

    def esik(self, deger):
        self.det.setScoreThreshold(deger)

    def bul(self, kare, min_boyut=20):
        h, w = kare.shape[:2]
        if self.boyut != (w, h):
            self.det.setInputSize((w, h))
            self.boyut = (w, h)
        _, yuzler = self.det.detect(kare)
        kutular, self.ham = [], []  # ham: tanima icin goz/burun/agiz noktalari
        if yuzler is not None:
            for f in yuzler:
                x, y, bw, bh = (int(v) for v in f[:4])
                x, y = max(0, x), max(0, y)
                bw, bh = min(bw, w - x), min(bh, h - y)
                if bw >= min_boyut and bh >= min_boyut:
                    kutular.append((x, y, bw, bh))
                    self.ham.append(f.copy())
        return kutular


# ===========================================================================
#  Yuz tanima (kisileri isimleriyle tanima) - OpenCV SFace, tamamen yerel
# ===========================================================================
SFACE_DOSYA = "face_recognition_sface_2021dec.onnx"
SFACE_URLLER = [
    "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/" + SFACE_DOSYA,
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/" + SFACE_DOSYA,
]
TR_ASCII = str.maketrans("\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00c7\u011e\u0130\u00d6\u015e\u00dc",
                         "cgiosuCGIOSU")


def ascii_ad(ad):
    """OpenCV ekrana Turkce harf yazamaz: s/g/i/o/u/c'ye cevir."""
    return ad.translate(TR_ASCII).encode("ascii", "replace").decode()


TANIMA_DURUM = {"metin": "Y\u00fcz tan\u0131ma haz\u0131rlan\u0131yor..."}


def model_indir(url, yol, ad, durum=None, en_az=30000000):
    """Buyuk dosyayi ilerleme gostererek indirir; 30 sn veri gelmezse keser.
    durum: ilerleme metnini alan fonksiyon (varsayilan: yuz tanima durumu)."""
    if durum is None:
        durum = lambda m: TANIMA_DURUM.__setitem__("metin", m)
    gecici = yol + ".tmp"
    with urllib.request.urlopen(url, timeout=30) as r, open(gecici, "wb") as f:
        toplam = int(r.headers.get("Content-Length") or 0)
        alinan, son_yazi = 0, 0.0
        while True:
            parca = r.read(256 * 1024)
            if not parca:
                break
            f.write(parca)
            alinan += len(parca)
            if time.time() - son_yazi > 1.0:
                son_yazi = time.time()
                yuzde = (" %%%d" % (alinan * 100 // toplam)) if toplam else ""
                m = "%s indiriliyor:%s (%.1f / %.1f MB)" % (ad, yuzde, alinan / 1e6, toplam / 1e6)
                durum(m)
                print("  " + m)
    if alinan < en_az or (toplam and alinan < toplam):
        raise RuntimeError("dosya eksik indi (%d / %d bayt)" % (alinan, toplam))
    os.replace(gecici, yol)


class YuzTaniyici:
    ESIK = 0.40  # kosinus benzerligi; ayni kisi genelde 0.6-0.9, farkli kisi 0.0-0.3

    def __init__(self, klasor, dedektor):
        yol = os.path.join(klasor, SFACE_DOSYA)
        if not os.path.exists(yol) or os.path.getsize(yol) < 30000000:
            hata = None
            for url in SFACE_URLLER:
                try:
                    model_indir(url, yol, "Y\u00fcz tan\u0131ma modeli")
                    hata = None
                    break
                except Exception as e:
                    hata = e
                    print("  \u0130ndirilemedi:", str(e)[:100])
            if hata is not None:
                raise RuntimeError("model indirilemedi: %s" % str(hata)[:100])
        TANIMA_DURUM["metin"] = "Y\u00fcz tan\u0131ma modeli y\u00fckleniyor..."
        self.rec = cv2.FaceRecognizerSF.create(yol, "")
        self.kilit = threading.Lock()
        self.json_yolu = os.path.join(klasor, "kisiler.json")
        self.klasor = os.path.join(klasor, "kisiler")
        self.kisiler = {}   # ad -> [ozellik (128 float)]
        self.dosyalar = []  # klasorden ogrenilmis resimler
        try:
            d = json.load(open(self.json_yolu, encoding="utf-8"))
            self.kisiler = {k: [np.array(f, np.float32).reshape(1, -1) for f in v]
                            for k, v in d.get("kisiler", {}).items()}
            self.dosyalar = d.get("dosyalar", [])
        except (OSError, ValueError):
            pass
        self._klasorden_ogren(dedektor)

    def _klasorden_ogren(self, dedektor):
        """kisiler/<Ad>/*.jpg resimlerinden toplu ogrenme."""
        if not os.path.isdir(self.klasor):
            os.makedirs(self.klasor, exist_ok=True)
            return
        yeni = 0
        for ad in sorted(os.listdir(self.klasor)):
            k = os.path.join(self.klasor, ad)
            if not os.path.isdir(k):
                continue
            for dosya in sorted(os.listdir(k)):
                yol = os.path.join(k, dosya)
                if yol in self.dosyalar or not dosya.lower().endswith((".jpg", ".jpeg", ".png")):
                    continue
                self.dosyalar.append(yol)
                img = cv2.imdecode(np.fromfile(yol, np.uint8), cv2.IMREAD_COLOR)
                if img is None:
                    continue
                h, w = img.shape[:2]
                if max(h, w) > 1280:
                    o = 1280.0 / max(h, w)
                    img = cv2.resize(img, (int(w * o), int(h * o)))
                kutular = dedektor.bul(img)
                if not kutular:
                    print("  %s: y\u00fcz bulunamad\u0131" % yol)
                    continue
                j = max(range(len(kutular)), key=lambda n: kutular[n][2] * kutular[n][3])
                self.kisiler.setdefault(ad, []).append(self.ozellik(img, dedektor.ham[j]))
                yeni += 1
        if yeni:
            print("Klas\u00f6rden %d y\u00fcz \u00f6\u011frenildi." % yeni)
            self.kaydet()

    def ozellik(self, kare, ham):
        return self.rec.feature(self.rec.alignCrop(kare, ham)).copy()

    def tani(self, oz):
        en_ad, en_skor = None, 0.0
        with self.kilit:
            for ad, liste in self.kisiler.items():
                for f in liste:
                    skor = self.rec.match(oz, f, cv2.FaceRecognizerSF_FR_COSINE)
                    if skor > en_skor:
                        en_ad, en_skor = ad, skor
        return (en_ad if en_skor >= self.ESIK else None), en_skor

    def ekle(self, ad, ozellikler):
        with self.kilit:
            self.kisiler.setdefault(ad, []).extend(ozellikler)
            self.kisiler[ad] = self.kisiler[ad][-30:]
        self.kaydet()

    def sil(self, ad):
        with self.kilit:
            self.kisiler.pop(ad, None)
        self.kaydet()

    def liste(self):
        with self.kilit:
            return [{"ad": k, "ornek": len(v)} for k, v in sorted(self.kisiler.items())]

    def kaydet(self):
        with self.kilit:
            d = {"kisiler": {k: [f.flatten().round(5).tolist() for f in v] for k, v in self.kisiler.items()},
                 "dosyalar": self.dosyalar}
        with open(self.json_yolu, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False)


def tr_kucuk(m):
    return m.replace("I", "\u0131").replace("\u0130", "i").lower()


def tr_baslik(ad):
    """'TAYLAN' -> 'Taylan', 'iLKER' -> '\u0130lker' (Turkce I/\u0130 kurallariyla)."""
    def buyuk(c):
        return {"i": "\u0130", "\u0131": "I"}.get(c, c.upper())
    return " ".join(buyuk(k[0]) + k[1:] for k in tr_kucuk(ad).split() if k)


def selam_metni(ad):
    saat = datetime.now().hour
    if 5 <= saat < 11:
        selam = "G\u00fcnayd\u0131n"
    elif 11 <= saat < 17:
        selam = "Merhaba"
    elif 17 <= saat < 22:
        selam = "\u0130yi ak\u015famlar"
    else:
        selam = "\u0130yi geceler"
    return "%s %s, ho\u015f geldin." % (selam, tr_baslik(ad))


SESLER = {"emel": "tr-TR-EmelNeural", "ahmet": "tr-TR-AhmetNeural"}
SES_AYAR = {"klasor": ".", "ses": "emel", "hoparlor": "kamera", "akis": None, "web": None, "son_hata": "",
            "uyarlama": False}


def _ses_dosyasi(metin):
    """Dogal Turkce ses dosyasi uretir (onbellekli): once Microsoft sinir agi sesi,
    olmazsa Google. Bir kez uretilen cumle internetsiz de calar."""
    import hashlib as _h
    klasor = os.path.join(SES_AYAR["klasor"], "ses_onbellek")
    os.makedirs(klasor, exist_ok=True)
    yol = os.path.join(klasor, _h.sha1((SES_AYAR["ses"] + "|" + metin).encode("utf-8")).hexdigest()[:16] + ".mp3")
    if os.path.exists(yol) and os.path.getsize(yol) > 1000:
        return yol
    try:
        import asyncio
        import edge_tts
        asyncio.run(edge_tts.Communicate(metin, SESLER.get(SES_AYAR["ses"], SESLER["emel"]),
                                         rate="-5%").save(yol))
        if os.path.getsize(yol) > 1000:
            return yol
    except Exception as e:
        print("Microsoft T\u00fcrk\u00e7e sesi kullan\u0131lamad\u0131 (%s), Google sesi deneniyor." % str(e)[:60])
    try:
        from gtts import gTTS
        gTTS(metin, lang="tr").save(yol)
        if os.path.getsize(yol) > 1000:
            return yol
    except Exception as e:
        print("Google T\u00fcrk\u00e7e sesi kullan\u0131lamad\u0131 (%s), Windows sesi kullan\u0131lacak." % str(e)[:60])
    return None


def _mp3_cal(yol):
    """Windows'ta MP3'u ek program olmadan calar (winmm). Basarili ise True."""
    import ctypes
    mci = ctypes.windll.winmm.mciSendStringW
    takma = "ses%d" % random.randint(0, 10 ** 9)
    if mci('open "%s" type mpegvideo alias %s' % (yol, takma), None, 0, 0) != 0:
        return False
    mci("play %s wait" % takma, None, 0, 0)
    mci("close %s" % takma, None, 0, 0)
    return True


def _windows_sesi(metin):
    ps = ("Add-Type -AssemblyName System.Speech; "
          "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
          "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'tr-TR' } | Select-Object -First 1; "
          "if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; $s.Speak($env:SELAM_METIN)")
    try:
        subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
                         env=dict(os.environ, SELAM_METIN=metin),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except OSError as e:
        print("Ses \u00e7al\u0131namad\u0131:", e)


def kamera_ses_kanali():
    """go2rtc'den kameranin hoparlor kanalini (sendonly ses) okur.
    Donus: (ffmpeg bicimi, okunabilir ad) | (None, sebep)."""
    akis = SES_AYAR.get("akis")
    try:
        bilgi = json.loads(_api("/api/streams?src=" + urllib.request.quote(akis), "GET", 5) or "{}")
    except Exception as e:
        return None, "go2rtc ak\u0131\u015f bilgisi okunamad\u0131: %s" % str(e)[:80]
    medyalar = []
    for uretici in (bilgi or {}).get("producers") or []:
        medyalar += uretici.get("medias") or []
    if not medyalar:
        return None, "kamera yay\u0131n\u0131 \u015fu an go2rtc'de etkin de\u011fil"
    for m in medyalar:
        parca = [x.strip() for x in m.split(",")]
        if len(parca) >= 3 and parca[0] == "audio" and parca[1] == "sendonly":
            kodek = parca[2].upper()  # ornek: PCMA/16000, PCMA, PCMU/8000, OPUS/48000/2
            ad = kodek.split("/")[0]
            hiz = kodek.split("/")[1] if "/" in kodek else "8000"
            if ad == "PCMA" and hiz == "16000" and SES_AYAR.get("uyarlama", False):
                return "xiaomi_hoparlor", kodek + " (8 kHz uyarlamal\u0131)"
            if ad in ("PCMA", "PCMU"):
                return "%s/%s" % (ad.lower(), hiz), kodek
            if ad == "OPUS":
                return "opus", kodek
            return None, "kameran\u0131n hoparl\u00f6r bi\u00e7imi desteklenmiyor: %s" % kodek
    sesli = any(m.startswith("audio") for m in medyalar)
    if not sesli:
        return None, ("kameran\u0131n g\u00f6r\u00fcnt\u00fcs\u00fcnde ses yok, bu y\u00fczden go2rtc hoparl\u00f6r kanal\u0131 a\u00e7m\u0131yor. "
                      "Xiaomi Home'da kameran\u0131n mikrofonunu/ses kayd\u0131n\u0131 a\u00e7\u0131n")
    return None, "kamera hoparl\u00f6r kanal\u0131 bildirmiyor (%s)" % "; ".join(medyalar)


def kameradan_cal(dosya):
    """Ses dosyasini go2rtc uzerinden kameranin hoparlorunden calar. Basarili ise True."""
    akis = SES_AYAR.get("akis")
    if not akis:
        SES_AYAR["son_hata"] = "kamera go2rtc \u00fczerinden a\u00e7\u0131lmad\u0131\u011f\u0131 i\u00e7in hoparl\u00f6r kullan\u0131lam\u0131yor"
        print("Kamera hoparl\u00f6r\u00fc: " + SES_AYAR["son_hata"])
        return False
    if not ffmpeg_yolu():
        SES_AYAR["son_hata"] = "FFmpeg kurulu de\u011fil (imageio-ffmpeg paketi kurulamam\u0131\u015f)"
        print("Kamera hoparl\u00f6r\u00fc: " + SES_AYAR["son_hata"])
        return False
    web = SES_AYAR.get("web")
    if web:  # dosyayi kendi web sunucumuzdan ver (yolda bosluk/Turkce harf sorunu olmasin)
        giris = "http://127.0.0.1:%d/ses/%s/%s" % (web.port, web.ses_anahtari, os.path.basename(dosya))
    else:
        giris = os.path.abspath(dosya).replace("\\", "/")
    # Kameranin hoparloru hangi bicimi bekliyor? go2rtc bicim ve ornekleme hizi BIREBIR
    # ayni olmazsa sesi baglamaz ("can't find consumer"). Once go2rtc'ye soruyoruz.
    bicim, aciklama = kamera_ses_kanali()
    if bicim:
        denenecek = [bicim]
    else:
        print("Kamera hoparl\u00f6r kanal\u0131: %s" % aciklama)
        denenecek = ["pcma/16000", "pcma/8000", "opus"]
    hatalar = []
    for kodek in denenecek:
        src = "ffmpeg:%s#input=file#audio=%s" % (giris, kodek)
        try:
            _api("/api/streams?dst=%s&src=%s" % (urllib.request.quote(akis), urllib.request.quote(src, safe="")),
                 "POST", 20)
            SES_AYAR["son_hata"] = ""
            print("Ses kameran\u0131n hoparl\u00f6r\u00fcne g\u00f6nderildi (%s)." % (aciklama if bicim else kodek))
            return True
        except urllib.error.HTTPError as e:
            hatalar.append("%s: %s" % (kodek, e.read().decode("utf-8", "replace").strip()[:80]))
        except Exception as e:
            hatalar.append("%s: %s" % (kodek, str(e)[:80]))
    SES_AYAR["son_hata"] = "go2rtc sesi kameraya g\u00f6nderemedi (%s)%s" % (
        "; ".join(hatalar), "" if bicim else ". " + aciklama)
    print("Kamera hoparl\u00f6r\u00fc kullan\u0131lamad\u0131: %s. Ses bilgisayardan \u00e7al\u0131nacak." % SES_AYAR["son_hata"])
    return False


def ses_kanali_raporu():
    """Acilista kameranin hoparlor kanalini bir kez raporlar (yayin oturduktan sonra)."""
    def is_():
        time.sleep(8)
        if not SES_AYAR.get("akis"):
            return
        bicim, aciklama = kamera_ses_kanali()
        if bicim:
            print("Kamera hoparl\u00f6r\u00fc haz\u0131r: ses %s bi\u00e7iminde g\u00f6nderilecek." % aciklama)
        else:
            SES_AYAR["son_hata"] = aciklama
            print("Kamera hoparl\u00f6r\u00fc uyar\u0131s\u0131: %s" % aciklama)
    threading.Thread(target=is_, daemon=True).start()


def sesli_soyle(metin):
    """Dogal Turkce sesle konusur: kameranin hoparlorunden (varsayilan) ve/veya bilgisayardan."""
    def is_():
        dosya = _ses_dosyasi(metin)
        hoparlor = SES_AYAR.get("hoparlor", "kamera")
        kamerada = False
        if dosya and hoparlor in ("kamera", "ikisi"):
            kamerada = kameradan_cal(dosya)
        if hoparlor == "kamera" and kamerada:
            return
        if platform.system() != "Windows":
            print("[SES] %s%s" % (metin, (" -> " + dosya) if dosya else ""))
            return
        if dosya and _mp3_cal(dosya):
            return
        _windows_sesi(metin)
    threading.Thread(target=is_, daemon=True).start()


# --- Cizim yardimcilari -----------------------------------------------------
YESIL = (90, 220, 120)
SARI = (40, 200, 255)
GRI = (170, 170, 170)
MAVI = (230, 170, 60)
TURUNCU = (40, 140, 255)
KOYU = (25, 25, 25)

# Turkce harfler (c, g, i, o, s, u ve buyukleri) icin OpenCV'nin kendi yazi tipi yetmez:
# yazilari Windows'un yazi tipiyle (Segoe UI) Pillow ile cizeriz. Pillow yoksa eski yol.
_YAZI_TIPLERI = {
    False: [r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf"],
    True: [r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf",
           "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"],
}
_FONT_ONBELLEK, _YAZI_ONBELLEK = {}, {}


def _font(px, kalin):
    anahtar = (px, kalin)
    if anahtar not in _FONT_ONBELLEK:
        f = None
        try:
            from PIL import ImageFont
            for yol in _YAZI_TIPLERI[kalin]:
                if os.path.exists(yol):
                    f = ImageFont.truetype(yol, px)
                    break
        except Exception:
            f = None
        _FONT_ONBELLEK[anahtar] = f
    return _FONT_ONBELLEK[anahtar]


def _yazi_maskesi(metin, px, kalin):
    """Metni gri tonlu maske olarak cizer (onbellekli). Donus: (maske, ust_bosluk) veya None."""
    anahtar = (metin, px, kalin)
    if anahtar in _YAZI_ONBELLEK:
        return _YAZI_ONBELLEK[anahtar]
    f = _font(px, kalin)
    if f is None:
        return None
    from PIL import Image, ImageDraw
    x0, y0, x1, y1 = f.getbbox(metin)
    w, h = max(1, x1), max(1, int(px * 1.25))
    img = Image.new("L", (w + 2, h + 2), 0)
    ImageDraw.Draw(img).text((0, 0), metin, font=f, fill=255)
    maske = np.asarray(img, np.float32) / 255.0
    if len(_YAZI_ONBELLEK) > 600:
        _YAZI_ONBELLEK.clear()
    _YAZI_ONBELLEK[anahtar] = maske
    return maske


def yazi_boyut(metin, px, kalin=False):
    m = _yazi_maskesi(metin, px, kalin)
    if m is None:
        (tw, th), _ = cv2.getTextSize(ascii_ad(metin), cv2.FONT_HERSHEY_SIMPLEX, px / 30.0, 2 if kalin else 1)
        return tw, th
    return m.shape[1], int(px * 1.05)


def yazi(kare, metin, x, y_ust, px, renk, kalin=False):
    """Turkce destekli yazi: (x, y_ust) sol ust kose."""
    m = _yazi_maskesi(metin, px, kalin)
    if m is None:
        cv2.putText(kare, ascii_ad(metin), (x, y_ust + px), cv2.FONT_HERSHEY_SIMPLEX, px / 30.0, renk,
                    2 if kalin else 1, cv2.LINE_AA)
        return
    H, W = kare.shape[:2]
    x0, y0 = max(0, x), max(0, y_ust)
    x1, y1 = min(W, x + m.shape[1]), min(H, y_ust + m.shape[0])
    if x1 <= x0 or y1 <= y0:
        return
    a = m[y0 - y_ust:y1 - y_ust, x0 - x:x1 - x][:, :, None]
    bolge = kare[y0:y1, x0:x1].astype(np.float32)
    kare[y0:y1, x0:x1] = (bolge * (1 - a) + np.array(renk, np.float32) * a).astype(np.uint8)


def yazi_kutusu(kare, metin, x, y, renk, olcek=0.55, kalin=1):
    """Renkli kutu icinde koyu yazi. y: kutunun alt cizgisi (eski cv2 duzeniyle uyumlu)."""
    px = max(10, int(round(olcek * 30)))
    tw, th = yazi_boyut(metin, px, kalin > 1)
    cv2.rectangle(kare, (x, y - th - 9), (x + tw + 12, y + 3), renk, -1)
    yazi(kare, metin, x + 6, y - th - 7, px, KOYU, kalin > 1)


def kose_cerceve(kare, x, y, w, h, renk, k=2):
    """Tam dikdortgen yerine sade kose isaretleri."""
    u = max(10, min(w, h) // 4)
    for (px, py, dx, dy) in ((x, y, 1, 1), (x + w, y, -1, 1), (x, y + h, 1, -1), (x + w, y + h, -1, -1)):
        cv2.line(kare, (px, py), (px + dx * u, py), renk, k, cv2.LINE_AA)
        cv2.line(kare, (px, py), (px, py + dy * u), renk, k, cv2.LINE_AA)


SON_DURUM = {"metin": ""}


def durum_yaz(kare, metin, renk):
    SON_DURUM["metin"] = metin
    tw, _ = yazi_boyut(metin, 18, True)
    x = kare.shape[1] - tw - 24
    yazi_kutusu(kare, metin, x, 34, renk, 0.6, 2)


def yuz_kirp(kare, kutu, pay=0.35):
    x, y, w, h = kutu
    H, W = kare.shape[:2]
    px, py = int(w * pay), int(h * pay)
    x0, y0 = max(0, x - px), max(0, y - py)
    x1, y1 = min(W, x + w + px), min(H, y + h + py)
    return kare[y0:y1, x0:x1]


# ===========================================================================
#  Canli goruntu okuyucu (her zaman EN SON kareyi verir, gecikme birikmez)
# ===========================================================================
class CanliOkuyucu:
    def __init__(self, adres):
        self.adres = adres
        self.cap = kaynak_ac(adres)
        for _ in range(10):  # kamera ilk acilista birkac saniye gecikebilir
            if self.cap.isOpened():
                break
            time.sleep(2)
            self.cap = kaynak_ac(adres)
        if not self.cap.isOpened():
            raise SystemExit(f"G\u00f6r\u00fcnt\u00fc kayna\u011f\u0131 a\u00e7\u0131lamad\u0131: {adres}")
        self.kare, self.sayac, self.okunan, self.dur = None, 0, 0, False
        self.kilit = threading.Lock()
        threading.Thread(target=self._dongu, daemon=True).start()

    def _dongu(self):
        while not self.dur:
            ok, f = self.cap.read()
            if not ok:
                print("Kamera ba\u011flant\u0131s\u0131 koptu, 2 saniye sonra yeniden deneniyor...")
                self.cap.release()
                time.sleep(2)
                self.cap = kaynak_ac(self.adres)
                continue
            with self.kilit:
                self.kare, self.sayac = f, self.sayac + 1

    def read(self):
        bitis = time.time() + 15
        while time.time() < bitis:
            with self.kilit:
                if self.sayac != self.okunan and self.kare is not None:
                    self.okunan = self.sayac
                    return True, self.kare.copy()
            time.sleep(0.005)
        return False, None

    def son(self):
        """Son kareyi okundu saymadan verir (kalibrasyon icin)."""
        bitis = time.time() + 15
        while time.time() < bitis:
            with self.kilit:
                if self.kare is not None:
                    return self.kare.copy()
            time.sleep(0.01)
        return None

    def release(self):
        self.dur = True
        time.sleep(0.1)
        self.cap.release()


class DosyaOkuyucu:
    def __init__(self, kaynak):
        self.cap = kaynak_ac(kaynak)
        if not self.cap.isOpened():
            raise SystemExit(f"G\u00f6r\u00fcnt\u00fc kayna\u011f\u0131 a\u00e7\u0131lamad\u0131: {kaynak}")

    def read(self):
        return self.cap.read()

    def release(self):
        self.cap.release()


class SimKamera:
    """Test icin sanal doner kamera: buyuk bir panorama resmin bir bolumunu
    gosterir, PTZ komutlari bu pencereyi kaydirir."""

    def __init__(self, panorama, w=960, h=540, adim_x=140, adim_y=90, gecikme=0.0):
        self.gecikme, self.tampon = gecikme, deque()
        self.p = cv2.imread(panorama)
        if self.p is None:
            raise SystemExit("Sim\u00fclasyon resmi okunamad\u0131: " + panorama)
        self.w, self.h, self.ax, self.ay = w, h, adim_x, adim_y
        self.x = (self.p.shape[1] - w) // 2
        self.y = (self.p.shape[0] - h) // 2

    def read(self):
        time.sleep(1 / 30)
        f = self.p[self.y:self.y + self.h, self.x:self.x + self.w].copy()
        cv2.putText(f, "SIM", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        simdi = time.time()
        self.tampon.append((simdi, f))  # gercek kameradaki goruntu gecikmesini taklit et
        while len(self.tampon) > 1 and self.tampon[1][0] <= simdi - self.gecikme:
            self.tampon.popleft()
        return True, self.tampon[0][1].copy()

    def release(self):
        pass

    def adaylar(self):
        # Gercek kameradaki gibi: hangi komutun ne yaptigi bilinmiyor
        return [{"tur": "sim", "kod": k, "ad": "sim-%d" % k} for k in range(1, 7)]

    def gonder(self, aday):
        k = aday["kod"]
        time.sleep(0.3)  # bulut gecikmesi
        if k == 1:
            self.x = max(0, self.x - self.ax)
        elif k == 2:
            self.x = min(self.p.shape[1] - self.w, self.x + self.ax)
        elif k == 4:
            self.y = max(0, self.y - self.ay)
        elif k == 5:
            self.y = min(self.p.shape[0] - self.h, self.y + self.ay)
        return k in (1, 2, 4, 5)  # 3 ve 6 hicbir sey yapmaz


# ===========================================================================
#  Xiaomi bulutu - go2rtc'nin kaydettigi girisi kullanir (yeni kod istemez)
#  (go2rtc pkg/xiaomi/cloud.go'nun Python karsiligi)
# ===========================================================================
def _rc4(anahtar, veri):
    S = list(range(256))
    j = 0
    for i in range(256):
        j = (j + S[i] + anahtar[i % len(anahtar)]) & 255
        S[i], S[j] = S[j], S[i]
    i = j = 0
    cikti = bytearray()
    for n in range(1024 + len(veri)):  # ilk 1024 bayt atilir
        i = (i + 1) & 255
        j = (j + S[i]) & 255
        S[i], S[j] = S[j], S[i]
        if n >= 1024:
            cikti.append(veri[n - 1024] ^ S[(S[i] + S[j]) & 255])
    return bytes(cikti)


class XiaomiBulut:
    def __init__(self, uid, pass_token, bolge):
        import requests
        self.requests = requests
        self._yerel = threading.local()  # her is parcacigina ayri, acik kalan baglanti
        self.uid = uid
        self.taban = ("https://api.io.mi.com/app" if bolge == "cn"
                      else "https://%s.api.io.mi.com/app" % bolge)
        r = requests.get("https://account.xiaomi.com/pass/serviceLogin?_json=true&sid=xiaomiio",
                         headers={"Cookie": "userId=%s; passToken=%s" % (uid, pass_token)}, timeout=15)
        if not r.text.startswith("&&&START&&&"):
            raise RuntimeError("Xiaomi giri\u015fi ba\u015far\u0131s\u0131z: " + r.text[:200])
        v = json.loads(r.text[11:])
        if not v.get("location"):
            raise RuntimeError("Xiaomi giri\u015fi ge\u00e7ersiz, go2rtc'de yeniden giri\u015f yap\u0131n: " + str(v.get("desc", ""))[:100])
        ss = v.get("ssecurity")
        r2 = requests.get(v["location"], timeout=15)
        cerezler = {}
        for yanit in list(r2.history) + [r2]:
            for c in yanit.cookies:
                cerezler[c.name] = c.value
            ep = yanit.headers.get("Extension-Pragma")
            if ep:
                try:
                    ss = json.loads(ep).get("ssecurity") or ss
                except ValueError:
                    pass
        if not ss or "serviceToken" not in cerezler:
            raise RuntimeError("Xiaomi oturumu a\u00e7\u0131lamad\u0131")
        self.ssecurity = base64.b64decode(ss)
        self.cerez = "userId=%s; cUserId=%s; serviceToken=%s" % (
            cerezler.get("userId", uid), cerezler.get("cUserId", ""), cerezler["serviceToken"])

    def istek(self, api, params):
        b64 = lambda b: base64.b64encode(b).decode()
        nonce = os.urandom(8) + struct.pack(">I", int(time.time() // 60))
        sn = hashlib.sha256(self.ssecurity + nonce).digest()

        def imza(data, h=None):
            s = "POST&" + api + "&data=" + data
            if h is not None:
                s += "&rc4_hash__=" + h
            s += "&" + b64(sn)
            return b64(hashlib.sha1(s.encode()).digest())

        h = imza(params)
        data_s = b64(_rc4(sn, params.encode()))
        h_s = b64(_rc4(sn, h.encode()))
        form = {"data": data_s, "rc4_hash__": h_s, "signature": imza(data_s, h_s), "_nonce": b64(nonce)}
        for deneme in range(2):
            oturum = getattr(self._yerel, "oturum", None)
            if oturum is None:
                oturum = self._yerel.oturum = self.requests.Session()
            try:
                r = oturum.post(self.taban + api, data=form, timeout=(4, 6),
                                headers={"Cookie": self.cerez,
                                         "Content-Type": "application/x-www-form-urlencoded"})
                break
            except (self.requests.ConnectionError, self.requests.Timeout):
                self._yerel.oturum = None  # sunucu baglantiyi kapatmis: yenisini ac, bir kez daha dene
                if deneme == 1:
                    raise
        r.raise_for_status()
        sonuc = json.loads(_rc4(sn, base64.b64decode(r.text)))
        if sonuc.get("code") != 0:
            raise RuntimeError("xiaomi: %s" % sonuc.get("message"))
        return sonuc.get("result")


def go2rtc_xiaomi_bilgisi(yaml_yolu):
    """go2rtc.yaml'dan hesap, bolge, kamera did ve model bilgisini okur."""
    metin = open(yaml_yolu, encoding="utf-8").read()
    m = re.search(r"xiaomi://(\d+):(\w+)@[^?\s\"']+\?([^\s\"']+)", metin)
    if not m:
        return None
    uid, bolge = m.group(1), m.group(2)
    q = urllib.parse.parse_qs(m.group(3))
    t = re.search(r"^\s+[\"']?%s[\"']?\s*:\s*[\"']?([^\s\"']+)" % uid, metin, re.M)
    if not t:
        return None
    return {"uid": uid, "bolge": bolge, "token": t.group(1),
            "did": q.get("did", [""])[0], "model": q.get("model", [""])[0]}


YON_AD = {"sol": "sola", "sag": "sa\u011fa", "yukari": "yukar\u0131", "asagi": "a\u015fa\u011f\u0131"}
YON_KELIMELERI = {"sol": ["left", "\u5de6"], "sag": ["right", "\u53f3"], "yukari": ["up", "\u4e0a"], "asagi": ["down", "\u4e0b"]}
PTZ_KELIMELERI = ["motor", "ptz", "turn", "rotat", "direction", "pan", "tilt", "yuntai", "holder",
                  "\u4e91\u53f0", "\u8f6c\u52a8", "\u65b9\u5411", "move"]


def miot_spec_indir(model, klasor):
    yol = os.path.join(klasor, "spec_%s.json" % model)
    if os.path.exists(yol):
        return json.load(open(yol, encoding="utf-8"))
    import requests
    taban = "https://miot-spec.org/miot-spec-v2/instance"
    parca = model.split(".")
    kisa = parca[0] + "-" + parca[-1]  # chuangmi.camera.026c02 -> chuangmi-026c02
    spec = None
    print("Kameran\u0131n \u00f6zellik listesi (MIoT) indiriliyor...")
    for surum in (1, 2, 3):  # once dogrudan tahmin (kucuk ve hizli)
        urn = "urn:miot-spec-v2:device:camera:0000A01C:%s:%d" % (kisa, surum)
        try:
            r = requests.get(taban, params={"type": urn}, timeout=20)
            if r.ok and r.json().get("services"):
                spec = r.json()
        except Exception as e:
            print("  ", urn, "->", str(e)[:60])
    if spec is None:
        print("  T\u00fcm cihaz listesi indiriliyor (b\u00fcy\u00fck dosya, 1-2 dakika s\u00fcrebilir)...")
        liste = requests.get("https://miot-spec.org/miot-spec-v2/instances?status=all", timeout=(15, 180)).json()
        uygun = [x for x in liste.get("instances", []) if x.get("model") == model]
        if not uygun:
            raise RuntimeError("Bu modelin \u00f6zellik listesi bulunamad\u0131: " + model)
        urn = max(uygun, key=lambda x: x.get("version", 0))["type"]
        spec = requests.get(taban, params={"type": urn}, timeout=30).json()
    json.dump(spec, open(yol, "w", encoding="utf-8"))
    print("  \u00d6zellik listesi indirildi:", len(spec.get("services", [])), "servis")
    return spec


def ptz_adaylari(spec):
    """Spec icinden motor/yon ile ilgili olabilecek tum komutlari cikarir."""
    adaylar = []
    yasak = ["off", "sleep", "privacy", "reboot", "restart", "reset", "format", "delete",
             "switch", "power", "upgrade", "storage", "calibrat", "\u4f11\u7720"]
    ic = lambda m: any(k in m for k in PTZ_KELIMELERI) and not any(y in m for y in yasak)
    for s in spec.get("services", []):
        siid, s_ad = s.get("iid"), (s.get("type", "") + " " + s.get("description", "")).lower()
        props = {p.get("iid"): p for p in s.get("properties", [])}
        for a in s.get("actions", []):
            a_ad = s_ad + " " + (a.get("type", "") + " " + a.get("description", "")).lower()
            if not ic(a_ad):
                continue
            girdiler = a.get("in", [])
            if not girdiler:
                adaylar.append({"tur": "action", "siid": siid, "aiid": a["iid"], "in": [], "ad": a_ad[-60:]})
            elif len(girdiler) == 1:
                p = props.get(girdiler[0], {})
                for v in p.get("value-list", []):
                    adaylar.append({"tur": "action", "siid": siid, "aiid": a["iid"], "in": [v["value"]],
                                    "ad": "%s=%s" % (a.get("description", ""), v.get("description", ""))})
                if not p.get("value-list") and p.get("value-range"):
                    lo, hi = p["value-range"][0], p["value-range"][1]
                    for v in range(int(lo), int(min(hi, lo + 8)) + 1):
                        adaylar.append({"tur": "action", "siid": siid, "aiid": a["iid"], "in": [v],
                                        "ad": "%s=%s" % (a.get("description", ""), v)})
        for p in s.get("properties", []):
            p_ad = s_ad + " " + (p.get("type", "") + " " + p.get("description", "")).lower()
            if ic(p_ad) and "write" in p.get("access", []) and p.get("value-list"):
                for v in p["value-list"]:
                    adaylar.append({"tur": "prop", "siid": siid, "piid": p["iid"], "value": v["value"],
                                    "ad": "%s=%s" % (p.get("description", ""), v.get("description", ""))})
    # Eski (miio) chuangmi kameralarinin motor komutu
    for op in range(1, 5):
        adaylar.append({"tur": "rpc", "method": "set_motor", "params": {"operation": op}, "ad": "set_motor %d" % op})
    return adaylar[:40]


def bulut_gonderici(bulut, did):
    def gonder(aday):
        t = aday["tur"]
        if t == "action":
            r = bulut.istek("/miotspec/action", json.dumps(
                {"params": {"did": did, "siid": aday["siid"], "aiid": aday["aiid"], "in": aday["in"]}}))
            kod = r.get("code", 0) if isinstance(r, dict) else 0
        elif t == "prop":
            r = bulut.istek("/miotspec/prop/set", json.dumps(
                {"params": [{"did": did, "siid": aday["siid"], "piid": aday["piid"], "value": aday["value"]}]}))
            kod = r[0].get("code", 0) if isinstance(r, list) and r else 0
        else:
            bulut.istek("/home/rpc/" + did, json.dumps({"id": 1, "method": aday["method"], "params": aday["params"]}))
            kod = 0
        return kod == 0
    return gonder


def goruntu_kaymasi(k1, k2):
    """Iki kare arasindaki genel kaymayi (dx, dy) piksel olarak olcer."""
    g1 = cv2.cvtColor(cv2.resize(k1, (320, 180)), cv2.COLOR_BGR2GRAY).astype(np.float32)
    g2 = cv2.cvtColor(cv2.resize(k2, (320, 180)), cv2.COLOR_BGR2GRAY).astype(np.float32)
    pencere = cv2.createHanningWindow((320, 180), cv2.CV_32F)
    (dx, dy), guven = cv2.phaseCorrelate(g1, g2, pencere)
    olcek = k1.shape[1] / 320.0
    return dx * olcek, dy * olcek, guven


def ptz_kalibre(gonder, adaylar, son_kare, bekle=2.0):
    """Her komutu dener, goruntunun nereye kaydigini olcer.
    sonuc: etki -> {aday, adim}. etki = goruntunun kaydigi yon (sol/sag/yukari/asagi)."""
    sonuc = {}
    print("Kamera motoru ayarlan\u0131yor (%d komut denenecek, kamera birka\u00e7 kez d\u00f6necek)..." % len(adaylar))
    for tur in range(2):  # ikinci tur: kamera bir uca dayanmis olabilir
        for aday in adaylar:
            if len(sonuc) == 4:
                break
            if tur == 1 and any(v["aday"] == aday for v in sonuc.values()):
                continue
            k1 = son_kare()
            t_gonder = time.time()
            ilk_kayma = None
            try:
                if not gonder(aday):
                    continue
            except Exception as e:
                print("  %-28s hata: %s" % (aday.get("ad", "")[:28], str(e)[:60]))
                continue
            # Goruntu gecikmeli gelir: kayma olusup sabitlenene kadar bekle
            bitis, onceki = time.time() + max(5.0, bekle), None
            while True:
                dx, dy, guven = goruntu_kaymasi(k1, son_kare())
                buyuk = max(abs(dx), abs(dy)) >= 8
                if buyuk and ilk_kayma is None:
                    ilk_kayma = max(0.2, time.time() - t_gonder - 0.15)  # son_kare'nin kendi beklemesi
                if buyuk and onceki and abs(dx - onceki[0]) < 4 and abs(dy - onceki[1]) < 4:
                    break
                if time.time() > bitis:
                    break
                onceki = (dx, dy) if buyuk else None
                time.sleep(0.15)
            if max(abs(dx), abs(dy)) < 8:
                print("  %-28s g\u00f6r\u00fcnt\u00fc kaymad\u0131" % aday.get("ad", "")[:28])
                continue
            if abs(dx) >= abs(dy):
                etki, adim = ("sol" if dx < 0 else "sag"), abs(dx)
            else:
                etki, adim = ("yukari" if dy < 0 else "asagi"), abs(dy)
            print("  %-28s g\u00f6r\u00fcnt\u00fc %s kayd\u0131 (%d piksel, gecikme %.1f sn)" % (aday.get("ad", "")[:28], YON_AD[etki], adim, ilk_kayma or 0))
            sonuc.setdefault(etki, {"aday": aday, "adim": float(adim),
                                    "gecikme": round(ilk_kayma or 1.2, 2)})
    return sonuc


class PTZ:
    """Kalibre edilmis komutlarla kamerayi SUREKLI dondurur.
    surekli(etki, aralik, paralel): bir yon verilir, arka plandaki isci o yone
    durmadan komut gonderir (bir onceki biter bitmez / aralik dolunca), boylece
    kamera adim adim degil akici sekilde doner. dur() ile durur."""

    def __init__(self, gonder, eslesme):
        self.gonder, self.e = gonder, eslesme
        self.son, self.dikey = 0.0, 0
        self.son_etki = None
        self.yon, self.aralik, self.paralel = None, 0.3, 1
        self.ucusta, self.son_gonderim, self.hata_sayisi = 0, 0.0, 0
        self.kilit = threading.Lock()
        g = sorted(v.get("gecikme", 1.2) for v in eslesme.values())
        self.gecikme = min(3.0, max(0.4, g[len(g) // 2])) if g else 1.2
        self.gonderilenler = deque()  # (zaman, etki): goruntude henuz gorunmeyen komutlar
        self.yon_baslangic = 0.0      # su anki yone ilk komutun gonderildigi an
        # Calisma alani: kameranin konumu adim cinsinden (x+ = saga, y+ = yukari bakar)
        self.x = self.y = 0
        self.sinir = {"sol": None, "sag": None, "ust": None, "alt": None}
        self.serbest = False          # elle kontrol: sinirlari yok say
        self.sinira_dayandi = None    # sinir yuzunden gonderilmeyen son yon
        self.gecmis = deque(maxlen=400)  # (zaman, etki): konum duzeltmesi icin
        self.alan_yolu, self.degisti = None, False
        self.led = None
        threading.Thread(target=self._isci, daemon=True).start()

    # --- calisma alani ---
    ETKI_KONUM = {"sol": (1, 0), "sag": (-1, 0), "asagi": (0, 1), "yukari": (0, -1)}

    def izinli(self, etki):
        """Bu yone bir adim calisma alaninin disina cikarir mi? (Alan disindaysa
        alana dogru gitmeye izin verilir.)"""
        dx, dy = self.ETKI_KONUM.get(etki, (0, 0))
        nx, ny = self.x + dx, self.y + dy
        s = self.sinir
        if dx < 0 and s["sol"] is not None and nx < s["sol"]:
            return False
        if dx > 0 and s["sag"] is not None and nx > s["sag"]:
            return False
        if dy > 0 and s["ust"] is not None and ny > s["ust"]:
            return False
        if dy < 0 and s["alt"] is not None and ny < s["alt"]:
            return False
        return True

    def _say(self, etki, n=1):
        dx, dy = self.ETKI_KONUM.get(etki, (0, 0))
        self.x += dx * n
        self.y += dy * n
        self.dikey = -self.y
        self.degisti = True

    def geri_al(self, t0, t1, etki):
        """Goruntu kaymadigi halde gonderilmis komutlari (donanim siniri) konumdan dus."""
        n = sum(1 for t, e in list(self.gecmis) if t0 <= t <= t1 and e == etki)
        if n:
            self._say(etki, -n)

    def sinir_ayarla(self, hangi):
        if hangi == "sil":
            self.sinir = {"sol": None, "sag": None, "ust": None, "alt": None}
        elif hangi in ("sol", "sag"):
            self.sinir[hangi] = self.x
            if None not in (self.sinir["sol"], self.sinir["sag"]) and self.sinir["sol"] > self.sinir["sag"]:
                self.sinir["sol"], self.sinir["sag"] = self.sinir["sag"], self.sinir["sol"]
        elif hangi in ("ust", "alt"):
            self.sinir[hangi] = self.y
            if None not in (self.sinir["ust"], self.sinir["alt"]) and self.sinir["alt"] > self.sinir["ust"]:
                self.sinir["ust"], self.sinir["alt"] = self.sinir["alt"], self.sinir["ust"]
        self.degisti = True
        self.kaydet()

    def kaydet(self):
        if self.alan_yolu and self.degisti:
            try:
                json.dump({"x": self.x, "y": self.y, "sinir": self.sinir}, open(self.alan_yolu, "w"))
                self.degisti = False
            except OSError:
                pass

    def yukle(self, yol):
        self.alan_yolu = yol
        try:
            d = json.load(open(yol))
            self.x, self.y = int(d.get("x", 0)), int(d.get("y", 0))
            self.sinir.update(d.get("sinir", {}))
            self.dikey = -self.y
        except (OSError, ValueError):
            pass

    def var(self, etki):
        return etki in self.e

    def adim(self, etki):
        return self.e[etki]["adim"] if etki in self.e else 100.0

    @property
    def mesgul(self):
        return self.yon is not None or self.ucusta > 0

    def bekleyen_kayma(self):
        """Gonderilmis ama goruntuye henuz yansimamis komutlarin toplam etkisi (dx, dy)."""
        sinir = time.time() - self.gecikme
        while self.gonderilenler and self.gonderilenler[0][0] < sinir:
            self.gonderilenler.popleft()
        dx = dy = 0.0
        for _, e in list(self.gonderilenler):
            a = self.adim(e)
            if e == "sol":
                dx -= a
            elif e == "sag":
                dx += a
            elif e == "yukari":
                dy -= a
            elif e == "asagi":
                dy += a
        return dx, dy

    TERS = {"sol": "sag", "sag": "sol", "yukari": "asagi", "asagi": "yukari"}

    def surekli(self, etki, aralik=0.3, paralel=1, zorla=False, serbest=False):
        # Ters yone donmeden once son hareketin goruntuye yansimasini bekle (sallanmayi onler)
        if (not zorla and self.son_etki == self.TERS.get(etki)
                and time.time() - self.son_gonderim < self.gecikme + 0.3):
            self.yon = None
            return
        if etki in self.e:
            self.yon, self.aralik, self.paralel, self.serbest = etki, aralik, paralel, serbest

    def dur(self):
        self.yon = None

    def _tek(self, etki):
        try:
            self.gonder(self.e[etki]["aday"])
            self.hata_sayisi = 0
        except Exception as ex:
            self.hata_sayisi += 1
            if self.hata_sayisi in (1, 5) or self.hata_sayisi % 20 == 0:
                print("Motor komutu hatas\u0131 (%d): %s" % (self.hata_sayisi, str(ex)[:80]))
        finally:
            with self.kilit:
                self.ucusta -= 1
            self.son = time.time()

    def _isci(self):
        while True:
            yon = self.yon
            simdi = time.time()
            bekleme = self.aralik + (1.0 if self.hata_sayisi >= 3 else 0.0)  # hata varsa yavasla
            if yon and not self.serbest and not self.izinli(yon):
                self.sinira_dayandi, self.yon = yon, None  # calisma alani siniri
                yon = None
            if yon and self.ucusta < self.paralel and simdi - self.son_gonderim >= bekleme:
                with self.kilit:
                    self.ucusta += 1
                if yon != self.son_etki:
                    self.yon_baslangic = simdi
                self.son_gonderim, self.son_etki = simdi, yon
                self.gonderilenler.append((simdi, yon))
                self.gecmis.append((simdi, yon))
                self._say(yon)
                threading.Thread(target=self._tek, args=(yon,), daemon=True).start()
            time.sleep(0.02)

    def hareket(self, etki, adet=1, serbest=False):
        """Tek seferlik birkac adim (surekli hareketten bagimsiz, ornegin dikey seviye degisimi)."""
        if etki not in self.e:
            return False
        for _ in range(adet):
            if not serbest and not self.izinli(etki):
                self.sinira_dayandi = etki
                break
            simdi = time.time()
            self.gecmis.append((simdi, etki))
            self.gonderilenler.append((simdi, etki))
            self._say(etki)
            with self.kilit:
                self.ucusta += 1
            threading.Thread(target=self._tek, args=(etki,), daemon=True).start()
            time.sleep(0.08)
        return True


LED_KELIMELERI = ["indicator", "status-light", "status light", "led", "light", "\u6307\u793a\u706f"]
LED_YASAK = ["night", "infrared", "ir-", "flood", "flash", "alarm", "wdr", "motion", "sleep", "fill",
             "\u591c\u89c6", "\u7ea2\u5916"]


def led_adayi(spec):
    """Spec icinde kameranin durum isigini (mavi LED) acip kapatan yazilabilir bool ayari bulur."""
    adaylar = []
    for s in spec.get("services", []):
        s_ad = (s.get("type", "") + " " + s.get("description", "")).lower()
        for p in s.get("properties", []):
            ad = s_ad + " " + (p.get("type", "") + " " + p.get("description", "")).lower()
            if p.get("format") != "bool" or "write" not in p.get("access", []):
                continue
            kelimeler = set(re.split(r"[^a-z\u4e00-\u9fff]+", ad))
            uygun = any((k in kelimeler) if k.isalpha() and k.isascii() else (k in ad) for k in LED_KELIMELERI)
            if not uygun or any(y in ad for y in LED_YASAK):
                continue
            oncelik = 0 if "indicator" in ad or "status" in ad else 1
            adaylar.append((oncelik, {"siid": s["iid"], "piid": p["iid"], "ad": ad.strip()[-60:]}))
    adaylar.sort(key=lambda t: t[0])
    return adaylar[0][1] if adaylar else None


class LedKontrol:
    """Kameranin mavi durum isigini Xiaomi bulutu uzerinden yakip sondurur."""

    def __init__(self, bulut, did, ayar):
        self.bulut, self.did, self.ayar = bulut, did, ayar
        self.yanip_sonsun = False
        self.test_bitis = 0.0
        self.durum = None
        self.asil = True
        try:
            r = bulut.istek("/miotspec/prop/get", json.dumps(
                {"params": [{"did": did, "siid": ayar["siid"], "piid": ayar["piid"]}]}))
            if isinstance(r, list) and r and r[0].get("code", 0) == 0 and "value" in r[0]:
                self.asil = bool(r[0]["value"])
        except Exception:
            pass
        self.durum = self.asil
        threading.Thread(target=self._isci, daemon=True).start()

    def _ayarla(self, deger):
        try:
            r = self.bulut.istek("/miotspec/prop/set", json.dumps(
                {"params": [{"did": self.did, "siid": self.ayar["siid"], "piid": self.ayar["piid"], "value": deger}]}))
            if isinstance(r, list) and r and r[0].get("code", 0) != 0:
                print("I\u015f\u0131k komutu kabul edilmedi (kod %s)." % r[0].get("code"))
                return False
            self.durum = deger
            return True
        except Exception as e:
            print("I\u015f\u0131k komutu hatas\u0131:", str(e)[:80])
            return False

    def _isci(self):
        while True:
            if self.yanip_sonsun or time.time() < self.test_bitis:
                self._ayarla(not self.durum)
                time.sleep(0.6)
            else:
                if self.durum != self.asil:
                    self._ayarla(self.asil)
                time.sleep(0.2)

    def birak(self):
        self.yanip_sonsun, self.test_bitis = False, 0.0
        if self.durum != self.asil:
            self._ayarla(self.asil)


def ptz_hazirla(betik_klasor, son_kare, kalibre_zorla=False):
    """Gercek Xiaomi kamera icin PTZ'yi hazirlar. Olmazsa None doner."""
    try:
        bilgi = go2rtc_xiaomi_bilgisi(os.path.join(betik_klasor, "go2rtc", "go2rtc.yaml"))
        if not bilgi:
            print("Motor: go2rtc.yaml i\u00e7inde Xiaomi kamera bilgisi yok.")
            return None
        bulut = XiaomiBulut(bilgi["uid"], bilgi["token"], bilgi["bolge"])
        gonder = bulut_gonderici(bulut, bilgi["did"])
        ayar_yolu = os.path.join(betik_klasor, "ptz_%s.json" % bilgi["did"])
        eslesme = None
        if os.path.exists(ayar_yolu) and not kalibre_zorla:
            eslesme = json.load(open(ayar_yolu, encoding="utf-8"))
            if any("gecikme" not in v for v in eslesme.values()):
                print("Eski motor ayar\u0131: gecikme \u00f6l\u00e7\u00fcm\u00fc i\u00e7in motor bir kez yeniden ayarlanacak.")
                eslesme = None
        if eslesme:
            print("Motor ayar\u0131 y\u00fcklendi:", ", ".join(YON_AD.get(k, k) for k in sorted(eslesme)))
        else:
            try:
                spec = miot_spec_indir(bilgi["model"], betik_klasor)
            except Exception as e:
                print("\u00d6zellik listesi indirilemedi (%s), yedek komutlar denenecek." % str(e)[:80])
                spec = {}
            eslesme = ptz_kalibre(gonder, ptz_adaylari(spec), son_kare)
            if not eslesme:
                print("Motor: hi\u00e7bir komut kameray\u0131 d\u00f6nd\u00fcrmedi. Sabit kamera olarak devam ediliyor.")
                return None
            json.dump(eslesme, open(ayar_yolu, "w", encoding="utf-8"), indent=1)
            print("Motor ayar\u0131 kaydedildi:", ", ".join(YON_AD.get(k, k) for k in sorted(eslesme)))
            alan = os.path.join(betik_klasor, "alan_%s.json" % bilgi["did"])
            if os.path.exists(alan):
                os.remove(alan)  # kalibrasyon kamerayi oynatti: eski konum/sinirlar gecersiz
                print("Motor yeniden ayarland\u0131\u011f\u0131 i\u00e7in \u00e7al\u0131\u015fma alan\u0131 s\u0131n\u0131rlar\u0131 silindi; yeniden belirleyin.")
        ptz = PTZ(gonder, eslesme)
        ptz.yukle(os.path.join(betik_klasor, "alan_%s.json" % bilgi["did"]))
        ptz.led = None
        try:
            ayar = led_adayi(miot_spec_indir(bilgi["model"], betik_klasor))
            if ayar:
                ptz.led = LedKontrol(bulut, bilgi["did"], ayar)
                print("Mavi \u0131\u015f\u0131k kontrol\u00fc haz\u0131r (%s). Ki\u015fi g\u00f6r\u00fcl\u00fcnce yan\u0131p s\u00f6necek." % ayar["ad"])
            else:
                print("Bu kameran\u0131n \u00f6zellik listesinde mavi \u0131\u015f\u0131k ayar\u0131 bulunamad\u0131.")
        except Exception as e:
            print("Mavi \u0131\u015f\u0131k kontrol\u00fc kullan\u0131lam\u0131yor:", str(e)[:100])
        return ptz
    except Exception as e:
        print("Motor kullan\u0131lam\u0131yor (%s). Sabit kamera olarak devam ediliyor." % str(e)[:120])
        return None


# ===========================================================================
#  Web arayuzu: telefondan / baska bilgisayardan izleme ve kontrol
# ===========================================================================
WEB_SAYFA = r"""<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Kamera Takip</title>
<style>
:root{--bg:#0f1412;--yuzey:#1a211e;--cizgi:#2c3732;--yazi:#e8eeeb;--soluk:#93a29b;--yesil:#3fbf86;--sari:#f2b33d}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--yazi);font:15px system-ui,-apple-system,"Segoe UI",sans-serif;
 padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) 24px max(12px,env(safe-area-inset-left))}
main{max-width:900px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
header{display:flex;justify-content:space-between;align-items:center;gap:8px}
h1{font-size:18px;margin:0;font-weight:700}
.surum{background:var(--sari);color:#111;font-weight:700;border-radius:6px;padding:2px 8px;font-size:13px}
.video{position:relative;background:#000;border-radius:10px;overflow:hidden;aspect-ratio:16/9}
.video img{width:100%;height:100%;object-fit:contain;display:block}
.bilgi{position:absolute;left:8px;top:8px;background:rgba(0,0,0,.6);padding:3px 8px;border-radius:6px;font-size:13px}
#durum{font-weight:600}
.kontrol{display:flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap}
.ped{display:grid;grid-template-columns:repeat(3,72px);grid-template-rows:repeat(3,72px);gap:8px;touch-action:none;user-select:none;-webkit-user-select:none}
.ok{background:var(--yuzey);border:1px solid var(--cizgi);border-radius:14px;color:var(--yazi);font-size:28px;
 display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:none}
.ok.basili{background:var(--yazi);color:#111}
.bos{visibility:hidden}
#mod{min-width:150px;height:72px;border:0;border-radius:14px;font:700 18px system-ui,sans-serif;cursor:pointer;color:#111}
#mod.OTO{background:var(--yesil)} #mod.SABIT{background:var(--sari)}
.not{color:var(--soluk);font-size:13px;text-align:center;margin:0}
button:focus-visible,.ok:focus-visible{outline:3px solid var(--yesil);outline-offset:2px}
.bag{display:flex;gap:8px;flex-wrap:wrap}.bag a{flex:1;text-align:center;padding:10px;border-radius:10px;border:1px solid var(--cizgi);color:var(--yazi);text-decoration:none;background:var(--yuzey);font-weight:600}
.konus{width:100%;min-height:56px;border-radius:14px;border:0;background:#2d6cdf;color:#fff;font:700 17px system-ui,sans-serif;touch-action:none;user-select:none;-webkit-user-select:none}
.konus.kayit{background:#d93a3a}
.satir{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.satir label{min-width:110px;color:var(--soluk);font-size:14px}
.satir input,.satir select{font:15px system-ui,sans-serif;padding:8px;border-radius:8px;border:1px solid var(--cizgi);background:var(--bg);color:var(--yazi)}
.satir input[type=number]{width:70px}.satir #bad{flex:1;min-width:0}
.ikili{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.cizim{position:relative;border-radius:10px;overflow:hidden;background:#000}.cizim img{width:100%;display:block}
.cizim canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none}
.alan{background:var(--yuzey);border:1px solid var(--cizgi);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px}
.alan h2{font-size:16px;margin:0}.alan .not{text-align:left}
.sinirlar{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sinirlar button{min-height:48px;border-radius:10px;border:1px solid var(--cizgi);background:var(--bg);color:var(--yazi);font:600 15px system-ui,sans-serif;cursor:pointer}
.sinirlar button:active{background:var(--yazi);color:#111}
.sinirlar .sil{grid-column:1/-1;color:var(--sari)}
.ekle{display:flex;gap:8px}.ekle input{flex:1;min-width:0;font:16px system-ui,sans-serif;padding:12px;border-radius:10px;
 border:1px solid var(--cizgi);background:var(--bg);color:var(--yazi)}
.ekle button{padding:0 18px;border:0;border-radius:10px;background:var(--yesil);color:#111;font:700 16px system-ui,sans-serif;cursor:pointer}
.ekle button:disabled{opacity:.5}
.kliste{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.kliste li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--cizgi);border-radius:10px}
.kliste .ad{font-weight:600;overflow-wrap:anywhere}.kliste .gor{color:var(--yesil);font-size:12px;margin-left:6px}
.kliste button{border:1px solid var(--cizgi);background:transparent;color:var(--sari);border-radius:8px;padding:6px 10px;font:600 13px system-ui;cursor:pointer}
.ikincil{min-height:44px;border-radius:10px;border:1px solid var(--cizgi);background:var(--bg);color:var(--yazi);font:600 15px system-ui,sans-serif;cursor:pointer}
.sec{display:flex;gap:8px;align-items:center;color:var(--soluk);font-size:14px}
.alanyazi{margin:0;font:13px ui-monospace,Consolas,monospace;color:var(--soluk);overflow-wrap:anywhere}
</style></head><body><main>
<header><h1>Kamera Takip</h1><span class="surum" id="surum">__SURUM__</span></header>
<nav class="bag"><a href="olaylar">&#128450;&#65039; Olay ge&#231;mi&#351;i</a><a href="#bildirim">&#128276; Bildirimler</a><a href="#bolgeler">&#11035; B&#246;lgeler</a></nav>
<div class="video"><img id="img" src="video" alt="Canl&#305; kamera g&ouml;r&uuml;nt&uuml;s&uuml;">
<div class="bilgi"><span id="durum">Ba&#287;lan&#305;yor...</span></div></div>
<div class="kontrol">
 <div class="ped" id="ped">
  <div class="bos"></div><div class="ok" data-yon="yukari" aria-label="Yukar&#305;">&#9650;</div><div class="bos"></div>
  <div class="ok" data-yon="sol" aria-label="Sol">&#9664;</div><div class="bos"></div><div class="ok" data-yon="sag" aria-label="Sa&#287;">&#9654;</div>
  <div class="bos"></div><div class="ok" data-yon="asagi" aria-label="A&#351;a&#287;&#305;">&#9660;</div><div class="bos"></div>
 </div>
 <button id="mod" class="OTO" type="button">OTOMAT&#304;K</button>
</div>
<p class="not">Oka dokun: bir ad&#305;m &middot; bas&#305;l&#305; tut: s&uuml;rekli d&ouml;n &middot; oka dokununca SAB&#304;T moda ge&ccedil;er</p>
<button type="button" id="konus" class="konus">&#127908; Bas&#305;l&#305; tut ve konu&#351;</button>
<p class="not" id="konusdurum">Konu&#351;ma kameran&#305;n hoparl&#246;r&#252;nden &#231;&#305;kar. Mikrofon i&#231;in g&#252;venli ba&#287;lant&#305; gerekir: internet (https) adresi ya da bu bilgisayarda localhost.</p>
<section class="alan" id="bildirim"><h2>Bildirimler</h2>
<p class="not">Tan&#305;nmayan biri (ya da y&#252;z&#252; g&#246;r&#252;nmeyen biri) kameraya girince telefonuna foto&#287;rafl&#305; bildirim gelir.
Telefona <b>ntfy</b> uygulamas&#305;n&#305; kur (Google Play / App Store, &#252;cretsiz), <b>+</b> ile &#351;u konuya abone ol:</p>
<p class="alanyazi" id="konuad"></p>
<div class="satir"><label for="bmod">Ne zaman</label>
<select id="bmod"><option value="her_zaman">Her zaman</option><option value="zamanli">Sadece &#351;u saatlerde</option><option value="kapali">Kapal&#305;</option></select></div>
<div class="satir" id="bsaat"><label>Saat aral&#305;&#287;&#305;</label><input id="bbas" type="number" min="0" max="23"> &#8211; <input id="bbit" type="number" min="0" max="23"></div>
<label class="sec"><input type="checkbox" id="bbilinen"> Tan&#305;d&#305;&#287;&#305; ki&#351;iler gelince de bildir ("Taylan geldi")</label>
<div class="ikili"><button type="button" class="ikincil" id="bkaydet">Kaydet</button><button type="button" class="ikincil" id="bdene">Deneme bildirimi g&#246;nder</button></div>
<p class="alanyazi" id="bdurum"></p></section>

<section class="alan" id="bolgeler"><h2>B&#246;lgeler</h2>
<p class="not"><b>Alarm b&#246;lgesi:</b> &#231;izersen, bildirim ve kay&#305;t sadece biri bu alana girince olur (kap&#305;, CNC makinesinin &#246;n&#252;...).
<b>Maske:</b> buradaki hareket ve alg&#305;lamalar yok say&#305;l&#305;r (televizyon, pencere, ayna...). D&#246;ner kamerada b&#246;lge, &#231;izildi&#287;i konumda ge&#231;erlidir.</p>
<div class="cizim"><img id="bimg" alt="B&#246;lge &#231;izimi i&#231;in kamera g&#246;r&#252;nt&#252;s&#252;"><canvas id="bcanvas"></canvas></div>
<p class="not">G&#246;r&#252;nt&#252;ye dokunarak k&#246;&#351;eleri i&#351;aretle (en az 3), sonra kaydet.</p>
<div class="satir"><input id="bad" maxlength="30" placeholder="B&#246;lge ad&#305; (&#246;r. Kap&#305;)" aria-label="B&#246;lge ad&#305;">
<select id="btur" aria-label="B&#246;lge t&#252;r&#252;"><option value="alarm">Alarm b&#246;lgesi</option><option value="maske">Maske</option></select></div>
<div class="ikili"><button type="button" class="ikincil" id="bciz">Yeni g&#246;r&#252;nt&#252; al / temizle</button><button type="button" class="ikincil" id="bekle">B&#246;lgeyi kaydet</button></div>
<ul id="bliste" class="kliste"></ul></section>

<section class="alan"><h2>Alg&#305;lama ve kay&#305;t</h2>
<label class="sec"><input type="checkbox" id="nhayvan"> Kedi ve k&#246;pekleri de alg&#305;la</label>
<label class="sec"><input type="checkbox" id="narac"> Ara&#231;lar&#305; da alg&#305;la (araba, motosiklet, kamyon...)</label>
<div class="satir"><label for="sgun">Olaylar&#305; sakla</label><input id="sgun" type="number" min="1" max="365"> g&#252;n, en fazla <input id="sgb" type="number" min="1" max="2000"> GB</div>
<button type="button" class="ikincil" id="skaydet">Kaydet</button></section>
<section class="alan"><h2>&Ccedil;al&#305;&#351;ma alan&#305;</h2>
<p class="not">Kameray&#305; oklarla s&#305;n&#305;r olacak yere &ccedil;evir, sonra ilgili d&uuml;&#287;meye bas.
Tarama ve takip bu alan&#305;n d&#305;&#351;&#305;na &ccedil;&#305;kmaz; oklar her yere gider.</p>
<div class="sinirlar">
 <button type="button" data-sinir="sol">&#9664; Sol s&#305;n&#305;r buras&#305;</button>
 <button type="button" data-sinir="sag">Sa&#287; s&#305;n&#305;r buras&#305; &#9654;</button>
 <button type="button" data-sinir="ust">&#9650; &Uuml;st s&#305;n&#305;r buras&#305;</button>
 <button type="button" data-sinir="alt">&#9660; Alt s&#305;n&#305;r buras&#305;</button>
 <button type="button" data-sinir="sil" class="sil">S&#305;n&#305;rlar&#305; sil</button>
</div>
<p id="alan" class="alanyazi"></p></section>
<section class="alan"><h2>&#304;nternetten eri&#351;im</h2>
<p class="not">Bu sayfaya her yerden ula&#351;mak i&ccedil;in a&#351;a&#287;&#305;daki <b>sabit yer imi</b> ba&#287;lant&#305;s&#305;n&#305; telefonunun yer imlerine ekle.
O sayfada her zaman kameran&#305;n g&uuml;ncel adresi yazar (program her a&ccedil;&#305;l&#305;&#351;ta yeni adres al&#305;r).</p>
<p class="alanyazi" id="uzakdurum"></p>
<p class="alanyazi">Sabit yer imi: <a id="uzaksabit" href="#" target="_blank" rel="noopener" style="color:var(--yesil)"></a></p>
<p class="alanyazi">&#350;u anki adres: <a id="uzakurl" href="#" target="_blank" rel="noopener" style="color:var(--yesil)"></a></p>
</section>
<section class="alan"><h2>Ki&#351;iler</h2>
<p class="not">Ki&#351;i kameraya bakarken ad&#305;n&#305; yaz ve Kaydet'e bas. 4 saniye boyunca y&uuml;z&uuml;nden &ouml;rnek al&#305;n&#305;r;
bu s&#305;rada ba&#351;&#305;n&#305; hafif&ccedil;e sa&#287;a sola &ccedil;evirsin. Ayn&#305; ki&#351;iyi farkl&#305; &#305;&#351;&#305;klarda tekrar kaydetmek tan&#305;may&#305; g&uuml;&ccedil;lendirir.</p>
<div class="ekle"><input id="kad" maxlength="30" placeholder="&#304;sim" aria-label="&#304;sim" autocomplete="off">
<button type="button" id="kaydet">Kaydet</button></div>
<p id="mesaj" class="alanyazi"></p>
<ul id="kliste" class="kliste"></ul>
<label class="sec"><input type="checkbox" id="telses"> Selam&#305; telefonda da sesli s&ouml;yle</label>
<button type="button" id="sesdene" class="ikincil">&#128264; Kameradan test sesi &ccedil;al</button>
<button type="button" id="uyarlama" class="ikincil">&#128260; Hoparl&ouml;r uyarlamas&#305;n&#305; a&ccedil;/kapat ve dene</button>
<button type="button" id="leddene" class="ikincil">&#128309; Mavi &#305;&#351;&#305;&#287;&#305; dene (5 sn yan&#305;p s&ouml;ner)</button>
<p id="seshata" class="alanyazi" style="color:var(--sari)"></p>
</section>
</main>
<script>
function gonder(v){return fetch("api/komut",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(v)}).catch(function(){});}
var zaman=null,aktif=null;
function bas(el){birak();aktif=el;el.classList.add("basili");var y=el.dataset.yon;gonder({islem:"bas",yon:y});
 zaman=setInterval(function(){gonder({islem:"bas",yon:y});},150);}
function birak(){if(zaman){clearInterval(zaman);zaman=null;}if(aktif){aktif.classList.remove("basili");aktif=null;gonder({islem:"birak"});}}
document.querySelectorAll(".ok").forEach(function(el){
 el.addEventListener("pointerdown",function(e){e.preventDefault();el.setPointerCapture(e.pointerId);bas(el);});
 ["pointerup","pointercancel","lostpointercapture"].forEach(function(t){el.addEventListener(t,birak);});
 el.addEventListener("contextmenu",function(e){e.preventDefault();});});
window.addEventListener("blur",birak);document.addEventListener("visibilitychange",birak);
document.getElementById("mod").addEventListener("click",function(){gonder({islem:"mod"}).then(guncelle);});
var kaydetD=document.getElementById("kaydet"),kadI=document.getElementById("kad");
kaydetD.addEventListener("click",function(){var ad=kadI.value.trim();if(!ad){kadI.focus();return;}
 gonder({islem:"ogren",ad:ad}).then(function(){kadI.value="";setTimeout(guncelle,300);});});
kadI.addEventListener("keydown",function(e){if(e.key==="Enter")kaydetD.click();});
var telses=document.getElementById("telses");try{telses.checked=localStorage.getItem("telses")==="1";}catch(e){}
telses.addEventListener("change",function(){try{localStorage.setItem("telses",telses.checked?"1":"0");}catch(e){}
 if(telses.checked&&window.speechSynthesis){var u=new SpeechSynthesisUtterance("Ses a\u00e7\u0131k");u.lang="tr-TR";speechSynthesis.speak(u);}});
document.getElementById("uyarlama").addEventListener("click",function(){gonder({islem:"uyarlama"}).then(function(){setTimeout(guncelle,500);});});
document.getElementById("leddene").addEventListener("click",function(){gonder({islem:"led_dene"}).then(function(){setTimeout(guncelle,500);});});
document.getElementById("sesdene").addEventListener("click",function(){gonder({islem:"ses_dene"}).then(function(){setTimeout(guncelle,1500);});});
var sonSelam=null,silOnay=null,sonListe="";
function kisileriCiz(d){var anahtar=JSON.stringify([d.kisiler,d.gorulen]);if(anahtar===sonListe)return;sonListe=anahtar;
 var ul=document.getElementById("kliste");ul.innerHTML="";
 (d.kisiler||[]).forEach(function(k){var li=document.createElement("li");var sol=document.createElement("span");
  var ad=document.createElement("span");ad.className="ad";ad.textContent=k.ad;sol.appendChild(ad);
  if((d.gorulen||[]).indexOf(k.ad)>=0){var g=document.createElement("span");g.className="gor";g.textContent="\u25cf \u015fu an g\u00f6r\u00fcl\u00fcyor";sol.appendChild(g);}
  var b=document.createElement("button");b.type="button";b.textContent="Sil";
  b.addEventListener("click",function(){if(silOnay===k.ad){gonder({islem:"kisi_sil",ad:k.ad}).then(function(){setTimeout(guncelle,300);});silOnay=null;}
   else{silOnay=k.ad;b.textContent="Emin misin?";setTimeout(function(){if(silOnay===k.ad){silOnay=null;b.textContent="Sil";}},3000);}});
  li.appendChild(sol);li.appendChild(b);ul.appendChild(li);});}
document.querySelectorAll("[data-sinir]").forEach(function(b){b.addEventListener("click",function(){
 gonder({islem:"sinir",hangi:b.dataset.sinir}).then(function(){setTimeout(guncelle,300);});});});
var modDugme=document.getElementById("mod");
function guncelle(){fetch("api/durum").then(function(r){return r.json();}).then(function(d){
 document.getElementById("durum").textContent=d.durum||"";document.getElementById("surum").textContent=d.surum;
 modDugme.className=d.mod;modDugme.textContent=d.mod==="OTO"?"OTOMAT\u0130K":"SAB\u0130T";
 modDugme.disabled=!d.ptz;document.getElementById("alan").textContent=d.alan||"";
 ayarlariDoldur(d);bolgeleriCiz(d);document.getElementById("bdurum").textContent=d.bildirim_durum||"";
 var us=document.getElementById("uzaksabit"),uu=document.getElementById("uzakurl");
 if(d.uzak_sabit){us.textContent=d.uzak_sabit;us.href=d.uzak_sabit;}else{us.textContent="kapal\u0131";us.removeAttribute("href");}
 if(d.uzak_url){uu.textContent=d.uzak_url;uu.href=d.uzak_url;}else{uu.textContent="-";uu.removeAttribute("href");}
 document.getElementById("uzakdurum").textContent=d.uzak_durum==="hazir"?"Durum: haz\u0131r":"Durum: "+(d.uzak_durum||"");
 document.getElementById("mesaj").textContent=d.tanima?(d.mesaj||""):(d.tanima_durum||"Y\u00fcz tan\u0131ma haz\u0131rlan\u0131yor...");
 kaydetD.disabled=!d.tanima||d.ogreniyor;kisileriCiz(d);
 document.getElementById("seshata").textContent=d.ses_hata?("Ses: "+d.ses_hata):"";
 if(d.selam){if(sonSelam!==null&&d.selam.no!==sonSelam&&telses.checked&&window.speechSynthesis){
  var u=new SpeechSynthesisUtterance(d.selam.metin);u.lang="tr-TR";speechSynthesis.speak(u);}sonSelam=d.selam.no;}}).catch(function(){document.getElementById("durum").textContent="Ba\u011flant\u0131 yok";});}

// ---- Bildirim ayarlari ----
var ilkAyar=false;
function ayarlariDoldur(d){if(ilkAyar||!d.bildirim)return;ilkAyar=true;
 document.getElementById("bmod").value=d.bildirim.mod;document.getElementById("bbas").value=d.bildirim.bas;
 document.getElementById("bbit").value=d.bildirim.bit;document.getElementById("bbilinen").checked=!!d.bildirim.bilinen;
 document.getElementById("nhayvan").checked=!!(d.nesneler&&d.nesneler.hayvan);document.getElementById("narac").checked=!!(d.nesneler&&d.nesneler.arac);
 if(d.saklama){document.getElementById("sgun").value=d.saklama.gun;document.getElementById("sgb").value=d.saklama.gb;}
 var ka=document.getElementById("konuad");ka.innerHTML="";var a=document.createElement("a");a.href="https://ntfy.sh/"+d.konu;a.target="_blank";a.rel="noopener";
 a.textContent=d.konu;a.style.color="var(--yesil)";ka.appendChild(a);saatGoster();}
function saatGoster(){document.getElementById("bsaat").style.display=document.getElementById("bmod").value==="zamanli"?"flex":"none";}
document.getElementById("bmod").addEventListener("change",saatGoster);
document.getElementById("bkaydet").addEventListener("click",function(){gonder({islem:"ayar_bildirim",mod:document.getElementById("bmod").value,
 bas:document.getElementById("bbas").value,bit:document.getElementById("bbit").value,bilinen:document.getElementById("bbilinen").checked}).then(function(){setTimeout(guncelle,300);});});
document.getElementById("bdene").addEventListener("click",function(){gonder({islem:"bildirim_dene"}).then(function(){setTimeout(guncelle,2500);});});
["nhayvan","narac"].forEach(function(id){document.getElementById(id).addEventListener("change",function(){
 gonder({islem:"ayar_nesne",hayvan:document.getElementById("nhayvan").checked,arac:document.getElementById("narac").checked});});});
document.getElementById("skaydet").addEventListener("click",function(){gonder({islem:"ayar_saklama",gun:document.getElementById("sgun").value,gb:document.getElementById("sgb").value}).then(function(){setTimeout(guncelle,300);});});

// ---- Bolge cizimi ----
var bimg=document.getElementById("bimg"),bc=document.getElementById("bcanvas"),bnok=[],bolgeVeri=[];
function bolgeCiz(){var r=bc.getBoundingClientRect();bc.width=r.width;bc.height=r.height;var c=bc.getContext("2d");
 c.clearRect(0,0,bc.width,bc.height);
 bolgeVeri.forEach(function(b){if(!b.aktif||b.nokta.length<3)return;c.beginPath();b.nokta.forEach(function(p,i){var x=p[0]*bc.width,y=p[1]*bc.height;i?c.lineTo(x,y):c.moveTo(x,y);});
  c.closePath();c.fillStyle=b.tur==="maske"?"rgba(60,60,60,.5)":"rgba(220,40,40,.18)";c.fill();c.strokeStyle=b.tur==="maske"?"#999":"#e44";c.lineWidth=2;c.stroke();});
 if(bnok.length){c.beginPath();bnok.forEach(function(p,i){var x=p[0]*bc.width,y=p[1]*bc.height;i?c.lineTo(x,y):c.moveTo(x,y);});
  if(bnok.length>2)c.closePath();c.strokeStyle="#ffd23f";c.lineWidth=3;c.stroke();
  bnok.forEach(function(p){c.beginPath();c.arc(p[0]*bc.width,p[1]*bc.height,6,0,7);c.fillStyle="#ffd23f";c.fill();});}}
function yeniGoruntu(){bnok=[];bimg.onload=bolgeCiz;bimg.src="kare.jpg?t="+Date.now();}
bc.addEventListener("pointerdown",function(e){var r=bc.getBoundingClientRect();bnok.push([(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]);bolgeCiz();});
document.getElementById("bciz").addEventListener("click",yeniGoruntu);
document.getElementById("bekle").addEventListener("click",function(){if(bnok.length<3){alert("En az 3 k\u00f6\u015fe i\u015faretle.");return;}
 gonder({islem:"bolge_ekle",ad:document.getElementById("bad").value,tur:document.getElementById("btur").value,nokta:bnok}).then(function(){bnok=[];document.getElementById("bad").value="";setTimeout(guncelle,300);});});
var sonBolge="";
function bolgeleriCiz(d){var anahtar=JSON.stringify(d.bolgeler||[]);if(anahtar===sonBolge)return;sonBolge=anahtar;bolgeVeri=d.bolgeler||[];bolgeCiz();
 var ul=document.getElementById("bliste");ul.innerHTML="";
 bolgeVeri.forEach(function(b){var li=document.createElement("li");var sp=document.createElement("span");
  sp.textContent=(b.tur==="maske"?"Maske: ":"Alarm: ")+b.ad+(b.aktif?"":" (ba\u015fka kamera konumunda)");
  var bt=document.createElement("button");bt.type="button";bt.textContent="Sil";
  bt.addEventListener("click",function(){gonder({islem:"bolge_sil",id:b.id}).then(function(){setTimeout(guncelle,300);});});
  li.appendChild(sp);li.appendChild(bt);ul.appendChild(li);});}
window.addEventListener("resize",bolgeCiz);yeniGoruntu();

// ---- Bas-konus ----
var kd=document.getElementById("konus"),kdurum=document.getElementById("konusdurum"),kayitci=null,parcalar=[],akisM=null;
function konusBasla(e){e.preventDefault();if(kayitci)return;
 if(!window.isSecureContext||!navigator.mediaDevices||!window.MediaRecorder){kdurum.textContent="Mikrofon bu ba\u011flant\u0131da kullan\u0131lam\u0131yor. \u0130nternet (https) adresini ya da bilgisayarda localhost'u kullan.";return;}
 navigator.mediaDevices.getUserMedia({audio:true}).then(function(akis){akisM=akis;parcalar=[];
  kayitci=new MediaRecorder(akis);kayitci.ondataavailable=function(ev){if(ev.data.size)parcalar.push(ev.data);};
  kayitci.onstop=function(){akisM.getTracks().forEach(function(t){t.stop();});var blob=new Blob(parcalar,{type:kayitci.mimeType||"audio/webm"});kayitci=null;
   if(blob.size<2000){kdurum.textContent="Kay\u0131t \u00e7ok k\u0131sa. D\u00fc\u011fmeyi bas\u0131l\u0131 tutarak konu\u015f.";return;}
   kdurum.textContent="Kameraya g\u00f6nderiliyor...";
   fetch("api/konus",{method:"POST",headers:{"Content-Type":blob.type},body:blob}).then(function(r){return r.json();}).then(function(j){
    kdurum.textContent=j.ok?"Kameradan \u00e7al\u0131n\u0131yor.":"G\u00f6nderilemedi: "+(j.hata||"");}).catch(function(){kdurum.textContent="G\u00f6nderilemedi.";});};
  kayitci.start();kd.classList.add("kayit");kd.textContent="\u1f534 Kaydediliyor... b\u0131rak\u0131nca g\u00f6nderilir";
 }).catch(function(){kdurum.textContent="Mikrofon izni verilmedi.";});}
function konusBitir(){kd.classList.remove("kayit");kd.textContent="\u1f3a4 Bas\u0131l\u0131 tut ve konu\u015f";if(kayitci&&kayitci.state==="recording")kayitci.stop();}
kd.addEventListener("pointerdown",konusBasla);["pointerup","pointercancel","pointerleave"].forEach(function(t){kd.addEventListener(t,konusBitir);});
kd.addEventListener("contextmenu",function(e){e.preventDefault();});
setInterval(guncelle,1000);guncelle();
var img=document.getElementById("img"),akisCalisti=false,tekKare=false;
img.onload=function(){akisCalisti=true;};
img.onerror=function(){if(!tekKare)setTimeout(function(){img.src="video?t="+Date.now();},2000);};
// Canli akis 6 sn icinde gelmezse (bazi baglantilar akisi tamponlar) tek tek kare cek
setTimeout(function(){if(akisCalisti&&img.naturalWidth>0)return;tekKare=true;
 var yeni=new Image();function sonraki(){yeni.src="kare.jpg?t="+Date.now();}
 yeni.onload=function(){img.src=yeni.src;setTimeout(sonraki,250);};yeni.onerror=function(){setTimeout(sonraki,1000);};sonraki();},6000);
</script></body></html>"""

OLAY_SAYFA = r"""<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Olay Ge&#231;mi&#351;i</title>
<style>
:root{--bg:#0f1412;--yuzey:#1a211e;--cizgi:#2c3732;--yazi:#e8eeeb;--soluk:#93a29b;--yesil:#3fbf86;--sari:#f2b33d;--kirmizi:#e5534b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--yazi);font:15px system-ui,-apple-system,"Segoe UI",sans-serif;
padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) 24px max(12px,env(safe-area-inset-left))}
main{max-width:1000px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
header{display:flex;justify-content:space-between;align-items:center;gap:8px}h1{font-size:19px;margin:0}
a{color:var(--yesil)}.surum{background:var(--sari);color:#111;font-weight:700;border-radius:6px;padding:2px 8px;font-size:13px}
.suzgec{display:flex;gap:8px;flex-wrap:wrap}.suzgec input,.suzgec select{font:15px system-ui;padding:9px;border-radius:9px;border:1px solid var(--cizgi);background:var(--yuzey);color:var(--yazi)}
.zaman{position:relative;height:38px;background:var(--yuzey);border:1px solid var(--cizgi);border-radius:9px;overflow:hidden}
.zaman i{position:absolute;top:6px;bottom:14px;min-width:3px;border-radius:2px;background:var(--yesil);cursor:pointer}
.zaman i.t{background:var(--kirmizi)}.zaman span{position:absolute;bottom:0;font-size:10px;color:var(--soluk);transform:translateX(-50%)}
.izgara{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
.kart{background:var(--yuzey);border:1px solid var(--cizgi);border-radius:12px;overflow:hidden;cursor:pointer;display:flex;flex-direction:column}
.kart img{width:100%;aspect-ratio:4/3;object-fit:cover;background:#000;display:block}
.kart .b{padding:8px;display:flex;flex-direction:column;gap:3px}.kart .s{font-weight:700;font-variant-numeric:tabular-nums}
.etiket{display:inline-block;font-size:12px;border-radius:6px;padding:1px 6px;margin-right:4px;background:#24302b}
.etiket.t{background:#4a2321;color:#ffb4ae}.bos{color:var(--soluk);text-align:center;padding:30px}
.pencere{position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:12px;z-index:9}
.pencere[hidden]{display:none}.pencere .ic{background:var(--yuzey);border-radius:12px;max-width:960px;width:100%;padding:12px;display:flex;flex-direction:column;gap:8px}
.pencere video,.pencere img{width:100%;border-radius:8px;background:#000;max-height:70vh}
.ust{display:flex;justify-content:space-between;align-items:center;gap:8px}.ust button{font:600 14px system-ui;padding:8px 12px;border-radius:8px;border:1px solid var(--cizgi);background:var(--bg);color:var(--yazi);cursor:pointer}
</style></head><body><main>
<header><h1>Olay ge&#231;mi&#351;i</h1><span><a href="./">&#8592; Canl&#305; g&#246;r&#252;nt&#252;</a> <span class="surum">__SURUM__</span></span></header>
<div class="suzgec"><input type="date" id="gun" aria-label="G&#252;n"><select id="kisi" aria-label="Ki&#351;i"><option value="">Herkes</option><option value="__taninmayan__">Tan&#305;nmayanlar</option></select></div>
<div class="zaman" id="zaman" aria-label="G&#252;n&#252;n zaman &#231;izelgesi"></div>
<div class="izgara" id="izgara"></div>
</main>
<div class="pencere" id="pencere" hidden><div class="ic"><div class="ust"><b id="pbaslik"></b><span><button id="psil">Sil</button> <button id="pkapat">Kapat</button></span></div>
<div id="pmedya"></div><div id="pbilgi" style="color:var(--soluk);font-size:14px"></div></div></div>
<script>
function iki(n){return(n<10?"0":"")+n;}
function bugun(){var d=new Date();return d.getFullYear()+"-"+iki(d.getMonth()+1)+"-"+iki(d.getDate());}
function saatYaz(t){var d=new Date(t*1000);return iki(d.getHours())+":"+iki(d.getMinutes())+":"+iki(d.getSeconds());}
var gunI=document.getElementById("gun"),kisiS=document.getElementById("kisi"),secili=null;gunI.value=bugun();
fetch("api/durum").then(function(r){return r.json();}).then(function(d){(d.kisiler||[]).forEach(function(k){var o=document.createElement("option");o.value=k.ad;o.textContent=k.ad;kisiS.appendChild(o);});});
function etiketler(o){var s=[];o.kisiler.forEach(function(k){s.push(["",k]);});if(o.taninmayan)s.push(["t","Tan\u0131nmayan"]);
 o.turler.forEach(function(t){if(t==="hayvan")s.push(["","Hayvan"]);if(t==="arac")s.push(["","Ara\u00e7"]);});
 if(!o.kisiler.length&&!o.taninmayan&&o.turler.indexOf("insan")>=0)s.push(["","Ki\u015fi"]);
 o.bolgeler.forEach(function(b){s.push(["","\u1f4cd "+b]);});return s;}
function yukle(){fetch("api/olaylar?gun="+gunI.value+"&kisi="+encodeURIComponent(kisiS.value)).then(function(r){return r.json();}).then(function(l){
 var iz=document.getElementById("izgara"),z=document.getElementById("zaman");iz.innerHTML="";z.innerHTML="";
 for(var h=0;h<24;h+=3){var sp=document.createElement("span");sp.style.left=(h/24*100)+"%";sp.textContent=iki(h);z.appendChild(sp);}
 if(!l.length){var b=document.createElement("div");b.className="bos";b.textContent="Bu g\u00fcn i\u00e7in kay\u0131tl\u0131 olay yok.";iz.appendChild(b);return;}
 l.forEach(function(o){var d=new Date(o.bas*1000),dk=d.getHours()*60+d.getMinutes();
  var m=document.createElement("i");if(o.taninmayan)m.className="t";m.style.left=(dk/1440*100)+"%";m.style.width=Math.max(0.3,(o.bit-o.bas)/864)+"%";
  m.title=saatYaz(o.bas);m.addEventListener("click",function(){ac(o);});z.appendChild(m);
  var k=document.createElement("div");k.className="kart";k.tabIndex=0;
  var im=document.createElement("img");im.loading="lazy";im.alt="Olay g\u00f6r\u00fcnt\u00fcs\u00fc";if(o.kucuk)im.src="olay/"+o.id+"/kucuk.jpg";k.appendChild(im);
  var bb=document.createElement("div");bb.className="b";var s=document.createElement("span");s.className="s";
  s.textContent=saatYaz(o.bas)+" \u00b7 "+(o.suruyor?"\u015fu an s\u00fcr\u00fcyor":Math.max(1,Math.round(o.bit-o.bas))+" sn");bb.appendChild(s);
  var e=document.createElement("div");etiketler(o).forEach(function(t){var x=document.createElement("span");x.className="etiket "+t[0];x.textContent=t[1];e.appendChild(x);});
  bb.appendChild(e);k.appendChild(bb);k.addEventListener("click",function(){ac(o);});k.addEventListener("keydown",function(ev){if(ev.key==="Enter")ac(o);});iz.appendChild(k);});});}
function ac(o){secili=o;document.getElementById("pbaslik").textContent=saatYaz(o.bas)+" \u2013 "+saatYaz(o.bit);
 var md=document.getElementById("pmedya");md.innerHTML="";
 if(o.video){var v=document.createElement("video");v.controls=true;v.autoplay=true;v.playsInline=true;v.src="olay/"+o.id+"/video.mp4";md.appendChild(v);}
 else{var im=document.createElement("img");im.src="olay/"+o.id+"/foto.jpg";im.alt="Olay foto\u011fraf\u0131";md.appendChild(im);
  var p=document.createElement("div");p.textContent="Video haz\u0131rlan\u0131yor ya da yok; foto\u011fraf g\u00f6steriliyor.";p.style.color="var(--soluk)";md.appendChild(p);}
 document.getElementById("pbilgi").textContent=etiketler(o).map(function(t){return t[1];}).join(" \u00b7 ");
 document.getElementById("pencere").hidden=false;}
function kapat(){document.getElementById("pencere").hidden=true;document.getElementById("pmedya").innerHTML="";}
document.getElementById("pkapat").addEventListener("click",kapat);
document.getElementById("pencere").addEventListener("click",function(e){if(e.target.id==="pencere")kapat();});
var silOnay=false;document.getElementById("psil").addEventListener("click",function(){var b=this;
 if(!silOnay){silOnay=true;b.textContent="Emin misin?";setTimeout(function(){silOnay=false;b.textContent="Sil";},3000);return;}
 silOnay=false;b.textContent="Sil";fetch("api/komut",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({islem:"olay_sil",id:secili.id})}).then(function(){kapat();yukle();});});
gunI.addEventListener("change",yukle);kisiS.addEventListener("change",yukle);yukle();setInterval(yukle,30000);
</script></body></html>"""


WEB_GIRIS = r"""<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Kamera Takip</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1412;
color:#e8eeeb;font:16px system-ui,sans-serif;padding:16px}form{display:flex;flex-direction:column;gap:12px;width:min(320px,100%)}
input{font:24px ui-monospace,Consolas,monospace;letter-spacing:.3em;text-align:center;padding:12px;border-radius:10px;
border:1px solid #2c3732;background:#1a211e;color:#e8eeeb}button{font:700 18px system-ui;padding:14px;border:0;border-radius:10px;
background:#3fbf86;color:#111}p{color:#93a29b;font-size:14px;margin:0}</style></head><body>
<form method="get" action="/"><h2 style="margin:0">Kamera Takip</h2>
<p>Bilgisayardaki siyah pencerede yazan 6 haneli PIN'i gir.</p>
<input name="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="6" autofocus aria-label="PIN">
<button type="submit">Gir</button>__HATA__</form></body></html>"""


def yerel_adresler():
    """Bu bilgisayarin ag adresleri (Tailscale 100.x adresleri dahil)."""
    import socket
    adresler = set()
    try:
        for bilgi in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            adresler.add(bilgi[4][0])
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        adresler.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return sorted(a for a in adresler if not a.startswith("127."))


class WebSunucu:
    def __init__(self, port, pin):
        from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
        from http.cookies import SimpleCookie
        import queue
        self.pin, self.jpeg, self.sayac = pin, None, 0
        self.kosul = threading.Condition()
        self.komutlar = queue.Queue()
        self.durum = {"surum": SURUM, "mod": "OTO", "durum": "", "ptz": False}
        self.son_izleme = 0.0
        self.hatalar = []  # yanlis PIN zamanlari (10 yanlis -> 15 dk kilit)
        self.ses_anahtari = "%032x" % random.SystemRandom().getrandbits(128)
        self.olay = self.ayarlar = None
        self.konu = ""
        web = self

        class Isleyici(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _yetkili(self):
                c = SimpleCookie(self.headers.get("Cookie", ""))
                return "pin" in c and c["pin"].value == web.pin

            def _yaz(self, kod, govde, tur="text/html; charset=utf-8", ek=None):
                self.send_response(kod)
                self.send_header("Content-Type", tur)
                self.send_header("Cache-Control", "no-store")
                for k, v in (ek or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(govde if isinstance(govde, bytes) else govde.encode("utf-8"))

            def do_GET(self):
                yol = urllib.parse.urlparse(self.path)
                q = urllib.parse.parse_qs(yol.query)
                if yol.path.startswith("/ses/"):  # go2rtc kameraya ses calarken buradan alir
                    parca = yol.path.split("/")
                    if len(parca) == 4 and parca[2] == web.ses_anahtari and re.match(r"^(konus_)?[0-9a-f]{16}\.(mp3|webm|ogg|mp4)$", parca[3]):
                        dosya = os.path.join(SES_AYAR["klasor"], "ses_onbellek", parca[3])
                        if os.path.exists(dosya):
                            return self._yaz(200, open(dosya, "rb").read(), "application/octet-stream")
                    return self._yaz(404, "yok")
                if yol.path == "/kimlik":
                    return self._yaz(200, "kamera-takip", "text/plain")
                if yol.path == "/" and "pin" in q:
                    simdi = time.time()
                    web.hatalar = [t for t in web.hatalar if simdi - t < 900]
                    if len(web.hatalar) >= 10:
                        return self._yaz(429, WEB_GIRIS.replace("__HATA__",
                                         '<p style="color:#f2b33d">&Ccedil;ok fazla yanl&#305;&#351; deneme. 15 dakika sonra tekrar dene.</p>'))
                    if q["pin"][0].strip() == web.pin:
                        return self._yaz(303, "", ek={"Location": "/", "Set-Cookie":
                                         "pin=%s; Path=/; Max-Age=31536000; SameSite=Strict" % web.pin})
                    web.hatalar.append(time.time())
                    time.sleep(1.0)  # tahmin denemelerini yavaslat
                    return self._yaz(200, WEB_GIRIS.replace("__HATA__", '<p style="color:#f2b33d">PIN yanl&#305;&#351;</p>'))
                if not self._yetkili():
                    if yol.path == "/":
                        return self._yaz(200, WEB_GIRIS.replace("__HATA__", ""))
                    return self._yaz(403, "PIN gerekli")
                if yol.path == "/":
                    return self._yaz(200, WEB_SAYFA.replace("__SURUM__", SURUM))
                if yol.path == "/api/durum":
                    return self._yaz(200, json.dumps(web.durum), "application/json")
                if yol.path == "/olaylar":
                    return self._yaz(200, OLAY_SAYFA.replace("__SURUM__", SURUM))
                if yol.path == "/api/olaylar" and web.olay:
                    liste = web.olay.liste(q.get("gun", [None])[0], q.get("kisi", [None])[0])
                    return self._yaz(200, json.dumps(liste, ensure_ascii=False), "application/json; charset=utf-8")
                m = re.match(r"^/olay/(\d{8}_\d{6})/(kucuk\.jpg|foto\.jpg|video\.mp4)$", yol.path)
                if m and web.olay:
                    dosya = web.olay.dosya(m.group(1), m.group(2))
                    if not dosya:
                        return self._yaz(404, "yok")
                    return self._dosya(dosya, "video/mp4" if dosya.endswith(".mp4") else "image/jpeg")
                if yol.path == "/video":
                    return self._video()
                if yol.path == "/kare.jpg":  # tek kare (akisi tamponlayan baglantilar icin yedek)
                    web.son_izleme = time.time()
                    with web.kosul:  # izleme yeni basladiysa ilk karenin uretilmesini bekle
                        onceki = web.sayac
                        web.kosul.wait_for(lambda: web.sayac != onceki, timeout=2)
                        jpeg = web.jpeg
                    if jpeg is None:
                        return self._yaz(503, "henuz kare yok")
                    return self._yaz(200, jpeg, "image/jpeg")
                self._yaz(404, "yok")

            def _dosya(self, yol, tur):
                """Dosya gonderir; video ileri-geri sarma icin Range destekli."""
                boyut = os.path.getsize(yol)
                bas, bit = 0, boyut - 1
                aralik = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
                if aralik and (aralik.group(1) or aralik.group(2)):
                    if aralik.group(1):
                        bas = int(aralik.group(1))
                        bit = int(aralik.group(2)) if aralik.group(2) else boyut - 1
                    else:
                        bas = max(0, boyut - int(aralik.group(2)))
                    bit = min(bit, boyut - 1)
                    self.send_response(206)
                    self.send_header("Content-Range", "bytes %d-%d/%d" % (bas, bit, boyut))
                else:
                    self.send_response(200)
                self.send_header("Content-Type", tur)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(bit - bas + 1))
                self.send_header("Cache-Control", "private, max-age=3600")
                self.end_headers()
                try:
                    with open(yol, "rb") as f:
                        f.seek(bas)
                        kalan = bit - bas + 1
                        while kalan > 0:
                            parca = f.read(min(256 * 1024, kalan))
                            if not parca:
                                break
                            self.wfile.write(parca)
                            kalan -= len(parca)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

            def do_POST(self):
                if not self._yetkili():
                    return self._yaz(403, "PIN gerekli")
                if self.path.startswith("/api/konus"):
                    n = int(self.headers.get("Content-Length", 0) or 0)
                    if n <= 0 or n > 8 * 1024 * 1024:
                        return self._yaz(400, "ses kaydi bos ya da cok buyuk")
                    tur = self.headers.get("Content-Type", "")
                    uzanti = "mp4" if "mp4" in tur or "aac" in tur else ("ogg" if "ogg" in tur else "webm")
                    ad = "konus_%016x.%s" % (random.getrandbits(64), uzanti)
                    klasor = os.path.join(SES_AYAR["klasor"], "ses_onbellek")
                    os.makedirs(klasor, exist_ok=True)
                    with open(os.path.join(klasor, ad), "wb") as f:
                        f.write(self.rfile.read(n))
                    ok = kameradan_cal(os.path.join(klasor, ad))
                    return self._yaz(200 if ok else 500, json.dumps(
                        {"ok": ok, "hata": SES_AYAR.get("son_hata", "")}, ensure_ascii=False), "application/json")
                if self.path.startswith("/api/komut"):
                    n = int(self.headers.get("Content-Length", 0) or 0)
                    try:
                        web.komutlar.put(json.loads(self.rfile.read(min(n, 1000)) or b"{}"))
                    except ValueError:
                        pass
                    return self._yaz(204, b"")
                self._yaz(404, "yok")

            def _video(self):
                self.send_response(200)
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=kare")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                son = -1
                try:
                    while True:
                        web.son_izleme = time.time()
                        with web.kosul:
                            web.kosul.wait_for(lambda: web.sayac != son, timeout=2)
                            jpeg, son = web.jpeg, web.sayac
                        if jpeg is None:
                            continue
                        self.wfile.write(b"--kare\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(jpeg))
                        self.wfile.write(jpeg)
                        self.wfile.write(b"\r\n")
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                    pass

        class Sunucu(ThreadingHTTPServer):
            # Baska bir program ayni portu kullaniyorsa paylasma: hata ver, sonraki portu dene.
            # Windows'ta SO_REUSEADDR portu baska programla PAYLASTIRIR (kapali olmali);
            # Linux/Mac'te ise sadece yeni kapanmis portu tekrar kullanmaya izin verir (acik olmali).
            allow_reuse_address = os.name != "nt"
            daemon_threads = True

            def server_bind(self):
                import socket
                if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):  # Windows
                    self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                ThreadingHTTPServer.server_bind(self)

        self.sunucu = None
        for p in range(port, port + 20):
            try:
                self.sunucu = Sunucu(("0.0.0.0", p), Isleyici)
            except OSError:
                continue
            threading.Thread(target=self.sunucu.serve_forever, daemon=True).start()
            # localhost gercekten bize mi geliyor? (baska program 127.0.0.1'e baglanmis olabilir)
            try:
                with urllib.request.urlopen("http://127.0.0.1:%d/kimlik" % p, timeout=2) as r:
                    if r.read().decode() == "kamera-takip":
                        self.port = p
                        break
            except Exception:
                pass
            self.sunucu.shutdown()
            self.sunucu.server_close()
            self.sunucu = None
        if self.sunucu is None:
            raise OSError("bos port bulunamadi (%d-%d)" % (port, port + 19))
        self._son_kare = 0.0

    def kare_ver(self, kare):
        """Izleyen varsa kareyi JPEG yapip yayinlar (en fazla ~12 kare/sn)."""
        simdi = time.time()
        if simdi - self.son_izleme > 5 or simdi - self._son_kare < 0.08:
            return
        self._son_kare = simdi
        h, w = kare.shape[:2]
        if w > 960:
            kare = cv2.resize(kare, (960, int(h * 960 / w)))
        ok, buf = cv2.imencode(".jpg", kare, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if ok:
            with self.kosul:
                self.jpeg, self.sayac = buf.tobytes(), self.sayac + 1
                self.kosul.notify_all()


def web_pin_al(klasor):
    yol = os.path.join(klasor, "web_pin.txt")
    try:
        pin = open(yol).read().strip()
        if len(pin) == 6 and pin.isdigit():
            return pin
    except OSError:
        pass
    pin = "%06d" % random.SystemRandom().randint(0, 999999)
    with open(yol, "w") as f:
        f.write(pin)
    return pin


# ===========================================================================
#  Internetten erisim: Cloudflare tuneli + sabit "adres panosu" (ntfy.sh)
# ===========================================================================
NTFY = "https://ntfy.sh"


def uzak_konu_al(klasor):
    """Bu kurulum icin gizli, rastgele ntfy konusu (bir kez uretilir, saklanir)."""
    yol = os.path.join(klasor, "uzak.json")
    try:
        d = json.load(open(yol))
        if d.get("konu"):
            return d["konu"]
    except (OSError, ValueError):
        pass
    harfler = "abcdefghijkmnpqrstuvwxyz23456789"
    konu = "kamera-" + "".join(random.SystemRandom().choice(harfler) for _ in range(20))
    json.dump({"konu": konu}, open(yol, "w"))
    return konu


class UzakErisim:
    """cloudflared ile https://....trycloudflare.com adresi acar; adres her
    degistiginde gizli ntfy sayfasina yazar. Sabit yer imi: https://ntfy.sh/<konu>"""

    def __init__(self, klasor, port):
        self.klasor, self.port = os.path.join(klasor, "cloudflared"), port
        self.konu = uzak_konu_al(klasor)
        self.sabit = "%s/%s" % (NTFY, self.konu)
        self.url, self.durum, self.surec = None, "\u0130nternet eri\u015fimi ba\u015flat\u0131l\u0131yor...", None
        self.son_duyuru = 0.0
        threading.Thread(target=self._calis, daemon=True).start()
        threading.Thread(target=self._tazele, daemon=True).start()

    def _exe(self):
        os.makedirs(self.klasor, exist_ok=True)
        sistem, mimari = platform.system(), platform.machine().lower()
        if sistem == "Windows":
            dosya, ad = "cloudflared-windows-amd64.exe", "cloudflared.exe"
        elif sistem == "Darwin":
            dosya = "cloudflared-darwin-arm64.tgz" if mimari in ("arm64", "aarch64") else "cloudflared-darwin-amd64.tgz"
            ad = "cloudflared"
        else:
            dosya = "cloudflared-linux-arm64" if mimari in ("arm64", "aarch64") else "cloudflared-linux-amd64"
            ad = "cloudflared"
        yol = os.path.join(self.klasor, ad)
        if not os.path.exists(yol):
            self.durum = "Cloudflare t\u00fcnel arac\u0131 indiriliyor..."
            print(self.durum)
            url = "https://github.com/cloudflare/cloudflared/releases/latest/download/" + dosya
            gecici = yol + ".indirilen"

            def guncelle(m):
                self.durum = m
            model_indir(url, gecici, "Cloudflare t\u00fcnel arac\u0131", guncelle, en_az=5000000)
            if dosya.endswith(".tgz"):
                import tarfile
                with tarfile.open(gecici) as t:
                    t.extract("cloudflared", self.klasor)
                os.remove(gecici)
            else:
                os.replace(gecici, yol)
            os.chmod(yol, 0o755)
        return yol

    def _calis(self):
        while True:
            try:
                exe = self._exe()
                self.durum = "\u0130nternet t\u00fcneli a\u00e7\u0131l\u0131yor..."
                self.surec = subprocess.Popen(
                    [exe, "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:%d" % self.port],
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace",
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                for satir in self.surec.stdout:
                    m = re.search(r"https://[-a-z0-9]+\.trycloudflare\.com", satir)
                    if m and m.group(0) != self.url and "api.trycloudflare" not in m.group(0):
                        self.url = m.group(0)
                        self.durum = "hazir"
                        print("-" * 60)
                        print(" \u0130NTERNETTEN ER\u0130\u015e\u0130M (her yerden):")
                        print("   Bu a\u00e7\u0131l\u0131\u015f\u0131n adresi : %s" % self.url)
                        print("   Sabit yer imi      : %s" % self.sabit)
                        print("   (Yer imi sayfas\u0131nda her zaman g\u00fcncel adres yazar; giri\u015f i\u00e7in PIN gerekir.)")
                        print("-" * 60)
                        self._duyur()
                self.surec.wait()
                self.url = None
                self.durum = "\u0130nternet t\u00fcneli kapand\u0131, yeniden a\u00e7\u0131l\u0131yor..."
            except Exception as e:
                self.url = None
                self.durum = "\u0130nternet eri\u015fimi hatas\u0131: %s (30 saniye sonra yeniden denenecek)" % str(e)[:100]
                print(self.durum)
            time.sleep(30)

    def _duyur(self):
        """Guncel adresi gizli ntfy sayfasina yaz (ntfy mesajlari ~12 saat saklar)."""
        if not self.url:
            return
        try:
            istek = urllib.request.Request(
                "%s/%s" % (NTFY, self.konu), method="POST",
                data=("Kamera Takip adresi: %s\n(A\u00e7mak i\u00e7in dokunun. Giri\u015f i\u00e7in PIN gerekir.)" % self.url).encode("utf-8"),
                headers={"Title": "Kamera Takip %s" % SURUM, "Click": self.url, "Tags": "video_camera",
                         "Actions": "view, Kamerayi ac, %s" % self.url})
            urllib.request.urlopen(istek, timeout=15).read()
            self.son_duyuru = time.time()
        except Exception as e:
            print("Adres sayfas\u0131na yaz\u0131lamad\u0131:", str(e)[:100])

    def _tazele(self):
        while True:
            time.sleep(60)
            if self.url and time.time() - self.son_duyuru > 6 * 3600:
                self._duyur()

    def kapat(self):
        if self.surec and self.surec.poll() is None:
            self.surec.terminate()


def qr_resmi(metin, boyut=260):
    q = cv2.QRCodeEncoder.create().encode(metin)
    q = cv2.copyMakeBorder(q, 3, 3, 3, 3, cv2.BORDER_CONSTANT, value=255)
    q = cv2.resize(q, (boyut, boyut), interpolation=cv2.INTER_NEAREST)
    return cv2.cvtColor(q, cv2.COLOR_GRAY2BGR)


# ===========================================================================
#  Insan / hayvan / arac algilama - OpenCV NanoDet-Plus (COCO, ~4 MB, yerel)
# ===========================================================================
NANODET_DOSYA = "object_detection_nanodet_2022nov.onnx"
NANODET_URLLER = [
    "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/object_detection_nanodet/" + NANODET_DOSYA,
    "https://github.com/opencv/opencv_zoo/raw/main/models/object_detection_nanodet/" + NANODET_DOSYA,
]
# COCO sinif numarasi -> (tur, Turkce ad)
OBJE_SINIF = {0: ("insan", "\u0130nsan"), 15: ("hayvan", "Kedi"), 16: ("hayvan", "K\u00f6pek"),
              1: ("arac", "Bisiklet"), 2: ("arac", "Araba"), 3: ("arac", "Motosiklet"),
              5: ("arac", "Otob\u00fcs"), 7: ("arac", "Kamyon")}


class ObjeDedektor:
    """NanoDet-Plus 416x416. bul(kare) -> [(x, y, w, h, guven, tur, ad), ...]"""
    BOYUT = 416

    def __init__(self, klasor, esik=0.45):
        yol = os.path.join(klasor, NANODET_DOSYA)
        if not os.path.exists(yol) or os.path.getsize(yol) < 3000000:
            for url in NANODET_URLLER:
                try:
                    model_indir(url, yol, "\u0130nsan alg\u0131lama modeli", lambda m: None, en_az=3000000)
                    break
                except Exception as e:
                    print("  \u0130ndirilemedi:", str(e)[:80])
            else:
                raise RuntimeError("insan alg\u0131lama modeli indirilemedi")
        self.net = cv2.dnn.readNet(yol)
        self.esik = esik
        self.ort = np.array([103.53, 116.28, 123.675], np.float32).reshape(1, 1, 3)
        self.std = np.array([57.375, 57.12, 58.395], np.float32).reshape(1, 1, 3)
        self.izgara = []
        for adim in (8, 16, 32, 64):
            n = self.BOYUT // adim
            xv, yv = np.meshgrid(np.arange(n) * adim, np.arange(n) * adim)
            self.izgara.append((adim, np.column_stack((xv.flatten() + 0.5 * (adim - 1),
                                                       yv.flatten() + 0.5 * (adim - 1)))))
        self.proj = np.arange(8, dtype=np.float32)

    def bul(self, kare, turler=("insan", "hayvan", "arac")):
        h, w = kare.shape[:2]
        olcek = self.BOYUT / float(max(h, w))
        yh, yw = int(round(h * olcek)), int(round(w * olcek))
        tuval = np.zeros((self.BOYUT, self.BOYUT, 3), np.uint8)
        tuval[:yh, :yw] = cv2.resize(kare, (yw, yh))
        blob = cv2.dnn.blobFromImage((tuval.astype(np.float32) - self.ort) / self.std)
        self.net.setInput(blob)
        cikis = self.net.forward(self.net.getUnconnectedOutLayersNames())
        # Cikislari sira yerine boyutlarina gore eslestir (OpenCV surumune gore sira degisebiliyor):
        # son boyut 80 -> sinif skorlari, 32 -> kutu dagilimi; satir sayisi -> izgara adimi
        skorlar, kutu_cikis = {}, {}
        for c in cikis:
            c = c.reshape(-1, c.shape[-1])
            (skorlar if c.shape[1] == 80 else kutu_cikis)[c.shape[0]] = c
        kutular, guvenler, siniflar = [], [], []
        for adim, nokta in self.izgara:
            n = len(nokta)
            if n not in skorlar or n not in kutu_cikis:
                continue
            skor, kutu = skorlar[n], kutu_cikis[n].reshape(-1, 8)
            e = np.exp(kutu - kutu.max(axis=1, keepdims=True))
            mesafe = ((e / e.sum(axis=1, keepdims=True)) @ self.proj).reshape(-1, 4) * adim
            sinif = skor.argmax(axis=1)
            guven = skor.max(axis=1)
            sec = (guven >= self.esik) & np.isin(sinif, list(OBJE_SINIF))
            if not sec.any():
                continue
            p, d = nokta[sec], mesafe[sec]
            x1, y1 = p[:, 0] - d[:, 0], p[:, 1] - d[:, 1]
            x2, y2 = p[:, 0] + d[:, 2], p[:, 1] + d[:, 3]
            for i in range(len(p)):
                kutular.append([float(x1[i]), float(y1[i]), float(x2[i] - x1[i]), float(y2[i] - y1[i])])
            guvenler += guven[sec].tolist()
            siniflar += sinif[sec].tolist()
        sonuc = []
        if kutular:
            for i in np.array(cv2.dnn.NMSBoxes(kutular, guvenler, self.esik, 0.5)).flatten():
                tur, ad = OBJE_SINIF[int(siniflar[i])]
                if tur not in turler or (tur == "insan" and guvenler[i] < 0.5):
                    continue
                x, y, bw, bh = (v / olcek for v in kutular[i])
                x, y = max(0, int(x)), max(0, int(y))
                bw, bh = min(int(bw), w - x), min(int(bh), h - y)
                if bw > 8 and bh > 8:
                    sonuc.append((x, y, bw, bh, float(guvenler[i]), tur, ad))
        return sonuc


# ===========================================================================
#  Kalici ayarlar (web sayfasindan degistirilir) - ayarlar.json
# ===========================================================================
AYAR_VARSAYILAN = {
    "bildirim": {"mod": "her_zaman", "bas": 22, "bit": 7, "bilinen": False, "bekleme": 60},
    "nesneler": {"hayvan": True, "arac": False},
    "saklama_gun": 14,
    "saklama_gb": 10,
    "bolgeler": [],
}


class Ayarlar:
    def __init__(self, klasor):
        self.yol = os.path.join(klasor, "ayarlar.json")
        self.kilit = threading.Lock()
        self.d = json.loads(json.dumps(AYAR_VARSAYILAN))
        try:
            gelen = json.load(open(self.yol, encoding="utf-8"))
            for k, v in gelen.items():
                if isinstance(v, dict) and isinstance(self.d.get(k), dict):
                    self.d[k].update(v)
                else:
                    self.d[k] = v
        except (OSError, ValueError):
            pass

    def __getitem__(self, k):
        return self.d[k]

    def kaydet(self):
        with self.kilit:
            with open(self.yol, "w", encoding="utf-8") as f:
                json.dump(self.d, f, ensure_ascii=False, indent=1)


# ===========================================================================
#  Telefona fotografli bildirim (ntfy.sh - sabit yer imiyle ayni gizli konu)
# ===========================================================================
def _rfc2047(m):
    """Turkce harfli HTTP basligi (ntfy RFC 2047 kodlamasini anlar)."""
    try:
        m.encode("ascii")
        return m
    except UnicodeEncodeError:
        return "=?UTF-8?B?%s?=" % base64.b64encode(m.encode("utf-8")).decode()


class Bildirimci:
    def __init__(self, konu, ayarlar):
        self.konu, self.ay = konu, ayarlar
        self.son = 0.0
        self.tiklama = None  # bildirime dokununca acilacak adres (internet adresi)
        self.son_durum = ""

    def zamani_mi(self):
        b = self.ay["bildirim"]
        if b.get("mod") == "kapali":
            return False
        if b.get("mod") == "zamanli":
            saat, bas, bit = datetime.now().hour, int(b.get("bas", 22)), int(b.get("bit", 7))
            return (bas <= saat < bit) if bas < bit else (saat >= bas or saat < bit)
        return True

    def gonder(self, baslik, mesaj, resim=None, oncelik="high", zorla=False):
        """resim: BGR kare (veya None). Arka planda gonderir."""
        simdi = time.time()
        if not zorla and (not self.zamani_mi() or simdi - self.son < float(self.ay["bildirim"].get("bekleme", 60))):
            return False
        self.son = simdi
        veri = None
        if resim is not None:
            ok, buf = cv2.imencode(".jpg", resim, [cv2.IMWRITE_JPEG_QUALITY, 80])
            veri = buf.tobytes() if ok else None

        def is_():
            basliklar = {"Title": _rfc2047(baslik), "Priority": oncelik, "Tags": "rotating_light"}
            if self.tiklama:
                basliklar["Click"] = self.tiklama
                basliklar["Actions"] = "view, Kamerayi ac, %s" % self.tiklama
            try:
                if veri:
                    basliklar.update({"Filename": "kamera.jpg", "Message": _rfc2047(mesaj)})
                    istek = urllib.request.Request("%s/%s" % (NTFY, self.konu), data=veri,
                                                   method="PUT", headers=basliklar)
                else:
                    istek = urllib.request.Request("%s/%s" % (NTFY, self.konu), data=mesaj.encode("utf-8"),
                                                   method="POST", headers=basliklar)
                urllib.request.urlopen(istek, timeout=20).read()
                self.son_durum = "Son bildirim: %s (%s)" % (baslik, datetime.now().strftime("%H:%M"))
                print("Telefona bildirim g\u00f6nderildi: %s" % baslik)
            except Exception as e:
                self.son_durum = "Bildirim g\u00f6nderilemedi: %s" % str(e)[:80]
                print(self.son_durum)
        threading.Thread(target=is_, daemon=True).start()
        return True


# ===========================================================================
#  Bolgeler ve maskeler (normalize koordinatlar; doner kamerada konuma bagli)
# ===========================================================================
def bolge_aktif(bolge, ptz):
    k = bolge.get("ptz")
    return k is None or ptz is None or (ptz.x == k[0] and ptz.y == k[1])


def bolge_icinde(bolge, x, y, w, h):
    noktalar = np.array([[px * w, py * h] for px, py in bolge["nokta"]], np.float32)
    return len(noktalar) >= 3 and cv2.pointPolygonTest(noktalar, (float(x), float(y)), False) >= 0


def bolgeleri_ciz(kare, bolgeler, ptz):
    h, w = kare.shape[:2]
    for b in bolgeler:
        if not bolge_aktif(b, ptz) or len(b["nokta"]) < 3:
            continue
        nk = np.array([[int(px * w), int(py * h)] for px, py in b["nokta"]], np.int32)
        if b["tur"] == "maske":
            kat = kare.copy()
            cv2.fillPoly(kat, [nk], (60, 60, 60))
            cv2.addWeighted(kat, 0.45, kare, 0.55, 0, kare)
        else:
            kat = kare.copy()
            cv2.fillPoly(kat, [nk], (40, 40, 220))
            cv2.addWeighted(kat, 0.12, kare, 0.88, 0, kare)
            cv2.polylines(kare, [nk], True, (60, 60, 230), 2, cv2.LINE_AA)
        x0, y0 = nk.min(axis=0)
        yazi(kare, b.get("ad", ""), int(x0) + 4, int(y0) + 2, 14, (240, 240, 240), True)


# ===========================================================================
#  Olay kaydi: on kayit (3 sn), klip, kucuk resim, veritabani, saklama
# ===========================================================================
class OlayKaydedici:
    FPS = 10

    def __init__(self, klasor_medya, db_yolu, ayarlar):
        import sqlite3
        self.kok = os.path.join(klasor_medya, "olaylar")
        os.makedirs(self.kok, exist_ok=True)
        self.ay = ayarlar
        self.db_yolu = db_yolu
        self.kilit = threading.Lock()
        with self._db() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS olay (id TEXT PRIMARY KEY, bas REAL, bit REAL,
                          kisiler TEXT, taninmayan INTEGER, turler TEXT, bolgeler TEXT, klasor TEXT, video INTEGER)""")
        self.tampon = deque()          # (zaman, kare) son 3 sn, on kayit
        self.son_tampon = 0.0
        self.aktif = None              # su anki olay
        threading.Thread(target=self._temizlik, daemon=True).start()

    def _db(self):
        import sqlite3
        return sqlite3.connect(self.db_yolu, timeout=10)

    def kare(self, temiz, var, simdi):
        """Her karede cagrilir. temiz: cizimsiz kare; var: algilanan bir sey var mi."""
        k = None
        if simdi - self.son_tampon >= 1.0 / self.FPS:
            self.son_tampon = simdi
            k = temiz if temiz.shape[1] <= 960 else cv2.resize(temiz, (960, int(temiz.shape[0] * 960 / temiz.shape[1])))
            self.tampon.append((simdi, k))
            while self.tampon and simdi - self.tampon[0][0] > 3.0:
                self.tampon.popleft()
        if var:
            if self.aktif is None:
                self._baslat(simdi)
            self.aktif["son"] = simdi
        if self.aktif is not None:
            if k is not None and self.aktif["yazici"] is not None:
                self.aktif["yazici"].write(k)
            if simdi - self.aktif.get("son_yazim", 0) > 3:
                self.aktif["son_yazim"] = simdi
                self._yaz(self.aktif)
            if simdi - self.aktif["son"] > 5.0 or simdi - self.aktif["bas"] > 120:
                self._bitir()

    def _baslat(self, simdi):
        kimlik = datetime.now().strftime("%Y%m%d_%H%M%S")
        klasor = os.path.join(self.kok, kimlik[:8], kimlik)
        os.makedirs(klasor, exist_ok=True)
        yazici = None
        if self.tampon:
            h, w = self.tampon[-1][1].shape[:2]
            yazici = cv2.VideoWriter(os.path.join(klasor, "ham.avi"), cv2.VideoWriter_fourcc(*"MJPG"),
                                     self.FPS, (w, h))
            for _, k in self.tampon:   # on kayit: olaydan onceki 3 saniye
                yazici.write(k)
        self.aktif = {"id": kimlik, "bas": simdi - (simdi - self.tampon[0][0] if self.tampon else 0),
                      "son": simdi, "klasor": klasor, "yazici": yazici, "kisiler": set(),
                      "taninmayan": False, "turler": set(), "bolgeler": set(), "kucuk_puan": 0}
        self._yaz(self.aktif)  # devam eden olay da listede gorunsun
        print("Olay ba\u015flad\u0131:", kimlik)

    def _yaz(self, o):
        with self.kilit, self._db() as db:
            db.execute("INSERT OR REPLACE INTO olay VALUES (?,?,?,?,?,?,?,?,?)",
                       (o["id"], o["bas"], o["son"], json.dumps(sorted(o["kisiler"]), ensure_ascii=False),
                        int(o["taninmayan"]), json.dumps(sorted(o["turler"])),
                        json.dumps(sorted(o["bolgeler"]), ensure_ascii=False), o["klasor"], 0))

    def isle(self, kisiler=(), taninmayan=False, turler=(), bolgeler=()):
        if self.aktif:
            self.aktif["kisiler"].update(kisiler)
            self.aktif["taninmayan"] |= bool(taninmayan)
            self.aktif["turler"].update(turler)
            self.aktif["bolgeler"].update(bolgeler)

    def resim(self, kare, kirpik, puan):
        """Olayin kapak resmi: en buyuk/en net yuz veya insan kirpigi."""
        if self.aktif and puan > self.aktif["kucuk_puan"] and kirpik is not None and kirpik.size:
            self.aktif["kucuk_puan"] = puan
            cv2.imwrite(os.path.join(self.aktif["klasor"], "kucuk.jpg"),
                        cv2.resize(kirpik, (240, max(1, int(kirpik.shape[0] * 240 / max(1, kirpik.shape[1]))))))
            k = kare if kare.shape[1] <= 1280 else cv2.resize(kare, (1280, int(kare.shape[0] * 1280 / kare.shape[1])))
            cv2.imwrite(os.path.join(self.aktif["klasor"], "foto.jpg"), k, [cv2.IMWRITE_JPEG_QUALITY, 85])

    def _bitir(self):
        o, self.aktif = self.aktif, None
        if o["yazici"] is not None:
            o["yazici"].release()
        self._yaz(o)
        print("Olay bitti: %s (%d sn)" % (o["id"], o["son"] - o["bas"]))
        threading.Thread(target=self._mp4_yap, args=(o["id"], o["klasor"]), daemon=True).start()

    def _mp4_yap(self, kimlik, klasor):
        """Tarayicida oynasin diye MJPG -> H.264 MP4 (FFmpeg)."""
        ham, mp4 = os.path.join(klasor, "ham.avi"), os.path.join(klasor, "video.mp4")
        ff = ffmpeg_yolu()
        if not ff or not os.path.exists(ham):
            return
        try:
            subprocess.run([ff, "-y", "-v", "error", "-i", ham, "-c:v", "libx264", "-preset", "veryfast",
                            "-crf", "26", "-vf", "format=yuv420p", "-movflags", "+faststart", mp4],
                           timeout=600, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if os.path.exists(mp4) and os.path.getsize(mp4) > 1000:
                os.remove(ham)
                with self.kilit, self._db() as db:
                    db.execute("UPDATE olay SET video=1 WHERE id=?", (kimlik,))
        except Exception as e:
            print("Olay videosu d\u00f6n\u00fc\u015ft\u00fcr\u00fclemedi:", str(e)[:80])

    def liste(self, gun=None, kisi=None, sinir=300):
        sorgu, arg = "SELECT * FROM olay", []
        if gun:
            sorgu += " WHERE id LIKE ?"
            arg.append(gun.replace("-", "") + "%")
        sorgu += " ORDER BY id DESC LIMIT ?"
        arg.append(sinir)
        with self.kilit, self._db() as db:
            satirlar = db.execute(sorgu, arg).fetchall()
        sonuc = []
        for (i, bas, bit, kisiler, tan, turler, bolgeler, klasor, video) in satirlar:
            kl = json.loads(kisiler)
            if kisi == "__taninmayan__" and not tan:
                continue
            if kisi and kisi != "__taninmayan__" and kisi not in kl:
                continue
            sonuc.append({"id": i, "bas": bas, "bit": bit, "kisiler": kl, "taninmayan": bool(tan),
                          "suruyor": bool(self.aktif and self.aktif["id"] == i),
                          "turler": json.loads(turler), "bolgeler": json.loads(bolgeler), "video": bool(video),
                          "kucuk": os.path.exists(os.path.join(klasor, "kucuk.jpg"))})
        return sonuc

    def dosya(self, kimlik, ad):
        if not re.match(r"^\d{8}_\d{6}$", kimlik or "") or ad not in ("kucuk.jpg", "foto.jpg", "video.mp4"):
            return None
        yol = os.path.join(self.kok, kimlik[:8], kimlik, ad)
        return yol if os.path.exists(yol) else None

    def sil(self, kimlik):
        if not re.match(r"^\d{8}_\d{6}$", kimlik or ""):
            return
        import shutil
        shutil.rmtree(os.path.join(self.kok, kimlik[:8], kimlik), ignore_errors=True)
        with self.kilit, self._db() as db:
            db.execute("DELETE FROM olay WHERE id=?", (kimlik,))

    def _temizlik(self):
        """Eski olaylari siler: saklama_gun'den eski ve toplam boyut saklama_gb'yi asarsa en eskiler."""
        import shutil
        while True:
            try:
                sinir = time.time() - float(self.ay["saklama_gun"]) * 86400
                with self.kilit, self._db() as db:
                    eskiler = db.execute("SELECT id, klasor FROM olay WHERE bit < ?", (sinir,)).fetchall()
                for i, kl in eskiler:
                    shutil.rmtree(kl, ignore_errors=True)
                    with self.kilit, self._db() as db:
                        db.execute("DELETE FROM olay WHERE id=?", (i,))
                azami = float(self.ay["saklama_gb"]) * 1e9
                gunler = sorted(d for d in os.listdir(self.kok) if re.match(r"^\d{8}$", d))
                toplam = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(self.kok) for f in fs)
                while toplam > azami and gunler:
                    eski = os.path.join(self.kok, gunler.pop(0))
                    boy = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(eski) for f in fs)
                    shutil.rmtree(eski, ignore_errors=True)
                    with self.kilit, self._db() as db:
                        db.execute("DELETE FROM olay WHERE id LIKE ?", (os.path.basename(eski) + "%",))
                    toplam -= boy
                if eskiler:
                    print("Eski olaylar silindi: %d" % len(eskiler))
            except Exception as e:
                print("Olay temizli\u011fi hatas\u0131:", str(e)[:80])
            time.sleep(3600)


# --- Elle kontrol paneli ----------------------------------------------------
# Ok yonu (kameranin bakacagi yon) -> goruntunun kayacagi yon (kalibrasyon etkisi)
OK_ETKI = {"sol": "sag", "sag": "sol", "yukari": "asagi", "asagi": "yukari"}
# Windows'ta cv2.waitKeyEx ok tus kodlari + WASD
SINIR_TUS = {ord("1"): "sol", ord("2"): "sag", ord("3"): "ust", ord("4"): "alt", ord("0"): "sil"}
TUS_YON = {2424832: "sol", 2555904: "sag", 2490368: "yukari", 2621440: "asagi",
           ord("a"): "sol", ord("d"): "sag", ord("w"): "yukari", ord("s"): "asagi",
           ord("A"): "sol", ord("D"): "sag", ord("W"): "yukari", ord("S"): "asagi"}


def tarama_seviyeleri(ptz):
    """Taranacak dikey seviyeler (adim): once orta, sonra iki uc; alan sinirlari icinde."""
    alt, ust = ptz.sinir["alt"], ptz.sinir["ust"]
    if alt is not None and ust is not None:
        orta = int(round((alt + ust) / 2.0))
        sev = [orta, ust, alt]
    else:
        sev = [0, 2, -2]
        if ust is not None:
            sev = [min(v, ust) for v in sev]
        if alt is not None:
            sev = [max(v, alt) for v in sev]
    sonuc = []
    for v in sev:
        if v not in sonuc:
            sonuc.append(v)
    return sonuc


def alan_metni(ptz, derece):
    s = ptz.sinir
    d = lambda v: "%+d (%+.0f\u00b0)" % (v, v * derece)
    if s["sol"] is None and s["sag"] is None:
        yatay = "Yatay alan: s\u0131n\u0131rs\u0131z"
    else:
        yatay = "Yatay alan: %s .. %s" % (d(s["sol"]) if s["sol"] is not None else "-",
                                           d(s["sag"]) if s["sag"] is not None else "-")
    if s["ust"] is None and s["alt"] is None:
        dikey = "Dikey alan: s\u0131n\u0131rs\u0131z"
    else:
        dikey = "Dikey alan: %s .. %s" % (d(s["alt"]) if s["alt"] is not None else "-",
                                     d(s["ust"]) if s["ust"] is not None else "-")
    return "%s  |  %s  |  \u015eu anki konum: %s, %s" % (yatay, dikey, d(ptz.x), d(ptz.y))


def alan_ciz(kare, ptz):
    """Alt ortada konum cubugu: yesil = izinli alan, beyaz nokta = kameranin baktigi yer."""
    h, w = kare.shape[:2]
    s = ptz.sinir
    uclar = [v for v in (s["sol"], s["sag"], ptz.x) if v is not None]
    lo, hi = min(uclar) - 3, max(uclar) + 3
    bx0, bx1, by = w // 2 - 150, w // 2 + 150, h - 22
    px = lambda v: int(bx0 + (v - lo) / float(hi - lo) * (bx1 - bx0))
    cv2.line(kare, (bx0, by), (bx1, by), (90, 90, 90), 4, cv2.LINE_AA)
    a = px(s["sol"]) if s["sol"] is not None else bx0
    b = px(s["sag"]) if s["sag"] is not None else bx1
    cv2.line(kare, (a, by), (b, by), YESIL, 4, cv2.LINE_AA)
    for v in (s["sol"], s["sag"]):
        if v is not None:
            cv2.line(kare, (px(v), by - 9), (px(v), by + 9), (60, 60, 230), 3, cv2.LINE_AA)
    cv2.circle(kare, (px(ptz.x), by), 7, (255, 255, 255), -1, cv2.LINE_AA)
    cv2.circle(kare, (px(ptz.x), by), 7, KOYU, 1, cv2.LINE_AA)


def panel_dugmeleri(w, h):
    """Sol alt koseye ok tuslari ve mod dugmesi (x0, y0, x1, y1)."""
    b, g = 46, 6
    cx, cy = 16 + b + g, h - 40 - 2 * (b + g)
    return {
        "yukari": (cx, cy - b - g, cx + b, cy - g),
        "sol": (cx - b - g, cy, cx - g, cy + b),
        "sag": (cx + b + g, cy, cx + 2 * b + g, cy + b),
        "asagi": (cx, cy + b + g, cx + b, cy + 2 * b + g),
        "mod": (cx + 2 * b + 3 * g + 8, cy, cx + 2 * b + 3 * g + 150, cy + b),
    }


def panel_ciz(kare, dugmeler, mod, basili):
    for ad, (x0, y0, x1, y1) in dugmeler.items():
        bolge = kare[y0:y1, x0:x1]
        if ad == "mod":
            renk = YESIL if mod == "OTO" else SARI
            cv2.addWeighted(bolge, 0.25, np.full_like(bolge, renk), 0.75, 0, bolge)
            metin = "OTOMAT\u0130K" if mod == "OTO" else "SAB\u0130T"
            tw, th = yazi_boyut(metin, 19, True)
            yazi(kare, metin, x0 + (x1 - x0 - tw) // 2, y0 + (y1 - y0 - th) // 2 - 2, 19, KOYU, True)
            continue
        dolgu = (255, 255, 255) if basili == ad else (60, 60, 60)
        cv2.addWeighted(bolge, 0.35, np.full_like(bolge, dolgu), 0.65, 0, bolge)
        cv2.rectangle(kare, (x0, y0), (x1, y1), (200, 200, 200), 1, cv2.LINE_AA)
        mx, my, r = (x0 + x1) // 2, (y0 + y1) // 2, (x1 - x0) // 4
        uc = {"yukari": [(mx, my - r), (mx - r, my + r // 2), (mx + r, my + r // 2)],
              "asagi": [(mx, my + r), (mx - r, my - r // 2), (mx + r, my - r // 2)],
              "sol": [(mx - r, my), (mx + r // 2, my - r), (mx + r // 2, my + r)],
              "sag": [(mx + r, my), (mx - r // 2, my - r), (mx - r // 2, my + r)]}[ad]
        cv2.fillPoly(kare, [np.array(uc, np.int32)], KOYU if basili == ad else (235, 235, 235))
    x0, _, _, y1 = dugmeler["sol"]
    yazi(kare, "Oklar / WASD: d\u00f6nd\u00fcr    P: otomatik/sabit    T: ses testi    L: \u0131\u015f\u0131k testi    U: QR kod    Q: \u00e7\u0131k\u0131\u015f",
         x0, dugmeler["asagi"][3] + 6, 14, (235, 235, 235))
    yazi(kare, "S\u0131n\u0131rlar: 1 sol   2 sa\u011f   3 \u00fcst   4 alt   0 sil",
         x0, dugmeler["yukari"][1] - 24, 14, (235, 235, 235))


def main():
    p = argparse.ArgumentParser(description="IP kamera hareket + yuz takibi (doner kamera destekli)")
    p.add_argument("--kaynak", required=True,
                   help="go2rtc, RTSP adresi, video dosyasi veya kamera no (0)")
    p.add_argument("--min-alan", type=int, default=800, help="Bu alandan kucuk hareketleri yok say (piksel)")
    p.add_argument("--genislik", type=int, default=1280, help="Isleme genisligi (kucuk = hizli)")
    p.add_argument("--maske-saat", action="store_true",
                   help="Sol ustteki tarih/saat yazisini hareket sayma (Xiaomi zaman damgasi)")
    p.add_argument("--yuz-esik", type=float, default=0.75, help="Yuz guven esigi 0-1 (yuksek = daha secici)")
    p.add_argument("--hareket-goster", action="store_true", help="Hareket bolgesini ince cizgiyle goster")
    p.add_argument("--kaydet", metavar="KLASOR", help="Hareket/yuz olunca klasore video kaydet")
    p.add_argument("--yuz-klasor", metavar="KLASOR", help="Yakalanan yuzlerin fotograflarini kaydet")
    p.add_argument("--foto-ara", type=float, default=30,
                   help="Iki yuz fotografi arasinda en az kac saniye olsun (ayni kisiyi tekrar tekrar kaydetmesin)")
    p.add_argument("--ptz", choices=["otomatik", "kapali"], default="otomatik",
                   help="Doner kamerada tarama + yuzu takip icin kamerayi dondur")
    p.add_argument("--ptz-kalibre", action="store_true", help="Motor kalibrasyonunu yeniden yap")
    p.add_argument("--ptz-hiz", type=int, choices=[1, 2, 3], default=3,
                   help="Motor hizi: 1 yavas/sakin, 2 normal, 3 hizli (varsayilan)")
    p.add_argument("--simulasyon", metavar="RESIM", help="Test: panorama resmiyle sanal doner kamera")
    p.add_argument("--sim-gecikme", type=float, default=0.0, help="Test: sanal kamerada goruntu gecikmesi (sn)")
    p.add_argument("--goruntusuz", action="store_true", help="Pencere acma (sunucu/headless)")
    p.add_argument("--tanima", choices=["acik", "kapali"], default="acik", help="Kisileri isimleriyle tani")
    p.add_argument("--selam", choices=["acik", "kapali"], default="acik", help="Taninan kisiyi sesli selamla")
    p.add_argument("--hoparlor", choices=["kamera", "bilgisayar", "ikisi"], default="kamera",
                   help="Selam nereden duyulsun: kameranin hoparloru (varsayilan), bilgisayar veya ikisi")
    p.add_argument("--hoparlor-uyarlama", choices=["acik", "kapali"], default="kapali",
                   help="16 kHz Xiaomi kameralarda cizirtiyi onleyen 8 kHz uyarlamasi")
    p.add_argument("--ses", choices=["emel", "ahmet"], default="emel",
                   help="Selam sesi: emel (kadin) veya ahmet (erkek) - Microsoft dogal Turkce ses")
    p.add_argument("--selam-ara", type=float, default=600, help="Ayni kisiyi tekrar selamlamadan once beklenecek sn")
    p.add_argument("--uzak", choices=["acik", "kapali"], default="acik",
                   help="Internetten erisim (Cloudflare tuneli + sabit yer imi sayfasi)")
    p.add_argument("--web-port", type=int, default=18765, help="Telefondan izleme/kontrol sayfasi portu (0 = kapali)")
    p.add_argument("--max-kare", type=int, default=0, help="Test icin: bu kadar kareden sonra dur")
    a = p.parse_args()
    print("=" * 40)
    print(" Kamera Takip %s" % SURUM)
    print("=" * 40)

    betik_klasor = os.path.dirname(os.path.abspath(__file__))
    dedektor = YuzDedektor(betik_klasor, a.yuz_esik)
    SES_AYAR.update(klasor=betik_klasor, ses=a.ses, hoparlor=a.hoparlor, uyarlama=a.hoparlor_uyarlama == "acik")

    tani = {"t": None}
    if a.tanima == "acik":
        def tanima_yukle():
            deneme = 0
            while True:
                deneme += 1
                try:
                    tani["t"] = YuzTaniyici(betik_klasor, YuzDedektor(betik_klasor, 0.6))
                    kl = tani["t"].liste()
                    TANIMA_DURUM["metin"] = "hazir"
                    print("Y\u00fcz tan\u0131ma haz\u0131r. Kay\u0131tl\u0131 ki\u015filer: %s" % (", ".join(k["ad"] for k in kl) or "yok"))
                    return
                except Exception as e:
                    TANIMA_DURUM["metin"] = "Y\u00fcz tan\u0131ma hatas\u0131: %s. 60 saniye sonra yeniden denenecek (%d. deneme)" % (
                        str(e)[:120], deneme)
                    print(TANIMA_DURUM["metin"])
                    time.sleep(60)
        threading.Thread(target=tanima_yukle, daemon=True).start()

    ayarlar = Ayarlar(betik_klasor)
    try:
        obje = ObjeDedektor(betik_klasor)
        print("\u0130nsan, hayvan ve ara\u00e7 alg\u0131lama haz\u0131r.")
    except Exception as e:
        obje = None
        print("\u0130nsan alg\u0131lama kullan\u0131lam\u0131yor (%s); sadece y\u00fcz alg\u0131lama \u00e7al\u0131\u015facak." % str(e)[:80])
    bildirimci = Bildirimci(uzak_konu_al(betik_klasor), ayarlar)
    olay = OlayKaydedici(a.kaydet or os.path.join(betik_klasor, "kayitlar"),
                         os.path.join(betik_klasor, "olaylar.db"), ayarlar)
    web = uzak = None
    qr_goster = False
    if a.web_port:
        try:
            web = WebSunucu(a.web_port, web_pin_al(betik_klasor))
            web.olay, web.ayarlar, web.konu = olay, ayarlar, bildirimci.konu
            SES_AYAR["web"] = web
            print("-" * 60)
            print(" Telefondan ya da ba\u015fka bir cihazdan izleyin ve y\u00f6netin:")
            print("   http://localhost:%d   (bu bilgisayardan)" % web.port)
            for adr in yerel_adresler():
                ek = "   (Tailscale \u2013 d\u0131\u015far\u0131dan)" if adr.startswith("100.") else "   (ev a\u011f\u0131)"
                print("   http://%s:%d%s" % (adr, web.port, ek))
            print(" PIN: %s" % web.pin)
            print("-" * 60)
            if a.uzak == "acik":
                uzak = UzakErisim(betik_klasor, web.port)
                print(" \u0130nternetten eri\u015fim haz\u0131rlan\u0131yor. Sabit yer imi: %s" % uzak.sabit)
                print(" Kamera penceresinde U tu\u015fu: telefonla okutmak i\u00e7in QR kod")
        except OSError as e:
            print("Web sayfas\u0131 ba\u015flat\u0131lamad\u0131: %s" % e)

    go2rtc_surec = None
    if a.kaynak == "go2rtc":
        a.kaynak, go2rtc_surec = go2rtc_hazirla(os.path.join(betik_klasor, "go2rtc"))
        SES_AYAR["akis"] = urllib.parse.unquote(a.kaynak.rsplit("/", 1)[-1])
        if a.hoparlor != "bilgisayar":
            ses_kanali_raporu()
        print("Kameraya ba\u011flan\u0131l\u0131yor:", a.kaynak)

    if a.simulasyon:
        okuyucu = SimKamera(a.simulasyon, gecikme=a.sim_gecikme)
    elif a.kaynak.startswith(("rtsp://", "http://", "https://")) or a.kaynak.isdigit():
        okuyucu = CanliOkuyucu(a.kaynak)
    else:
        okuyucu = DosyaOkuyucu(a.kaynak)

    def kucult(k):
        h0, w0 = k.shape[:2]
        return cv2.resize(k, (a.genislik, int(h0 * a.genislik / w0))) if w0 > a.genislik else k

    def son_kare():
        if isinstance(okuyucu, CanliOkuyucu):
            time.sleep(0.15)  # tampondaki eski kareler gecsin
            return kucult(okuyucu.son())
        ok, k = okuyucu.read()
        return kucult(k)

    ptz = None
    ptz_durum = {"ptz": None, "hazirlaniyor": False}
    if a.ptz == "otomatik":
        if a.simulasyon:
            esl = ptz_kalibre(okuyucu.gonder, okuyucu.adaylar(), son_kare, bekle=0.6)
            ptz_durum["ptz"] = PTZ(okuyucu.gonder, esl) if esl else None
        elif a.kaynak.startswith("rtsp://127.0.0.1:8554/"):
            # Arka planda hazirla: bu sirada goruntu penceresi acik kalir
            def hazirla():
                ptz_durum["ptz"] = ptz_hazirla(betik_klasor, son_kare, a.ptz_kalibre)
                ptz_durum["hazirlaniyor"] = False
            ptz_durum["hazirlaniyor"] = True
            threading.Thread(target=hazirla, daemon=True).start()

    arka_plan = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=32, detectShadows=True)
    cekirdek = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    yuz_takip = MerkezTakipci(max_kayip=30 if ptz else 12, max_mesafe=320 if ptz else 160, iz_uzunlugu=25)
    son_foto = 0.0
    yumusak = {}          # yuz id -> titremesiz kutu
    gorulme = {}          # yuz id -> kac karedir art arda goruluyor
    kaydedilen = set()    # fotografi alinan yuz id'leri
    yuz_bekleme = 0       # hareket bitse de bir sure daha yuz ara
    yazici, son_olay, kare_no = None, 0.0, 0
    fps_t, fps = time.time(), 0.0
    son_yuz_zamani = 0.0
    son_kisi_zamani = 0.0
    kisi_takip = MerkezTakipci(max_kayip=8, max_mesafe=260, iz_uzunlugu=10)
    son_objeler, obje_zamani, kisi_bekleme = [], 0.0, 0
    olay_bildirim = {"id": None, "tanimsiz": False, "yuzsuz": False, "bilinen": set(), "kisi_ilk": 0.0}
    tarama_yonu = random.choice(["sol", "sag"])
    HIZ = {1: dict(takip_aralik=0.9, min_aralik=0.45, tarama_aralik=0.5, tarama_paralel=1),
           2: dict(takip_aralik=0.7, min_aralik=0.3, tarama_aralik=0.3, tarama_paralel=2),
           3: dict(takip_aralik=0.55, min_aralik=0.2, tarama_aralik=0.12, tarama_paralel=3)}[a.ptz_hiz]
    seviye_no = 0
    tarama_ref, tarama_ref_zaman, tarama_kontrol, seviye_zamani = None, 0.0, 0.0, time.time()
    tur_suresi = 20.0         # PTZ hazir olunca adim buyuklugunden hesaplanir
    derece_adim = 10.0
    son_alan_kayit = 0.0
    if a.yuz_klasor:
        os.makedirs(a.yuz_klasor, exist_ok=True)

    # Tanima durumu
    tanima = {}            # yuz id -> {"son", "oylar", "ad"}
    son_selam = {}         # ad -> zaman
    ogren = None           # {"ad", "bitis", "ornekler", "son"}
    mesaj = {"metin": "", "zaman": 0.0}
    selam_olay = {"no": 0, "metin": ""}

    def mesaj_ver(m):
        mesaj["metin"], mesaj["zaman"] = m, time.time()
        print(m)

    def maskede(kutu, w, h):
        """Kutunun merkezi bir maske bolgesinde mi (orada algilananlar yok sayilir)."""
        x, y, bw, bh = kutu[:4]
        return any(b["tur"] == "maske" and bolge_aktif(b, ptz) and bolge_icinde(b, x + bw / 2, y + bh / 2, w, h)
                   for b in ayarlar["bolgeler"])

    # Elle kontrol durumu
    el = {"mod": "OTO", "yon": None, "basla": 0.0, "bitis": 0.0, "kaynak": None, "tekrar": False,
          "dugmeler": {}}
    pencere = "Kamera Takip %s" % SURUM  # Windows pencere basligi Turkce harf gosteremez

    def el_basla(yon, kaynak):
        """Ok basildi: SABIT moda gec, hemen bir adim at; basili tutulursa surekli don."""
        if not ptz:
            return
        el["mod"] = "SABIT"
        simdi = time.time()
        if el["yon"] != yon:
            # Yeni basis: tek adim. Tus basili tutulursa Windows tekrar gonderir -> surekli
            ptz.dur()
            ptz.hareket(OK_ETKI[yon], 1, serbest=True)
            el["basla"], el["tekrar"] = simdi, False
            el["bitis"] = simdi + (0.6 if kaynak in ("tus", "web") else 1e9)
        elif kaynak in ("tus", "web"):
            el["tekrar"] = True               # tus/dugme basili tutuluyor
            el["bitis"] = simdi + (0.15 if kaynak == "tus" else 0.45)  # tekrar gelmezse dur
        el["yon"], el["kaynak"] = yon, kaynak

    def el_birak():
        el["yon"] = None
        if ptz:
            ptz.dur()

    def fare(olay, x, y, bayrak, _):
        if olay == cv2.EVENT_LBUTTONDOWN:
            for ad, (x0, y0, x1, y1) in el["dugmeler"].items():
                if x0 <= x <= x1 and y0 <= y <= y1:
                    if ad == "mod":
                        el["mod"] = "SABIT" if el["mod"] == "OTO" else "OTO"
                        el_birak()
                    else:
                        el_basla(ad, "fare")
        elif olay == cv2.EVENT_LBUTTONUP and el["kaynak"] == "fare":
            el_birak()

    if not a.goruntusuz:
        cv2.namedWindow(pencere, cv2.WINDOW_AUTOSIZE)
        cv2.setMouseCallback(pencere, fare)

    while True:
        ok, kare = okuyucu.read()
        if not ok:
            break
        kare_no += 1
        kare = kucult(kare)
        while web and not web.komutlar.empty():
            k = web.komutlar.get()
            islem = k.get("islem")
            if islem == "bas" and k.get("yon") in OK_ETKI:
                el_basla(k["yon"], "web")
            elif islem == "birak" and el["kaynak"] == "web":
                el_birak()
            elif islem == "mod" and ptz:
                el["mod"] = "SABIT" if el["mod"] == "OTO" else "OTO"
                el_birak()
            elif islem == "ogren":
                isim = " ".join(str(k.get("ad", "")).split())[:30]
                if not tani["t"]:
                    mesaj_ver("Y\u00fcz tan\u0131ma hen\u00fcz haz\u0131r de\u011fil, l\u00fctfen biraz bekleyin.")
                elif not isim:
                    mesaj_ver("\u00d6nce bir isim yaz\u0131n.")
                else:
                    ogren = {"ad": isim, "bitis": time.time() + 4.0, "ornekler": [], "son": 0.0}
                    mesaj_ver("%s \u00f6\u011freniliyor: kameraya bak\u0131n, ba\u015f\u0131n\u0131z\u0131 hafif\u00e7e sa\u011fa sola \u00e7evirin..." % isim)
            elif islem == "ayar_bildirim":
                b = ayarlar["bildirim"]
                if k.get("mod") in ("kapali", "her_zaman", "zamanli"):
                    b["mod"] = k["mod"]
                for alan in ("bas", "bit"):
                    if str(k.get(alan, "")).isdigit() and 0 <= int(k[alan]) <= 23:
                        b[alan] = int(k[alan])
                if "bilinen" in k:
                    b["bilinen"] = bool(k["bilinen"])
                ayarlar.kaydet()
                mesaj_ver("Bildirim ayarlar\u0131 kaydedildi.")
            elif islem == "bildirim_dene":
                bildirimci.tiklama = uzak.url if uzak and uzak.url else None
                bildirimci.gonder("Deneme bildirimi", "Kamera Takip bildirimleri \u00e7al\u0131\u015f\u0131yor.", temiz, zorla=True)
                mesaj_ver("Deneme bildirimi g\u00f6nderildi. Telefonda ntfy uygulamas\u0131nda g\u00f6r\u00fcnmeli.")
            elif islem == "ayar_nesne":
                for t in ("hayvan", "arac"):
                    if t in k:
                        ayarlar["nesneler"][t] = bool(k[t])
                ayarlar.kaydet()
            elif islem == "ayar_saklama":
                try:
                    ayarlar.d["saklama_gun"] = max(1, min(365, int(k.get("gun", ayarlar["saklama_gun"]))))
                    ayarlar.d["saklama_gb"] = max(1, min(2000, float(k.get("gb", ayarlar["saklama_gb"]))))
                    ayarlar.kaydet()
                    mesaj_ver("Saklama ayar\u0131 kaydedildi.")
                except (TypeError, ValueError):
                    pass
            elif islem == "bolge_ekle":
                nok = [[min(1.0, max(0.0, float(px))), min(1.0, max(0.0, float(py)))]
                       for px, py in (k.get("nokta") or [])][:30]
                if len(nok) >= 3:
                    ayarlar["bolgeler"].append({
                        "id": "%08x" % random.getrandbits(32), "tur": "maske" if k.get("tur") == "maske" else "alarm",
                        "ad": (" ".join(str(k.get("ad", "")).split())[:30] or "B\u00f6lge"), "nokta": nok,
                        "ptz": [ptz.x, ptz.y] if ptz else None})
                    ayarlar.kaydet()
                    mesaj_ver("B\u00f6lge eklendi.")
            elif islem == "bolge_sil":
                ayarlar.d["bolgeler"] = [b for b in ayarlar["bolgeler"] if b.get("id") != k.get("id")]
                ayarlar.kaydet()
            elif islem == "olay_sil":
                olay.sil(str(k.get("id", "")))
            elif islem == "led_dene":
                if ptz and ptz.led:
                    ptz.led.test_bitis = time.time() + 5
                    mesaj_ver("Mavi \u0131\u015f\u0131k 5 saniye yan\u0131p s\u00f6necek.")
                else:
                    mesaj_ver("Mavi \u0131\u015f\u0131k kontrol\u00fc bu kamerada kullan\u0131lam\u0131yor.")
            elif islem == "uyarlama":
                SES_AYAR["uyarlama"] = not SES_AYAR.get("uyarlama", False)
                mesaj_ver("Hoparl\u00f6r uyarlamas\u0131 %s. Test sesi \u00e7al\u0131n\u0131yor..." %
                          ("A\u00c7IK" if SES_AYAR["uyarlama"] else "KAPALI"))
                sesli_soyle("Ses denemesi. Bir, iki, \u00fc\u00e7. Beni duyuyor musunuz?")
            elif islem == "ses_dene":
                sesli_soyle("Ses denemesi. Bir, iki, \u00fc\u00e7. Beni duyuyor musunuz?")
                mesaj_ver("Test sesi g\u00f6nderildi. Kameradan duyulmazsa a\u015fa\u011f\u0131daki ses durumuna bak\u0131n.")
            elif islem == "kisi_sil" and tani["t"]:
                tani["t"].sil(str(k.get("ad", "")))
                tanima.clear()
                mesaj_ver("%s silindi." % k.get("ad", ""))
            elif islem == "sinir" and ptz and k.get("hangi") in ("sol", "sag", "ust", "alt", "sil"):
                ptz.sinir_ayarla(k["hangi"])
                print("\u00c7al\u0131\u015fma alan\u0131:", alan_metni(ptz, derece_adim))
        h, w = kare.shape[:2]
        temiz = kare.copy()  # fotograf icin cizimsiz kopya
        simdi = time.time()

        if ptz is None and ptz_durum["ptz"] is not None:
            ptz = ptz_durum["ptz"]
            yuz_takip.max_mesafe, yuz_takip.max_kayip = 420, 30
            # Formul: bir adim kac derece? (balik gozu yatay gorus ~100 derece)
            # tam tur adim = 360 / derece_adim ; tur suresi = adim * aralik / paralel
            derece_adim = max(1.0, ptz.adim("sol" if ptz.var("sol") else "sag") / w * 100.0)
            tur_adim = 360.0 / derece_adim
            tur_suresi = max(3.0, tur_adim * HIZ["tarama_aralik"] / HIZ["tarama_paralel"])
            tur_suresi = tur_suresi * 1.5 + ptz.gecikme  # pay: gecikme ve yavas komutlar
            print("D\u00f6ner kamera modu: kamera tarama yapacak, y\u00fcz g\u00f6r\u00fcnce takip edecek."
                  " (g\u00f6r\u00fcnt\u00fc gecikmesi yakla\u015f\u0131k %.1f sn)" % ptz.gecikme)
            print("Tarama: bir ad\u0131m yakla\u015f\u0131k %.0f\u00b0, tam tur yakla\u015f\u0131k %.0f ad\u0131m, tahmini s\u00fcre %.1f sn"
                  % (derece_adim, tur_adim, tur_suresi))
            print("\u00c7al\u0131\u015fma alan\u0131:", alan_metni(ptz, derece_adim))
        if ptz:
            # Doner kamera: hareket algilama yok (kamera donerken her sey hareketli
            # gorunur). Her karede yuz aranir.
            hareket, hareketli = False, []
            yuzler = [y for y in dedektor.bul(kare) if not maskede(y, w, h)]
            yuz_takip.guncelle(yuzler)
        else:
            # 1) Hareket var mi? (kucuk kopyada, hizli)
            kucuk = cv2.resize(kare, (320, int(h * 320 / w)))
            oran = w / 320.0
            maske = arka_plan.apply(cv2.GaussianBlur(kucuk, (5, 5), 0))
            _, maske = cv2.threshold(maske, 200, 255, cv2.THRESH_BINARY)
            maske = cv2.morphologyEx(maske, cv2.MORPH_OPEN, cekirdek)
            maske = cv2.dilate(maske, cekirdek, iterations=2)
            if a.maske_saat:
                maske[: int(maske.shape[0] * 0.07), : int(maske.shape[1] * 0.35)] = 0
            for b in ayarlar["bolgeler"]:  # maske bolgelerindeki hareketi yok say (TV, pencere...)
                if b["tur"] == "maske" and bolge_aktif(b, ptz) and len(b["nokta"]) >= 3:
                    cv2.fillPoly(maske, [np.array([[int(px * maske.shape[1]), int(py * maske.shape[0])]
                                                   for px, py in b["nokta"]], np.int32)], 0)
            konturlar, _ = cv2.findContours(maske, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            hareketli = [cv2.boundingRect(c) for c in konturlar
                         if cv2.contourArea(c) * oran * oran >= a.min_alan]
            hareket = kare_no > 30 and bool(hareketli)

            # 2) Hareket varsa veya yuz takip ediliyorsa yuz ara
            if hareket:
                yuz_bekleme = 45  # ~1.5 sn
            elif yuz_bekleme > 0:
                yuz_bekleme -= 1
            takipte = any(k == 0 for k in yuz_takip.kayip.values())
            kisi_var = bool([o for o in son_objeler if o[5] == "insan"]) and simdi - obje_zamani < 1.0
            yuzler = dedektor.bul(kare) if (hareket or takipte or yuz_bekleme > 0 or ogren or kisi_var) else []
            yuzler = [y for y in yuzler if not maskede(y, w, h)]
            yuz_takip.guncelle(yuzler)

        ham_harita = dict(zip(yuzler, dedektor.ham)) if yuzler else {}
        taniyici = tani["t"]

        # 2b) Insan / hayvan / arac (NanoDet). Arkasi donuk ya da uzaktaki kisiyi de yakalar.
        if obje and kare_no % 3 == 0 and (ptz or hareket or yuz_bekleme > 0 or kisi_bekleme > 0
                                          or kare_no % 15 == 0 or any(v == 0 for v in kisi_takip.kayip.values())):
            turler = ["insan"] + [t for t in ("hayvan", "arac") if ayarlar["nesneler"].get(t)]
            son_objeler = [o for o in obje.bul(kare, turler) if not maskede(o[:4], w, h)]
            obje_zamani = simdi
            kisi_takip.guncelle([tuple(o[:4]) for o in son_objeler if o[5] == "insan"])
            kisi_bekleme = 30 if son_objeler else max(0, kisi_bekleme - 3)
        elif simdi - obje_zamani > 1.0:
            son_objeler = []
        kisiler = [o for o in son_objeler if o[5] == "insan"]

        # 3) Cizim
        if a.hareket_goster and hareket and not ptz:
            xs = [x for x, y, bw, bh in hareketli] + [x + bw for x, y, bw, bh in hareketli]
            ys = [y for x, y, bw, bh in hareketli] + [y + bh for x, y, bw, bh in hareketli]
            cv2.rectangle(kare, (int(min(xs) * oran), int(min(ys) * oran)),
                          (int(max(xs) * oran), int(max(ys) * oran)), GRI, 1, cv2.LINE_AA)

        aktif = []
        for i in list(yuz_takip.nesneler):
            if i not in yuz_takip.kayip:
                continue
            if yuz_takip.kayip[i] > 0:
                gorulme[i] = 0
                continue
            gorulme[i] = gorulme.get(i, 0) + 1
            x, y, bw, bh = yuz_takip.kutular[i]
            if i in yumusak:  # titremeyi azalt
                ox, oy, ow, oh = yumusak[i]
                x, y = int(0.5 * ox + 0.5 * x), int(0.5 * oy + 0.5 * y)
                bw, bh = int(0.5 * ow + 0.5 * bw), int(0.5 * oh + 0.5 * bh)
            yumusak[i] = (x, y, bw, bh)
            aktif.append((i, (x, y, bw, bh)))

            # Kim? (her yuz icin ~0.4 sn'de bir; son 7 tahminin cogunlugu)
            td = tanima.setdefault(i, {"son": 0.0, "oylar": deque(maxlen=7), "ad": None})
            ham = ham_harita.get(yuz_takip.kutular[i])
            if taniyici and ham is not None and simdi - td["son"] > 0.4 and not ogren:
                td["son"] = simdi
                kim, skor = taniyici.tani(taniyici.ozellik(temiz, ham))
                td["oylar"].append(kim or "?")
                sayim = {}
                for o in td["oylar"]:
                    sayim[o] = sayim.get(o, 0) + 1
                en = max((k for k in sayim if k != "?"), key=lambda k: sayim[k], default=None)
                onceki = td["ad"]
                if en and sayim[en] >= 2 and sayim[en] * 2 >= len(td["oylar"]) - sayim.get("?", 0):
                    td["ad"] = en
                elif sayim.get("?", 0) >= 4 and (not en or sayim[en] < 2):
                    td["ad"] = "?"
                if td["ad"] and td["ad"] != "?" and td["ad"] != onceki:
                    print("Tan\u0131nd\u0131: %s (benzerlik %.2f)" % (td["ad"], skor))
                    if a.selam == "acik" and simdi - son_selam.get(td["ad"], 0) > a.selam_ara:
                        son_selam[td["ad"]] = simdi
                        metin = selam_metni(td["ad"])
                        sesli_soyle(metin)
                        selam_olay["no"] += 1
                        selam_olay["metin"] = metin
            if td["ad"] and td["ad"] != "?":
                etiket, renk = td["ad"], YESIL
            elif td["ad"] == "?":
                etiket, renk = "Tan\u0131nm\u0131yor", TURUNCU
            else:
                etiket, renk = f"Y\u00fcz {i}", (170, 210, 170)

            iz = list(yuz_takip.izler[i])
            for k in range(1, len(iz)):
                cv2.line(kare, iz[k - 1], iz[k], renk, 1, cv2.LINE_AA)
            kose_cerceve(kare, x, y, bw, bh, renk, 2)
            yazi_kutusu(kare, etiket, x, max(22, y - 6), renk)

            # Yeni yuz 5 kare boyunca saglam gorulduyse fotografini al
            if (a.yuz_klasor and i not in kaydedilen and gorulme[i] >= 8
                    and simdi - son_foto >= a.foto_ara):
                kaydedilen.add(i)
                son_foto = simdi
                kim = ascii_ad(td["ad"]) if td["ad"] and td["ad"] != "?" else str(i)
                ad = os.path.join(a.yuz_klasor, datetime.now().strftime("yuz_%Y%m%d_%H%M%S_") + kim + ".jpg")
                cv2.imwrite(ad, yuz_kirp(temiz, yuz_takip.kutular[i]))
                print("Y\u00fcz foto\u011fraf\u0131 kaydedildi:", ad)
        for i in list(tanima):
            if i not in yuz_takip.nesneler:
                tanima.pop(i, None)
        for i in list(yumusak):
            if i not in yuz_takip.nesneler:
                yumusak.pop(i, None)
                gorulme.pop(i, None)

        # Yuzleri insan kutularina bagla, insanlari/hayvanlari ciz
        yuz_adlari = {}
        for i, (fx, fy, fw, fh) in aktif:
            ad_i = tanima.get(i, {}).get("ad")
            for k, o in enumerate(kisiler):
                if o[0] <= fx + fw / 2 <= o[0] + o[2] and o[1] <= fy + fh / 2 <= o[1] + o[3]:
                    yuz_adlari[k] = ad_i
        for k, o in enumerate(son_objeler):
            x, y, bw, bh, guven, tur, ad_o = o
            if tur == "insan":
                ad_k = yuz_adlari.get(k)
                etiket = ad_k if ad_k and ad_k != "?" else ("Tan\u0131nm\u0131yor" if ad_k == "?" else "\u0130nsan")
                renk = YESIL if ad_k and ad_k != "?" else (TURUNCU if ad_k == "?" else (235, 200, 120))
            else:
                etiket, renk = ad_o, ((200, 120, 255) if tur == "hayvan" else (255, 160, 60))
            cv2.rectangle(kare, (x, y), (x + bw, y + bh), renk, 1, cv2.LINE_AA)
            if not (tur == "insan" and k in yuz_adlari):  # yuz etiketi zaten var
                yazi_kutusu(kare, etiket, x, max(22, y - 4), renk, 0.45, 1)

        # Bolgeler: alarm bolgesi varsa sadece oraya giren insanlar "ilgili" sayilir
        alarm_bolgeleri = [b for b in ayarlar["bolgeler"] if b["tur"] == "alarm" and bolge_aktif(b, ptz)]
        bolgeleri_ciz(kare, ayarlar["bolgeler"], ptz)
        girilen = set()

        def ilgili(x, y, bw, bh):
            if not alarm_bolgeleri:
                return True
            sonuc = False
            for b in alarm_bolgeleri:
                if bolge_icinde(b, x + bw / 2, y + bh * 0.9, w, h) or bolge_icinde(b, x + bw / 2, y + bh / 2, w, h):
                    girilen.add(b.get("ad", "b\u00f6lge"))
                    sonuc = True
            return sonuc
        ilgili_kisiler = [o for o in kisiler if ilgili(*o[:4])]
        ilgili_yuzler = [(i, k) for i, k in aktif if ilgili(*k)]

        # Olay kaydi + telefona bildirim
        bilinenler = {tanima[i]["ad"] for i, _ in aktif if tanima.get(i, {}).get("ad") not in (None, "?")}
        tanimsiz_yuz = [(i, k) for i, k in ilgili_yuzler if tanima.get(i, {}).get("ad") == "?"]
        olay_var = bool(ilgili_kisiler or ilgili_yuzler or [o for o in son_objeler if o[5] != "insan"])
        olay.kare(temiz, olay_var, simdi)
        if olay.aktif:
            olay.isle(kisiler=bilinenler, taninmayan=bool(tanimsiz_yuz),
                      turler={o[5] for o in son_objeler}, bolgeler=girilen)
            if ilgili_yuzler:
                _, kb = max(ilgili_yuzler, key=lambda t: t[1][2] * t[1][3])
                olay.resim(temiz, yuz_kirp(temiz, kb, 0.6), 1000 + kb[2] * kb[3])
            elif ilgili_kisiler:
                kb = max(ilgili_kisiler, key=lambda o: o[2] * o[3])[:4]
                olay.resim(temiz, yuz_kirp(temiz, kb, 0.05), kb[2] * kb[3])
            if olay_bildirim["id"] != olay.aktif["id"]:
                olay_bildirim.update(id=olay.aktif["id"], tanimsiz=False, yuzsuz=False, bilinen=set(), kisi_ilk=0.0)
            if ilgili_kisiler and not olay_bildirim["kisi_ilk"]:
                olay_bildirim["kisi_ilk"] = simdi
            bildirimci.tiklama = uzak.url if uzak and uzak.url else None
            saat = datetime.now().strftime("%H:%M")
            yer = (" (%s)" % ", ".join(sorted(girilen))) if girilen else ""
            if tanimsiz_yuz and not olay_bildirim["tanimsiz"]:
                _, kb = max(tanimsiz_yuz, key=lambda t: t[1][2] * t[1][3])
                if bildirimci.gonder("Tan\u0131nmayan ki\u015fi!", "Saat %s: kamerada tan\u0131nmayan biri g\u00f6r\u00fcld\u00fc%s." % (saat, yer),
                                     yuz_kirp(temiz, kb, 1.2)):
                    olay_bildirim["tanimsiz"] = True
            elif (ilgili_kisiler and not bilinenler and not olay_bildirim["yuzsuz"] and not olay_bildirim["tanimsiz"]
                  and olay_bildirim["kisi_ilk"] and simdi - olay_bildirim["kisi_ilk"] > 4.0):
                kb = max(ilgili_kisiler, key=lambda o: o[2] * o[3])[:4]
                if bildirimci.gonder("Ki\u015fi alg\u0131land\u0131", "Saat %s: kamerada biri var, y\u00fcz\u00fc g\u00f6r\u00fcnm\u00fcyor%s." % (saat, yer),
                                     yuz_kirp(temiz, kb, 0.15)):
                    olay_bildirim["yuzsuz"] = True
            if ayarlar["bildirim"].get("bilinen"):
                for ad_b in bilinenler - olay_bildirim["bilinen"]:
                    olay_bildirim["bilinen"].add(ad_b)
                    bildirimci.son = 0  # bilinen kisi bildirimi bekleme suresine takilmasin
                    bildirimci.gonder("%s geldi" % tr_baslik(ad_b), "Saat %s: %s kamerada g\u00f6r\u00fcld\u00fc%s." %
                                      (saat, tr_baslik(ad_b), yer), temiz, oncelik="default")

        # Mavi isik: kisi goruldugu surece (ve 2 sn sonrasina kadar) yanip soner
        if ptz and ptz.led:
            if aktif or kisiler:
                son_kisi_zamani = simdi
            ptz.led.yanip_sonsun = simdi - son_kisi_zamani < 2.0

        # Kisi ogrenme (web'den "Kaydet")
        if ogren and taniyici:
            if len(aktif) > 1 and not ogren.get("uyari"):
                ogren["uyari"] = True
            if aktif and simdi - ogren["son"] > 0.3:
                i_b, kutu_b = max(aktif, key=lambda t: t[1][2] * t[1][3])
                ham = ham_harita.get(yuz_takip.kutular.get(i_b))
                if ham is not None:
                    ogren["son"] = simdi
                    ogren["ornekler"].append(taniyici.ozellik(temiz, ham))
            yazi_kutusu(kare, "\u00d6\u011eREN\u0130L\u0130YOR: %s (%d/10)" % (ogren["ad"], len(ogren["ornekler"])),
                        12, 70, SARI, 0.6, 2)
            if simdi > ogren["bitis"] or len(ogren["ornekler"]) >= 10:
                if len(ogren["ornekler"]) >= 3:
                    taniyici.ekle(ogren["ad"], ogren["ornekler"])
                    mesaj_ver("%s kaydedildi (%d \u00f6rnek)%s" % (
                        ogren["ad"], len(ogren["ornekler"]),
                        ". Dikkat: g\u00f6r\u00fcnt\u00fcde birden fazla y\u00fcz vard\u0131, en b\u00fcy\u00fc\u011f\u00fc kaydedildi" if ogren.get("uyari") else ""))
                    tanima.clear()
                else:
                    mesaj_ver("%s kaydedilemedi: y\u00fcz yeterince g\u00f6r\u00fclmedi. Kameraya bakarak yeniden deneyin."
                              % ogren["ad"])
                ogren = None

        # En buyuk yuzun yakin plani (sag ust kose)
        if aktif:
            _, kutu = max(aktif, key=lambda t: t[1][2] * t[1][3])
            kirp = yuz_kirp(temiz, kutu)
            if kirp.size:
                yb = 150
                kirp = cv2.resize(kirp, (yb, int(yb * kirp.shape[0] / max(1, kirp.shape[1]))))
                kirp = kirp[:yb]
                y0, x0 = 52, w - yb - 12
                kare[y0:y0 + kirp.shape[0], x0:x0 + yb] = kirp
                cv2.rectangle(kare, (x0 - 1, y0 - 1), (x0 + yb, y0 + kirp.shape[0]), YESIL, 1)

        # 4) Doner kamera kontrolu (surekli/akici hareket)
        if ptz and el["mod"] == "SABIT":
            # SABIT mod: kamera kendiliginden hic hareket etmez, sadece oklarla
            dedektor.esik(a.yuz_esik)
            if el["yon"] and simdi > el["bitis"]:
                el_birak()  # tus birakildi (tekrar gelmedi)
            elif el["yon"] and (el["tekrar"] if el["kaynak"] in ("tus", "web") else simdi - el["basla"] > 0.35):
                ptz.surekli(OK_ETKI[el["yon"]], 0.15, 2, zorla=True, serbest=True)  # basili tutuluyor
        elif ptz:
            # Tarama sirasinda daha hassas ara, takipte daha secici ol
            dedektor.esik(a.yuz_esik if aktif else max(0.55, a.yuz_esik - 0.15))
            # Yanlis alarmla taramayi durdurmamak icin yuz en az 2 karede gorulmeli
            onayli = [t for t in aktif if gorulme.get(t[0], 0) >= 2]
            hedef = None
            if onayli:
                _, (x, y, bw, bh) = max(onayli, key=lambda t: t[1][2] * t[1][3])
                hedef = (x, y, bw, bh)
            elif kisiler:
                # Yuz yok ama insan var (arkasi donuk / uzakta): basin olacagi ust kismi takip et
                x, y, bw, bh = max(kisiler, key=lambda o: o[2] * o[3])[:4]
                y, bh = y, max(1, int(bh * 0.4))
                hedef = (x, y, bw, bh)
            if hedef:
                son_yuz_zamani = simdi
                x, y, bw, bh = hedef
                # Gecikme telafisi: yolda olan komutlar yuzu nereye goturecek?
                bdx, bdy = ptz.bekleyen_kayma()
                ox = (x + bw / 2 + bdx - w / 2) / w   # + ise yuz sagda
                oy = (y + bh / 2 + bdy - h / 2) / h   # + ise yuz asagida
                etki, hata = None, 0.0
                if abs(ox) > 0.10 and abs(ox) >= abs(oy) * 0.8:
                    etki, hata = ("sol" if ox > 0 else "sag"), abs(ox)
                elif abs(oy) > 0.15:
                    etki, hata = ("yukari" if oy > 0 else "asagi"), abs(oy)
                if etki:
                    # Yuz merkezden ne kadar uzaksa o kadar hizli don
                    aralik = max(HIZ["min_aralik"], HIZ["takip_aralik"] - 2.0 * hata)
                    ptz.surekli(etki, aralik, 2 if hata > 0.25 else 1)
                else:
                    ptz.dur()
                tarama_ref = None
            elif aktif or kisiler or simdi - son_yuz_zamani <= 1.5:
                ptz.dur()  # yuz/kisi yeni goruldu ya da kayboldu: kisa bekle
            else:
                # HIZLI SISTEMATIK TARAMA: bir yone azami hizla kesintisiz don.
                # Goruntu kaymiyorsa (dondurme siniri) yon degistir ve dikey seviyeyi
                # degistir; sinir yoksa her tam turda seviye degistir.
                if tarama_ref is None:
                    tarama_ref, tarama_ref_zaman, tarama_kontrol = temiz, simdi, simdi + 0.5
                seviye_degis = simdi - seviye_zamani > tur_suresi
                if simdi >= tarama_kontrol:
                    # Sadece bu yondeki hareketin goruntuye yansimis olmasi gereken
                    # karelerle karar ver (gecikmeli goruntu yuzunden yanlis "sinir" olmasin)
                    if (ptz.son_etki == tarama_yonu
                            and tarama_ref_zaman >= ptz.yon_baslangic + ptz.gecikme + 0.2):
                        dx, _, _ = goruntu_kaymasi(tarama_ref, temiz)
                        if abs(dx) < 5:  # donanim sinirina dayandi
                            # kaymayan komutlari konumdan dus (konum sayaci kaymasin)
                            ptz.geri_al(tarama_ref_zaman - ptz.gecikme, simdi - ptz.gecikme, tarama_yonu)
                            tarama_yonu = "sag" if tarama_yonu == "sol" else "sol"
                            seviye_degis = True
                    tarama_ref, tarama_ref_zaman, tarama_kontrol = temiz, simdi, simdi + 0.5
                if ptz.sinira_dayandi == tarama_yonu:  # calisma alani siniri
                    ptz.sinira_dayandi = None
                    tarama_yonu = "sag" if tarama_yonu == "sol" else "sol"
                    seviye_degis = True
                if seviye_degis and (ptz.var("yukari") or ptz.var("asagi")):
                    sev = tarama_seviyeleri(ptz)
                    seviye_no = (seviye_no + 1) % len(sev)
                    fark = sev[seviye_no] - ptz.y          # + ise yukari bakmali
                    if fark:
                        ptz.hareket("asagi" if fark > 0 else "yukari", abs(fark))
                    seviye_zamani = simdi
                ptz.surekli(tarama_yonu, HIZ["tarama_aralik"], HIZ["tarama_paralel"])

        if ptz_durum["hazirlaniyor"]:
            durum_yaz(kare, "KAMERA MOTORU HAZIRLANIYOR\u2026", MAVI)
        elif ptz and el["mod"] == "SABIT":
            durum_yaz(kare, ("SAB\u0130T \u2013 %d y\u00fcz" % len(aktif)) if aktif else "SAB\u0130T \u2013 elle kontrol", SARI)
        elif aktif:
            durum_yaz(kare, f"Y\u00dcZ TAK\u0130B\u0130: {len(aktif)}", YESIL)
        elif kisiler:
            durum_yaz(kare, f"K\u0130\u015e\u0130 TAK\u0130B\u0130: {len(kisiler)}", (235, 200, 120))
        elif ptz and simdi - son_yuz_zamani <= 3:
            durum_yaz(kare, "Y\u00fcz kayboldu \u2013 bekleniyor", SARI)
        elif ptz:
            durum_yaz(kare, "TARAMA \u2013 y\u00fcz aran\u0131yor", MAVI)
        elif hareket or yuz_bekleme > 0:
            durum_yaz(kare, "HAREKET \u2013 y\u00fcz aran\u0131yor", SARI)
        else:
            durum_yaz(kare, "Bekleniyor", GRI)

        fps = 0.9 * fps + 0.1 / max(simdi - fps_t, 1e-6)
        fps_t = simdi
        yazi(kare, f"{fps:.0f} kare/sn", 10, h - 22, 13, GRI)
        sw, _ = yazi_boyut(SURUM, 21, True)
        yazi_kutusu(kare, SURUM, w - sw - 22, h - 12, SARI, 0.7, 2)

        if ptz:
            alan_ciz(kare, ptz)
            if simdi - son_alan_kayit > 2:
                ptz.kaydet()
                son_alan_kayit = simdi

        if web:
            web.durum.update(mod=el["mod"], durum=SON_DURUM["metin"], ptz=bool(ptz),
                             alan=alan_metni(ptz, derece_adim) if ptz else "",
                             tanima=bool(tani["t"]), kisiler=tani["t"].liste() if tani["t"] else [],
                             tanima_durum=TANIMA_DURUM["metin"], ses_hata=SES_AYAR.get("son_hata", ""),
                             uzak_url=uzak.url if uzak else None, uzak_sabit=uzak.sabit if uzak else None,
                             uzak_durum=uzak.durum if uzak else "kapali",
                             mesaj=mesaj["metin"] if simdi - mesaj["zaman"] < 20 else "",
                             ogreniyor=bool(ogren), selam=dict(selam_olay),
                             bildirim=ayarlar["bildirim"], bildirim_durum=bildirimci.son_durum,
                             konu=bildirimci.konu, nesneler=ayarlar["nesneler"],
                             saklama={"gun": ayarlar["saklama_gun"], "gb": ayarlar["saklama_gb"]},
                             bolgeler=[{"id": b["id"], "ad": b["ad"], "tur": b["tur"], "nokta": b["nokta"],
                                        "aktif": bolge_aktif(b, ptz)} for b in ayarlar["bolgeler"]],
                             kisi_sayisi=len(kisiler),
                             gorulen=[tanima[i]["ad"] for i, _ in aktif
                                      if i in tanima and tanima[i]["ad"] not in (None, "?")])
            web.kare_ver(kare)

        if web and not a.goruntusuz:
            yazi_kutusu(kare, "Ki\u015fi kayd\u0131 ve telefon: http://localhost:%d    PIN: %s" % (web.port, web.pin),
                        12, 62 if not ogren else 100, (200, 200, 200), 0.5, 1)
        if qr_goster and uzak and not a.goruntusuz:
            q = qr_resmi(uzak.sabit, min(300, h - 120))
            qy, qx = (h - q.shape[0]) // 2, (w - q.shape[1]) // 2
            cv2.rectangle(kare, (qx - 20, qy - 50), (qx + q.shape[1] + 20, qy + q.shape[0] + 40), (255, 255, 255), -1)
            kare[qy:qy + q.shape[0], qx:qx + q.shape[1]] = q
            yazi(kare, "Telefonla okutun, yer imlerine ekleyin", qx - 10, qy - 40, 18, KOYU, True)
            yazi(kare, uzak.sabit, qx - 10, qy + q.shape[0] + 10, 13, KOYU)
        elif uzak and not a.goruntusuz:
            yazi_kutusu(kare, ("\u0130nternetten eri\u015fim: haz\u0131r (QR kod i\u00e7in U)" if uzak.url else uzak.durum[:80]),
                        12, 114 if not ogren else 152, (200, 200, 200), 0.5, 1)
        if a.tanima == "acik" and not tani["t"] and not a.goruntusuz:
            yazi_kutusu(kare, TANIMA_DURUM["metin"][:100], 12, 88 if not ogren else 126, SARI, 0.5, 1)

        if ptz:
            el["dugmeler"] = panel_dugmeleri(w, h)
            panel_ciz(kare, el["dugmeler"], el["mod"], el["yon"])

        if not a.goruntusuz:
            cv2.imshow(pencere, kare)
            tus = cv2.waitKeyEx(1)
            if tus != -1:
                if tus & 0xFF in (ord("q"), ord("Q"), 27) and tus not in TUS_YON:
                    break
                if tus in (ord("l"), ord("L")) and ptz and ptz.led:
                    ptz.led.test_bitis = time.time() + 5
                    print("Mavi \u0131\u015f\u0131k testi: 5 saniye yan\u0131p s\u00f6necek.")
                elif tus in (ord("t"), ord("T")):
                    sesli_soyle("Ses denemesi. Bir, iki, \u00fc\u00e7. Beni duyuyor musunuz?")
                elif tus in (ord("u"), ord("U")) and uzak:
                    qr_goster = not qr_goster
                elif tus in (ord("p"), ord("P")) and ptz:
                    el["mod"] = "SABIT" if el["mod"] == "OTO" else "OTO"
                    el_birak()
                elif tus in TUS_YON:
                    el_basla(TUS_YON[tus], "tus")
                elif ptz and tus in SINIR_TUS:
                    ptz.sinir_ayarla(SINIR_TUS[tus])
                    print("\u00c7al\u0131\u015fma alan\u0131:", alan_metni(ptz, derece_adim))
        elif kare_no % 15 == 0:
            print(f"kare {kare_no}: hareket={hareket} ptz={ptz.son_etki if ptz else '-'} yuzler=" +
                  ", ".join(f"Yuz{i}@{k[:2]}" for i, k in aktif))

        if a.max_kare and kare_no >= a.max_kare:
            break

    if olay.aktif:
        olay._bitir()
    okuyucu.release()
    if ptz:
        ptz.degisti = True
        ptz.kaydet()
        if ptz.led:
            ptz.led.birak()
    if not a.goruntusuz:
        cv2.destroyAllWindows()
    if go2rtc_surec is not None:
        go2rtc_surec.terminate()
    if uzak:
        uzak.kapat()


if __name__ == "__main__":
    main()
