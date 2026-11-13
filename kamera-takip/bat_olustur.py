"""takip.py degisince KameraTakip.bat'i yeniden uretir: python bat_olustur.py"""
import os
d = os.path.dirname(os.path.abspath(__file__))
sablon = open(os.path.join(d, "bat_sablon.txt"), encoding="ascii").read()
kod = open(os.path.join(d, "takip.py"), encoding="ascii").read()
metin = sablon.rstrip("\n") + "\n" + kod
with open(os.path.join(d, "KameraTakip.bat"), "w", encoding="ascii", newline="\r\n") as f:
    f.write(metin)
import zipfile
with zipfile.ZipFile(os.path.join(d, "KameraTakip.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join(d, "KameraTakip.bat"), "KameraTakip.bat")
    z.write(os.path.join(d, "Guncelle.bat"), "Guncelle.bat")
print("KameraTakip.bat ve KameraTakip.zip olusturuldu")
