#!/usr/bin/env python3
"""DentMill / EdingCNC G-code dosyalarini grblHAL'e cevirir.

Kullanim:  python eding2grblhal.py dosya1.nc [dosya2.nc ...]
Cikti:     ayni klasorde  <ad>_grblhal.nc

Guvenlik ilkesi: taninmayan HER satir icin hata verir ve o dosyanin
ciktisini YAZMAZ. Yani ya tamamen bilinen komutlardan olusan bir dosya
uretilir ya da hic dosya uretilmez.
"""
import os
import re
import sys

# Eding satiri -> grblHAL karsiligi (bkz. ../sd_kart ve ../BENIOKU.md)
SATIR_ESLEME = {
    "GOSUB CHECK_EMPTY_TOOL": "G65 P110",   # program basinda pens bos olmali
    "GOSUB Z_SAFE": "G65 P108",             # Z guvenli yukseklige
    "GOSUB AZXY_SAFE": "G65 P109",          # Z+A guvenli, sensor ustune
    "M100": "G65 P105",                     # takim boyu / asinma kontrolu
    "M101": None,                           # Eding'de sadece mesaj -> kaldirilir
    "%": None,                              # program isareti -> kaldirilir
}

# Eding'de spindleRampUpTime = 1.00 s. grblHAL M3'ten sonra beklemez,
# bu yuzden her M3/M4 satirindan sonra bekleme eklenir.
SPINDLE_BEKLEME = "G4 P1"

IZINLI_G = {0, 1, 2, 3, 4, 17, 18, 19, 21, 30, 40, 49, 54, 80, 90, 91, 94}
IZINLI_M = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30}
IZINLI_HARF = set("GMXYZABFSTPIJKR")
KELIME = re.compile(r"([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))")


def satir_kontrol(satir):
    """Satir guvenle grblHAL'e gidebilirse None, yoksa hata metni dondurur."""
    kalan = KELIME.sub("", satir).strip()
    if kalan:
        return "taninmayan icerik: %r" % kalan
    for harf, deger in KELIME.findall(satir):
        if harf not in IZINLI_HARF:
            return "izin verilmeyen kelime %s%s" % (harf, deger)
        if harf == "G" and float(deger) not in IZINLI_G:
            return "izin verilmeyen G kodu G%s" % deger
        if harf == "M" and float(deger) not in IZINLI_M:
            return "izin verilmeyen M kodu M%s" % deger
    return None


def cevir(giris):
    cikis = os.path.splitext(giris)[0] + "_grblhal.nc"
    sayac = {}
    hatalar = []
    satirlar = []
    with open(giris, "r", encoding="ascii", errors="strict", newline="") as f:
        for no, ham in enumerate(f, 1):
            satir = ham.strip().upper()
            if not satir:
                continue
            if satir in SATIR_ESLEME:
                yeni = SATIR_ESLEME[satir]
                sayac[satir] = sayac.get(satir, 0) + 1
                if yeni:
                    satirlar.append(yeni)
                continue
            hata = satir_kontrol(satir)
            if hata:
                hatalar.append("  satir %d: %s   [%s]" % (no, hata, ham.strip()))
                if len(hatalar) >= 20:
                    break
                continue
            satirlar.append(satir)
            if re.search(r"\bM0?[34]\b", satir):
                satirlar.append(SPINDLE_BEKLEME)
                sayac["M3/M4 sonrasi G4 P1"] = sayac.get("M3/M4 sonrasi G4 P1", 0) + 1

    if hatalar:
        print("HATA  %s  -> cikti YAZILMADI" % giris)
        print("\n".join(hatalar))
        return False

    gecici = cikis + ".tmp"
    with open(gecici, "w", encoding="ascii", newline="\r\n") as f:
        f.write("\n".join(satirlar) + "\n")
    os.replace(gecici, cikis)
    print("TAMAM %s -> %s (%d satir)" % (giris, cikis, len(satirlar)))
    for k in sorted(sayac):
        print("    %-24s %d" % (k, sayac[k]))
    return True


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    basarili = all([cevir(d) for d in sys.argv[1:]])
    return 0 if basarili else 1


if __name__ == "__main__":
    sys.exit(main())
