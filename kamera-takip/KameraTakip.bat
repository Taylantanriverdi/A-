@echo off
setlocal
title Kamera Hareket Takibi v3
REM ================================================================
REM  Kamera Hareket Takibi - tek dosya kurulum + calistirma
REM  Bu dosyaya cift tikla. Her seyi kendisi yapar:
REM   1) Python yoksa kurar
REM   2) Gerekli kutuphaneleri kurar (opencv, numpy)
REM   3) Takip programini cikarir
REM   4) go2rtc'yi indirir ve baslatir, Xiaomi girisi icin tarayici acar
REM   5) Kamera eklenince tarama + yuz takibini baslatir (doner kamerada
REM      ilk seferde motor kalibrasyonu yapar, kamera biraz doner)
REM ================================================================

set "BAT_YOLU=%~f0"
set "KLASOR=%LOCALAPPDATA%\KameraTakip"
if not exist "%KLASOR%" mkdir "%KLASOR%"

echo.
echo Kamera Takip v3
echo.
echo [1/4] Python kontrol ediliyor...
set "PY="
py -3 -c "import sys" >nul 2>&1 && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>&1 && set "PY=python"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe""
if defined PY goto python_var

echo Python bulunamadi, kuruluyor (birkac dakika surebilir)...
where winget >nul 2>&1
if errorlevel 1 goto python_elle
winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
if not exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" goto python_elle
set "PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe""

:python_var
echo Python hazir.

echo.
echo [2/4] Kutuphaneler kuruluyor (ilk seferde biraz surer)...
%PY% -m pip install --disable-pip-version-check --quiet --upgrade opencv-python numpy requests
if errorlevel 1 (
  echo HATA: Kutuphaneler kurulamadi. Internet baglantini kontrol et.
  pause
  exit /b 1
)

echo.
echo [3/4] Takip programi hazirlaniyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=[IO.File]::ReadAllText($env:BAT_YOLU); $p=$c -split '::PYTHON_KODU_BURADA::'; [IO.File]::WriteAllText($env:KLASOR + '\takip.py', $p[$p.Length-1].TrimStart())"
if not exist "%KLASOR%\takip.py" (
  echo HATA: takip.py olusturulamadi.
  pause
  exit /b 1
)

echo.
echo [4/4] Kamera baglantisi kuruluyor ve takip baslatiliyor...
echo       Takip penceresinden cikmak icin: q veya Esc
cd /d "%KLASOR%"
%PY% takip.py --kaynak go2rtc --maske-saat --kaydet "%USERPROFILE%\Videos\KameraTakip" --yuz-klasor "%USERPROFILE%\Pictures\KameraTakip"
echo.
echo Hareket videolari : %USERPROFILE%\Videos\KameraTakip
echo Yuz fotograflari  : %USERPROFILE%\Pictures\KameraTakip
pause
exit /b 0

:python_elle
echo.
echo Python otomatik kurulamadi.
echo Lutfen https://www.python.org/downloads/ adresinden Python'u kur,
echo kurulumda "Add Python to PATH" kutusunu isaretle, sonra bu dosyayi tekrar calistir.
start "" https://www.python.org/downloads/
pause
exit /b 1

REM ---- Asagisi Python kodudur, bat tarafindan calistirilmaz ----
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
SURUM = "v3"  # her guncellemede artirilir; kamerada ve pencere basliginda gorunur

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
    print("Xiaomi hesabi bulundu (%s), kamera araniyor..." % kullanici)
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
    print("Bu hesapta kamera bulunamadi. Kamera baska bir Xiaomi hesabinda olabilir.")
    return False


def go2rtc_hazirla(klasor):
    """go2rtc'yi gerekirse indirir ve baslatir, kamera eklenene kadar bekler.
    Donus: (rtsp adresi, baslatilan surec veya None)"""
    os.makedirs(klasor, exist_ok=True)
    dosya, exe = _go2rtc_dosyasi()
    exe_yolu = os.path.join(klasor, exe)
    yaml_yolu = os.path.join(klasor, "go2rtc.yaml")
    surec = None

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
        print("go2rtc baslatiliyor...")
        log = open(os.path.join(klasor, "go2rtc.log"), "a")
        surec = subprocess.Popen([exe_yolu, "-config", yaml_yolu], cwd=klasor,
                                 stdout=log, stderr=subprocess.STDOUT)
        for _ in range(30):
            if _akislar() is not None:
                break
            if surec.poll() is not None:
                raise SystemExit("go2rtc acilamadi, go2rtc.log dosyasina bak.")
            time.sleep(0.5)
        else:
            raise SystemExit("go2rtc cevap vermiyor (1984 portu dolu olabilir).")

    akislar = _akislar() or {}
    if not akislar:
        print()
        print("=" * 64)
        print(" Kamera henuz eklenmemis. Tarayicida go2rtc acilacak:")
        print("   1) Asagida Xiaomi'ye tikla")
        print("   2) Xiaomi Home hesabinla giris yap (login'e BIR KEZ bas,")
        print("      gelen kodu yazip send'e bas)")
        print(" Giris yapinca kamera KENDILIGINDEN bulunup eklenir ve takip")
        print(" baslar. Bu pencereyi kapatma.")
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
    print("Kamera akisi bulundu:", ad)
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
                    print("Yuz modeli indiriliyor...")
                    urllib.request.urlretrieve(url, yol)
                    if os.path.getsize(yol) > 100000:
                        break
                except Exception as e:
                    print("  indirilemedi:", e)
            else:
                raise SystemExit("Yuz modeli indirilemedi, internet baglantisini kontrol et.")
        self.det = cv2.FaceDetectorYN.create(yol, "", (320, 320), esik, 0.3, 50)
        self.boyut = None

    def esik(self, deger):
        self.det.setScoreThreshold(deger)

    def bul(self, kare, min_boyut=20):
        h, w = kare.shape[:2]
        if self.boyut != (w, h):
            self.det.setInputSize((w, h))
            self.boyut = (w, h)
        _, yuzler = self.det.detect(kare)
        kutular = []
        if yuzler is not None:
            for f in yuzler:
                x, y, bw, bh = (int(v) for v in f[:4])
                x, y = max(0, x), max(0, y)
                bw, bh = min(bw, w - x), min(bh, h - y)
                if bw >= min_boyut and bh >= min_boyut:
                    kutular.append((x, y, bw, bh))
        return kutular


# --- Cizim yardimcilari -----------------------------------------------------
YESIL = (90, 220, 120)
SARI = (40, 200, 255)
GRI = (170, 170, 170)
MAVI = (230, 170, 60)
KOYU = (25, 25, 25)


def yazi_kutusu(kare, metin, x, y, renk, olcek=0.55, kalin=1):
    (tw, th), b = cv2.getTextSize(metin, cv2.FONT_HERSHEY_SIMPLEX, olcek, kalin)
    cv2.rectangle(kare, (x, y - th - 8), (x + tw + 10, y + b - 2), renk, -1)
    cv2.putText(kare, metin, (x + 5, y - 4), cv2.FONT_HERSHEY_SIMPLEX, olcek, KOYU, kalin, cv2.LINE_AA)


def kose_cerceve(kare, x, y, w, h, renk, k=2):
    """Tam dikdortgen yerine sade kose isaretleri."""
    u = max(10, min(w, h) // 4)
    for (px, py, dx, dy) in ((x, y, 1, 1), (x + w, y, -1, 1), (x, y + h, 1, -1), (x + w, y + h, -1, -1)):
        cv2.line(kare, (px, py), (px + dx * u, py), renk, k, cv2.LINE_AA)
        cv2.line(kare, (px, py), (px, py + dy * u), renk, k, cv2.LINE_AA)


SON_DURUM = {"metin": ""}


def durum_yaz(kare, metin, renk):
    SON_DURUM["metin"] = metin
    (tw, _), _ = cv2.getTextSize(metin, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
    x = kare.shape[1] - tw - 22
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
            raise SystemExit(f"Kaynak acilamadi: {adres}")
        self.kare, self.sayac, self.okunan, self.dur = None, 0, 0, False
        self.kilit = threading.Lock()
        threading.Thread(target=self._dongu, daemon=True).start()

    def _dongu(self):
        while not self.dur:
            ok, f = self.cap.read()
            if not ok:
                print("Baglanti koptu, 2 sn sonra yeniden deneniyor...")
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
            raise SystemExit(f"Kaynak acilamadi: {kaynak}")

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
            raise SystemExit("Simulasyon resmi okunamadi: " + panorama)
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
            raise RuntimeError("Xiaomi girisi basarisiz: " + r.text[:200])
        v = json.loads(r.text[11:])
        if not v.get("location"):
            raise RuntimeError("Xiaomi girisi gecersiz, go2rtc'de tekrar login ol: " + str(v.get("desc", ""))[:100])
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
            raise RuntimeError("Xiaomi oturumu acilamadi")
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
    print("Kamera ozellik listesi (MIoT spec) indiriliyor...")
    for surum in (1, 2, 3):  # once dogrudan tahmin (kucuk ve hizli)
        urn = "urn:miot-spec-v2:device:camera:0000A01C:%s:%d" % (kisa, surum)
        try:
            r = requests.get(taban, params={"type": urn}, timeout=20)
            if r.ok and r.json().get("services"):
                spec = r.json()
        except Exception as e:
            print("  ", urn, "->", str(e)[:60])
    if spec is None:
        print("  Tum cihaz listesi indiriliyor (buyuk dosya, 1-2 dk surebilir)...")
        liste = requests.get("https://miot-spec.org/miot-spec-v2/instances?status=all", timeout=(15, 180)).json()
        uygun = [x for x in liste.get("instances", []) if x.get("model") == model]
        if not uygun:
            raise RuntimeError("MIoT spec bulunamadi: " + model)
        urn = max(uygun, key=lambda x: x.get("version", 0))["type"]
        spec = requests.get(taban, params={"type": urn}, timeout=30).json()
    json.dump(spec, open(yol, "w", encoding="utf-8"))
    print("  Spec indirildi:", len(spec.get("services", [])), "servis")
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
    print("Kamera motoru kalibre ediliyor (%d komut denenecek, kamera donecek)..." % len(adaylar))
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
                print("  %-28s goruntu kaymadi" % aday.get("ad", "")[:28])
                continue
            if abs(dx) >= abs(dy):
                etki, adim = ("sol" if dx < 0 else "sag"), abs(dx)
            else:
                etki, adim = ("yukari" if dy < 0 else "asagi"), abs(dy)
            print("  %-28s goruntu %s kaydi (%d px, %.1f sn)" % (aday.get("ad", "")[:28], etki, adim, ilk_kayma or 0))
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
        threading.Thread(target=self._isci, daemon=True).start()

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

    def surekli(self, etki, aralik=0.3, paralel=1, zorla=False):
        # Ters yone donmeden once son hareketin goruntuye yansimasini bekle (sallanmayi onler)
        if (not zorla and self.son_etki == self.TERS.get(etki)
                and time.time() - self.son_gonderim < self.gecikme + 0.3):
            self.yon = None
            return
        if etki in self.e:
            self.yon, self.aralik, self.paralel = etki, aralik, paralel

    def dur(self):
        self.yon = None

    def _tek(self, etki):
        try:
            self.gonder(self.e[etki]["aday"])
            self.hata_sayisi = 0
        except Exception as ex:
            self.hata_sayisi += 1
            if self.hata_sayisi in (1, 5) or self.hata_sayisi % 20 == 0:
                print("PTZ komut hatasi (%d): %s" % (self.hata_sayisi, str(ex)[:80]))
        finally:
            with self.kilit:
                self.ucusta -= 1
            self.son = time.time()

    def _isci(self):
        while True:
            yon = self.yon
            simdi = time.time()
            bekleme = self.aralik + (1.0 if self.hata_sayisi >= 3 else 0.0)  # hata varsa yavasla
            if yon and self.ucusta < self.paralel and simdi - self.son_gonderim >= bekleme:
                with self.kilit:
                    self.ucusta += 1
                if yon != self.son_etki:
                    self.yon_baslangic = simdi
                self.son_gonderim, self.son_etki = simdi, yon
                self.gonderilenler.append((simdi, yon))
                self.dikey += 1 if yon == "yukari" else -1 if yon == "asagi" else 0
                threading.Thread(target=self._tek, args=(yon,), daemon=True).start()
            time.sleep(0.02)

    def hareket(self, etki, adet=1):
        """Tek seferlik birkac adim (surekli hareketten bagimsiz, ornegin dikey seviye degisimi)."""
        if etki not in self.e:
            return False
        self.dikey += adet if etki == "yukari" else -adet if etki == "asagi" else 0
        for _ in range(adet):
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
            print("PTZ: go2rtc.yaml icinde Xiaomi kamera bilgisi yok.")
            return None
        bulut = XiaomiBulut(bilgi["uid"], bilgi["token"], bilgi["bolge"])
        gonder = bulut_gonderici(bulut, bilgi["did"])
        ayar_yolu = os.path.join(betik_klasor, "ptz_%s.json" % bilgi["did"])
        eslesme = None
        if os.path.exists(ayar_yolu) and not kalibre_zorla:
            eslesme = json.load(open(ayar_yolu, encoding="utf-8"))
            if any("gecikme" not in v for v in eslesme.values()):
                print("Eski PTZ ayari: gecikme olcumu icin bir kez yeniden kalibre edilecek.")
                eslesme = None
        if eslesme:
            print("PTZ ayari yuklendi:", ", ".join(sorted(eslesme)))
        else:
            try:
                spec = miot_spec_indir(bilgi["model"], betik_klasor)
            except Exception as e:
                print("Spec indirilemedi (%s), yedek komutlarla denenecek." % str(e)[:80])
                spec = {}
            eslesme = ptz_kalibre(gonder, ptz_adaylari(spec), son_kare)
            if not eslesme:
                print("PTZ: hicbir komut kamerayi dondurmedi. Sabit kamera modunda devam.")
                return None
            json.dump(eslesme, open(ayar_yolu, "w", encoding="utf-8"), indent=1)
            print("PTZ ayari kaydedildi:", ", ".join(sorted(eslesme)))
        return PTZ(gonder, eslesme)
    except Exception as e:
        print("PTZ kullanilamiyor (%s). Sabit kamera modunda devam." % str(e)[:120])
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
var modDugme=document.getElementById("mod");
function guncelle(){fetch("api/durum").then(function(r){return r.json();}).then(function(d){
 document.getElementById("durum").textContent=d.durum||"";document.getElementById("surum").textContent=d.surum;
 modDugme.className=d.mod;modDugme.textContent=d.mod==="OTO"?"OTOMAT\u0130K":"SAB\u0130T";
 modDugme.disabled=!d.ptz;}).catch(function(){document.getElementById("durum").textContent="Ba\u011flant\u0131 yok";});}
setInterval(guncelle,1000);guncelle();
var img=document.getElementById("img");img.onerror=function(){setTimeout(function(){img.src="video?t="+Date.now();},2000);};
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
                if yol.path == "/" and "pin" in q:
                    if q["pin"][0].strip() == web.pin:
                        return self._yaz(303, "", ek={"Location": "/", "Set-Cookie":
                                         "pin=%s; Path=/; Max-Age=31536000; SameSite=Strict" % web.pin})
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

        self.sunucu = ThreadingHTTPServer(("0.0.0.0", port), Isleyici)
        self.sunucu.daemon_threads = True
        threading.Thread(target=self.sunucu.serve_forever, daemon=True).start()
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


# --- Elle kontrol paneli ----------------------------------------------------
# Ok yonu (kameranin bakacagi yon) -> goruntunun kayacagi yon (kalibrasyon etkisi)
OK_ETKI = {"sol": "sag", "sag": "sol", "yukari": "asagi", "asagi": "yukari"}
# Windows'ta cv2.waitKeyEx ok tus kodlari + WASD
TUS_YON = {2424832: "sol", 2555904: "sag", 2490368: "yukari", 2621440: "asagi",
           ord("a"): "sol", ord("d"): "sag", ord("w"): "yukari", ord("s"): "asagi",
           ord("A"): "sol", ord("D"): "sag", ord("W"): "yukari", ord("S"): "asagi"}


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
            metin = "OTOMATIK" if mod == "OTO" else "SABIT"
            (tw, th), _ = cv2.getTextSize(metin, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            cv2.putText(kare, metin, (x0 + (x1 - x0 - tw) // 2, y0 + (y1 - y0 + th) // 2),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, KOYU, 2, cv2.LINE_AA)
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
    cv2.putText(kare, "Oklar/WASD: dondur   P: oto/sabit   Q: cikis",
                (x0, dugmeler["asagi"][3] + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (235, 235, 235), 1, cv2.LINE_AA)


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
    p.add_argument("--web-port", type=int, default=8765, help="Telefondan izleme/kontrol sayfasi portu (0 = kapali)")
    p.add_argument("--max-kare", type=int, default=0, help="Test icin: bu kadar kareden sonra dur")
    a = p.parse_args()
    print("=" * 40)
    print(" Kamera Takip %s" % SURUM)
    print("=" * 40)

    betik_klasor = os.path.dirname(os.path.abspath(__file__))
    dedektor = YuzDedektor(betik_klasor, a.yuz_esik)

    web = None
    if a.web_port:
        try:
            web = WebSunucu(a.web_port, web_pin_al(betik_klasor))
            print("-" * 60)
            print(" Telefondan / baska cihazdan izle ve kontrol et:")
            for adr in yerel_adresler():
                ek = "   (Tailscale - disaridan)" if adr.startswith("100.") else "   (ev agi)"
                print("   http://%s:%d%s" % (adr, a.web_port, ek))
            print(" PIN: %s" % web.pin)
            print("-" * 60)
        except OSError as e:
            print("Web sayfasi baslatilamadi (port %d): %s" % (a.web_port, e))

    go2rtc_surec = None
    if a.kaynak == "go2rtc":
        a.kaynak, go2rtc_surec = go2rtc_hazirla(os.path.join(betik_klasor, "go2rtc"))
        print("Baglaniliyor:", a.kaynak)

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
    SEVIYELER = [0, 2, -2]   # tarama yapilan dikey seviyeler (adim): orta, yukari, asagi
    seviye_no = 0
    tarama_ref, tarama_ref_zaman, tarama_kontrol, seviye_zamani = None, 0.0, 0.0, time.time()
    tur_suresi = 20.0         # PTZ hazir olunca adim buyuklugunden hesaplanir
    if a.yuz_klasor:
        os.makedirs(a.yuz_klasor, exist_ok=True)

    # Elle kontrol durumu
    el = {"mod": "OTO", "yon": None, "basla": 0.0, "bitis": 0.0, "kaynak": None, "tekrar": False,
          "dugmeler": {}}
    pencere = "Kamera Takip %s  (cikis: q)" % SURUM

    def el_basla(yon, kaynak):
        """Ok basildi: SABIT moda gec, hemen bir adim at; basili tutulursa surekli don."""
        if not ptz:
            return
        el["mod"] = "SABIT"
        simdi = time.time()
        if el["yon"] != yon:
            # Yeni basis: tek adim. Tus basili tutulursa Windows tekrar gonderir -> surekli
            ptz.dur()
            ptz.hareket(OK_ETKI[yon], 1)
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
            print("Doner kamera modu: tarama yapilacak, yuz gorulunce takip edilecek."
                  " (goruntu gecikmesi ~%.1f sn)" % ptz.gecikme)
            print("Tarama: adim ~%.0f derece, tam tur ~%.0f adim, tahmini ~%.1f sn"
                  % (derece_adim, tur_adim, tur_suresi))
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
            yuzler = dedektor.bul(kare) if (hareket or takipte or yuz_bekleme > 0) else []
            yuz_takip.guncelle(yuzler)

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

            iz = list(yuz_takip.izler[i])
            for k in range(1, len(iz)):
                cv2.line(kare, iz[k - 1], iz[k], YESIL, 1, cv2.LINE_AA)
            kose_cerceve(kare, x, y, bw, bh, YESIL, 2)
            yazi_kutusu(kare, f"Yuz {i}", x, max(22, y - 6), YESIL)

            # Yeni yuz 5 kare boyunca saglam gorulduyse fotografini al
            if (a.yuz_klasor and i not in kaydedilen and gorulme[i] >= 8
                    and simdi - son_foto >= a.foto_ara):
                kaydedilen.add(i)
                son_foto = simdi
                ad = os.path.join(a.yuz_klasor, datetime.now().strftime(f"yuz_%Y%m%d_%H%M%S_{i}.jpg"))
                cv2.imwrite(ad, yuz_kirp(temiz, yuz_takip.kutular[i]))
                print("Yuz yakalandi:", ad)
        for i in list(yumusak):
            if i not in yuz_takip.nesneler:
                yumusak.pop(i, None)
                gorulme.pop(i, None)

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
                ptz.surekli(OK_ETKI[el["yon"]], 0.15, 2, zorla=True)  # basili tutuluyor
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
                        if abs(dx) < 5:  # sinira dayandi
                            tarama_yonu = "sag" if tarama_yonu == "sol" else "sol"
                            seviye_degis = True
                    tarama_ref, tarama_ref_zaman, tarama_kontrol = temiz, simdi, simdi + 0.5
                if seviye_degis and (ptz.var("yukari") or ptz.var("asagi")):
                    seviye_no = (seviye_no + 1) % len(SEVIYELER)
                    fark = SEVIYELER[seviye_no] - ptz.dikey
                    if fark:
                        ptz.hareket("yukari" if fark > 0 else "asagi", abs(fark))
                    seviye_zamani = simdi
                ptz.surekli(tarama_yonu, HIZ["tarama_aralik"], HIZ["tarama_paralel"])

        if ptz_durum["hazirlaniyor"]:
            durum_yaz(kare, "KAMERA MOTORU HAZIRLANIYOR...", MAVI)
        elif ptz and el["mod"] == "SABIT":
            durum_yaz(kare, ("SABIT - yuz: %d" % len(aktif)) if aktif else "SABIT - elle kontrol", SARI)
        elif aktif:
            durum_yaz(kare, f"YUZ TAKIP: {len(aktif)}", YESIL)
        elif ptz and simdi - son_yuz_zamani <= 3:
            durum_yaz(kare, "Yuz kayboldu - bekleniyor", SARI)
        elif ptz:
            durum_yaz(kare, "TARAMA - yuz araniyor", MAVI)
        elif hareket or yuz_bekleme > 0:
            durum_yaz(kare, "HAREKET - yuz araniyor", SARI)
        else:
            durum_yaz(kare, "Bekleniyor", GRI)

        fps = 0.9 * fps + 0.1 / max(simdi - fps_t, 1e-6)
        fps_t = simdi
        cv2.putText(kare, f"{fps:.0f} FPS", (10, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, GRI, 1, cv2.LINE_AA)
        (sw, _), _ = cv2.getTextSize(SURUM, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
        yazi_kutusu(kare, SURUM, w - sw - 22, h - 12, SARI, 0.7, 2)

        if a.kaydet:
            if hareket or aktif:
                son_olay = simdi
                if yazici is None:
                    os.makedirs(a.kaydet, exist_ok=True)
                    ad = os.path.join(a.kaydet, datetime.now().strftime("hareket_%Y%m%d_%H%M%S.mp4"))
                    yazici = cv2.VideoWriter(ad, cv2.VideoWriter_fourcc(*"mp4v"), 15, (w, h))
                    print("Kayit basladi:", ad)
            if yazici is not None:
                yazici.write(kare)
                if simdi - son_olay > 5:
                    yazici.release()
                    yazici = None
                    print("Kayit bitti")

        if web:
            web.durum.update(mod=el["mod"], durum=SON_DURUM["metin"], ptz=bool(ptz))
            web.kare_ver(kare)

        if ptz:
            el["dugmeler"] = panel_dugmeleri(w, h)
            panel_ciz(kare, el["dugmeler"], el["mod"], el["yon"])

        if not a.goruntusuz:
            cv2.imshow(pencere, kare)
            tus = cv2.waitKeyEx(1)
            if tus != -1:
                if tus & 0xFF in (ord("q"), ord("Q"), 27) and tus not in TUS_YON:
                    break
                if tus in (ord("p"), ord("P")) and ptz:
                    el["mod"] = "SABIT" if el["mod"] == "OTO" else "OTO"
                    el_birak()
                elif tus in TUS_YON:
                    el_basla(TUS_YON[tus], "tus")
        elif kare_no % 15 == 0:
            print(f"kare {kare_no}: hareket={hareket} ptz={ptz.son_etki if ptz else '-'} yuzler=" +
                  ", ".join(f"Yuz{i}@{k[:2]}" for i, k in aktif))

        if a.max_kare and kare_no >= a.max_kare:
            break

    if yazici is not None:
        yazici.release()
    okuyucu.release()
    if not a.goruntusuz:
        cv2.destroyAllWindows()
    if go2rtc_surec is not None:
        go2rtc_surec.terminate()


if __name__ == "__main__":
    main()
