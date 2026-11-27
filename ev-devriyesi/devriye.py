#!/usr/bin/env python3
"""
Ev Devriyesi - Roborock + IP kamera ile ev devriye robotu.

Robot, ayar dosyasindaki noktalari sirayla gezer. Her noktada durur,
kameradan birkac kare alir, YOLO ile insan / hayvan arar. Insan gorurse
fotografi Telegram'a alarm olarak gonderir. Devriye bitince sarja doner
ve ozet yollar.

Kullanim:
    python devriye.py                     # config.yaml ile gercek devriye
    python devriye.py --ayar benim.yaml
    python devriye.py --deneme            # robotu hareket ettirmeden test
    python devriye.py --nokta mutfak      # sadece tek noktaya git ve bak
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import requests
import yaml

log = logging.getLogger("devriye")

# COCO sinif numaralari (YOLO varsayilan modeli)
SINIFLAR = {0: "insan", 15: "kedi", 16: "kopek"}


# ---------------------------------------------------------------------------
# Robot kontrolu
# ---------------------------------------------------------------------------
class Robot:
    """Ortak arayuz."""

    def git(self, x: int, y: int) -> None: ...
    def hareket_ediyor_mu(self) -> bool: ...
    def eve_don(self) -> None: ...
    def batarya(self) -> int | None: ...

    def varana_kadar_bekle(self, zaman_asimi: int = 180) -> bool:
        """Robot hedefe varip durana kadar bekler."""
        bitis = time.time() + zaman_asimi
        # 1) Hareket baslasin (en fazla 20 sn). Robot zaten oradaysa hic baslamaz.
        baslama_sonu = time.time() + 20
        while time.time() < baslama_sonu and not self.hareket_ediyor_mu():
            time.sleep(2)
        # 2) Hareket bitsin
        while time.time() < bitis:
            if not self.hareket_ediyor_mu():
                return True
            time.sleep(2)
        log.warning("Robot %s sn icinde hedefe varamadi", zaman_asimi)
        return False


class HomeAssistantRobot(Robot):
    """Home Assistant'in Roborock entegrasyonu uzerinden kontrol."""

    HAREKET_DURUMLARI = {"cleaning", "returning"}

    def __init__(self, url: str, token: str, entity_id: str, batarya_sensoru: str | None = None):
        self.url = url.rstrip("/")
        self.entity_id = entity_id
        self.batarya_sensoru = batarya_sensoru
        self.s = requests.Session()
        self.s.headers["Authorization"] = f"Bearer {token}"

    def _servis(self, alan: str, servis: str, veri: dict) -> None:
        r = self.s.post(f"{self.url}/api/services/{alan}/{servis}", json=veri, timeout=15)
        r.raise_for_status()

    def _durum(self, entity_id: str) -> dict:
        r = self.s.get(f"{self.url}/api/states/{entity_id}", timeout=15)
        r.raise_for_status()
        return r.json()

    def git(self, x, y):
        self._servis("vacuum", "send_command", {
            "entity_id": self.entity_id,
            "command": "app_goto_target",
            "params": [x, y],
        })

    def hareket_ediyor_mu(self):
        durum = self._durum(self.entity_id)
        # Bazi surumlerde "Going to target" durumu ayri bir ozellik olarak gelir
        ozel = str(durum.get("attributes", {}).get("status", "")).lower()
        return durum["state"] in self.HAREKET_DURUMLARI or "going" in ozel

    def eve_don(self):
        self._servis("vacuum", "return_to_base", {"entity_id": self.entity_id})

    def batarya(self):
        try:
            if self.batarya_sensoru:
                return int(float(self._durum(self.batarya_sensoru)["state"]))
            return int(self._durum(self.entity_id)["attributes"]["battery_level"])
        except Exception:
            return None


class ValetudoRobot(Robot):
    """Valetudo (root'lu robot) REST API uzerinden yerel kontrol."""

    def __init__(self, url: str, kullanici: str | None = None, sifre: str | None = None):
        self.url = url.rstrip("/") + "/api/v2/robot"
        self.s = requests.Session()
        if kullanici:
            self.s.auth = (kullanici, sifre or "")

    def _ozellikler(self) -> list[dict]:
        r = self.s.get(f"{self.url}/state/attributes", timeout=15)
        r.raise_for_status()
        return r.json()

    def git(self, x, y):
        r = self.s.put(f"{self.url}/capabilities/GoToLocationCapability",
                       json={"action": "goto", "coordinates": {"x": x, "y": y}}, timeout=15)
        r.raise_for_status()

    def hareket_ediyor_mu(self):
        for o in self._ozellikler():
            if o.get("__class") == "StatusStateAttribute":
                return o.get("value") in {"moving", "cleaning", "returning"}
        return False

    def eve_don(self):
        self.s.put(f"{self.url}/capabilities/BasicControlCapability",
                   json={"action": "home"}, timeout=15).raise_for_status()

    def batarya(self):
        for o in self._ozellikler():
            if o.get("__class") == "BatteryStateAttribute":
                return int(o.get("level"))
        return None


class SahteRobot(Robot):
    """--deneme modu: robotu hareket ettirmez."""

    def git(self, x, y):
        log.info("[deneme] robot (%s, %s) noktasina gidiyormus gibi", x, y)

    def hareket_ediyor_mu(self):
        return False

    def eve_don(self):
        log.info("[deneme] robot sarja donuyormus gibi")

    def batarya(self):
        return 100


# ---------------------------------------------------------------------------
# Kamera ve goruntu isleme
# ---------------------------------------------------------------------------
class Kamera:
    def __init__(self, kaynak: str | int):
        self.kaynak = kaynak

    def kareler(self, adet: int, aralik: float) -> list:
        """Akisi acar, tampondaki eski kareleri atar, `adet` kare dondurur.

        Akis her noktada yeniden acilir; robot hareket ederken Wi-Fi'nin
        kopmasi sorun olmaz ve eski (gecikmeli) kare gelmez.
        """
        import cv2

        cap = cv2.VideoCapture(self.kaynak)
        if not cap.isOpened():
            raise RuntimeError(f"Kamera acilamadi: {self.kaynak}")
        try:
            for _ in range(15):  # tampondaki eski kareleri at
                cap.grab()
            sonuc = []
            for _ in range(adet):
                ok, kare = cap.read()
                if ok:
                    sonuc.append(kare)
                time.sleep(aralik)
            return sonuc
        finally:
            cap.release()


@dataclass
class Tespit:
    sinif: str
    guven: float
    kare: object  # kutular cizilmis goruntu


class Dedektor:
    def __init__(self, model: str, esik: float):
        from ultralytics import YOLO

        self.model = YOLO(model)
        self.esik = esik

    def bul(self, kare) -> list[Tespit]:
        sonuc = self.model(kare, conf=self.esik, classes=list(SINIFLAR), verbose=False)[0]
        cizili = sonuc.plot()
        return [Tespit(SINIFLAR[int(k.cls)], float(k.conf), cizili) for k in sonuc.boxes]


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------
class Telegram:
    def __init__(self, token: str | None, chat_id: str | None):
        self.aktif = bool(token and chat_id)
        self.api = f"https://api.telegram.org/bot{token}"
        self.chat_id = chat_id

    def mesaj(self, metin: str) -> None:
        log.info("Bildirim: %s", metin)
        if self.aktif:
            requests.post(f"{self.api}/sendMessage",
                          data={"chat_id": self.chat_id, "text": metin}, timeout=20)

    def foto(self, yol: Path, aciklama: str) -> None:
        log.info("Foto: %s (%s)", yol, aciklama)
        if self.aktif:
            with open(yol, "rb") as f:
                requests.post(f"{self.api}/sendPhoto",
                              data={"chat_id": self.chat_id, "caption": aciklama},
                              files={"photo": f}, timeout=60)


# ---------------------------------------------------------------------------
# Devriye
# ---------------------------------------------------------------------------
def robot_olustur(ayar: dict, deneme: bool) -> Robot:
    if deneme:
        return SahteRobot()
    r = ayar["robot"]
    if r["tur"] == "homeassistant":
        return HomeAssistantRobot(r["url"], r["token"], r["entity_id"], r.get("batarya_sensoru"))
    if r["tur"] == "valetudo":
        return ValetudoRobot(r["url"], r.get("kullanici"), r.get("sifre"))
    raise ValueError(f"Bilinmeyen robot turu: {r['tur']}")


def devriye(ayar: dict, deneme: bool, tek_nokta: str | None) -> int:
    import cv2

    robot = robot_olustur(ayar, deneme)
    kamera = Kamera(ayar["kamera"]["kaynak"])
    d = ayar.get("tespit", {})
    dedektor = Dedektor(d.get("model", "yolov8n.pt"), d.get("esik", 0.5))
    tg = Telegram(ayar.get("telegram", {}).get("token"), ayar.get("telegram", {}).get("chat_id"))
    dv = ayar.get("devriye", {})
    alarm_siniflari = set(dv.get("alarm_siniflari", ["insan"]))

    noktalar = ayar["noktalar"]
    if tek_nokta:
        noktalar = [n for n in noktalar if n["ad"] == tek_nokta]
        if not noktalar:
            log.error("'%s' adinda nokta yok", tek_nokta)
            return 2

    min_batarya = dv.get("min_batarya", 30)
    pil = robot.batarya()
    if pil is not None and pil < min_batarya:
        tg.mesaj(f"Devriye iptal: batarya %{pil} (en az %{min_batarya} gerekli)")
        return 1

    klasor = Path(dv.get("kayit_klasoru", "kayitlar")) / dt.datetime.now().strftime("%Y-%m-%d_%H-%M")
    klasor.mkdir(parents=True, exist_ok=True)

    tg.mesaj(f"Devriye basladi: {len(noktalar)} nokta")
    ozet: list[str] = []
    alarm_var = False

    try:
        for n in noktalar:
            ad = n["ad"]
            log.info("-> %s (%s, %s)", ad, n["x"], n["y"])
            robot.git(n["x"], n["y"])
            if not robot.varana_kadar_bekle(dv.get("zaman_asimi", 180)):
                ozet.append(f"{ad}: ulasilamadi")
                continue
            time.sleep(dv.get("bekleme", 2))  # titresim dinsin, kamera netlessin

            try:
                kareler = kamera.kareler(dv.get("kare_sayisi", 5), dv.get("kare_araligi", 0.5))
            except RuntimeError as e:
                ozet.append(f"{ad}: kamera hatasi")
                log.error(e)
                continue

            en_iyi: Tespit | None = None
            gorulenler: set[str] = set()
            for kare in kareler:
                for t in dedektor.bul(kare):
                    gorulenler.add(t.sinif)
                    if t.sinif in alarm_siniflari and (en_iyi is None or t.guven > en_iyi.guven):
                        en_iyi = t

            # Her noktanin fotografini kaydet
            yol = klasor / f"{ad}.jpg"
            cv2.imwrite(str(yol), en_iyi.kare if en_iyi else kareler[-1])

            if en_iyi:
                alarm_var = True
                saat = dt.datetime.now().strftime("%H:%M")
                tg.foto(yol, f"ALARM {saat} - {ad}: {en_iyi.sinif} (%{en_iyi.guven*100:.0f})")
            elif dv.get("her_noktayi_gonder", False):
                tg.foto(yol, f"{ad}: temiz")

            ozet.append(f"{ad}: {', '.join(sorted(gorulenler)) or 'temiz'}")
    finally:
        robot.eve_don()

    tg.mesaj(("Devriye bitti (ALARM VAR)" if alarm_var else "Devriye bitti, her sey yolunda")
             + "\n" + "\n".join(ozet))
    return 0


def main() -> None:
    p = argparse.ArgumentParser(description="Roborock ev devriyesi")
    p.add_argument("--ayar", default="config.yaml")
    p.add_argument("--deneme", action="store_true", help="robotu hareket ettirme")
    p.add_argument("--nokta", help="sadece bu noktaya git")
    a = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    with open(a.ayar, encoding="utf-8") as f:
        ayar = yaml.safe_load(f)
    sys.exit(devriye(ayar, a.deneme, a.nokta))


if __name__ == "__main__":
    main()
