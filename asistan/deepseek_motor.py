"""DeepSeek motoru.

DeepSeek'in OpenAI uyumlu API'sini kullanır. DeepSeek'te hazır bir
"bilgisayar kullanma" aracı olmadığı için fare/klavye eylemlerini kendi
tanımladığımız `computer` fonksiyonuyla veriyoruz. Ekran görüntüleri,
araç sonuçlarından sonra kullanıcı mesajı içinde resim olarak gönderilir.
"""

from __future__ import annotations

import json
import os
import time

import openai
import pyautogui

from bilgisayar import Bilgisayar
from ortak import KOMUT_ACIKLAMASI, KOMUT_SEMASI, eylemi_goster, komut_calistir, sistem_istemi

MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-flash")
ADRES = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
MAKS_ADIM = int(os.environ.get("ASISTAN_MAKS_ADIM", "80"))
# Geçmişte tutulacak en fazla ekran görüntüsü (eskileri metinle değiştirilir; maliyeti düşürür).
SAKLANAN_GORUNTU = int(os.environ.get("ASISTAN_GORUNTU_SAYISI", "3"))

EYLEMLER = [
    "screenshot", "left_click", "right_click", "middle_click", "double_click", "triple_click",
    "left_click_drag", "mouse_move", "scroll", "type", "key", "hold_key", "wait", "zoom",
    "cursor_position", "left_mouse_down", "left_mouse_up",
]
GORSEL_EYLEMLER = ("screenshot", "zoom")

ARACLAR = [
    {
        "type": "function",
        "function": {
            "name": "computer",
            "description": (
                "Kullanıcının bilgisayarında tek bir fare/klavye/ekran eylemi yapar. "
                "Koordinatlar her zaman SON TAM EKRAN GÖRÜNTÜSÜNÜN piksel koordinatlarıdır "
                "(sol üst köşe 0,0). Eylemden sonra sana otomatik olarak yeni bir ekran görüntüsü gelir.\n"
                "Eylemler:\n"
                "- screenshot: ekranın görüntüsünü al\n"
                "- left_click / right_click / middle_click / double_click / triple_click: "
                "coordinate=[x,y] noktasına tıkla (text='ctrl' gibi değiştirici tuşla birlikte basılabilir)\n"
                "- left_click_drag: start_coordinate'tan coordinate'a sürükle\n"
                "- mouse_move: fareyi coordinate'a götür\n"
                "- scroll: scroll_direction (up/down/left/right) yönünde scroll_amount kadar kaydır, "
                "isteğe bağlı coordinate üzerinde\n"
                "- type: text metnini yaz\n"
                "- key: tuş veya kombinasyon bas, örn. 'Return', 'Escape', 'ctrl+c', 'alt+Tab', "
                "'super' (Windows tuşu); repeat ile tekrarla\n"
                "- hold_key: text tuşunu duration saniye basılı tut\n"
                "- wait: duration saniye bekle (sayfa yüklenirken)\n"
                "- zoom: region=[x0,y0,x1,y1] bölgesini büyütüp gör (küçük yazılar için)\n"
                "- cursor_position: farenin konumunu öğren\n"
                "- left_mouse_down / left_mouse_up: sol tuşa bas / bırak"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": EYLEMLER},
                    "coordinate": {
                        "type": "array", "items": {"type": "integer"}, "minItems": 2, "maxItems": 2,
                        "description": "[x, y]",
                    },
                    "start_coordinate": {
                        "type": "array", "items": {"type": "integer"}, "minItems": 2, "maxItems": 2,
                    },
                    "text": {"type": "string"},
                    "scroll_direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
                    "scroll_amount": {"type": "integer"},
                    "duration": {"type": "number"},
                    "repeat": {"type": "integer"},
                    "region": {
                        "type": "array", "items": {"type": "integer"}, "minItems": 4, "maxItems": 4,
                        "description": "[x0, y0, x1, y1]",
                    },
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {"name": "run_command", "description": KOMUT_ACIKLAMASI, "parameters": KOMUT_SEMASI},
    },
]

EK_ISTEM = """

Araç kullanımı:
- Ekranı görmek ve kontrol etmek için `computer` fonksiyonunu, komut çalıştırmak için `run_command` fonksiyonunu kullan.
- Ekran görüntülerinin üzerinde koordinat bulmana yardım eden soluk mor bir ızgara var (her 100 pikselde bir,
  kenarlarda sayılarla). Tıklamadan önce hedefin x,y koordinatını bu ızgaraya göre dikkatlice hesapla.
- Bir işi bitirdiğinde ya da kullanıcıya bir şey sorman gerektiğinde fonksiyon çağırmadan sadece yanıt yaz."""


def _veri_url(blok: dict) -> str:
    kaynak = blok["source"]
    return f"data:{kaynak['media_type']};base64,{kaynak['data']}"


class DeepSeekAsistan:
    def __init__(self, onayli: bool) -> None:
        anahtar = os.environ.get("DEEPSEEK_API_KEY")
        self.istemci = openai.OpenAI(api_key=anahtar, base_url=ADRES, timeout=300)
        # DeepSeek resimleri küçük bir token bütçesinde işler; çok büyük göndermenin faydası yok.
        self.pc = Bilgisayar(maks_uzun_kenar=1280, bicim="jpeg", izgara=True)
        self.sistem = sistem_istemi(self.pc, EK_ISTEM)
        self.onayli = onayli
        self.dusunce_geri_gonder = True
        self.mesajlar: list[dict] = []
        self.sifirla()

    def sifirla(self) -> None:
        self.mesajlar = [{"role": "system", "content": self.sistem}]

    # --- API ------------------------------------------------------------------

    def _istek(self):
        try:
            return self.istemci.chat.completions.create(
                model=MODEL, messages=self._gonderilecek(), tools=ARACLAR, max_tokens=8192,
            )
        except openai.BadRequestError as hata:
            # Bazı DeepSeek modelleri önceki düşünce metninin geri gönderilmesini kabul etmez.
            if self.dusunce_geri_gonder and "reasoning_content" in str(hata):
                self.dusunce_geri_gonder = False
                return self.istemci.chat.completions.create(
                    model=MODEL, messages=self._gonderilecek(), tools=ARACLAR, max_tokens=8192,
                )
            raise

    def _gonderilecek(self) -> list[dict]:
        if self.dusunce_geri_gonder:
            return self.mesajlar
        return [{k: v for k, v in m.items() if k != "reasoning_content"} for m in self.mesajlar]

    def _eski_goruntuleri_temizle(self) -> None:
        """Son birkaç ekran görüntüsü dışındakileri metinle değiştirir."""
        gorulen = 0
        for mesaj in reversed(self.mesajlar):
            if mesaj["role"] != "user" or not isinstance(mesaj["content"], list):
                continue
            for parca in mesaj["content"]:
                if parca.get("type") == "image_url":
                    gorulen += 1
                    if gorulen > SAKLANAN_GORUNTU:
                        parca.clear()
                        parca.update({"type": "text", "text": "[eski ekran görüntüsü kaldırıldı]"})

    # --- eylemler -------------------------------------------------------------

    def _ekran_parcasi(self, aciklama: str, bloklar: list[dict]) -> list[dict]:
        return [
            {"type": "text", "text": aciklama},
            {"type": "image_url", "image_url": {"url": _veri_url(bloklar[0])}},
        ]

    def _araclari_calistir(self, cagrilar) -> None:
        """Araç çağrılarını uygular; araç mesajlarını ve gerekirse resimli kullanıcı mesajını ekler."""
        resimler: list[dict] = []
        hata_oldu = False
        ekran_eylemi = False
        son_eylem = None
        for cagri in cagrilar:
            ad = cagri.function.name
            try:
                girdi = json.loads(cagri.function.arguments or "{}")
                if not isinstance(girdi, dict):
                    raise ValueError("argümanlar bir nesne olmalı")
            except (json.JSONDecodeError, ValueError) as hata:
                girdi, sonuc = None, f"Hata: geçersiz argümanlar ({hata})"

            if girdi is None:
                hata_oldu = True
            elif hata_oldu:
                sonuc = "Çalıştırılmadı: bu turdaki önceki bir eylem başarısız oldu."
            elif ad == "computer":
                eylem = girdi.pop("action", None)
                eylemi_goster(str(eylem), girdi)
                try:
                    if eylem not in EYLEMLER:
                        raise ValueError(f"bilinmeyen eylem {eylem!r}")
                    if self.onayli and eylem not in ("screenshot", "zoom", "cursor_position"):
                        if input("      Uygulansın mı? [E/h] ").strip().lower() in ("h", "hayır", "n", "no"):
                            raise RuntimeError("Kullanıcı bu eylemi reddetti.")
                    bloklar = self.pc.uygula(eylem, girdi)
                    ekran_eylemi = True
                    son_eylem = eylem
                    if eylem in GORSEL_EYLEMLER:
                        sonuc = "Görüntü aşağıdaki mesajda."
                        if eylem == "screenshot":
                            aciklama = f"Ekran görüntüsü ({self.pc.goruntu_g}x{self.pc.goruntu_y}):"
                        else:
                            aciklama = (f"{girdi.get('region')} bölgesinin yakınlaştırılmış görüntüsü "
                                        "(koordinatlar için tam ekran görüntüsünü kullan):")
                        resimler.extend(self._ekran_parcasi(aciklama, bloklar))
                    else:
                        sonuc = bloklar[0]["text"]
                except pyautogui.FailSafeException:
                    raise
                except Exception as hata:  # noqa: BLE001 - hatayı modele geri bildiriyoruz
                    sonuc = f"Hata: {hata}"
                    hata_oldu = True
            elif ad == "run_command":
                komut = girdi.get("command")
                if not isinstance(komut, str) or not komut.strip():
                    sonuc = "Hata: command eksik."
                else:
                    sonuc, _ = komut_calistir(komut, str(girdi.get("reason", "")))
            else:
                sonuc = f"Hata: bilinmeyen fonksiyon {ad}"
            self.mesajlar.append({"role": "tool", "tool_call_id": cagri.id, "content": sonuc})

        # Fare/klavye eyleminden sonra sonucu görebilmesi için otomatik ekran görüntüsü ekle.
        if ekran_eylemi and son_eylem not in GORSEL_EYLEMLER:
            time.sleep(0.8)
            bloklar = self.pc.uygula("screenshot", {})
            resimler.extend(self._ekran_parcasi(
                f"Eylemlerden sonraki ekran görüntüsü ({self.pc.goruntu_g}x{self.pc.goruntu_y}):", bloklar))
        if resimler:
            self.mesajlar.append({"role": "user", "content": resimler})
            self._eski_goruntuleri_temizle()

    # --- görev döngüsü --------------------------------------------------------

    def gorev(self, istek: str) -> None:
        son = self.mesajlar[-1]
        if son["role"] == "user" and isinstance(son["content"], list):
            # Önceki görev yarıda kaldıysa yeni isteği aynı kullanıcı mesajına ekle.
            son["content"].append({"type": "text", "text": istek})
        else:
            self.mesajlar.append({"role": "user", "content": istek})

        for _ in range(MAKS_ADIM):
            try:
                yanit = self._istek()
            except openai.AuthenticationError:
                print("\n❌ DeepSeek API anahtarı geçersiz. DEEPSEEK_API_KEY değerini kontrol et.")
                return
            except openai.APIStatusError as hata:
                print(f"\n❌ API hatası ({hata.status_code}): {hata.message}")
                return
            except openai.APIConnectionError:
                print("\n❌ Bağlantı hatası: internet bağlantını kontrol et ve 'devam et' yaz.")
                return

            secim = yanit.choices[0]
            mesaj = secim.message
            kayit: dict = {"role": "assistant", "content": mesaj.content or ""}
            dusunce = getattr(mesaj, "reasoning_content", None)
            if dusunce:
                kayit["reasoning_content"] = dusunce
            if mesaj.tool_calls:
                kayit["tool_calls"] = [
                    {"id": c.id, "type": "function",
                     "function": {"name": c.function.name, "arguments": c.function.arguments}}
                    for c in mesaj.tool_calls
                ]
            self.mesajlar.append(kayit)

            if mesaj.content and mesaj.content.strip():
                onek = "  💭 " if mesaj.tool_calls else "\n🤖 "
                print(f"{onek}{mesaj.content.strip()}")

            if not mesaj.tool_calls:
                if secim.finish_reason == "length":
                    print("\n⚠️  Yanıt çok uzadı ve kesildi.")
                return  # görev bitti ya da asistan bir soru soruyor

            self._araclari_calistir(mesaj.tool_calls)

        print(f"\n⚠️  {MAKS_ADIM} adım sınırına ulaşıldı. Devam etmesi için 'devam et' yazabilirsin.")
