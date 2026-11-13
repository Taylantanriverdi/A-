#!/usr/bin/env python3
"""
Hareketli nesne takibi - Xiaomi (veya herhangi bir) IP kamera icin.

Kaynak olarak RTSP adresi, video dosyasi ya da USB kamera numarasi verilebilir:
    python takip.py --kaynak rtsp://127.0.0.1:8554/xiaomi
    python takip.py --kaynak kayit.mp4
    python takip.py --kaynak 0

Yontem: arka plan cikarma (MOG2) ile hareketli pikseller bulunur, konturlar
kutulara cevrilir, her kutu merkez noktasina gore bir kimlik (ID) ile
kareden kareye takip edilir. Her nesnenin izi ekrana cizilir.
"""
import argparse
import os
import time
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


def kaynak_ac(kaynak):
    if kaynak.isdigit():
        return cv2.VideoCapture(int(kaynak))
    if kaynak.startswith("rtsp://"):
        # RTSP icin TCP daha kararli (gri/bozuk kare azalir)
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
        return cv2.VideoCapture(kaynak, cv2.CAP_FFMPEG)
    return cv2.VideoCapture(kaynak)


def main():
    p = argparse.ArgumentParser(description="IP kamera hareketli nesne takibi")
    p.add_argument("--kaynak", required=True, help="RTSP adresi, video dosyasi veya kamera no (0)")
    p.add_argument("--min-alan", type=int, default=800, help="Bu alandan kucuk hareketleri yok say (piksel)")
    p.add_argument("--genislik", type=int, default=960, help="Isleme genisligi (kucuk = hizli)")
    p.add_argument("--maske-saat", action="store_true",
                   help="Sol ustteki tarih/saat yazisini yok say (Xiaomi zaman damgasi)")
    p.add_argument("--kaydet", metavar="KLASOR", help="Hareket olunca klasore video kaydet")
    p.add_argument("--goruntusuz", action="store_true", help="Pencere acma (sunucu/headless)")
    p.add_argument("--max-kare", type=int, default=0, help="Test icin: bu kadar kareden sonra dur")
    a = p.parse_args()

    cap = kaynak_ac(a.kaynak)
    if not cap.isOpened():
        raise SystemExit(f"Kaynak acilamadi: {a.kaynak}")

    arka_plan = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=32, detectShadows=True)
    takipci = MerkezTakipci()
    cekirdek = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    yazici, son_hareket, kare_no = None, 0.0, 0
    fps_t, fps = time.time(), 0.0

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

        gri = cv2.GaussianBlur(kare, (5, 5), 0)
        maske = arka_plan.apply(gri)
        _, maske = cv2.threshold(maske, 200, 255, cv2.THRESH_BINARY)  # golgeleri (127) at
        maske = cv2.morphologyEx(maske, cv2.MORPH_OPEN, cekirdek, iterations=1)
        maske = cv2.dilate(maske, cekirdek, iterations=3)
        if a.maske_saat:
            maske[: int(h * 0.06), : int(w * 0.3)] = 0

        konturlar, _ = cv2.findContours(maske, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        kutular = [cv2.boundingRect(c) for c in konturlar if cv2.contourArea(c) >= a.min_alan]

        # Ilk ~1 sn arka plan ogreniliyor; o surede tespit yapma
        if kare_no < 30:
            kutular = []
        nesneler = takipci.guncelle(kutular)

        for i in nesneler:
            if takipci.kayip[i] > 0:
                continue
            x, y, bw, bh = takipci.kutular[i]
            renk = tuple(int(c) for c in np.random.default_rng(i).integers(60, 255, 3))
            cv2.rectangle(kare, (x, y), (x + bw, y + bh), renk, 2)
            cv2.putText(kare, f"ID {i}", (x, max(15, y - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, renk, 2)
            iz = list(takipci.izler[i])
            for k in range(1, len(iz)):
                cv2.line(kare, tuple(map(int, iz[k - 1])), tuple(map(int, iz[k])), renk, 2)

        aktif = sum(1 for i in nesneler if takipci.kayip[i] == 0)
        simdi = time.time()
        fps = 0.9 * fps + 0.1 / max(simdi - fps_t, 1e-6)
        fps_t = simdi
        cv2.putText(kare, f"Nesne: {aktif}  FPS: {fps:.1f}", (10, h - 12),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

        if a.kaydet:
            if aktif:
                son_hareket = simdi
                if yazici is None:
                    os.makedirs(a.kaydet, exist_ok=True)
                    ad = os.path.join(a.kaydet, datetime.now().strftime("hareket_%Y%m%d_%H%M%S.mp4"))
                    yazici = cv2.VideoWriter(ad, cv2.VideoWriter_fourcc(*"mp4v"), 15, (w, h))
                    print("Kayit basladi:", ad)
            if yazici is not None:
                yazici.write(kare)
                if simdi - son_hareket > 5:  # 5 sn hareket yoksa kaydi kapat
                    yazici.release()
                    yazici = None
                    print("Kayit bitti")

        if not a.goruntusuz:
            cv2.imshow("Takip", kare)
            cv2.imshow("Hareket maskesi", maske)
            if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                break
        elif aktif and kare_no % 15 == 0:
            print(f"kare {kare_no}: {aktif} hareketli nesne " +
                  ", ".join(f"ID{i}@{nesneler[i]}" for i in nesneler if takipci.kayip[i] == 0))

        if a.max_kare and kare_no >= a.max_kare:
            break

    if yazici is not None:
        yazici.release()
    cap.release()
    if not a.goruntusuz:
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
