"""Onay, tehlikeli komut tespiti ve günlük kaydı."""

from __future__ import annotations

import datetime as dt
import json
import re

from .ayarlar import Ayarlar

# Gözetimsiz modda bile asla otomatik çalıştırılmayan kalıplar
TEHLIKELI_KALIPLAR = [
    r"\brm\s+-[a-z]*r[a-z]*f?\s+(/|~|\$HOME|/\*)(\s|$)",
    r"\bmkfs(\.|\s)",
    r"\bdd\s+.*of=/dev/",
    r"\b(shutdown|reboot|poweroff|halt)\b",
    r"\bformat\s+[a-z]:",
    r":\(\)\s*\{\s*:\|:&\s*\};:",
    r"\bgit\s+push\b.*(--force|-f\b)",
    r"\bchmod\s+-R\s+777\s+/",
    r"\bcurl\b.*\|\s*(sudo\s+)?(ba)?sh",
    r"\bwget\b.*\|\s*(sudo\s+)?(ba)?sh",
    r"Remove-Item\s+.*-Recurse.*(C:\\|\$env:USERPROFILE)",
]


def tehlikeli_mi(komut: str) -> bool:
    return any(re.search(k, komut, re.IGNORECASE) for k in TEHLIKELI_KALIPLAR)


class Guvenlik:
    def __init__(self, ayarlar: Ayarlar):
        self.ayarlar = ayarlar

    def gunluge_yaz(self, tur: str, veri: object) -> None:
        satir = json.dumps(
            {"zaman": dt.datetime.now().isoformat(timespec="seconds"), "tur": tur, "veri": veri},
            ensure_ascii=False,
            default=str,
        )
        with self.ayarlar.gunluk_dosyasi.open("a", encoding="utf-8") as f:
            f.write(satir + "\n")

    def _sor(self, aciklama: str) -> bool:
        if self.ayarlar.gozetimsiz:
            return False
        try:
            cevap = input(f"\n⚠️  {aciklama}\n   Onaylıyor musun? [e/H] ").strip().lower()
        except EOFError:
            return False
        return cevap in ("e", "evet", "y", "yes")

    def komut_onayi(self, komut: str) -> tuple[bool, str]:
        """Terminal komutu çalıştırılabilir mi? (izin, ret_sebebi)"""
        for kalip in self.ayarlar.yasak_kaliplar:
            if re.search(kalip, komut, re.IGNORECASE):
                return False, "Bu komut bu modda yasak (git işlemlerini otopilot yönetir)."
        if tehlikeli_mi(komut):
            if self._sor(f"TEHLİKELİ komut: {komut}"):
                return True, ""
            return False, "Bu komut tehlikeli olarak işaretlendi ve kullanıcı onaylamadı."
        if self.ayarlar.mod == "otonom":
            return True, ""
        if self._sor(f"Komut çalıştırılacak: {komut}"):
            return True, ""
        return False, "Kullanıcı bu komutu onaylamadı. Başka bir yol dene veya kullanıcıya sor."

    def dosya_onayi(self, islem: str, yol: str) -> tuple[bool, str]:
        if self.ayarlar.mod == "otonom":
            return True, ""
        if self._sor(f"Dosya {islem}: {yol}"):
            return True, ""
        return False, "Kullanıcı bu dosya değişikliğini onaylamadı."

    def ekran_onayi(self, eylem: str, girdi: dict) -> tuple[bool, str]:
        if self.ayarlar.mod != "tam" or eylem in ("screenshot", "zoom", "cursor_position", "wait"):
            return True, ""
        if self._sor(f"Ekran eylemi: {eylem} {girdi}"):
            return True, ""
        return False, "Kullanıcı bu ekran eylemini onaylamadı."
