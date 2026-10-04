"""Yönetici: otomatik geliştirmesi açık tüm projeler arasında sırayla dolaşır.

Her turda en uzun süredir sıra gelmeyen projeyi seçer ve orada bir görev yapar (gerekirse önce planlar).
Hedefi tamamlanan proje, yeni görev eklenene ya da hedef değişene kadar atlanır; hata veren proje bir
süre dinlendirilir. Kullanım limiti/bakiye beklemesi o anki projenin içinde yapılır.

    python -m otopilot hepsi
"""

from __future__ import annotations

import datetime as dt
import json
import os
import time

from .durum import KOK, Durum, _surec_yasiyor, tum_projeler

DURUM_DOSYASI = KOK / "yonetici.json"
KILIT = KOK / "yonetici.kilit"
HATA_DINLENME = dt.timedelta(minutes=30)
BOSTA_BEKLEME_SN = 30


def yonetici_durumu() -> dict:
    try:
        v = json.loads(DURUM_DOSYASI.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        v = {}
    pid = None
    try:
        pid = int(KILIT.read_text().strip())
    except (OSError, ValueError):
        pass
    v["calisiyor"] = bool(pid and _surec_yasiyor(pid))
    v["pid"] = pid if v["calisiyor"] else None
    return v


def _yaz(**degerler) -> None:
    KOK.mkdir(parents=True, exist_ok=True)
    try:
        v = json.loads(DURUM_DOSYASI.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        v = {}
    v.update(degerler)
    gecici = DURUM_DOSYASI.with_suffix(".tmp")
    gecici.write_text(json.dumps(v, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    gecici.replace(DURUM_DOSYASI)


def is_imzasi(d: Durum) -> str:
    """Projede yapılacak işi özetler; değişirse 'bitti' sayılan proje yeniden ele alınır."""
    ayar = d.ayarlari_oku()
    bekleyen = sum(1 for durum, _ in d.gorevleri_oku() if durum == " ")
    return f"{ayar.hedef if ayar else ''}|{bekleyen}"


def sirasi_gelebilir(d: Durum, simdi: dt.datetime) -> tuple[bool, str]:
    ayar = d.ayarlari_oku()
    if not ayar or not ayar.otomatik:
        return False, "otomatik kapalı"
    if not d.proje.exists():
        return False, "klasör bulunamadı"
    v = d.oku()
    if v.get("asama") == "bitti" and v.get("bitti_imzasi") == is_imzasi(d) and not v.get("aktif"):
        return False, "hedef tamamlandı"
    dinlen = v.get("dinlen_until")
    if dinlen and dt.datetime.fromisoformat(dinlen) > simdi:
        return False, "hata sonrası dinleniyor"
    if not ayar.hedef and not d.siradaki_gorev() and not v.get("aktif"):
        return False, "hedef/görev yok"
    if d.calisiyor_mu():
        return False, "başka bir otopilot çalıştırıyor"
    return True, ""


def calistir() -> None:
    from .dongu import Otopilot

    KOK.mkdir(parents=True, exist_ok=True)
    try:
        eski = int(KILIT.read_text().strip())
    except (OSError, ValueError):
        eski = 0
    if eski and eski != os.getpid() and _surec_yasiyor(eski):
        raise SystemExit("Yönetici zaten çalışıyor.")
    KILIT.write_text(str(os.getpid()))
    _yaz(baslangic=dt.datetime.now().isoformat(timespec="seconds"), aktif=None, not_=None)
    print("Otopilot yöneticisi başladı: otomatik geliştirmesi açık projeler sırayla geliştirilecek.", flush=True)

    try:
        while True:
            simdi = dt.datetime.now().astimezone()
            adaylar = [d for d in tum_projeler() if sirasi_gelebilir(d, simdi)[0]]
            if not adaylar:
                _yaz(aktif=None, not_="Şu an yapılacak iş yok. Proje, görev veya hedef eklenince devam edilecek.")
                time.sleep(BOSTA_BEKLEME_SN)
                continue

            # Yarım görevi olan proje önce, sonra en uzun süredir sıra gelmeyen
            d = min(adaylar, key=lambda d: (not d.oku().get("aktif"), d.oku().get("son_sira") or ""))
            ayar = d.ayarlari_oku()
            _yaz(aktif=d.dizin.name, aktif_proje=str(d.proje), not_=None,
                 aktif_baslangic=simdi.isoformat(timespec="seconds"))
            print(f"\n=== {d.proje.name} ===", flush=True)
            try:
                Otopilot(d, ayar, tek_sefer=True).calistir()
            except SystemExit as e:
                d.olay("hata", f"Bu proje atlandı: {e.code}", asama="hata")
            except Exception as e:  # bir projedeki hata diğerlerini durdurmasın
                d.olay("hata", f"Beklenmeyen hata: {type(e).__name__}: {e}", asama="hata")
            d.yaz(son_sira=dt.datetime.now().isoformat(timespec="seconds"))

            asama = d.oku().get("asama")
            if asama == "durdu":  # Ctrl+C
                break
            if asama == "bitti":
                d.yaz(bitti_imzasi=is_imzasi(d))
            elif asama == "hata":
                d.yaz(dinlen_until=(dt.datetime.now().astimezone() + HATA_DINLENME).isoformat())
    except KeyboardInterrupt:
        pass
    finally:
        _yaz(aktif=None, not_=None)
        try:
            if KILIT.read_text().strip() == str(os.getpid()):
                KILIT.unlink()
        except OSError:
            pass
        print("Yönetici durdu.", flush=True)
