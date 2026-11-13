@echo off
setlocal
title Kamera Hareket Takibi
REM ================================================================
REM  Kamera Hareket Takibi - tek dosya kurulum + calistirma
REM  Bu dosyaya cift tikla. Her seyi kendisi yapar:
REM   1) Python yoksa kurar
REM   2) Gerekli kutuphaneleri kurar (opencv, numpy)
REM   3) Takip programini cikarir
REM   4) go2rtc'yi indirir ve baslatir, Xiaomi girisi icin tarayici acar
REM   5) Kamera eklenince hareket + yuz takibini baslatir
REM ================================================================

set "BAT_YOLU=%~f0"
set "KLASOR=%LOCALAPPDATA%\KameraTakip"
if not exist "%KLASOR%" mkdir "%KLASOR%"

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
%PY% -m pip install --disable-pip-version-check --quiet --upgrade opencv-python numpy
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

Yontem:
  1) Arka plan cikarma (MOG2) ile sahnede hareket olup olmadigina bakilir.
  2) Hareket gorulunce YuNet yuz dedektoru calisir ve yuz aranir.
  3) Bulunan yuzler kareden kareye ayni numarayla takip edilir, yeni bir yuz
     yakalaninca fotografi kaydedilir. Yuz kaybolunca tekrar hareket beklenir.
"""
import argparse
import json
import os
import platform
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

    def bul(self, kare, min_boyut=24):
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


def durum_yaz(kare, metin, renk):
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


def main():
    p = argparse.ArgumentParser(description="IP kamera hareket + yuz takibi")
    p.add_argument("--kaynak", required=True,
                   help="go2rtc, RTSP adresi, video dosyasi veya kamera no (0)")
    p.add_argument("--min-alan", type=int, default=800, help="Bu alandan kucuk hareketleri yok say (piksel)")
    p.add_argument("--genislik", type=int, default=960, help="Isleme genisligi (kucuk = hizli)")
    p.add_argument("--maske-saat", action="store_true",
                   help="Sol ustteki tarih/saat yazisini hareket sayma (Xiaomi zaman damgasi)")
    p.add_argument("--yuz-esik", type=float, default=0.75, help="Yuz guven esigi 0-1 (yuksek = daha secici)")
    p.add_argument("--hareket-goster", action="store_true", help="Hareket bolgesini ince cizgiyle goster")
    p.add_argument("--kaydet", metavar="KLASOR", help="Hareket/yuz olunca klasore video kaydet")
    p.add_argument("--yuz-klasor", metavar="KLASOR", help="Yakalanan yuzlerin fotograflarini kaydet")
    p.add_argument("--goruntusuz", action="store_true", help="Pencere acma (sunucu/headless)")
    p.add_argument("--max-kare", type=int, default=0, help="Test icin: bu kadar kareden sonra dur")
    a = p.parse_args()

    betik_klasor = os.path.dirname(os.path.abspath(__file__))
    dedektor = YuzDedektor(betik_klasor, a.yuz_esik)

    go2rtc_surec = None
    if a.kaynak == "go2rtc":
        a.kaynak, go2rtc_surec = go2rtc_hazirla(os.path.join(betik_klasor, "go2rtc"))
        print("Baglaniliyor:", a.kaynak)

    cap = kaynak_ac(a.kaynak)
    for _ in range(10):  # kamera ilk acilista birkac saniye gecikebilir
        if cap.isOpened():
            break
        time.sleep(2)
        cap = kaynak_ac(a.kaynak)
    if not cap.isOpened():
        raise SystemExit(f"Kaynak acilamadi: {a.kaynak}")

    arka_plan = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=32, detectShadows=True)
    cekirdek = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    yuz_takip = MerkezTakipci(max_kayip=12, max_mesafe=160, iz_uzunlugu=25)
    yumusak = {}          # yuz id -> titremesiz kutu
    gorulme = {}          # yuz id -> kac karedir art arda goruluyor
    kaydedilen = set()    # fotografi alinan yuz id'leri
    yuz_bekleme = 0       # hareket bitse de bir sure daha yuz ara
    yazici, son_olay, kare_no = None, 0.0, 0
    fps_t, fps = time.time(), 0.0
    if a.yuz_klasor:
        os.makedirs(a.yuz_klasor, exist_ok=True)

    while True:
        ok, kare = cap.read()
        if not ok:
            if a.kaynak.startswith("rtsp://"):
                print("Baglanti koptu, 2 sn sonra yeniden deneniyor...")
                cap.release()
                time.sleep(2)
                cap = kaynak_ac(a.kaynak)
                continue
            break
        kare_no += 1

        h0, w0 = kare.shape[:2]
        if w0 > a.genislik:
            kare = cv2.resize(kare, (a.genislik, int(h0 * a.genislik / w0)))
        h, w = kare.shape[:2]
        temiz = kare.copy()  # fotograf icin cizimsiz kopya

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
        if a.hareket_goster and hareket:
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
            if a.yuz_klasor and i not in kaydedilen and gorulme[i] >= 5:
                kaydedilen.add(i)
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

        if aktif:
            durum_yaz(kare, f"YUZ TAKIP: {len(aktif)}", YESIL)
        elif hareket or yuz_bekleme > 0:
            durum_yaz(kare, "HAREKET - yuz araniyor", SARI)
        else:
            durum_yaz(kare, "Bekleniyor", GRI)

        simdi = time.time()
        fps = 0.9 * fps + 0.1 / max(simdi - fps_t, 1e-6)
        fps_t = simdi
        cv2.putText(kare, f"{fps:.0f} FPS", (10, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, GRI, 1, cv2.LINE_AA)

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

        if not a.goruntusuz:
            cv2.imshow("Kamera Takip  (cikis: q)", kare)
            if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                break
        elif kare_no % 15 == 0 and (aktif or hareket):
            print(f"kare {kare_no}: hareket={hareket} yuzler=" +
                  ", ".join(f"Yuz{i}@{k[:2]}" for i, k in aktif))

        if a.max_kare and kare_no >= a.max_kare:
            break

    if yazici is not None:
        yazici.release()
    cap.release()
    if not a.goruntusuz:
        cv2.destroyAllWindows()
    if go2rtc_surec is not None:
        go2rtc_surec.terminate()


if __name__ == "__main__":
    main()
