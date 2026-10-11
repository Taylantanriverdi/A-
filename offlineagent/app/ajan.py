"""Asistanın bilgisayarda iş yapan kısmı: model araç kullanarak klasör/dosya işlemleri yapar, program
açar, belgelerde arar, kod ve komut çalıştırır.

Onay politikası (ayarlardaki "onay_modu"):
- "riskli" (varsayılan): okuma ve zararsız işler (klasör oluşturma, kopyalama, belge/klasör açma)
  hemen yapılır; silme, taşıma, üzerine yazma, program başlatma, kod ve komut onay ister.
- "hepsi": okuma dışındaki her işlem onay ister.
Sohbet durumu istemcide tutulur: her istek tüm geçmişi gönderir, sunucu güncel geçmişi geri yollar.
"""
import datetime
import os
import re
import platform
import shutil
import subprocess
import sys
from pathlib import Path

from starlette.concurrency import run_in_threadpool

import hafiza
from ayarlar import KOK
from belge_oku import belgeyi_oku
from ollama_api import OllamaHatasi, sohbet_akisi

CALISMA = KOK / "calisma"
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
    takma = KLASOR_TAKMA_ADLARI.get(parcalar[0].strip().casefold())
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


def cop_kutusuna_at(yol: str) -> str:
    from send2trash import send2trash

    p = _yol(yol)
    if not p.exists():
        return f"Bulunamadı: {p}"
    send2trash(str(p))
    return f"Geri Dönüşüm Kutusu'na taşındı (geri alınabilir): {p}"


def _ac_hedefi(hedef: str) -> str:
    ad = hedef.strip().strip('"')
    uygulama = UYGULAMALAR.get(ad.casefold())
    if uygulama:
        return uygulama
    p = _yol(ad)
    return str(p) if p.exists() else ad


def program_ac(hedef: str) -> str:
    gercek = _ac_hedefi(hedef)
    if not WINDOWS:
        return f"(Bu bilgisayar Windows değil) Açılacaktı: {gercek}"
    # "start": klasör, belge, kayıtlı uygulama adı (excel, chrome) ve ms-settings: gibi adresleri açar
    subprocess.Popen(["cmd", "/c", "start", "", gercek], creationflags=subprocess.CREATE_NO_WINDOW)
    return f"Açıldı: {gercek}"


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
    "klasor_olustur": (klasor_olustur, "zararsiz", _tanim(
        "klasor_olustur", "Yeni klasör oluşturur (ara klasörler de oluşturulur).", {"yol": _metin(YOL)}, ["yol"])),
    "dosya_kopyala": (dosya_kopyala, "zararsiz", _tanim(
        "dosya_kopyala", "Dosya ya da klasörü kopyalar. Hedef bir klasörse içine kopyalar. Üzerine yazmaz.",
        {"kaynak": _metin(YOL), "hedef": _metin(YOL)}, ["kaynak", "hedef"])),
    "program_ac": (program_ac, "zararsiz", _tanim(
        "program_ac", "Bir klasörü, belgeyi ya da uygulamayı açar. Uygulama adları: not defteri, hesap makinesi, "
        "paint, dosya gezgini, görev yöneticisi, ayarlar, word, excel, powerpoint, chrome, edge, kamera.",
        {"hedef": _metin("Uygulama adı ya da açılacak klasör/dosya yolu")}, ["hedef"])),
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
    "komut_calistir": (komut_calistir, "riskli", _tanim(
        "komut_calistir", "Windows PowerShell komutu çalıştırır. Hazır bir araç yoksa kullan.",
        {"komut": _metin("PowerShell komutu")}, ["komut"])),
}
ARAC_TANIMLARI = [tanim for _, _, tanim in ARACLAR.values()]


def onay_gerekli(ad: str, argumanlar: dict, onay_modu: str = "riskli") -> bool:
    if ad not in ARACLAR:
        return False
    risk = ARACLAR[ad][1]
    if risk == "okuma":
        return False
    if risk == "riskli" or onay_modu == "hepsi":
        return True
    if ad == "program_ac":
        # Bilinen uygulama, klasör ve belge açmak serbest; program/betik dosyası başlatmak onay ister
        hedef = str(argumanlar.get("hedef", ""))
        return hedef.strip().casefold() not in UYGULAMALAR and Path(_ac_hedefi(hedef)).suffix.lower() in CALISTIRILABILIR
    return False


def sistem_istemi(belgeler: bool = False) -> str:
    klasorler = ", ".join(f"{ad} = {_bilinen_klasor(ad)}" for ad in ("Masaüstü", "Belgeler", "İndirilenler"))
    return (
        "Sen Offline Agent'sın: kullanıcının Windows bilgisayarında tamamen yerel çalışan, onun yerine iş yapan "
        "bir asistansın. Araçlarla gerçekten klasör/dosya oluşturabilir, kopyalayabilir, taşıyabilir, silebilir, "
        "program ve belge açabilir, dosya okuyabilir, belgelerde arayabilir, Python ve PowerShell çalıştırabilirsin.\n"
        f"Bilinen klasörler: {klasorler}. Çalışma klasörün: {CALISMA}\n"
        "Kurallar:\n"
        "- Türkçe, kısa ve samimi konuş.\n"
        "- Kullanıcı bilgisayarda bir iş isterse ASLA 'yapamam' ya da 'kendiniz yapın' deme: uygun aracı hemen çağır. "
        "Sadece sohbet, bilgi ya da fikir istiyorsa araç kullanmadan cevap ver.\n"
        "- Önce hazır araçları kullan (klasor_olustur, dosya_kopyala, program_ac...); hiçbiri uymazsa komut_calistir.\n"
        "- Silme, taşıma, üzerine yazma, kod ve komut kullanıcı onayı ister; kullanıcı reddederse başka yol öner.\n"
        "- Bir araç hata verirse hatayı oku, düzelt ve tekrar dene. Emin olmadığın dosya adını önce dosya_listele ile bul.\n"
        "- İş bitince ne yaptığını tek cümleyle söyle (ör. 'Masaüstünde \"Raporlar\" klasörünü oluşturdum.').\n"
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
    r"yapamıyorum|yapamam|gerçekleştiremiyorum|erişimim (yok|bulunmamakta)|New-Item|mkdir )",
    re.IGNORECASE,
)
_YER = r"(?P<yer>masa ?[üu]st[üu]\w*|belgeler\w*|indirilenler\w*|resimler\w*)"
_AD = r"[\"'“”]?(?P<ad>[^\"'“”\n]{1,80}?)[\"'“”]?"
HIZLI_KLASOR = [
    re.compile(_YER + r"\s+(?:bir\s+)?" + _AD + r"\s+(?:isimli|isminde|adında|adinda|adlı|adli|diye)\s+(?:bir\s+)?klas\w*\s+(?:oluştur|olustur|aç|yap)", re.I),
    re.compile(_AD + r"\s+(?:isimli|isminde|adında|adinda|adlı|adli|diye)\s+(?:bir\s+)?klas\w*\s+" + _YER + r"\s*(?:oluştur|olustur|aç|yap)", re.I),
    re.compile(_YER + r"\s+(?:bir\s+)?klas\w*\s+(?:oluştur|olustur|aç|yap)\w*\s*[,:]?\s*(?:adı|adi|ismi)\s+" + _AD + r"\s*$", re.I),
]
HIZLI_UYGULAMA = re.compile(r"^\s*(?P<ad>" + "|".join(sorted(map(re.escape, UYGULAMALAR), key=len, reverse=True))
                            + r")\w*\s+(?:aç|ac|açar mısın|açsana|başlat|baslat)\b", re.I)


def _yer_adi(yer: str) -> str:
    yer = yer.casefold().replace(" ", "")
    for anahtar, ad in (("masa", "Masaüstü"), ("belge", "Belgeler"), ("indir", "İndirilenler"), ("resim", "Resimler")):
        if yer.startswith(anahtar):
            return ad
    return "Masaüstü"


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
    return None


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
        if ad == "belge_ara":
            sonuclar = await run_in_threadpool(belge_ara, str(argumanlar.get("soru", "")))
            if not sonuclar:
                return "Belgelerde ilgili bölüm bulunamadı."
            return _kisalt("\n\n".join(
                f"[{k['kaynak']}{', ' + k['sayfa'] if k['sayfa'] else ''}]\n{k['metin']}" for k in sonuclar))
        return await run_in_threadpool(fonksiyon, **{k: str(v) for k, v in argumanlar.items()})
    except TypeError as hata:
        return f"Araç yanlış parametreyle çağrıldı: {hata}"
    except Exception as hata:  # Hata metni modele dönsün ki düzeltebilsin
        return f"Hata: {type(hata).__name__}: {hata}"


async def _dongu(mesajlar: list[dict], karar: bool | None, model: str, baglam: int, belge_ara,
                 onay_modu: str, belgeler: bool):
    son_soru = mesajlar[-1]["content"] if mesajlar and mesajlar[-1].get("role") == "user" else ""
    if son_soru and (hizli := hizli_komut(son_soru)):
        mesajlar.append({"role": "assistant", "content": "", "tool_calls": [hizli]})
    duzeltme_hakki = 2
    itme: list[dict] = []
    for _ in range(MAKS_TUR):
        for cagri in _bekleyen_cagrilar(mesajlar):
            fn = cagri.get("function", {})
            ad, argumanlar = fn.get("name", ""), fn.get("arguments") or {}
            if onay_gerekli(ad, argumanlar, onay_modu):
                if karar is None:
                    yield {"onay": {"ad": ad, "argumanlar": argumanlar}}
                    return
                onaylandi, karar = karar, None
                sonuc = await _araci_calistir(ad, argumanlar, belge_ara) if onaylandi else \
                    "Kullanıcı bu işlemi reddetti. Neden reddedildiğini sor veya başka bir yol öner."
            else:
                sonuc = await _araci_calistir(ad, argumanlar, belge_ara)
            mesajlar.append({"role": "tool", "tool_name": ad, "content": sonuc})
            yield {"arac": {"ad": ad, "argumanlar": argumanlar, "sonuc": sonuc}}

        icerik, cagrilar = "", []
        async for olay in sohbet_akisi(model, [{"role": "system", "content": sistem_istemi(belgeler)}, *mesajlar, *itme],
                                       baglam, ARAC_TANIMLARI):
            if "t" in olay:
                icerik += olay["t"]
                yield olay
            else:
                cagrilar.extend(olay["tool_calls"])
        itme = []
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
                                            "ŞİMDİ kendin yap: uygun aracı çağır (ör. klasor_olustur, program_ac, "
                                            "dosya_kopyala; hiçbiri uymuyorsa komut_calistir)."},
            ]
            continue
        yanit = {"role": "assistant", "content": icerik}
        if cagrilar:
            yanit["tool_calls"] = cagrilar
        mesajlar.append(yanit)
        if not cagrilar:
            return
    yield {"hata": f"İş {MAKS_TUR} adımda bitmedi; isterseniz 'devam et' yazın."}


async def ajan_akisi(gecmis: list[dict], karar: bool | None, model: str, baglam: int, belge_ara,
                     onay_modu: str = "riskli", belgeler: bool = False):
    """Olaylar: {"t"}, {"arac": {...}}, {"onay": {...}}, {"hata"}, son olarak {"gecmis": [...]}."""
    CALISMA.mkdir(parents=True, exist_ok=True)
    # Araç kullanan model resim görmez; sohbetteki resimler ve arayüz alanları gönderilmez
    mesajlar = [{k: v for k, v in m.items() if k in ("role", "content", "tool_calls", "tool_name")} for m in gecmis
                if m.get("role") in ("user", "assistant", "tool")]
    try:
        async for olay in _dongu(mesajlar, karar, model, baglam, belge_ara, onay_modu, belgeler):
            yield olay
    except OllamaHatasi as hata:
        yield {"hata": str(hata)}
    # İstemci durumu güncel geçmişle eşitlensin
    yield {"gecmis": mesajlar}
