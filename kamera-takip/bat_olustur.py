"""takip.py degisince (UTF-8 sablon, chcp 65001) KameraTakip.bat'i yeniden uretir: python bat_olustur.py"""
import os
d = os.path.dirname(os.path.abspath(__file__))
sablon = open(os.path.join(d, "bat_sablon.txt"), encoding="utf-8").read()
kod = open(os.path.join(d, "takip.py"), encoding="utf-8").read()
# Python kodu ASCII kalsin (Turkce harfler \\uXXXX kacisiyla): bat icinde kodlama sorunu cikmasin
kod = "".join(c if ord(c) < 128 else "\\u%04x" % ord(c) for c in kod)
import re
surum = re.search(r'^SURUM = "([^"]+)"', kod, re.M).group(1)
sablon = sablon.replace("title Kamera Hareket Takibi", "title Kamera Hareket Takibi " + surum)
sablon = sablon.replace("echo [1/4] Python", "echo Kamera Takip " + surum + "\necho.\necho [1/4] Python", 1)
metin = sablon.rstrip("\n") + "\n" + kod
with open(os.path.join(d, "KameraTakip.bat"), "w", encoding="utf-8", newline="\r\n") as f:
    f.write(metin)
import zipfile
with zipfile.ZipFile(os.path.join(d, "KameraTakip.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join(d, "KameraTakip.bat"), "KameraTakip.bat")
    z.write(os.path.join(d, "Guncelle.bat"), "Guncelle.bat")
with zipfile.ZipFile(os.path.join(d, "Guncelle.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join(d, "Guncelle.bat"), "Guncelle.bat")
print("KameraTakip.bat, KameraTakip.zip ve Guncelle.zip olusturuldu")
