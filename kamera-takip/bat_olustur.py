"""takip.py degisince KameraTakip.bat'i yeniden uretir: python bat_olustur.py"""
import os
d = os.path.dirname(os.path.abspath(__file__))
sablon = open(os.path.join(d, "bat_sablon.txt"), encoding="ascii").read()
kod = open(os.path.join(d, "takip.py"), encoding="ascii").read()
metin = sablon.rstrip("\n") + "\n" + kod
with open(os.path.join(d, "KameraTakip.bat"), "w", encoding="ascii", newline="\r\n") as f:
    f.write(metin)
print("KameraTakip.bat olusturuldu")
