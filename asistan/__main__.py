"""Komut satırı.

    python -m asistan                         # sohbet modu
    python -m asistan "Spotify'ı aç ve odaklanma listemi çal"
    python -m asistan ogren ~/projeler        # seni tanısın: profilini çıkarır
    python -m asistan otonom ~/projeler/uygulama --surekli
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .ajan import Ajan
from .ayarlar import Ayarlar

OGREN_ISTEMI = """\
Amacın beni tanımak ve "profil" hafızamı yazmak; böylece bilgisayarımı ve kodlamayı tıpkı benim gibi yapabileceksin.

İncelenecek dizinler: {dizinler}

1. Bu dizinlerdeki git depolarını bul. Benim commit'lerimi (`git config user.email` / `user.name` ile eşleşen
   yazar) incele: hangi diller ve çatılar, dosya/klasör düzeni, isimlendirme, yorum yoğunluğu, test alışkanlıkları,
   lint/format ayarları (.editorconfig, prettier, eslint, ruff, black vb.), commit mesajı dili ve biçimi,
   dal isimlendirme, README dili. Birkaç temsilî dosyayı gerçekten oku.
2. Sistemde yüklü ve sık kullandığım araçlara bak (editör, tarayıcı, paket yöneticileri, terminal kabuğu).
3. {soru_satiri}
4. Bulduklarını `hafiza` aracıyla `profil` dosyasına `yaz` işlemiyle, başlıklı ve maddeli bir Markdown olarak kaydet:
   Kimlik ve dil · Kodlama stili (dil bazında) · Proje yapısı · Test ve kalite · Git alışkanlıkları ·
   Araçlar ve uygulamalar · Çalışma tercihleri. Gizli bilgi (şifre, token) yazma.
5. Sonunda profilin kısa bir özetini göster.
"""


def _ayarlar(args) -> Ayarlar:
    a = Ayarlar()
    if args.model:
        a.model = args.model
    if args.mod:
        a.mod = args.mod
    if args.ekransiz:
        a.ekran = False
    return a


def sohbet(ajan: Ajan) -> None:
    print("Asistan hazır. Görevini yaz (çıkmak için: çık). Çalışırken Ctrl+C görevi durdurur.")
    print("Acil durdurma: fareyi ekranın bir köşesine götür.\n")
    while True:
        try:
            metin = input("\nsen › ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if metin.lower() in ("çık", "cik", "exit", "quit"):
            return
        if not metin:
            continue
        try:
            ajan.gorev(metin)
        except KeyboardInterrupt:
            print("\n[durduruldu]")


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    ortak = argparse.ArgumentParser(add_help=False)
    ortak.add_argument("--model", help="DeepSeek model adı (ör. deepseek-chat, deepseek-reasoner)")
    ortak.add_argument("--mod", choices=["onayli", "tam", "otonom"], help="onay modu")
    ortak.add_argument("--ekransiz", action="store_true", help="ekran/fare/klavye kontrolünü kapat")

    if argv and argv[0] == "ogren":
        p = argparse.ArgumentParser(prog="asistan ogren", parents=[ortak])
        p.add_argument("dizinler", nargs="*", default=[str(Path.home())])
        p.add_argument("--sorusuz", action="store_true", help="bana soru sormadan çıkar")
        args = p.parse_args(argv[1:])
        a = _ayarlar(args)
        a.ekran = False  # profil çıkarmak için terminal ve dosyalar yeterli
        ajan = Ajan(a)
        soru = ("Bana soru sorma; bulgularınla yetin." if args.sorusuz else
                "Kodda göremediğin önemli tercihlerimi `kullaniciya_sor` ile en fazla 5 kısa soruda sor.")
        ajan.gorev(OGREN_ISTEMI.format(dizinler=", ".join(args.dizinler), soru_satiri=soru))
        return

    if argv and argv[0] == "otonom":
        from . import otonom

        p = argparse.ArgumentParser(prog="asistan otonom", parents=[ortak])
        p.add_argument("proje", help="git deposu dizini")
        p.add_argument("--gorevler", type=Path, help="görev dosyası (varsayılan ~/.asistan/gorevler/<proje>.md)")
        p.add_argument("--dal-oneki", default="asistan/")
        p.add_argument("--push", action="store_true", help="biten dalları origin'e gönder")
        p.add_argument("--surekli", action="store_true", help="yeni görev bekleyerek çalışmaya devam et")
        p.add_argument("--bekleme-dk", type=int, default=15)
        p.add_argument("--ekranli", action="store_true", help="otonom modda ekran kontrolüne izin ver")
        args = p.parse_args(argv[1:])
        a = _ayarlar(args)
        a.ekran = args.ekranli
        otonom.calistir(a, Path(args.proje), args.gorevler, args.dal_oneki, args.push, args.surekli, args.bekleme_dk)
        return

    p = argparse.ArgumentParser(prog="asistan", parents=[ortak], description="Bilgisayarını senin gibi kullanan asistan")
    p.add_argument("gorev", nargs="*", help="tek seferlik görev (boşsa sohbet modu)")
    args = p.parse_args(argv)
    ajan = Ajan(_ayarlar(args))
    if args.gorev:
        ajan.gorev(" ".join(args.gorev))
    else:
        sohbet(ajan)


if __name__ == "__main__":
    main()
