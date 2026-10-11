"""Yüz tanıma (tamamen yerel): OpenCV YuNet ile yüz bulunur, SFace ile kişi tanınır.

Kayıtlı kişiler veri/yuzler.json içinde yüz vektörleri olarak saklanır; fotoğraf saklanmaz.
"""
import base64
import json
import sys
import threading
import time
from pathlib import Path

import numpy as np

from ayarlar import KOK

MODEL_DIZINI = KOK / "araclar" / "yuz"
DEPO = KOK / "veri" / "yuzler.json"
TESPIT_MODELI = "face_detection_yunet_2023mar.onnx"
TANIMA_MODELI = "face_recognition_sface_2021dec.onnx"
MODEL_ADRESI = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/{klasor}/{dosya}"
ESIK = 0.363  # SFace için önerilen kosinüs benzerlik eşiği

_kilit = threading.Lock()
_tespit = None
_tanima = None


def modeller_var() -> bool:
    return all((MODEL_DIZINI / d).exists() for d in (TESPIT_MODELI, TANIMA_MODELI))


def _yukle():
    global _tespit, _tanima
    if _tespit is None:
        if not modeller_var():
            raise RuntimeError("Yüz tanıma modelleri kurulu değil. İnternet varken GUNCELLE.bat çalıştırın.")
        import cv2

        _tespit = cv2.FaceDetectorYN.create(str(MODEL_DIZINI / TESPIT_MODELI), "", (320, 320), 0.8)
        _tanima = cv2.FaceRecognizerSF.create(str(MODEL_DIZINI / TANIMA_MODELI), "")
    return _tespit, _tanima


def _resim(b64: str):
    import cv2

    veri = np.frombuffer(base64.b64decode(b64.split(",")[-1]), np.uint8)
    resim = cv2.imdecode(veri, cv2.IMREAD_COLOR)
    if resim is None:
        raise ValueError("Resim okunamadı")
    return resim


def _yuzler(b64: str) -> list[tuple[list[int], np.ndarray]]:
    """Resimdeki her yüz için (kutu, normalize vektör) döndürür; büyük yüz önce."""
    resim = _resim(b64)
    with _kilit:
        tespit, tanima = _yukle()
        yukseklik, genislik = resim.shape[:2]
        tespit.setInputSize((genislik, yukseklik))
        _, bulunan = tespit.detect(resim)
        sonuc = []
        for yuz in [] if bulunan is None else sorted(bulunan, key=lambda f: -f[2] * f[3]):
            vektor = tanima.feature(tanima.alignCrop(resim, yuz)).flatten()
            sonuc.append(([int(v) for v in yuz[:4]], vektor / max(np.linalg.norm(vektor), 1e-9)))
        return sonuc


def _oku() -> dict:
    try:
        return json.loads(DEPO.read_text("utf-8"))
    except (OSError, ValueError):
        return {"kisiler": []}


def _yaz(veri: dict) -> None:
    DEPO.parent.mkdir(parents=True, exist_ok=True)
    gecici = DEPO.with_suffix(".tmp")
    gecici.write_text(json.dumps(veri, ensure_ascii=False), "utf-8")
    gecici.replace(DEPO)


def kisiler() -> list[dict]:
    return [{"ad": k["ad"], "ornek": len(k["vektorler"]), "tarih": k.get("tarih")} for k in _oku()["kisiler"]]


def kaydet(ad: str, resimler: list[str]) -> dict:
    """Bir kişiyi birkaç kareden öğrenir. Her karede en büyük yüz alınır."""
    ad = ad.strip()[:60]
    if not ad:
        raise ValueError("İsim boş olamaz")
    vektorler = []
    for b64 in resimler[:10]:
        yuzler = _yuzler(b64)
        if yuzler:
            vektorler.append(yuzler[0][1].round(5).tolist())
    if not vektorler:
        raise ValueError("Görüntülerde yüz bulunamadı. Kameraya önden ve aydınlık bir yerde bakın.")
    veri = _oku()
    kisi = next((k for k in veri["kisiler"] if k["ad"].lower() == ad.lower()), None)
    if kisi is None:
        kisi = {"ad": ad, "vektorler": []}
        veri["kisiler"].append(kisi)
    kisi["vektorler"] = (kisi["vektorler"] + vektorler)[-20:]
    kisi["tarih"] = time.strftime("%Y-%m-%d %H:%M")
    _yaz(veri)
    return {"ad": ad, "eklenen": len(vektorler), "ornek": len(kisi["vektorler"])}


def sil(ad: str) -> bool:
    veri = _oku()
    once = len(veri["kisiler"])
    veri["kisiler"] = [k for k in veri["kisiler"] if k["ad"] != ad]
    _yaz(veri)
    return len(veri["kisiler"]) < once


def tani(b64: str) -> list[dict]:
    """Resimdeki yüzleri kayıtlı kişilerle karşılaştırır."""
    kayitli = _oku()["kisiler"]
    sonuc = []
    for kutu, vektor in _yuzler(b64):
        en_iyi, skor = None, 0.0
        for kisi in kayitli:
            benzerlik = float(np.max(np.asarray(kisi["vektorler"], np.float32) @ vektor))
            if benzerlik > skor:
                en_iyi, skor = kisi["ad"], benzerlik
        sonuc.append({"ad": en_iyi if skor >= ESIK else None, "skor": round(skor, 3), "kutu": kutu})
    return sonuc


if __name__ == "__main__":
    # Kurulum betiği çağırır: python yuz.py  -> modelleri araclar/yuz klasörüne indirir
    import urllib.request

    MODEL_DIZINI.mkdir(parents=True, exist_ok=True)
    for klasor, dosya in (("face_detection_yunet", TESPIT_MODELI), ("face_recognition_sface", TANIMA_MODELI)):
        hedef = MODEL_DIZINI / dosya
        if hedef.exists() and hedef.stat().st_size > 100_000:
            print(f"Zaten var: {dosya}")
            continue
        print(f"İndiriliyor: {dosya}")
        gecici = hedef.with_suffix(".indiriliyor")
        urllib.request.urlretrieve(MODEL_ADRESI.format(klasor=klasor, dosya=dosya), gecici)
        if gecici.stat().st_size < 100_000:  # LFS işaretçisi ya da hata sayfası
            gecici.unlink()
            sys.exit(f"İndirme başarısız: {dosya}")
        gecici.replace(hedef)
    print("Yüz tanıma modelleri hazır.")
