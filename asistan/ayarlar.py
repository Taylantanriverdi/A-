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
    # DeepSeek (OpenAI uyumlu API). Başka bir OpenAI uyumlu servis için ASISTAN_API_URL'yi değiştir.
    api_url: str = os.environ.get("ASISTAN_API_URL", "https://api.deepseek.com")
    api_anahtari: str = os.environ.get("DEEPSEEK_API_KEY", "")
    # Ekran kontrolü için görüntü kabul eden bir model gerekir (ör. DeepSeek'in "flash" görsel modelleri).
    model: str = os.environ.get("ASISTAN_MODEL", "deepseek-chat")
    max_tokens: int = int(os.environ.get("ASISTAN_MAX_TOKENS", "8192"))
    # Geçmişte tutulacak en fazla ekran görüntüsü (eskiler metne çevrilir; maliyeti düşürür)
    max_goruntu: int = int(os.environ.get("ASISTAN_MAX_GORUNTU", "3"))

    # onayli  : terminal komutları ve dosya değişiklikleri için onay ister (varsayılan)
    # tam     : fare/klavye dahil her eylem için onay ister
    # otonom  : onay istemez; yalnızca tehlikeli komutları reddeder (gözetimsiz çalışma)
    mod: str = os.environ.get("ASISTAN_MOD", "onayli")

    # Gözetimsiz modda kullanıcıya soru sorulamaz
    gozetimsiz: bool = False

    # Her modda reddedilen komut kalıpları (regex); ör. otopilot git işlemlerini kendisi yönetir
    yasak_kaliplar: list[str] = field(default_factory=list)

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
