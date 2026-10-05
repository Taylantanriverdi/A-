"""Kişisel bilgisayar asistanı.

Ne istediğini yazarsın; yapay zeka (DeepSeek veya Claude) ekranına bakıp
fareyi, klavyeyi ve (izin verirsen) komut satırını kullanarak işi bir insan gibi yapar.

Çalıştırma:  python asistan.py
Sağlayıcı:   DEEPSEEK_API_KEY varsa DeepSeek, yoksa ANTHROPIC_API_KEY ile Claude kullanılır.
             Zorlamak için ASISTAN_SAGLAYICI=deepseek veya ASISTAN_SAGLAYICI=claude.
"""

from __future__ import annotations

import argparse
import os
import sys

import anthropic
import pyautogui

from bilgisayar import Bilgisayar
from ortak import KOMUT_ACIKLAMASI, KOMUT_SEMASI, eylemi_goster, komut_calistir, sistem_istemi

MODEL = os.environ.get("ASISTAN_MODEL", "claude-opus-5-5")
EFOR = os.environ.get("ASISTAN_EFOR", "high")  # low / medium / high / xhigh / max
YEDEK_MODEL = os.environ.get("ASISTAN_YEDEK", "1") != "0"
MAKS_ADIM = int(os.environ.get("ASISTAN_MAKS_ADIM", "80"))

BETALAR = ["thinking-display-updates-2026-08-18"]
if YEDEK_MODEL:
    BETALAR.append("server-side-fallback-2026-07-01")

KOMUT_ARACI = {
    "name": "run_command",
    "description": KOMUT_ACIKLAMASI,
    "input_schema": KOMUT_SEMASI,
    "strict": True,
    "eager_input_streaming": True,
}


class Asistan:
    def __init__(self, onayli: bool) -> None:
        self.istemci = anthropic.Anthropic()
        self.pc = Bilgisayar()
        self.sistem = sistem_istemi(self.pc)
        self.onayli = onayli  # True ise her ekran eyleminden önce onay sorulur
        self.mesajlar: list = []

    def sifirla(self) -> None:
        self.mesajlar = []

    def _istek(self):
        ekstra = {"cache_control": {"type": "ephemeral"}}
        if YEDEK_MODEL:
            # Model güvenlik nedeniyle reddederse sunucu uygun bir modelle otomatik devam eder.
            ekstra["fallbacks"] = "default"
        with self.istemci.beta.messages.stream(
            model=MODEL,
            max_tokens=64000,
            system=self.sistem,
            thinking={"type": "adaptive", "display": "updates"},
            output_config={"effort": EFOR},
            tools=[{"type": "computer_toolset_20260801"}, KOMUT_ARACI],
            messages=self.mesajlar,
            betas=BETALAR,
            extra_body=ekstra,
        ) as akis:
            return akis.get_final_message()

    def _araclari_calistir(self, yanit) -> list[dict]:
        sonuclar = []
        hata_oldu = False
        for blok in yanit.content:
            if blok.type != "tool_use":
                continue
            araci_seti = getattr(blok, "toolset_name", None)
            sonuc: dict = {"type": "tool_result", "tool_use_id": blok.id}
            if araci_seti:
                sonuc["toolset_name"] = araci_seti

            if hata_oldu:
                sonuc["content"] = "Not executed: an earlier action in this turn failed."
                sonuc["is_error"] = True
            elif araci_seti == "computer":
                girdi = dict(blok.input or {})
                eylemi_goster(blok.name, girdi)
                try:
                    if self.onayli and blok.name not in ("screenshot", "zoom", "cursor_position"):
                        if input("      Uygulansın mı? [E/h] ").strip().lower() in ("h", "hayır", "n", "no"):
                            raise RuntimeError("Kullanıcı bu eylemi reddetti.")
                    sonuc["content"] = self.pc.uygula(blok.name, girdi)
                except pyautogui.FailSafeException:
                    raise
                except Exception as hata:  # noqa: BLE001 - hatayı Claude'a geri bildiriyoruz
                    sonuc["content"] = f"Hata: {hata}"
                    sonuc["is_error"] = True
                    hata_oldu = True
            elif blok.name == "run_command":
                girdi = blok.input if isinstance(blok.input, dict) else {}
                komut, gerekce = girdi.get("command"), girdi.get("reason", "")
                if not isinstance(komut, str) or not komut.strip():
                    sonuc["content"] = "Hata: geçersiz araç girdisi (command eksik)."
                    sonuc["is_error"] = True
                else:
                    metin, hatali = komut_calistir(komut, str(gerekce))
                    sonuc["content"] = metin
                    if hatali:
                        sonuc["is_error"] = True
            else:
                sonuc["content"] = f"Bilinmeyen araç: {blok.name}"
                sonuc["is_error"] = True
            sonuclar.append(sonuc)
        return sonuclar

    def gorev(self, istek: str) -> None:
        son = self.mesajlar[-1] if self.mesajlar else None
        if son is not None and son["role"] == "user":
            # Önceki görev yarıda kaldıysa (ör. API hatası) yeni isteği aynı kullanıcı turuna ekle.
            son["content"].append({"type": "text", "text": istek})
        else:
            self.mesajlar.append({"role": "user", "content": [{"type": "text", "text": istek}]})
        for _ in range(MAKS_ADIM):
            try:
                yanit = self._istek()
            except anthropic.APIStatusError as hata:
                print(f"\n❌ API hatası ({hata.status_code}): {hata.message}")
                return
            except anthropic.APIConnectionError:
                print("\n❌ Bağlantı hatası: internet bağlantını kontrol et ve 'devam et' yaz.")
                return

            self.mesajlar.append({"role": "assistant", "content": yanit.content})

            for blok in yanit.content:
                if blok.type == "thinking" and getattr(blok, "thinking", ""):
                    print(f"  💭 {blok.thinking.strip()}")
                elif blok.type == "text" and blok.text.strip():
                    print(f"\n🤖 {blok.text.strip()}")

            if yanit.stop_reason == "refusal":
                print("\n⚠️  Asistan bu isteği güvenlik nedeniyle yerine getiremedi.")
                return
            if yanit.stop_reason == "max_tokens":
                print("\n⚠️  Yanıt çok uzadı ve kesildi.")
                return

            sonuclar = self._araclari_calistir(yanit)
            if not sonuclar:
                return  # görev bitti ya da asistan bir soru soruyor
            self.mesajlar.append({"role": "user", "content": sonuclar})

        print(f"\n⚠️  {MAKS_ADIM} adım sınırına ulaşıldı. Devam etmesi için 'devam et' yazabilirsin.")


YARDIM = """Komutlar:
  /yeni     yeni bir sohbet başlat (asistan öncekileri unutur)
  /onay     her fare/klavye eyleminden önce onay sorulmasını aç/kapat
  /cikis    çık
Acil durdurma: fareyi hızla ekranın bir KÖŞESİNE götür ya da Ctrl+C'ye bas."""


def main() -> None:
    ayristirici = argparse.ArgumentParser(description="Bilgisayarını kullanan kişisel asistan")
    ayristirici.add_argument("--onay", action="store_true", help="her eylemden önce onay sor")
    ayristirici.add_argument("gorev", nargs="*", help="hemen başlatılacak görev")
    args = ayristirici.parse_args()

    deepseek_var = bool(os.environ.get("DEEPSEEK_API_KEY"))
    claude_var = bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
    saglayici = os.environ.get("ASISTAN_SAGLAYICI", "").lower() or (
        "deepseek" if deepseek_var or not claude_var else "claude"
    )
    if saglayici == "deepseek":
        if not deepseek_var:
            print("DEEPSEEK_API_KEY bulunamadı. Anahtarını https://platform.deepseek.com/api_keys adresinden")
            print("alıp kurulum dosyasını yeniden çalıştır (ayrıntılar BENIOKU.txt dosyasında).")
            sys.exit(1)
        from deepseek_motor import DeepSeekAsistan

        asistan = DeepSeekAsistan(onayli=args.onay)
    else:
        if not claude_var:
            print("ANTHROPIC_API_KEY bulunamadı. Anahtarını https://console.anthropic.com adresinden alıp")
            print("ortam değişkeni olarak ayarla (ayrıntılar README.md dosyasında).")
            sys.exit(1)
        asistan = Asistan(onayli=args.onay)
    print(f"Yapay zeka: {'DeepSeek' if saglayici == 'deepseek' else 'Claude'}")
    print("╭──────────────────────────────────────────────╮")
    print("│  🤖 Kişisel Asistan hazır. Ne yapayım?        │")
    print("╰──────────────────────────────────────────────╯")
    print(YARDIM)

    ilk = " ".join(args.gorev).strip()
    while True:
        try:
            istek = ilk or input("\n👤 Sen: ").strip()
            ilk = ""
        except (EOFError, KeyboardInterrupt):
            print("\nGörüşürüz! 👋")
            return
        if not istek:
            continue
        if istek in ("/cikis", "/çıkış", "/exit", "/quit"):
            print("Görüşürüz! 👋")
            return
        if istek == "/yeni":
            asistan.sifirla()
            print("Yeni sohbet başladı.")
            continue
        if istek == "/onay":
            asistan.onayli = not asistan.onayli
            print(f"Eylem onayı {'AÇIK' if asistan.onayli else 'KAPALI'}.")
            continue
        if istek in ("/yardim", "/yardım", "/help"):
            print(YARDIM)
            continue
        try:
            asistan.gorev(istek)
        except KeyboardInterrupt:
            print("\n⏹️  Görev durduruldu.")
            asistan.sifirla()
            print("(Güvenlik için sohbet sıfırlandı.)")
        except pyautogui.FailSafeException:
            print("\n⏹️  Acil durdurma: fare köşeye götürüldü. Görev durduruldu.")
            asistan.sifirla()
        except Exception as hata:  # noqa: BLE001
            print(f"\n❌ Beklenmeyen hata: {hata}")
            asistan.sifirla()


if __name__ == "__main__":
    main()
