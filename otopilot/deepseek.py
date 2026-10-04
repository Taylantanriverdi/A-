"""DeepSeek motoru: Claude Code yerine DeepSeek API ile çalışan kodlayıcı.

Asistanın (asistan/) terminal ve dosya araçlarını kullanır; ClaudeCLI ile aynı arayüzü sunar
(`calistir(istem, oturum, sema) -> Sonuc`), böylece otopilot döngüsü motordan bağımsızdır.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import uuid
from pathlib import Path

from .claude import SISTEM_EKI, Sonuc

# Otopilot git'i kendisi yönettiği için kodlayıcının bu komutları çalıştırması engellenir
GIT_YASAKLARI = [
    r"\bgit\s+(commit|push|reset|rebase|checkout|switch|branch|stash|merge|cherry-pick|revert|tag|clean)\b",
]

BAKIYE_MESAJI = "DeepSeek bakiyesi yetersiz. https://platform.deepseek.com adresinden bakiye yükle; otopilot bekleyip yeniden dener."


def _json_cikar(metin: str) -> dict | None:
    """Model yanıtındaki JSON nesnesini bulur (```json bloğu veya ilk {...})."""
    adaylar = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", metin, re.DOTALL)
    bas, son = metin.find("{"), metin.rfind("}")
    if bas != -1 and son > bas:
        adaylar.append(metin[bas:son + 1])
    for a in adaylar:
        try:
            v = json.loads(a)
            if isinstance(v, dict):
                return v
        except json.JSONDecodeError:
            continue
    return None


class DeepSeekMotor:
    def __init__(self, proje: Path, model: str | None = None, izleyici=None, **_):
        from asistan.ayarlar import Ayarlar

        self.proje = proje
        self.model = model
        self.izleyici = izleyici  # her araç çağrısında (ad, girdi) ile çağrılır — arayüz için
        self.ek_izinler: list[str] = []  # Claude motoruyla uyumluluk için; burada kullanılmaz
        self._ayarlar = Ayarlar
        self._oturumlar: dict = {}
        self._yeni_ajan()  # API anahtarı yoksa hemen anlaşılsın

    def _yeni_ajan(self):
        from asistan.ajan import Ajan

        a = self._ayarlar()
        a.ekran = False
        a.mod = "otonom"
        a.gozetimsiz = True
        a.izinli_dizinler = [self.proje.resolve()]
        a.yasak_kaliplar = list(GIT_YASAKLARI)
        if self.model:
            a.model = self.model
        ajan = Ajan(a)
        ajan.izleyici = self.izleyici
        ajan.terminal.cwd = str(self.proje)
        return ajan

    def calistir(self, istem: str, oturum: str | None = None, sema: dict | None = None) -> Sonuc:
        ajan = self._oturumlar.get(oturum) if oturum else None
        if ajan is None:
            # Yeni oturum ya da yeniden başlatma sonrası kaybolmuş oturum: kurallarla baştan başla
            oturum = oturum or uuid.uuid4().hex
            ajan = self._oturumlar[oturum] = self._yeni_ajan()
            istem = f"<otopilot_kurallari>\n{SISTEM_EKI}</otopilot_kurallari>\n\n{istem}"
        if sema:
            istem += ("\n\nİşin bitince yanıtının sonunda YALNIZCA şu JSON şemasına uyan tek bir JSON nesnesi yaz "
                      f"(başka metin ekleme):\n{json.dumps(sema, ensure_ascii=False)}")

        metin = ajan.gorev(istem)
        if ajan.durduruldu:
            raise KeyboardInterrupt

        if ajan.son_hata:
            durum, mesaj = ajan.son_hata
            if durum == 402:
                return Sonuc(False, metin=BAKIYE_MESAJI, oturum=oturum, limit=True, hata=BAKIYE_MESAJI)
            if durum == 429:
                return Sonuc(False, metin=mesaj, oturum=oturum, limit=True, hata="DeepSeek hız sınırı",
                             sifirlanma=dt.datetime.now().astimezone() + dt.timedelta(minutes=2))
            return Sonuc(False, metin=mesaj, oturum=oturum, hata=f"DeepSeek hatası ({durum}): {mesaj}")

        yapisal = None
        if sema:
            yapisal = _json_cikar(metin)
            if yapisal is None:  # bir kez daha, yalnızca JSON iste
                metin = ajan.gorev("Yanıtında geçerli JSON bulamadım. Şimdi YALNIZCA istenen JSON nesnesini yaz.")
                yapisal = _json_cikar(metin)
            if yapisal is None:
                return Sonuc(False, metin=metin, oturum=oturum, hata="Model geçerli JSON üretmedi.")
        return Sonuc(True, metin=metin, oturum=oturum, yapisal=yapisal)
