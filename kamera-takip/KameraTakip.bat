@echo off
chcp 65001 >nul
setlocal
title Kamera Hareket Takibi v11
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
echo Kamera Takip v11
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
SURUM = "v11"  # her guncellemede artirilir; kamerada ve pencere basliginda gorunur

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


def go2rtc_ffmpeg_ayarla(yaml_yolu):
    """go2rtc.yaml'a FFmpeg'in yerini yazar. Degisiklik yapildiysa True."""
    ff = ffmpeg_yolu()
    if not ff or not os.path.exists(yaml_yolu):
        return False
    ff = ff.replace("\\", "/")
    metin = open(yaml_yolu, encoding="utf-8").read()
    satir = '  bin: "%s"' % ff
    m = re.search(r"^ffmpeg:[ \t]*\n([ \t]+bin:.*)$", metin, re.M)
    if m:
        if m.group(1).strip() == satir.strip():
            return False
        metin = metin[:m.start(1)] + satir + metin[m.end(1):]
    elif re.search(r"^ffmpeg:", metin, re.M):
        metin = re.sub(r"^ffmpeg:[ \t]*\n", "ffmpeg:\n" + satir + "\n", metin, count=1, flags=re.M)
    else:
        metin = metin.rstrip("\n") + "\n\nffmpeg:\n" + satir + "\n"
    with open(yaml_yolu, "w", encoding="utf-8") as f:
        f.write(metin)
    return True


def go2rtc_hazirla(klasor):
    """go2rtc'yi gerekirse indirir ve baslatir, kamera eklenene kadar bekler.
    Donus: (rtsp adresi, baslatilan surec veya None)"""
    os.makedirs(klasor, exist_ok=True)
    dosya, exe = _go2rtc_dosyasi()
    exe_yolu = os.path.join(klasor, exe)
    yaml_yolu = os.path.join(klasor, "go2rtc.yaml")
    surec = None

    # Kameraya ses gonderebilmek icin go2rtc'nin FFmpeg'i bilmesi gerekir
    if go2rtc_ffmpeg_ayarla(yaml_yolu) and _akislar() is not None:
        print("go2rtc ses ayar\u0131 i\u00e7in yeniden ba\u015flat\u0131l\u0131yor...")
        try:
            _api("/api/exit", "POST", 5)
        except Exception:
            pass
        for _ in range(20):
            if _akislar() is None:
                break
            time.sleep(0.5)

    if _akislar() is None:
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
SES_AYAR = {"klasor": ".", "ses": "emel", "hoparlor": "kamera", "akis": None, "web": None}


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


def kameradan_cal(dosya):
    """Ses dosyasini go2rtc uzerinden kameranin hoparlorunden calar. Basarili ise True."""
    akis = SES_AYAR.get("akis")
    if not akis or not ffmpeg_yolu():
        return False
    web = SES_AYAR.get("web")
    if web:  # dosyayi kendi web sunucumuzdan ver (yolda bosluk/Turkce harf sorunu olmasin)
        giris = "http://127.0.0.1:%d/ses/%s/%s" % (web.port, web.ses_anahtari, os.path.basename(dosya))
    else:
        giris = os.path.abspath(dosya).replace("\\", "/")
    hata = ""
    for kodek in ("pcma", "opus"):  # kamera hangisini kabul ederse
        src = "ffmpeg:%s#input=file#audio=%s" % (giris, kodek)
        try:
            _api("/api/streams?dst=%s&src=%s" % (urllib.request.quote(akis), urllib.request.quote(src, safe="")),
                 "POST", 15)
            return True
        except urllib.error.HTTPError as e:
            hata = e.read().decode("utf-8", "replace")[:120]
        except Exception as e:
            hata = str(e)[:120]
    print("Kamera hoparl\u00f6r\u00fc kullan\u0131lamad\u0131 (%s). Ses bilgisayardan \u00e7al\u0131nacak." % hata)
    return False


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
.sec{display:flex;gap:8px;align-items:center;color:var(--soluk);font-size:14px}
.alanyazi{margin:0;font:13px ui-monospace,Consolas,monospace;color:var(--soluk);overflow-wrap:anywhere}
</style></head><body><main>
<header><h1>Kamera Takip</h1><span class="surum" id="surum">__SURUM__</span></header>
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
 var us=document.getElementById("uzaksabit"),uu=document.getElementById("uzakurl");
 if(d.uzak_sabit){us.textContent=d.uzak_sabit;us.href=d.uzak_sabit;}else{us.textContent="kapal\u0131";us.removeAttribute("href");}
 if(d.uzak_url){uu.textContent=d.uzak_url;uu.href=d.uzak_url;}else{uu.textContent="-";uu.removeAttribute("href");}
 document.getElementById("uzakdurum").textContent=d.uzak_durum==="hazir"?"Durum: haz\u0131r":"Durum: "+(d.uzak_durum||"");
 document.getElementById("mesaj").textContent=d.tanima?(d.mesaj||""):(d.tanima_durum||"Y\u00fcz tan\u0131ma haz\u0131rlan\u0131yor...");
 kaydetD.disabled=!d.tanima||d.ogreniyor;kisileriCiz(d);
 if(d.selam){if(sonSelam!==null&&d.selam.no!==sonSelam&&telses.checked&&window.speechSynthesis){
  var u=new SpeechSynthesisUtterance(d.selam.metin);u.lang="tr-TR";speechSynthesis.speak(u);}sonSelam=d.selam.no;}}).catch(function(){document.getElementById("durum").textContent="Ba\u011flant\u0131 yok";});}
setInterval(guncelle,1000);guncelle();
var img=document.getElementById("img"),akisCalisti=false,tekKare=false;
img.onload=function(){akisCalisti=true;};
img.onerror=function(){if(!tekKare)setTimeout(function(){img.src="video?t="+Date.now();},2000);};
// Canli akis 6 sn icinde gelmezse (bazi baglantilar akisi tamponlar) tek tek kare cek
setTimeout(function(){if(akisCalisti&&img.naturalWidth>0)return;tekKare=true;
 var yeni=new Image();function sonraki(){yeni.src="kare.jpg?t="+Date.now();}
 yeni.onload=function(){img.src=yeni.src;setTimeout(sonraki,250);};yeni.onerror=function(){setTimeout(sonraki,1000);};sonraki();},6000);
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
                    if len(parca) == 4 and parca[2] == web.ses_anahtari and re.match(r"^[0-9a-f]{16}\.mp3$", parca[3]):
                        dosya = os.path.join(SES_AYAR["klasor"], "ses_onbellek", parca[3])
                        if os.path.exists(dosya):
                            return self._yaz(200, open(dosya, "rb").read(), "audio/mpeg")
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

            def do_POST(self):
                if not self._yetkili():
                    return self._yaz(403, "PIN gerekli")
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
    yazi(kare, "Oklar / WASD: d\u00f6nd\u00fcr    P: otomatik/sabit    U: QR kod    Q: \u00e7\u0131k\u0131\u015f",
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
    SES_AYAR.update(klasor=betik_klasor, ses=a.ses, hoparlor=a.hoparlor)

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

    web = uzak = None
    qr_goster = False
    if a.web_port:
        try:
            web = WebSunucu(a.web_port, web_pin_al(betik_klasor))
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
            yuzler = dedektor.bul(kare)
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
            yuzler = dedektor.bul(kare) if (hareket or takipte or yuz_bekleme > 0 or ogren) else []
            yuz_takip.guncelle(yuzler)

        ham_harita = dict(zip(yuzler, dedektor.ham)) if yuzler else {}
        taniyici = tani["t"]

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
            if onayli:
                son_yuz_zamani = simdi
                _, (x, y, bw, bh) = max(onayli, key=lambda t: t[1][2] * t[1][3])
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
            elif aktif or simdi - son_yuz_zamani <= 1.5:
                ptz.dur()  # yuz yeni goruldu/kayboldu: kisa bekle
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

        if a.kaydet:
            if hareket or aktif:
                son_olay = simdi
                if yazici is None:
                    os.makedirs(a.kaydet, exist_ok=True)
                    ad = os.path.join(a.kaydet, datetime.now().strftime("hareket_%Y%m%d_%H%M%S.mp4"))
                    yazici = cv2.VideoWriter(ad, cv2.VideoWriter_fourcc(*"mp4v"), 15, (w, h))
                    print("Video kayd\u0131 ba\u015flad\u0131:", ad)
            if yazici is not None:
                yazici.write(kare)
                if simdi - son_olay > 5:
                    yazici.release()
                    yazici = None
                    print("Video kayd\u0131 bitti.")

        if ptz:
            alan_ciz(kare, ptz)
            if simdi - son_alan_kayit > 2:
                ptz.kaydet()
                son_alan_kayit = simdi

        if web:
            web.durum.update(mod=el["mod"], durum=SON_DURUM["metin"], ptz=bool(ptz),
                             alan=alan_metni(ptz, derece_adim) if ptz else "",
                             tanima=bool(tani["t"]), kisiler=tani["t"].liste() if tani["t"] else [],
                             tanima_durum=TANIMA_DURUM["metin"],
                             uzak_url=uzak.url if uzak else None, uzak_sabit=uzak.sabit if uzak else None,
                             uzak_durum=uzak.durum if uzak else "kapali",
                             mesaj=mesaj["metin"] if simdi - mesaj["zaman"] < 20 else "",
                             ogreniyor=bool(ogren), selam=dict(selam_olay),
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
                if tus in (ord("u"), ord("U")) and uzak:
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

    if yazici is not None:
        yazici.release()
    okuyucu.release()
    if ptz:
        ptz.degisti = True
        ptz.kaydet()
    if not a.goruntusuz:
        cv2.destroyAllWindows()
    if go2rtc_surec is not None:
        go2rtc_surec.terminate()
    if uzak:
        uzak.kapat()


if __name__ == "__main__":
    main()
