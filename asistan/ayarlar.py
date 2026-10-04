"""Asistanın tüm ayarları tek yerde.

Değerler ortam değişkenleriyle (ASISTAN_*) ezilebilir.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

VERI_DIZINI = Path(os.environ.get("ASISTAN_DIZIN", Path.home() / ".asistan"))


@dataclass
class Ayarlar:
    model: str = os.environ.get("ASISTAN_MODEL", "claude-opus-5-5")
    # low | medium | high | xhigh | max — bilgisayar kullanımı ve kodlama için "high" iyi bir denge
    efor: str = os.environ.get("ASISTAN_EFOR", "high")
    max_tokens: int = 64000

    # onayli  : terminal komutları ve dosya değişiklikleri için onay ister (varsayılan)
    # tam     : fare/klavye dahil her eylem için onay ister
    # otonom  : onay istemez; yalnızca tehlikeli komutları reddeder (gözetimsiz çalışma)
    mod: str = os.environ.get("ASISTAN_MOD", "onayli")

    # Gözetimsiz modda kullanıcıya soru sorulamaz
    gozetimsiz: bool = False

    # Dosya düzenleyicinin dokunabileceği kök dizinler
    izinli_dizinler: list[Path] = field(
        default_factory=lambda: [
            Path(p).expanduser().resolve()
            for p in os.environ.get("ASISTAN_IZINLI_DIZINLER", str(Path.home())).split(os.pathsep)
            if p
        ]
    )

    # Ekran kontrolü kapatılabilir (ör. sunucuda yalnızca yazılım modu)
    ekran: bool = os.environ.get("ASISTAN_EKRAN", "1") != "0"

    # Bir görevde en fazla kaç model turu
    max_tur: int = int(os.environ.get("ASISTAN_MAX_TUR", "200"))

    # Komut zaman aşımı (saniye)
    komut_zaman_asimi: int = int(os.environ.get("ASISTAN_KOMUT_ZAMAN_ASIMI", "300"))

    @property
    def veri_dizini(self) -> Path:
        VERI_DIZINI.mkdir(parents=True, exist_ok=True)
        return VERI_DIZINI

    @property
    def profil_dosyasi(self) -> Path:
        return self.veri_dizini / "profil.md"

    @property
    def notlar_dosyasi(self) -> Path:
        return self.veri_dizini / "notlar.md"

    @property
    def gunluk_dosyasi(self) -> Path:
        return self.veri_dizini / "gunluk.log"
