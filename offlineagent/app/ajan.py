"""Ajan modu: model araç kullanarak dosya okuyup yazabilir, kod ve komut çalıştırabilir.

Okuma araçları kendiliğinden çalışır. Dosya yazma, Python ve komut çalıştırma ise her seferinde
kullanıcının arayüzden onay vermesini bekler. Sohbet durumu istemcide tutulur: her istek tüm
geçmişi gönderir, sunucu güncel geçmişi geri yollar.
"""
import datetime
import os
import subprocess
import sys
from pathlib import Path

from starlette.concurrency import run_in_threadpool

from ayarlar import KOK
from belge_oku import belgeyi_oku
from ollama_api import OllamaHatasi, sohbet_akisi

CALISMA = KOK / "calisma"
MAKS_TUR = 12
MAKS_CIKTI = 8000
ZAMAN_ASIMI = 120
WINDOWS = sys.platform == "win32"


def _kisalt(metin: str) -> str:
    return metin if len(metin) <= MAKS_CIKTI else metin[:MAKS_CIKTI] + f"\n… (çıktı kısaltıldı, toplam {len(metin)} karakter)"


def _yol(yol: str) -> Path:
    """Göreli yollar çalışma klasörüne göre çözülür; mutlak yollar olduğu gibi kullanılır."""
    p = Path(os.path.expandvars(os.path.expanduser(yol.strip() or ".")))
    return p if p.is_absolute() else CALISMA / p


def _calisma_ici(yol: str) -> Path:
    p = (CALISMA / yol).resolve()
    if p != CALISMA.resolve() and CALISMA.resolve() not in p.parents:
        raise ValueError(f"Dosyalar sadece çalışma klasörüne yazılabilir: {CALISMA}")
    return p


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

def tarih_saat() -> str:
    return datetime.datetime.now().strftime("%d.%m.%Y %H:%M, %A")


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


def dosya_yaz(yol: str, icerik: str) -> str:
    p = _calisma_ici(yol)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(icerik, "utf-8")
    return f"Yazıldı: {p} ({len(icerik)} karakter)"


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


# ad -> (fonksiyon, onay gerekli mi, tanım)
ARACLAR = {
    "tarih_saat": (tarih_saat, False, _tanim("tarih_saat", "Bugünün tarihini ve saatini verir.", {}, [])),
    "belge_ara": (None, False, _tanim(
        "belge_ara", "Kullanıcının belgeler klasöründeki dosyalarda anlamca arama yapar ve ilgili bölümleri getirir.",
        {"soru": _metin("Aranacak konu veya soru")}, ["soru"])),
    "dosya_listele": (dosya_listele, False, _tanim(
        "dosya_listele", "Bir klasördeki dosyaları listeler. Boş bırakılırsa çalışma klasörünü listeler.",
        {"klasor": _metin("Klasör yolu (göreli yollar çalışma klasörüne göredir)")}, [])),
    "dosya_oku": (dosya_oku, False, _tanim(
        "dosya_oku", "Bir dosyanın içeriğini okur (txt, md, csv, json, py, html, pdf, docx, xlsx...).",
        {"yol": _metin("Dosya yolu (göreli yollar çalışma klasörüne göredir)")}, ["yol"])),
    "dosya_yaz": (dosya_yaz, True, _tanim(
        "dosya_yaz", "Çalışma klasörüne bir dosya yazar (varsa üzerine yazar). Kullanıcı onayı gerekir.",
        {"yol": _metin("Çalışma klasörü içindeki göreli dosya yolu"), "icerik": _metin("Dosyanın tam içeriği")},
        ["yol", "icerik"])),
    "python_calistir": (python_calistir, True, _tanim(
        "python_calistir",
        "Python kodu çalıştırır ve çıktısını döndürür. Çalışma klasöründe çalışır. Kullanıcı onayı gerekir. "
        "Sonucu görmek için print kullan.",
        {"kod": _metin("Çalıştırılacak tam Python kodu")}, ["kod"])),
    "komut_calistir": (komut_calistir, True, _tanim(
        "komut_calistir",
        "Windows PowerShell komutu çalıştırır (program açma, dosya işlemleri, sistem bilgisi vb.). "
        "Kullanıcı onayı gerekir.",
        {"komut": _metin("PowerShell komutu")}, ["komut"])),
}
ARAC_TANIMLARI = [tanim for _, _, tanim in ARACLAR.values()]


def onay_gerekli(ad: str) -> bool:
    return ad in ARACLAR and ARACLAR[ad][1]


def sistem_istemi() -> str:
    return (
        "Sen Offline Agent'ın ajan modusun. Kullanıcının Windows bilgisayarında tamamen yerel çalışıyorsun ve "
        "araçlar kullanarak gerçek işler yapabilirsin: dosya okuma/yazma, Python kodu ve PowerShell komutu çalıştırma, "
        f"belgelerde arama. Çalışma klasörün: {CALISMA}\n"
        "Kurallar:\n"
        "- Türkçe konuş. Bir işe başlamadan önce ne yapacağını bir cümleyle söyle.\n"
        "- Gerektiğinde araç kullan; tahmin etmek yerine dosyayı oku veya kodu çalıştırıp sonucu gör.\n"
        "- Dosya yazma, kod ve komut çalıştırma kullanıcı onayı ister; kullanıcı reddederse başka yol öner.\n"
        "- Bir araç hata verirse hatayı oku, düzelt ve tekrar dene.\n"
        "- Silme veya geri alınamaz işlemler yapmadan önce kullanıcıya açıkça sor.\n"
        "- İş bitince sonucu kısaca özetle."
    )


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


async def _dongu(mesajlar: list[dict], karar: bool | None, model: str, baglam: int, belge_ara):
    for _ in range(MAKS_TUR):
        for cagri in _bekleyen_cagrilar(mesajlar):
            fn = cagri.get("function", {})
            ad, argumanlar = fn.get("name", ""), fn.get("arguments") or {}
            if onay_gerekli(ad):
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
        async for olay in sohbet_akisi(model, [{"role": "system", "content": sistem_istemi()}, *mesajlar],
                                       baglam, ARAC_TANIMLARI):
            if "t" in olay:
                icerik += olay["t"]
                yield olay
            else:
                cagrilar.extend(olay["tool_calls"])
        yanit = {"role": "assistant", "content": icerik}
        if cagrilar:
            yanit["tool_calls"] = cagrilar
        mesajlar.append(yanit)
        if not cagrilar:
            return
    yield {"hata": f"Ajan {MAKS_TUR} adımda işi bitiremedi; isterseniz 'devam et' yazın."}


async def ajan_akisi(gecmis: list[dict], karar: bool | None, model: str, baglam: int, belge_ara):
    """Olaylar: {"t"}, {"arac": {...}}, {"onay": {...}}, {"hata"}, son olarak {"gecmis": [...]}."""
    CALISMA.mkdir(parents=True, exist_ok=True)
    # Ajan modeli resim görmez; sohbetteki resimler ajana gönderilmez
    mesajlar = [{k: v for k, v in m.items() if k != "images"} for m in gecmis
                if m.get("role") in ("user", "assistant", "tool")]
    try:
        async for olay in _dongu(mesajlar, karar, model, baglam, belge_ara):
            yield olay
    except OllamaHatasi as hata:
        yield {"hata": str(hata)}
    # İstemci durumu güncel geçmişle eşitlensin
    yield {"gecmis": mesajlar}
