"""Klasör izleme: belirlenen klasörlere arka planda belirli aralıklarla bakar ve yeni gelen dosya/klasörleri
bir kez bildirir. Sadece okur; hiçbir şeyi değiştirmez. İzlemeler veri/izlemeler.json'da saklanır,
Offline Agent yeniden açılınca kaldığı yerden devam eder.
"""
import json
import os
import threading
import time
import uuid
from collections import deque
from pathlib import Path

from ayarlar import KOK

DEPO = KOK / "veri" / "izlemeler.json"
EN_KISA_ARALIK = 5
TURLER = ("hepsi", "klasor", "dosya")

_kilit = threading.Lock()
_izlemeler: dict[str, dict] = {}
_bildirimler: deque = deque(maxlen=200)
_son_bildirim_no = 0
_calisiyor = False


def _kaydet() -> None:
    DEPO.parent.mkdir(parents=True, exist_ok=True)
    veri = [{**i, "bilinen": sorted(i["bilinen"])} for i in _izlemeler.values()]
    gecici = DEPO.with_suffix(".tmp")
    gecici.write_text(json.dumps(veri, ensure_ascii=False), "utf-8")
    gecici.replace(DEPO)


def _icerik(yol: str, tur: str) -> set[str]:
    adlar = set()
    with os.scandir(yol) as ogeler:
        for oge in ogeler:
            if oge.name.startswith((".", "~$")) or oge.name in ("desktop.ini", "Thumbs.db"):
                continue
            klasor = oge.is_dir(follow_symlinks=False)
            if tur == "hepsi" or (tur == "klasor") == klasor:
                adlar.add(("[klasör] " if klasor else "") + oge.name)
    return adlar


def _bildir(metin: str, izleme_id: str = "") -> None:
    global _son_bildirim_no
    _son_bildirim_no += 1
    _bildirimler.append({"no": _son_bildirim_no, "zaman": time.strftime("%H:%M:%S"), "metin": metin, "izleme": izleme_id})


def ekle(yol: str, aralik: int, tur: str) -> dict:
    """Yeni izleme başlatır; şu anki içerik "bilinen" sayılır, sadece bundan sonra gelenler bildirilir."""
    p = Path(yol)
    if not p.is_dir():
        raise ValueError(f"Klasör bulunamadı: {p}")
    tur = tur if tur in TURLER else "hepsi"
    aralik = max(EN_KISA_ARALIK, int(aralik))
    with _kilit:
        for mevcut in _izlemeler.values():
            if mevcut["yol"] == str(p) and mevcut["tur"] == tur:
                mevcut["aralik"] = aralik
                _kaydet()
                return {k: v for k, v in mevcut.items() if k != "bilinen"} | {"zaten_vardi": True}
        izleme = {"id": uuid.uuid4().hex[:6], "yol": str(p), "aralik": aralik, "tur": tur,
                  "bilinen": _icerik(str(p), tur), "son_kontrol": time.time(), "baslangic": time.strftime("%Y-%m-%d %H:%M")}
        _izlemeler[izleme["id"]] = izleme
        _kaydet()
    return {k: v for k, v in izleme.items() if k != "bilinen"}


def liste() -> list[dict]:
    with _kilit:
        return [{k: v for k, v in i.items() if k != "bilinen"} | {"oge_sayisi": len(i["bilinen"])} for i in _izlemeler.values()]


def durdur(izleme_id: str) -> bool:
    with _kilit:
        if _izlemeler.pop(izleme_id, None) is None:
            return False
        _kaydet()
        return True


def bildirimler(son_no: int = 0) -> list[dict]:
    return [b for b in list(_bildirimler) if b["no"] > son_no]


def son_no() -> int:
    return _son_bildirim_no


def _dongu() -> None:
    while True:
        time.sleep(1)
        simdi = time.time()
        with _kilit:
            bekleyen = [i for i in _izlemeler.values() if simdi - i["son_kontrol"] >= i["aralik"]]
        for izleme in bekleyen:
            izleme["son_kontrol"] = simdi
            try:
                guncel = _icerik(izleme["yol"], izleme["tur"])
            except OSError:
                continue  # klasör geçici olarak erişilemez (ör. ağ sürücüsü); sonra tekrar denenir
            with _kilit:
                if izleme["id"] not in _izlemeler:
                    continue
                yeniler = sorted(guncel - izleme["bilinen"])
                izleme["bilinen"] = guncel
                if yeniler:
                    _kaydet()
            if yeniler:
                klasor_adi = Path(izleme["yol"]).name or izleme["yol"]
                liste_metni = ", ".join(yeniler[:10]) + (f" ve {len(yeniler) - 10} tane daha" if len(yeniler) > 10 else "")
                _bildir(f"“{klasor_adi}” klasörüne {len(yeniler)} yeni öğe geldi: {liste_metni}", izleme["id"])


def baslat() -> None:
    global _calisiyor
    if _calisiyor:
        return
    _calisiyor = True
    try:
        for i in json.loads(DEPO.read_text("utf-8")):
            i["bilinen"] = set(i.get("bilinen", []))
            i["son_kontrol"] = 0
            _izlemeler[i["id"]] = i
    except (OSError, ValueError, KeyError):
        pass
    threading.Thread(target=_dongu, daemon=True, name="klasor-izleyici").start()
