"""Otopilot komut satırı.

    python -m otopilot baslat C:\\projeler\\uygulama --hedef "Uygulamaya kullanıcı girişi ve raporlama ekle"
    python -m otopilot gorev  C:\\projeler\\uygulama "Ana sayfaya arama kutusu ekle" "README'yi güncelle"
    python -m otopilot durum  C:\\projeler\\uygulama
    python -m otopilot otomatik-kur C:\\projeler\\uygulama     # bilgisayar açılınca kendiliğinden başlasın
    python -m otopilot otomatik-kaldir C:\\projeler\\uygulama
    python -m otopilot arayuz                                # canlı izleme paneli (tarayıcıda)
"""

from __future__ import annotations

import argparse
import os
import platform
import sys
from pathlib import Path

from .durum import Durum, ProjeAyarlari

REPO = Path(__file__).resolve().parent.parent


def _baslangic_dosyasi(durum: Durum) -> Path:
    baslangic = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
    return baslangic / f"otopilot-{durum.dizin.name}.bat"


def baslat(args) -> None:
    from .dongu import Otopilot

    d = Durum(Path(args.proje).expanduser())
    a = d.ayarlari_oku() or ProjeAyarlari(proje=str(d.proje))
    if args.hedef:
        a.hedef = args.hedef
    if args.test:
        a.test_komutu = args.test
    if args.dal:
        a.dal = args.dal
    if args.motor:
        a.motor = args.motor
    if args.model:
        a.model = args.model
    if args.max_deneme:
        a.max_deneme = args.max_deneme
    if args.izin:
        a.ek_izinler = sorted(set(a.ek_izinler) | set(args.izin))
    if args.tam_yetki:
        a.izin_modu = "bypassPermissions"
    d.ayarlari_yaz(a)
    if args.gorev:
        d.gorev_ekle(args.gorev)
    if not a.hedef and not d.siradaki_gorev() and not d.aktif_gorev():
        if not sys.stdin.isatty():
            raise SystemExit("Ne yapılacağını söyle: --hedef \"...\" ver veya `gorev` komutuyla görev ekle.")
        print("\nBu proje için henüz hedef yok. Projenin nasıl geliştirilmesini istediğini yaz.")
        print("Örnek: Hekim portalına randevu sistemi, bildirimler ve raporlama ekle; hataları düzelt.\n")
        while not a.hedef:
            a.hedef = input("Hedef: ").strip()
        d.ayarlari_yaz(a)
    try:
        otopilot = Otopilot(d, a, tek_sefer=args.tek_sefer)
    except SystemExit as e:  # ör. API anahtarı yok, Claude Code yok — arayüzde de görünsün
        d.olay("hata", f"Otopilot başlatılamadı: {e.code}", asama="hata")
        raise
    otopilot.calistir()


def gorev(args) -> None:
    d = Durum(Path(args.proje).expanduser())
    d.gorev_ekle(args.metinler)
    print(f"{len(args.metinler)} görev eklendi → {d.gorev_dosyasi}")


def durum(args) -> None:
    d = Durum(Path(args.proje).expanduser())
    a = d.ayarlari_oku()
    v = d.oku()
    gorevler = d.gorevleri_oku()
    say = {k: sum(1 for x, _ in gorevler if x == k) for k in (" ", "x", "!")}
    print(f"Proje      : {d.proje}")
    if a:
        print(f"Hedef      : {a.hedef or '-'}")
        print(f"Motor      : {a.motor}{' / ' + a.model if a.model else ''}")
        print(f"Dal / test : {a.dal} / {a.test_komutu or 'yok'}")
    print(f"Görevler   : {say['x']} bitti, {say[' ']} bekliyor, {say['!']} başarısız")
    if v.get("aktif"):
        print(f"Şu an      : {v['aktif']['satir']} (aşama: {v['aktif']['asama']}, deneme: {v['aktif']['deneme']})")
    if v.get("bekle_until"):
        print(f"Bekliyor   : {v.get('bekleme_sebebi')} → {v['bekle_until']}")
    print(f"Maliyet    : ~${v.get('toplam_maliyet', 0)} (yalnızca Claude motorunda hesaplanır)")
    print(f"Dosyalar   : {d.dizin}")


def otomatik_kur(args) -> None:
    d = Durum(Path(args.proje).expanduser())
    if platform.system() == "Windows":
        dosya = _baslangic_dosyasi(d)
        bat = REPO / "otopilot.bat"
        dosya.write_text(
            f'@echo off\r\nstart "Otopilot {d.proje.name}" /min "{bat}" baslat "{d.proje}"\r\n', encoding="ascii",
            errors="replace",
        )
        print(f"Tamam. Windows her açıldığında otopilot başlayacak.\nBaşlangıç dosyası: {dosya}")
    else:
        print("Linux/macOS için crontab'a şu satırı ekle (crontab -e):\n")
        print(f"@reboot cd {REPO} && {sys.executable} -m otopilot baslat '{d.proje}' >> '{d.gunluk_dosyasi}' 2>&1")


def otomatik_kaldir(args) -> None:
    d = Durum(Path(args.proje).expanduser())
    if platform.system() == "Windows":
        dosya = _baslangic_dosyasi(d)
        if dosya.exists():
            dosya.unlink()
            print("Otomatik başlatma kaldırıldı.")
        else:
            print("Otomatik başlatma zaten kurulu değil.")
    else:
        print("crontab -e ile @reboot satırını sil.")


def arayuz(args) -> None:
    from . import arayuz as ui

    ui.calistir(args.port, tarayici=not args.tarayicisiz)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="otopilot", description="DeepSeek API veya Claude Code ile projeni otomatik geliştirir.")
    alt = p.add_subparsers(dest="komut", required=True)

    b = alt.add_parser("baslat", help="otopilotu çalıştır (kaldığı yerden devam eder)")
    b.add_argument("proje")
    b.add_argument("--hedef", help="projenin ulaşmasını istediğin genel hedef; görevler buna göre planlanır")
    b.add_argument("--gorev", nargs="*", help="başlamadan önce eklenecek görevler")
    b.add_argument("--test", help="doğrulama komutu (ör. 'npm test'); verilmezse otomatik bulunur")
    b.add_argument("--dal", help="çalışma dalı (varsayılan otopilot/gelistirme)")
    b.add_argument("--motor", choices=["deepseek", "claude"],
                   help="kodlayıcı: deepseek (DeepSeek API, varsayılan) veya claude (Claude Code)")
    b.add_argument("--model", help="model adı (DeepSeek: deepseek-chat / deepseek-reasoner; Claude: opus, sonnet)")
    b.add_argument("--max-deneme", type=int, help="test başarısız olursa düzeltme deneme sayısı (varsayılan 3)")
    b.add_argument("--izin", nargs="*", help="Claude'a ek izin, ör. \"Bash(npm *)\" \"Bash(python *)\"")
    b.add_argument("--tam-yetki", action="store_true",
                   help="Claude tüm komutları sormadan çalıştırabilir (yalnızca güvendiğin projede)")
    b.add_argument("--tek-sefer", action="store_true", help="tek görev yapıp çık")
    b.set_defaults(f=baslat)

    g = alt.add_parser("gorev", help="görev listesine görev ekle")
    g.add_argument("proje")
    g.add_argument("metinler", nargs="+")
    g.set_defaults(f=gorev)

    dz = alt.add_parser("durum", help="ilerlemeyi göster")
    dz.add_argument("proje")
    dz.set_defaults(f=durum)

    ok = alt.add_parser("otomatik-kur", help="bilgisayar açılınca otomatik başlat")
    ok.add_argument("proje")
    ok.set_defaults(f=otomatik_kur)

    ka = alt.add_parser("otomatik-kaldir", help="otomatik başlatmayı kaldır")
    ka.add_argument("proje")
    ka.set_defaults(f=otomatik_kaldir)

    ui = alt.add_parser("arayuz", help="tarayıcıda canlı izleme ve kontrol paneli")
    ui.add_argument("--port", type=int, default=8765)
    ui.add_argument("--tarayicisiz", action="store_true", help="tarayıcıyı otomatik açma")
    ui.set_defaults(f=arayuz)

    args = p.parse_args(argv)
    args.f(args)


if __name__ == "__main__":
    main()
