"""Asistanın bilgisayarda iş yapan kısmı: model araç kullanarak klasör/dosya işlemleri yapar, program
açar, belgelerde arar, kod ve komut çalıştırır.

Onay politikası (ayarlardaki "onay_modu"):
- "riskli" (varsayılan): okuma ve zararsız işler (klasör oluşturma, kopyalama, belge/klasör açma)
  hemen yapılır; silme, taşıma, üzerine yazma, program başlatma, kod ve komut onay ister.
- "hepsi": okuma dışındaki her işlem onay ister.
Dosyalar klasörünün (D:\\offlineagent\\dosyalar) içinde kalan dosya işleri iki modda da onaysız yapılır
(Ayarlar > "Dosyalar klasöründe onay sorma"). Python/PowerShell her zaman onay ister: kod bir klasöre hapsedilemez.
Sohbet durumu istemcide tutulur: her istek tüm geçmişi gönderir, sunucu güncel geçmişi geri yollar.
"""
import datetime
import json
import os
import re
import platform
import shutil
import subprocess
import sys
from pathlib import Path

from starlette.concurrency import run_in_threadpool

import hafiza
import izleyici
import primerlab
from ayarlar import KOK, ayarlari_oku
from belge_oku import belgeyi_oku
from ollama_api import OllamaHatasi, sohbet_akisi



def _dosyalar_klasoru() -> Path:
    """Kullanıcının dosyalar klasörü: buraya koyulan her şeyde asistan onay sormadan çalışır.
    ayarlar.json'da "dosyalar_klasoru" verilmişse o kullanılır; yoksa D:\\offlineagent içinde
    "dosyalarım" adlı bir klasör varsa o, yoksa "dosyalar"."""
    secilen = str(ayarlari_oku().get("dosyalar_klasoru", "") or "").strip().strip('"')
    if secilen:
        yol = Path(os.path.expandvars(secilen))
        return yol if yol.is_absolute() else KOK / yol
    for ad in ("dosyalarım", "Dosyalarım", "dosyalarim", "Dosyalarim"):
        if (KOK / ad).is_dir():
            return KOK / ad
    varsayilan = KOK / "dosyalar"
    eski = KOK / "calisma"
    if eski.is_dir() and not varsayilan.exists():
        try:
            eski.rename(varsayilan)  # eski sürümlerin "calisma" klasörü taşınır
        except OSError:
            pass
    return varsayilan


CALISMA = _dosyalar_klasoru()
MAKS_TUR = 12
MAKS_CIKTI = 8000
ZAMAN_ASIMI = 120
WINDOWS = sys.platform == "win32"

# Windows bilinen klasörleri (OneDrive'a taşınmış masaüstü dahil doğru yeri verir)
BILINEN_KLASORLER = {
    "Masaüstü": ("B4BFCC3A-DB2C-424C-B029-7FE99A87C641", "Desktop"),
    "Belgeler": ("FDD39AD0-238F-46AF-ADB4-6C85480369C7", "Documents"),
    "İndirilenler": ("374DE290-123F-4565-9164-39C4925E467B", "Downloads"),
    "Resimler": ("33E28130-4E1E-4676-835A-98395C3BC3BB", "Pictures"),
    "Müzik": ("4BD8D571-6D19-48D3-BE97-422220080E43", "Music"),
    "Videolar": ("18989B1D-99B5-455B-841C-AB7C74E4DDFC", "Videos"),
}
KLASOR_TAKMA_ADLARI = {
    "masaüstü": "Masaüstü", "masaustu": "Masaüstü", "masa üstü": "Masaüstü", "desktop": "Masaüstü",
    "belgeler": "Belgeler", "belgelerim": "Belgeler", "documents": "Belgeler",
    "indirilenler": "İndirilenler", "i̇ndirilenler": "İndirilenler", "downloads": "İndirilenler",
    "karşıdan yüklenenler": "İndirilenler",
    "resimler": "Resimler", "pictures": "Resimler", "müzik": "Müzik", "music": "Müzik",
    "videolar": "Videolar", "videos": "Videolar",
}
# Onay istemeden açılabilecek uygulamalar (adı söylenince)
UYGULAMALAR = {
    "not defteri": "notepad", "notepad": "notepad", "hesap makinesi": "calc", "paint": "mspaint",
    "dosya gezgini": "explorer", "gezgin": "explorer", "görev yöneticisi": "taskmgr", "ayarlar": "ms-settings:",
    "komut istemi": "cmd", "powershell": "powershell", "word": "winword", "excel": "excel",
    "powerpoint": "powerpnt", "edge": "msedge", "chrome": "chrome", "kamera": "microsoft.windows.camera:",
}
CALISTIRILABILIR = {".exe", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".msi", ".lnk", ".com", ".scr", ".reg", ".jar", ".py"}


def _bilinen_klasor(ad: str) -> Path:
    guid, yedek = BILINEN_KLASORLER[ad]
    if WINDOWS:
        try:
            import ctypes
            import uuid
            from ctypes import wintypes

            class GUID(ctypes.Structure):
                _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD), ("Data3", wintypes.WORD),
                            ("Data4", ctypes.c_ubyte * 8)]

            u = uuid.UUID(guid)
            g = GUID(u.fields[0], u.fields[1], u.fields[2], (ctypes.c_ubyte * 8).from_buffer_copy(u.bytes[8:]))
            yol = ctypes.c_wchar_p()
            if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(g), 0, None, ctypes.byref(yol)) == 0:
                sonuc = Path(yol.value)
                ctypes.windll.ole32.CoTaskMemFree(yol)
                return sonuc
        except (OSError, AttributeError, ValueError):
            pass
    return Path.home() / yedek


def _kisalt(metin: str) -> str:
    return metin if len(metin) <= MAKS_CIKTI else metin[:MAKS_CIKTI] + f"\n… (çıktı kısaltıldı, toplam {len(metin)} karakter)"


def _yol(yol: str) -> Path:
    """"Masaüstü/Rapor" gibi takma adları gerçek klasöre çevirir; göreli yollar çalışma klasörüne göredir."""
    metin = os.path.expandvars(os.path.expanduser(str(yol).strip().strip('"') or "."))
    parcalar = metin.replace("\\", "/").split("/", 1)
    ilk = parcalar[0].strip().casefold()
    if ilk in ("dosyalar", "dosyalarım", "dosyalarim"):
        return CALISMA / parcalar[1] if len(parcalar) > 1 and parcalar[1] else CALISMA
    takma = KLASOR_TAKMA_ADLARI.get(ilk)
    if takma:
        kok = _bilinen_klasor(takma)
        return kok / parcalar[1] if len(parcalar) > 1 and parcalar[1] else kok
    p = Path(metin)
    return p if p.is_absolute() else CALISMA / p


def _calistir(komut: list[str]) -> str:
    ortam = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    try:
        sonuc = subprocess.run(
            komut, cwd=CALISMA, capture_output=True, timeout=ZAMAN_ASIMI, env=ortam,
            creationflags=subprocess.CREATE_NO_WINDOW if WINDOWS else 0,
        )
    except subprocess.TimeoutExpired:
        return f"Zaman aşımı: işlem {ZAMAN_ASIMI} saniyede bitmedi ve durduruldu."
    cikti = sonuc.stdout.decode("utf-8", "replace")
    hata = sonuc.stderr.decode("utf-8", "replace")
    parcalar = [f"Çıkış kodu: {sonuc.returncode}"]
    if cikti.strip():
        parcalar.append(f"Çıktı:\n{cikti}")
    if hata.strip():
        parcalar.append(f"Hata çıktısı:\n{hata}")
    return _kisalt("\n".join(parcalar))


# ---------- Araçlar ----------

def hafizaya_kaydet(bilgi: str) -> str:
    return "Hafızaya kaydedildi." if hafiza.ekle(bilgi, "ajan") else "Bu bilgi zaten kayıtlı ya da boş."


def tarih_saat() -> str:
    gunler = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]
    simdi = datetime.datetime.now()
    return simdi.strftime("%d.%m.%Y %H:%M, ") + gunler[simdi.weekday()]


def sistem_bilgisi() -> str:
    satirlar = [f"Bilgisayar: {platform.node()} · {platform.system()} {platform.release()}",
                f"İşlemci çekirdeği: {os.cpu_count()}"]
    diskler = [f"{h}:\\" for h in "CDEFGH"] if WINDOWS else ["/"]
    for disk in diskler:
        try:
            k = shutil.disk_usage(disk)
            satirlar.append(f"Disk {disk}  boş {k.free / 1e9:.1f} GB / toplam {k.total / 1e9:.1f} GB (%{100 * k.used / k.total:.0f} dolu)")
        except OSError:
            continue
    return "\n".join(satirlar)


def dosya_listele(klasor: str = "") -> str:
    p = _yol(klasor)
    if not p.is_dir():
        return f"Klasör bulunamadı: {p}"
    satirlar = []
    for oge in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))[:200]:
        satirlar.append(f"[klasör] {oge.name}" if oge.is_dir() else f"{oge.name} ({oge.stat().st_size} bayt)")
    return f"{p}:\n" + ("\n".join(satirlar) or "(boş)")


def dosya_oku(yol: str) -> str:
    p = _yol(yol)
    if not p.is_file():
        return f"Dosya bulunamadı: {p}"
    metin = "\n\n".join(f"[{s}]\n{m}" if s else m for s, m in belgeyi_oku(p))
    return _kisalt(metin) or "(dosyada okunabilir metin yok)"


def klasor_olustur(yol: str) -> str:
    p = _yol(yol)
    if p.is_dir():
        return f"Bu klasör zaten var: {p}"
    p.mkdir(parents=True)
    return f"Klasör oluşturuldu: {p}"


def dosya_yaz(yol: str, icerik: str) -> str:
    p = _yol(yol)
    vardi = p.exists()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(icerik, "utf-8")
    return f"{'Üzerine yazıldı' if vardi else 'Dosya oluşturuldu'}: {p} ({len(icerik)} karakter)"


def dosya_kopyala(kaynak: str, hedef: str) -> str:
    k, h = _yol(kaynak), _yol(hedef)
    if not k.exists():
        return f"Kaynak bulunamadı: {k}"
    if h.is_dir():
        h = h / k.name
    if h.exists():
        return f"Hedefte aynı adla bir şey var, üzerine yazılmadı: {h}"
    h.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(k, h) if k.is_dir() else shutil.copy2(k, h)
    return f"Kopyalandı: {k} → {h}"


def dosya_tasi(kaynak: str, hedef: str) -> str:
    k, h = _yol(kaynak), _yol(hedef)
    if not k.exists():
        return f"Kaynak bulunamadı: {k}"
    if h.is_dir():
        h = h / k.name
    if h.exists():
        return f"Hedefte aynı adla bir şey var, taşınmadı: {h}"
    h.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(k), str(h))
    return f"Taşındı / yeniden adlandırıldı: {k} → {h}"


def _klasor_icinde(yol: str, kok_dahil: bool = False) -> bool:
    """Yol dosyalar klasörünün içinde mi? (kısayol/üst klasör hilelerine karşı gerçek yola bakılır)"""
    try:
        p, kok = _yol(yol).resolve(), CALISMA.resolve()
    except (OSError, ValueError):
        return False
    return kok in p.parents or (kok_dahil and p == kok)


def icerikte_ara(metin: str, klasor: str = "") -> str:
    """Dosyaların İÇİNDE metin arar (varsayılan: dosyalar klasörü)."""
    import time

    kok = _yol(klasor) if klasor else CALISMA
    if not kok.is_dir():
        return f"Klasör bulunamadı: {kok}"
    aranan = metin.strip().casefold()
    if len(aranan) < 2:
        return "Aranacak metin en az 2 karakter olmalı."
    from belge_oku import DESTEKLENEN
    okunur = (DESTEKLENEN - {".png", ".jpg", ".jpeg", ".webp", ".bmp"}) | {
        ".py", ".js", ".html", ".css", ".xml", ".ini", ".cfg", ".yaml", ".yml", ".ps1", ".bat", ".sql", ".cs", ".ts"}
    sonuclar, bakilan, bitis = [], 0, time.monotonic() + 20
    for dosya in sorted(kok.rglob("*")):
        if time.monotonic() > bitis or len(sonuclar) >= 30:
            break
        if not dosya.is_file() or dosya.suffix.lower() not in okunur or dosya.stat().st_size > 20_000_000:
            continue
        bakilan += 1
        try:
            parcalar = belgeyi_oku(dosya)
        except Exception:  # bozuk ya da şifreli dosya aramayı durdurmasın
            continue
        for kaynak, icerik in parcalar:
            konum = icerik.casefold().find(aranan)
            if konum < 0:
                continue
            alinti = " ".join(icerik[max(0, konum - 80): konum + len(aranan) + 80].split())
            yer = dosya.relative_to(kok).as_posix() + (f" [{kaynak}]" if kaynak else "")
            sonuclar.append(f"- {yer}: …{alinti}…")
            break
    if not sonuclar:
        return f"'{metin}' hiçbir dosyanın içinde bulunamadı ({kok} içinde {bakilan} dosyaya bakıldı)."
    return f"'{metin}' geçen dosyalar ({kok}):\n" + "\n".join(sonuclar)


def cop_kutusuna_at(yol: str) -> str:
    from send2trash import send2trash

    p = _yol(yol)
    if not p.exists():
        return f"Bulunamadı: {p}"
    send2trash(str(p))
    return f"Geri Dönüşüm Kutusu'na taşındı (geri alınabilir): {p}"


_TR = str.maketrans("çğıöşüâî", "cgiosuai")
_EKLER = ("nın", "nin", "nun", "nün", "yı", "yi", "yu", "yü", "ya", "ye", "na", "ne", "nı", "ni", "nu", "nü",
          "ı", "i", "u", "ü", "a", "e")
_ATLANAN = {"Windows", "Program Files", "Program Files (x86)", "node_modules", "AppData"}


def _sade(metin: str) -> str:
    return "".join(c for c in metin.casefold().translate(_TR) if c.isalnum())


def _arama_kokleri() -> list[Path]:
    kokler = [CALISMA, _bilinen_klasor("Masaüstü"), _bilinen_klasor("Belgeler"), _bilinen_klasor("İndirilenler")]
    if WINDOWS:
        kokler += [Path(os.environ.get("PUBLIC", "C:/Users/Public")) / "Desktop",
                   Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs",
                   Path(os.environ.get("PROGRAMDATA", "C:/ProgramData")) / "Microsoft/Windows/Start Menu/Programs"]
        kokler += [Path(f"{h}:/") for h in "DEF" if Path(f"{h}:/").exists()]
    return [k for k in kokler if k.exists()]


def _ara(sorgu: str, en_fazla: int = 30, derinlik: int = 4) -> list[Path]:
    """Adında sorgu geçen dosya/klasörleri bilinen yerlerde arar (Türkçe karakter ve boşluk duyarsız)."""
    import time

    hedef = _sade(sorgu)
    if len(hedef) < 2:
        return []
    bulunan, bitis = [], time.monotonic() + 6
    for kok in _arama_kokleri():
        yigin = [(kok, 0)]
        while yigin and len(bulunan) < en_fazla and time.monotonic() < bitis:
            klasor, d = yigin.pop()
            try:
                ogeler = list(os.scandir(klasor))
            except OSError:
                continue
            for oge in ogeler:
                if oge.name.startswith(("$", ".")) or oge.name in _ATLANAN:
                    continue
                if hedef in _sade(Path(oge.name).stem) and Path(oge.path) not in bulunan:
                    bulunan.append(Path(oge.path))
                if oge.is_dir(follow_symlinks=False) and d < derinlik:
                    yigin.append((Path(oge.path), d + 1))
    return bulunan


def dosya_ara(ad: str) -> str:
    sonuc = _ara(ad)
    if not sonuc:
        return f"'{ad}' adında bir şey bulunamadı (Masaüstü, Belgeler, İndirilenler, Başlat menüsü ve D/E/F sürücülerine bakıldı)."
    return "Bulunanlar:\n" + "\n".join(f"{'[klasör] ' if p.is_dir() else ''}{p}" for p in sonuc)


def _en_iyi_eslesme(ad: str) -> Path | None:
    """Program adı söylenince masaüstü/Başlat menüsünde kısayolunu, yoksa dosya ya da klasörünü bulur."""
    temiz = ad.strip().rstrip("'’ ")
    adaylar = [temiz]
    for ek in _EKLER:  # "PrimerLab'ı", "primerlab a" gibi Türkçe ekleri soy
        if temiz.casefold().endswith(ek) and len(temiz) - len(ek) >= 3:
            adaylar.append(temiz[: -len(ek)].rstrip("'’ "))
    oncelik = {".lnk": 0, ".url": 0, ".exe": 1, ".bat": 2, ".cmd": 2}
    for aday in adaylar:
        sonuc = _ara(aday, en_fazla=40, derinlik=3)
        if sonuc:
            return sorted(sonuc, key=lambda p: (oncelik.get(p.suffix.lower(), 3 if p.is_dir() else 4), len(p.name)))[0]
    return None


def _ac_hedefi(hedef: str) -> str:
    ad = hedef.strip().strip('"')
    uygulama = UYGULAMALAR.get(ad.casefold()) or UYGULAMALAR.get(_sade(ad))
    if uygulama:
        return uygulama
    p = _yol(ad)
    if p.exists():
        return str(p)
    # Yanlış tahmin edilmiş yolda (ör. C:\Users\X\Desktop\primerlab) son parçanın adıyla aranır
    eslesme = _en_iyi_eslesme(Path(ad.replace("\\", "/")).name or ad)
    return str(eslesme) if eslesme else ad


def _kisayol_alani(yol: Path) -> bool:
    """Masaüstü ve Başlat menüsündeki kısayollar çift tıklamak gibidir; onay istemeden açılabilir."""
    kokler = [k for k in _arama_kokleri() if "Start Menu" in str(k) or k.name in ("Desktop", "Masaüstü")]
    kokler.append(_bilinen_klasor("Masaüstü"))
    return yol.suffix.lower() in (".lnk", ".url") and any(k in yol.parents for k in kokler)


def program_ac(hedef: str) -> str:
    gercek = _ac_hedefi(hedef)
    bulundu = gercek in UYGULAMALAR.values() or "://" in gercek or Path(gercek).exists()
    if not bulundu:
        return f"'{hedef}' bulunamadı. dosya_ara ile adını arayıp tam yoluyla tekrar dene."
    if not WINDOWS:
        return f"(Bu bilgisayar Windows değil) Açılacaktı: {gercek}"
    # "start": klasör, belge, kısayol, kayıtlı uygulama adı (excel, chrome) ve adresleri açar
    subprocess.Popen(["cmd", "/c", "start", "", gercek], creationflags=subprocess.CREATE_NO_WINDOW)
    return f"Açıldı: {gercek}"


def _klasor_bul(klasor: str) -> Path | None:
    """"Masaüstü/Taylan", tam yol ya da sadece "Taylan" verilebilir; sadece ad verilirse bilinen yerlerde aranır."""
    p = _yol(klasor)
    if p.is_dir():
        return p
    ad = Path(str(klasor).replace("\\", "/")).name or str(klasor)
    adaylar = [x for x in _ara(ad, en_fazla=20, derinlik=3) if x.is_dir() and _sade(x.name) == _sade(ad)]
    return adaylar[0] if adaylar else None


def klasoru_izle(klasor: str, aralik_saniye: str = "30", tur: str = "hepsi") -> str:
    p = _klasor_bul(klasor)
    if p is None:
        return f"'{klasor}' klasörü bulunamadı. dosya_ara ile yerini bulup tam yoluyla tekrar dene."
    aralik = int(re.sub(r"\D", "", str(aralik_saniye)) or 30)
    tur = {"klasör": "klasor", "klasörler": "klasor", "dosyalar": "dosya"}.get(str(tur).casefold(), str(tur).casefold())
    i = izleyici.ekle(str(p), aralik, tur)
    ne = {"klasor": "klasör", "dosya": "dosya"}.get(i["tur"], "dosya ya da klasör")
    on_ek = "Bu klasör zaten izleniyordu; aralık güncellendi. " if i.get("zaten_vardi") else ""
    return (f"{on_ek}İzleme başladı: {p} — her {i['aralik']} saniyede bir bakılacak; yeni {ne} gelince kullanıcıya "
            f"bir kez bildirim gidecek (izleme no: {i['id']}). Offline Agent açık olduğu sürece arka planda çalışır.")


def izlemeleri_listele() -> str:
    izlemeler = izleyici.liste()
    if not izlemeler:
        return "Şu an izlenen klasör yok."
    return "\n".join(f"- {i['id']}: {i['yol']} (her {i['aralik']} sn, {i['tur']}, başlangıç {i['baslangic']})" for i in izlemeler)


def izlemeyi_durdur(izleme_no: str) -> str:
    izleme_no = str(izleme_no).strip()
    hedef = next((i for i in izleyici.liste() if i["id"] == izleme_no or _sade(Path(i["yol"]).name) == _sade(izleme_no)), None)
    if not hedef:
        return "Böyle bir izleme bulunamadı. izlemeleri_listele ile numarasına bak."
    izleyici.durdur(hedef["id"])
    return f"İzleme durduruldu: {hedef['yol']}"


def python_calistir(kod: str) -> str:
    betik = CALISMA / "_ajan_kodu.py"
    betik.write_text(kod, "utf-8")
    python = Path(sys.executable)
    if python.name.lower() == "pythonw.exe":  # pencere açmadan çalışan sürüm çıktı vermez
        python = python.with_name("python.exe")
    return _calistir([str(python), str(betik)])


def komut_calistir(komut: str) -> str:
    if WINDOWS:
        on_ek = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference = 'SilentlyContinue'; "
        return _calistir(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", on_ek + komut])
    return _calistir(["/bin/sh", "-c", komut])


def _tanim(ad: str, aciklama: str, ozellikler: dict, zorunlu: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": ad,
            "description": aciklama,
            "parameters": {"type": "object", "properties": ozellikler, "required": zorunlu},
        },
    }


def _metin(aciklama: str) -> dict:
    return {"type": "string", "description": aciklama}


YOL = "Yol. 'Masaüstü/Klasör', 'Belgeler/x.txt', 'İndirilenler' gibi yazılabilir ya da tam yol verilebilir"

# ad -> (fonksiyon, risk, tanım). risk: "okuma" | "zararsiz" | "riskli"
ARACLAR = {
    "tarih_saat": (tarih_saat, "okuma", _tanim("tarih_saat", "Bugünün tarihini, saatini ve gününü verir.", {}, [])),
    "sistem_bilgisi": (sistem_bilgisi, "okuma", _tanim(
        "sistem_bilgisi", "Bilgisayarın adı, Windows sürümü ve disklerin doluluk durumu.", {}, [])),
    "hafizaya_kaydet": (hafizaya_kaydet, "okuma", _tanim(
        "hafizaya_kaydet", "Kullanıcı hakkında kalıcı bir bilgiyi hafızaya kaydeder (adı, işi, tercihleri vb.).",
        {"bilgi": _metin("Tek cümlelik bilgi, ör. 'Kullanıcının laboratuvarının adı Primer Lab.'")}, ["bilgi"])),
    "belge_ara": (None, "okuma", _tanim(
        "belge_ara", "Kullanıcının belgeler klasöründeki dosyalarda anlamca arama yapar ve ilgili bölümleri getirir.",
        {"soru": _metin("Aranacak konu veya soru")}, ["soru"])),
    "dosya_listele": (dosya_listele, "okuma", _tanim(
        "dosya_listele", "Bir klasördeki dosya ve klasörleri listeler.", {"klasor": _metin(YOL)}, [])),
    "dosya_oku": (dosya_oku, "okuma", _tanim(
        "dosya_oku", "Bir dosyanın içeriğini okur (txt, md, csv, json, py, html, pdf, docx, xlsx...).",
        {"yol": _metin(YOL)}, ["yol"])),
    "dosya_ara": (dosya_ara, "okuma", _tanim(
        "dosya_ara", "Adını bildiğin bir dosya, klasör ya da programı bilgisayarda arar (Masaüstü, Belgeler, "
        "İndirilenler, Başlat menüsü, D/E/F sürücüleri). Yerini bilmediğin her şey için önce bunu kullan.",
        {"ad": _metin("Aranacak ad ya da adın bir parçası, ör. 'PrimerLab'")}, ["ad"])),
    "icerikte_ara": (icerikte_ara, "okuma", _tanim(
        "icerikte_ara", "Dosyaların İÇİNDE geçen bir kelime/metni arar (pdf, docx, xlsx, txt, kod...). Klasör verilmezse "
        "kullanıcının dosyalar klasöründe arar. 'Hangi dosyada X yazıyor', 'X geçen dosyaları bul' gibi isteklerde kullan.",
        {"metin": _metin("Aranacak kelime ya da metin"), "klasor": _metin("İsteğe bağlı klasör; boşsa dosyalar klasörü")},
        ["metin"])),
    "klasor_olustur": (klasor_olustur, "zararsiz", _tanim(
        "klasor_olustur", "Yeni klasör oluşturur (ara klasörler de oluşturulur).", {"yol": _metin(YOL)}, ["yol"])),
    "dosya_kopyala": (dosya_kopyala, "zararsiz", _tanim(
        "dosya_kopyala", "Dosya ya da klasörü kopyalar. Hedef bir klasörse içine kopyalar. Üzerine yazmaz.",
        {"kaynak": _metin(YOL), "hedef": _metin(YOL)}, ["kaynak", "hedef"])),
    "program_ac": (program_ac, "zararsiz", _tanim(
        "program_ac", "Bir uygulamayı, klasörü, belgeyi ya da adresi açar. Sadece adını vermen yeterli "
        "(ör. 'PrimerLab', 'excel', 'hesap makinesi'); yerini kendisi bulur.",
        {"hedef": _metin("Uygulama/program adı ya da açılacak klasör/dosya yolu")}, ["hedef"])),
    "klasoru_izle": (klasoru_izle, "zararsiz", _tanim(
        "klasoru_izle", "Bir klasörü arka planda sürekli izler; belirtilen aralıkla bakar ve yeni dosya/klasör gelince "
        "kullanıcıya bir kez bildirim gönderir. 'X klasörünü izle', 'yeni gelenleri bildir' gibi isteklerde kullan.",
        {"klasor": _metin(YOL + " ya da sadece klasörün adı"),
         "aralik_saniye": _metin("Kaç saniyede bir bakılacağı (varsayılan 30, en az 5)"),
         "tur": {"type": "string", "enum": ["hepsi", "klasor", "dosya"], "description": "Neyin bildirileceği"}}, ["klasor"])),
    "izlemeleri_listele": (izlemeleri_listele, "okuma", _tanim(
        "izlemeleri_listele", "Arka planda izlenen klasörleri listeler.", {}, [])),
    "izlemeyi_durdur": (izlemeyi_durdur, "zararsiz", _tanim(
        "izlemeyi_durdur", "Bir klasör izlemesini durdurur.", {"izleme_no": _metin("İzleme numarası ya da klasör adı")}, ["izleme_no"])),
    "dosya_yaz": (dosya_yaz, "riskli", _tanim(
        "dosya_yaz", "Metin dosyası oluşturur ya da üzerine yazar (txt, md, csv, html, py...).",
        {"yol": _metin(YOL), "icerik": _metin("Dosyanın tam içeriği")}, ["yol", "icerik"])),
    "dosya_tasi": (dosya_tasi, "riskli", _tanim(
        "dosya_tasi", "Dosya ya da klasörü taşır veya yeniden adlandırır. Hedef bir klasörse içine taşır.",
        {"kaynak": _metin(YOL), "hedef": _metin(YOL)}, ["kaynak", "hedef"])),
    "cop_kutusuna_at": (cop_kutusuna_at, "riskli", _tanim(
        "cop_kutusuna_at", "Dosya ya da klasörü Geri Dönüşüm Kutusu'na atar (silme; geri alınabilir).",
        {"yol": _metin(YOL)}, ["yol"])),
    "python_calistir": (python_calistir, "riskli", _tanim(
        "python_calistir", "Python kodu çalıştırır ve çıktısını döndürür (hesaplama, Excel/CSV işleme, toplu işler). "
        "Sonucu görmek için print kullan.", {"kod": _metin("Çalıştırılacak tam Python kodu")}, ["kod"])),
    "primerlab": (None, "okuma", _tanim(
        "primerlab", "PrimerLab laboratuvar programına sorar: işler/siparişler, hastalar, hekimler, teknisyenler, cari hesap, "
        "bakiye, tahsilat, gider, raporlar, mesajlar, portal hesapları. İş durumunu değiştirme, teknisyen atama, işi onaylama, "
        "tahsilat/gider ekleme, mesaj gönderme gibi işlemleri de buradan iste: PrimerLab önerir, kullanıcı onaylar.",
        {"istek": _metin("Kullanıcının laboratuvarla ilgili sorusu ya da isteği, tam cümle")}, ["istek"])),
    # Modelin göremediği araç: PrimerLab'ın önerdiği işlemler bununla, kullanıcı onaylayınca uygulanır
    "primerlab_uygula": (None, "riskli", _tanim(
        "primerlab_uygula", "PrimerLab'ın önerdiği bir işlemi uygular.", {"etiket": _metin("İşlem")}, ["etiket"])),
    "komut_calistir": (komut_calistir, "riskli", _tanim(
        "komut_calistir", "Windows PowerShell komutu çalıştırır. Hazır bir araç yoksa kullan.",
        {"komut": _metin("PowerShell komutu")}, ["komut"])),
}
ARAC_TANIMLARI = [tanim for ad, (_, _, tanim) in ARACLAR.items() if ad != "primerlab_uygula"]


def primerlab_acik() -> bool:
    """PrimerLab bağlantısı Ayarlar'dan açılıp kapatılır (varsayılan kapalı)."""
    return bool(ayarlari_oku().get("primerlab", False))


def arac_tanimlari() -> list[dict]:
    if primerlab_acik():
        return ARAC_TANIMLARI
    return [t for t in ARAC_TANIMLARI if t["function"]["name"] != "primerlab"]


# Dosyalar klasörünün içindeyken onaysız yapılan araçlar ve yol argümanları
DOSYALAR_SERBEST = {
    "dosya_yaz": ("yol",), "dosya_tasi": ("kaynak", "hedef"), "cop_kutusuna_at": ("yol",),
    "klasor_olustur": ("yol",), "dosya_kopyala": ("kaynak", "hedef"),
}


def onay_gerekli(ad: str, argumanlar: dict, onay_modu: str = "riskli") -> bool:
    if ad not in ARACLAR:
        return False
    risk = ARACLAR[ad][1]
    if risk == "okuma":
        return False
    if ad in DOSYALAR_SERBEST and ayarlari_oku().get("dosyalar_serbest", True):
        # Dosyalar klasörünün içinde kalan dosya işleri hiç onay sormaz (klasörün kendisini silmek hariç)
        yollar = [str(argumanlar.get(a, "")) for a in DOSYALAR_SERBEST[ad]]
        if all(y.strip() and _klasor_icinde(y, kok_dahil=(ad == "klasor_olustur" or a == "hedef"))
               for y, a in zip(yollar, DOSYALAR_SERBEST[ad])):
            return False
    if risk == "riskli" or onay_modu == "hepsi":
        return True
    if ad == "program_ac":
        # Bilinen uygulama, klasör ve belge açmak serbest; program/betik dosyası başlatmak onay ister
        hedef = str(argumanlar.get("hedef", ""))
        if hedef.strip().casefold() in UYGULAMALAR:
            return False
        gercek = Path(_ac_hedefi(hedef))
        return gercek.suffix.lower() in CALISTIRILABILIR and not _kisayol_alani(gercek)
    return False


def sistem_istemi(belgeler: bool = False) -> str:
    klasorler = ", ".join(f"{ad} = {_bilinen_klasor(ad)}" for ad in ("Masaüstü", "Belgeler", "İndirilenler"))
    return (
        "Sen Offline Agent'sın: kullanıcının Windows bilgisayarında tamamen yerel çalışan, onun yerine iş yapan "
        "bir asistansın. Araçlarla gerçekten klasör/dosya oluşturabilir, kopyalayabilir, taşıyabilir, silebilir, "
        "program ve belge açabilir, dosya okuyabilir, belgelerde arayabilir, Python ve PowerShell çalıştırabilirsin.\n"
        f"Bilinen klasörler: {klasorler}.\n"
        f"Kullanıcının dosyalar klasörü: {CALISMA} — kullanıcı kontrol etmeni istediği dosyaları buraya koyar. "
        "'Dosyalarım', 'dosyalar klasörü', 'yüklediğim dosyalar' denince burası kastedilir. Bu klasörün içinde okuma, "
        "arama, yazma, düzenleme, yeniden adlandırma, taşıma ve silme işlerini HİÇ SORMADAN, onay beklemeden hemen yap. "
        "Göreli yollar (ör. 'rapor.txt', 'Faturalar/ocak.pdf') bu klasöre göredir. İçerikte arama için icerikte_ara kullan.\n"
        "Kullanıcı sana dosya (pdf, Word, Excel...) vermek isterse şöyle yapacağını söyle: mesaj kutusundaki 📎 düğmesine "
        "basıp dosyayı seçer ya da dosyayı pencereye sürükleyip bırakır; dosya bu klasöre kaydedilir ve sen okursun. "
        "Mesajın sonunda '[Ekli dosyalar ...]' görürsen o dosyalar az önce yüklendi: okunmamış olanları dosya_oku ile oku "
        "ve kullanıcının istediğini yap; istek yoksa kısaca özetle.\n"
        "Kurallar:\n"
        "- Türkçe, kısa ve samimi konuş.\n"
        "- Kullanıcı bilgisayarda bir iş isterse önce uygun aracı hemen çağırarak yapmayı dene; 'kendiniz yapın' deme. "
        "Sadece sohbet, bilgi ya da fikir istiyorsa araç kullanmadan cevap ver.\n"
        "- Önce hazır araçları kullan (klasor_olustur, dosya_kopyala, program_ac...); hiçbiri uymazsa komut_calistir.\n"
        "- Bir klasörü sürekli takip etmen ya da yeni gelenleri bildirmen istenirse klasoru_izle aracını kullan. "
        "Asla döngü ya da bekleme içeren komut yazma: komutlar en fazla 2 dakika çalışabilir.\n"
        + ("- Laboratuvarla ilgili her soru ve istekte (işler, hastalar, hekimler, cari, tahsilat, teknisyen, teslim...) "
           "primerlab aracını kullan; laboratuvar bilgisi uydurma.\n" if primerlab_acik() else "") +
        "- Dosyalar klasörü dışında silme, taşıma, üzerine yazma ile her yerde kod ve komut kullanıcı onayı ister; "
        "onayı sistem kendisi sorar, sen kullanıcıya 'yapayım mı?' diye sorma, aracı çağır. Reddederse başka yol öner.\n"
        "- Bir araç hata verirse hatayı oku, düzelt ve tekrar dene. Emin olmadığın dosya adını önce dosya_listele ile bul.\n"
        "- İş bitince ne yaptığını tek cümleyle söyle (ör. 'Masaüstünde \"Raporlar\" klasörünü oluşturdum.').\n"
        "- DÜRÜSTLÜK: Bir işi gerçekten yapamadıysan (uygun araç yok, araç hata verdi ve düzeltemedin, kullanıcı "
        "reddetti, gereken bilgi yok) bunu açıkça 'Bunu yapamadım: <kısa neden>' diye söyle. Yapmadığın bir işi "
        "yaptım deme; araç sonucunu, dosya içeriğini ya da bilgiyi asla uydurma, sadece araç sonuçlarında gördüğünü söyle. "
        "İşin bir kısmını yapabildiysen hangi kısmı yapıp hangisini yapamadığını ayrı ayrı söyle.\n"
        "- GÜVEN: Bilgi verdiğin cevabın sonuna tek satır ekle: '✅ Eminim — <dayanağı>' ya da '⚠️ Emin değilim — <nedeni>'. "
        "Eminim yalnız bilgiyi araç sonucunda ya da belgede gördüysen yazılır; tahmin, hafızadan genel bilgi veya belirsiz "
        "soruda 'Emin değilim' de. Selamlaşma ve tek cümlelik iş bildirimlerinde güven notu yazma.\n"
        "- Kullanıcı hakkında kalıcı bir bilgi öğrenirsen hafizaya_kaydet ile kaydet."
        + ("\n- Kullanıcı belgelerini kullanmanı istiyor: soruyu cevaplamadan önce belge_ara ile belgelerde ara ve kaynağı belirt."
           if belgeler else "")
    ) + hafiza.istem_metni()


# ---------- Model yerine kurallarla anlaşılan sık istekler ----------

EYLEM = re.compile(
    r"(oluştur|olustur|\baç\b|açar m|başlat|baslat|kapat|\bsil\b|taşı|tasi|kopyala|yeniden adlandır|kaydet|"
    r"listele|çalıştır|calistir|klasör|klasor|dosya|masaüst|masaust|indirilen|belgeler|program|uygulama|disk)",
    re.IGNORECASE,
)
# Modelin işi yapmak yerine kullanıcıya talimat verdiğini gösteren ifadeler
TALIMAT = re.compile(
    r"(```|çalıştırabilirsiniz|kopyalayıp|yapıştırın|yapabilirsiniz|kendiniz|sağ tık|komutunu|komutu kullan|"
    r"New-Item|mkdir )",
    re.IGNORECASE,
)
# Hiç denemeden "yapamam" demesi: bir kez araçlarla denemesi istenir; denedikten sonra "yapamadım" diyebilir
YAPAMAM = re.compile(r"(yapamıyorum|yapamam|gerçekleştiremiyorum|erişimim (yok|bulunmamakta)|mümkün değil)", re.IGNORECASE)
_YER = r"(?P<yer>masa ?[üu]st[üu]\w*|belgeler\w*|indirilenler\w*|resimler\w*)"
_AD = r"[\"'“”]?(?P<ad>[^\"'“”\n]{1,80}?)[\"'“”]?"
HIZLI_KLASOR = [
    re.compile(_YER + r"\s+(?:bir\s+)?" + _AD + r"\s+(?:isimli|isminde|adında|adinda|adlı|adli|diye)\s+(?:bir\s+)?klas\w*\s+(?:oluştur|olustur|aç|yap)", re.I),
    re.compile(_AD + r"\s+(?:isimli|isminde|adında|adinda|adlı|adli|diye)\s+(?:bir\s+)?klas\w*\s+" + _YER + r"\s*(?:oluştur|olustur|aç|yap)", re.I),
    re.compile(_YER + r"\s+(?:bir\s+)?klas\w*\s+(?:oluştur|olustur|aç|yap)\w*\s*[,:]?\s*(?:adı|adi|ismi)\s+" + _AD + r"\s*$", re.I),
]
HIZLI_UYGULAMA = re.compile(r"^\s*(?P<ad>" + "|".join(sorted(map(re.escape, UYGULAMALAR), key=len, reverse=True))
                            + r")\w*\s+(?:aç|ac|açar mısın|açsana|başlat|baslat)\b", re.I)


# "PrimerLab'ı aç", "primerlab a ulaş", "Blender'ı başlat" gibi kısa açma istekleri
HIZLI_AC = re.compile(r"^\s*(?P<ad>[^\n]{2,60}?)\s+(?:aç|ac|açar\s*m[ıi]s[ıi]n|açsana|başlat|baslat|ulaş\w*|ulas\w*)\s*[.!?]*\s*$", re.I)
# Bunlar "aç" ile bitse de program açma değildir
EYLEM_DISI = re.compile(r"(klas[öo]r|dosya|oluştur|olustur|yeni|bir |konu|açıkla|anlat|kapı|pencere|sayfa)", re.I)


# Laboratuvar (PrimerLab) soruları: modele sormadan doğrudan Primer AI'a gider
LAB = re.compile(
    r"(sipariş|hasta(lar|nın|nin|ya|yı)?\b|hekim|doktor|dr\.|teknisyen|cari|bakiye|tahsilat|ödeme|gider|ciro|termin|"
    r"teslim|gecik|üretim|tasarım|makyaj|onay bekleyen|gelen onay|portal hesab|primer ?ai|\biş(ler|leri|lerin|imiz)?\b|"
    r"\b(iş|işi|işin)\s*#?\d+|#\d+)", re.I)
DOSYA_ISI = re.compile(r"(klas[öo]r|dosya|masaüst|masaust|indirilen|belgeler(?!im)|kopyala|program(ı|i)? aç)", re.I)


def _yer_adi(yer: str) -> str:
    yer = yer.casefold().replace(" ", "")
    for anahtar, ad in (("masa", "Masaüstü"), ("belge", "Belgeler"), ("indir", "İndirilenler"), ("resim", "Resimler")):
        if yer.startswith(anahtar):
            return ad
    return "Masaüstü"


# Arayüzün 📎 ile eklenen dosyalar için mesajın sonuna koyduğu not
EKLI_DOSYALAR = re.compile(r"\[Ekli dosyalar \(Dosyalarım klasöründe\): (.+?)\]\s*$")


def hizli_komut(metin: str) -> dict | None:
    """Sık istekleri modele sormadan araç çağrısına çevirir (küçük modeller bazen araç yerine talimat yazıyor)."""
    for kalip in HIZLI_KLASOR:
        m = kalip.search(metin.strip())
        if m and m.group("ad").strip():
            ad = m.group("ad").strip().strip(".")
            return {"function": {"name": "klasor_olustur", "arguments": {"yol": f"{_yer_adi(m.group('yer'))}/{ad}"}}}
    m = HIZLI_UYGULAMA.search(metin)
    if m:
        return {"function": {"name": "program_ac", "arguments": {"hedef": m.group("ad").casefold()}}}
    if primerlab_acik() and LAB.search(metin) and not DOSYA_ISI.search(metin) and primerlab.kurulu():
        return {"function": {"name": "primerlab", "arguments": {"istek": metin.strip()}}}
    m = HIZLI_AC.search(metin)
    if m and not EYLEM_DISI.search(m.group("ad")):
        return {"function": {"name": "program_ac", "arguments": {"hedef": m.group("ad").strip(" '’\"")}}}
    return None


_ARAC_ADI_METNI = re.compile(r'"(?:name|ad|arac|tool)"\s*:\s*"(?P<ad>[a-z_]+)"')


def _json_sonu(metin: str, bas: int) -> int:
    """metin[bas] == "{" ise eşleşen "}" konumunu döndürür (dizgelerin içindeki parantezleri sayar)."""
    derinlik, dizgide, kacis = 0, False, False
    for i in range(bas, len(metin)):
        c = metin[i]
        if dizgide:
            if kacis:
                kacis = False
            elif c == "\\":
                kacis = True
            elif c == '"':
                dizgide = False
        elif c == '"':
            dizgide = True
        elif c == "{":
            derinlik += 1
        elif c == "}":
            derinlik -= 1
            if derinlik == 0:
                return i
    return -1


def metinden_cagrilar(icerik: str) -> list[dict]:
    """Model aracı çağırmak yerine çağrıyı metin olarak yazdıysa ({"name": "program_ac", "arguments": {...}}) yakalar."""
    cagrilar = []
    for m in _ARAC_ADI_METNI.finditer(icerik):
        if m.group("ad") not in ARACLAR:
            continue
        bas = icerik.rfind("{", 0, m.start())
        son = _json_sonu(icerik, bas) if bas >= 0 else -1
        try:
            nesne = json.loads(icerik[bas:son + 1]) if son > 0 else None
        except ValueError:
            nesne = None
        if not isinstance(nesne, dict):
            continue
        argumanlar = nesne.get("arguments", nesne.get("parameters", nesne.get("argumanlar", {})))
        if isinstance(argumanlar, str):
            try:
                argumanlar = json.loads(argumanlar)
            except ValueError:
                argumanlar = {}
        cagrilar.append({"function": {"name": m.group("ad"), "arguments": argumanlar if isinstance(argumanlar, dict) else {}}})
    return cagrilar


def _bekleyen_cagrilar(mesajlar: list[dict]) -> list[dict]:
    """Son asistan mesajındaki, henüz sonucu eklenmemiş araç çağrıları."""
    for i in range(len(mesajlar) - 1, -1, -1):
        m = mesajlar[i]
        if m.get("role") == "assistant":
            cagrilar = m.get("tool_calls") or []
            cevaplanan = sum(1 for x in mesajlar[i + 1:] if x.get("role") == "tool")
            return cagrilar[cevaplanan:]
        if m.get("role") == "user":
            return []
    return []


async def _araci_calistir(ad: str, argumanlar: dict, belge_ara) -> str:
    if ad not in ARACLAR:
        return f"Bilinmeyen araç: {ad}"
    fonksiyon = ARACLAR[ad][0]
    try:
        if ad == "primerlab_uygula":
            islem = argumanlar.get("islem") or {}
            etiket = argumanlar.get("etiket") or "PrimerLab işlemi"
            sonuc = await run_in_threadpool(primerlab.uygula, islem)
            return f"✅ {etiket} — uygulandı." if sonuc.get("ok") else f"❌ {etiket} — uygulanamadı: {sonuc.get('mesaj')}"
        if ad == "belge_ara":
            sonuclar = await run_in_threadpool(belge_ara, str(argumanlar.get("soru", "")))
            if not sonuclar:
                return "Belgelerde ilgili bölüm bulunamadı."
            return _kisalt("\n\n".join(
                f"[{k['kaynak']}{', ' + k['sayfa'] if k['sayfa'] else ''}]\n{k['metin']}" for k in sonuclar))
        return await run_in_threadpool(fonksiyon, **{k: str(v) for k, v in argumanlar.items()})
    except primerlab.PrimerLabHatasi as hata:
        return f"Hata: {hata}"
    except TypeError as hata:
        return f"Araç yanlış parametreyle çağrıldı: {hata}"
    except Exception as hata:  # Hata metni modele dönsün ki düzeltebilsin
        return f"Hata: {type(hata).__name__}: {hata}"


async def _dongu(mesajlar: list[dict], karar: bool | None, model: str, baglam: int, belge_ara,
                 onay_modu: str, belgeler: bool, dusun: bool = False):
    son_soru = mesajlar[-1]["content"] if mesajlar and mesajlar[-1].get("role") == "user" else ""
    dogrudan = False  # PrimerLab'a modelsiz giden soru: cevabı olduğu gibi gösterilir
    ekli = EKLI_DOSYALAR.search(son_soru) if son_soru else None
    if ekli:
        # Mesaja eklenen dosyalar modele bırakılmadan hemen okunur (en fazla 3 tanesi; gerisini model okur)
        adlar = [a.strip() for a in ekli.group(1).split(" | ") if a.strip()][:3]
        mesajlar.append({"role": "assistant", "content": "", "tool_calls": [
            {"function": {"name": "dosya_oku", "arguments": {"yol": ad}}} for ad in adlar]})
    elif son_soru and (hizli := hizli_komut(son_soru)):
        mesajlar.append({"role": "assistant", "content": "", "tool_calls": [hizli]})
        dogrudan = hizli["function"]["name"] == "primerlab"
    duzeltme_hakki = 2
    yapamam_hakki = 1
    itme: list[dict] = []
    for _ in range(MAKS_TUR):
        oneriler, oneri_cevabi, son_cevap = [], "", ""
        for cagri in _bekleyen_cagrilar(mesajlar):
            fn = cagri.get("function", {})
            ad, argumanlar = fn.get("name", ""), fn.get("arguments") or {}
            if onay_gerekli(ad, argumanlar, onay_modu):
                if karar is None:
                    yield {"onay": {"ad": ad, "argumanlar": argumanlar}}
                    return
                onaylandi, karar = karar, None
                if onaylandi:
                    sonuc = await _araci_calistir(ad, argumanlar, belge_ara)
                elif ad == "primerlab_uygula":
                    sonuc = f"⏭ {argumanlar.get('etiket', 'İşlem')} — uygulanmadı (reddettin)."
                else:
                    sonuc = "Kullanıcı bu işlemi reddetti. Neden reddedildiğini sor veya başka bir yol öner."
            elif ad == "primerlab":
                sonuc, yeni = await _primerlaba_sor(str(argumanlar.get("istek", "")), mesajlar, model)
                if yeni:
                    oneriler += yeni
                    oneri_cevabi = sonuc.split("\n\nÖnerilen işlemler")[0]
                elif dogrudan and not sonuc.startswith("Hata"):
                    son_cevap = sonuc
            else:
                sonuc = await _araci_calistir(ad, argumanlar, belge_ara)
            mesajlar.append({"role": "tool", "tool_name": ad, "content": sonuc})
            yield {"arac": {"ad": ad, "argumanlar": argumanlar, "sonuc": sonuc}}

        if oneriler:
            # PrimerLab'ın önerdiği her işlem ayrı onay kartı olarak kullanıcıya sorulur
            mesajlar.append({"role": "assistant", "content": oneri_cevabi, "tool_calls": [
                {"function": {"name": "primerlab_uygula", "arguments": {"islem": o["islem"], "etiket": o["etiket"]}}}
                for o in oneriler]})
            yield {"t": oneri_cevabi}
            continue
        if son_cevap:
            mesajlar.append({"role": "assistant", "content": son_cevap})
            yield {"t": son_cevap}
            return
        if (ozet := _uygulama_ozeti(mesajlar)) is not None:
            mesajlar.append({"role": "assistant", "content": ozet})
            yield {"t": ozet}
            return

        icerik, cagrilar = "", []
        async for olay in sohbet_akisi(model, [{"role": "system", "content": sistem_istemi(belgeler)}, *mesajlar, *itme],
                                       baglam, arac_tanimlari(), dusun):
            if "t" in olay:
                icerik += olay["t"]
                yield olay
            elif "tool_calls" in olay:
                cagrilar.extend(olay["tool_calls"])
            else:
                yield olay  # "düşünüyor" bildirimi
        itme = []
        if not cagrilar and (yazilan := metinden_cagrilar(icerik)):
            yield {"geri_al": True}
            cagrilar, icerik = yazilan, ""
        # İş istendiği halde araç çağırmadan talimat yazdıysa: cevabı geri al, modeli işi yapmaya yönlendir
        son_kullanici = max((i for i, m in enumerate(mesajlar) if m.get("role") == "user"), default=-1)
        kullanici_istegi = mesajlar[son_kullanici]["content"] if son_kullanici >= 0 else ""
        hic_arac_yok = not any(m.get("role") == "tool" for m in mesajlar[son_kullanici + 1:])
        if (not cagrilar and duzeltme_hakki and hic_arac_yok and EYLEM.search(kullanici_istegi)
                and TALIMAT.search(icerik)):
            duzeltme_hakki -= 1
            yield {"geri_al": True}
            itme = [
                {"role": "assistant", "content": icerik},
                {"role": "user", "content": "Bana nasıl yapacağımı anlatma, talimat ya da komut yazma. Bu işi araçlarınla "
                                            "ŞİMDİ kendin yap: uygun aracı çağır (ör. klasor_olustur, program_ac, klasoru_izle, "
                                            "dosya_kopyala; hiçbiri uymuyorsa komut_calistir)."},
            ]
            continue
        if (not cagrilar and yapamam_hakki and hic_arac_yok and EYLEM.search(kullanici_istegi)
                and YAPAMAM.search(icerik)):
            yapamam_hakki -= 1
            yield {"geri_al": True}
            itme = [
                {"role": "assistant", "content": icerik},
                {"role": "user", "content": "Denemeden 'yapamam' deme. Önce araçlarınla dene (dosya_ara, dosya_listele, "
                                            "program_ac, komut_calistir...). Denedikten sonra yine yapamazsan "
                                            "'Bunu yapamadım: <neden>' de."},
            ]
            continue
        yanit = {"role": "assistant", "content": icerik}
        if cagrilar:
            yanit["tool_calls"] = cagrilar
        mesajlar.append(yanit)
        if not cagrilar:
            return
    yield {"hata": f"İş {MAKS_TUR} adımda bitmedi; isterseniz 'devam et' yazın."}


async def _primerlaba_sor(istek: str, mesajlar: list[dict], model: str) -> tuple[str, list[dict]]:
    """PrimerLab'ın cevabını ve önerdiği işlemleri döndürür."""
    son_kullanici = max((i for i, m in enumerate(mesajlar) if m.get("role") == "user"), default=0)
    try:
        veri = await run_in_threadpool(primerlab.sor, istek, mesajlar[:son_kullanici], model)
    except primerlab.PrimerLabHatasi as hata:
        return f"Hata: {hata}", []
    oneriler = veri.get("islemler") or []
    metin = veri.get("cevap") or "(PrimerLab boş cevap verdi)"
    if oneriler:
        metin += "\n\nÖnerilen işlemler (kullanıcının onayına sunuldu):\n" + "\n".join(f"- {o['etiket']}" for o in oneriler)
    return metin, oneriler


def _uygulama_ozeti(mesajlar: list[dict]) -> str | None:
    """PrimerLab işlemlerinin hepsi onaylanıp/reddedilip sonuçlandıysa modele sormadan özet yazar."""
    for i in range(len(mesajlar) - 1, -1, -1):
        m = mesajlar[i]
        if m.get("role") == "assistant":
            cagrilar = m.get("tool_calls") or []
            sonuclar = [x["content"] for x in mesajlar[i + 1:] if x.get("role") == "tool"]
            if cagrilar and all(c.get("function", {}).get("name") == "primerlab_uygula" for c in cagrilar) \
                    and len(sonuclar) == len(cagrilar):
                return "\n".join(sonuclar)
            return None
    return None


async def ajan_akisi(gecmis: list[dict], karar: bool | None, model: str, baglam: int, belge_ara,
                     onay_modu: str = "riskli", belgeler: bool = False, dusun: bool = False):
    """Olaylar: {"t"}, {"arac": {...}}, {"onay": {...}}, {"hata"}, son olarak {"gecmis": [...]}."""
    CALISMA.mkdir(parents=True, exist_ok=True)
    # Araç kullanan model resim görmez; sohbetteki resimler ve arayüz alanları gönderilmez
    mesajlar = [{k: v for k, v in m.items() if k in ("role", "content", "tool_calls", "tool_name")} for m in gecmis
                if m.get("role") in ("user", "assistant", "tool")]
    try:
        async for olay in _dongu(mesajlar, karar, model, baglam, belge_ara, onay_modu, belgeler, dusun):
            yield olay
    except OllamaHatasi as hata:
        yield {"hata": str(hata)}
    # İstemci durumu güncel geçmişle eşitlensin
    yield {"gecmis": mesajlar}
