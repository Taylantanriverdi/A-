"""Otonom yazılım modu: görev listesindeki işleri senin adına, sırayla geliştirir.

Görev dosyası (varsayılan: ~/.asistan/gorevler/<proje-adı>.md — depo dışında tutulur ki
git geçmişine karışmasın) Markdown onay kutuları kullanır:

    - [ ] Kullanıcı girişine "beni hatırla" seçeneği ekle
    - [ ] /api/rapor uç noktası için testleri yaz

Her görev için ayrı bir git dalı açılır, asistan işi yapar, test eder ve commit atar.
Tamamlanan görev [x] olarak işaretlenir ve altına kısa bir özet eklenir.
"""

from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

from .ajan import Ajan, zaman_damgasi
from .ayarlar import Ayarlar

GOREV_SATIRI = re.compile(r"^(\s*)- \[ \] (.+)$")

OTONOM_ISTEMI = """\
Otonom yazılım modundasın; kullanıcı başında değil. Proje dizini: {proje}
Şu an `{dal}` dalındasın (temel dal: `{temel}`). Görev:

{gorev}

Adımlar:
1. Önce projeyi tanı: README, yapı, mevcut testler, stil ayarları, son commit'ler.
   Notlarında bu projeyle ilgili bilgi varsa kullan.
2. Görevi kullanıcının stiliyle, mevcut kodun düzenine uyarak uygula. Yarım iş veya yer tutucu bırakma.
3. Testleri/derlemeyi/lint'i çalıştır ve geçtiğinden emin ol. Gerekiyorsa test ekle.
4. Değişiklikleri bu dalda, kullanıcının commit mesajı stiliyle commit et. Push yapma.
5. Görev belirsizse veya tamamlanamıyorsa: yapabildiğin kadarını commit et, nedenini notlara yaz.
6. Sonunda tek paragraflık bir özet yaz: ne yapıldı, testlerin durumu, açık kalan konular.
"""


def _git(proje: Path, *args: str) -> str:
    r = subprocess.run(["git", *args], cwd=proje, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout.strip()


def _slug(metin: str) -> str:
    tablo = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    s = re.sub(r"[^a-z0-9]+", "-", metin.translate(tablo).lower()).strip("-")
    return s[:40] or "gorev"


def _bekleyen_gorevler(dosya: Path) -> list[tuple[int, str]]:
    if not dosya.exists():
        return []
    return [
        (i, m.group(2).strip())
        for i, satir in enumerate(dosya.read_text(encoding="utf-8").splitlines())
        if (m := GOREV_SATIRI.match(satir))
    ]


def _isaretle(dosya: Path, satir_no: int, ozet: str, dal: str) -> None:
    satirlar = dosya.read_text(encoding="utf-8").splitlines()
    girinti = GOREV_SATIRI.match(satirlar[satir_no]).group(1)
    satirlar[satir_no] = satirlar[satir_no].replace("- [ ]", "- [x]", 1)
    ozet_tek = " ".join(ozet.split())[:600] or "(özet yok)"
    satirlar.insert(satir_no + 1, f"{girinti}  - _{zaman_damgasi()} · dal `{dal}`_: {ozet_tek}")
    dosya.write_text("\n".join(satirlar) + "\n", encoding="utf-8")


def calistir(
    ayarlar: Ayarlar,
    proje: Path,
    gorev_dosyasi: Path | None = None,
    dal_oneki: str = "asistan/",
    push: bool = False,
    surekli: bool = False,
    bekleme_dk: int = 15,
) -> None:
    proje = proje.expanduser().resolve()
    gorev_dosyasi = (gorev_dosyasi or ayarlar.veri_dizini / "gorevler" / f"{proje.name}.md").expanduser().resolve()
    if not gorev_dosyasi.exists():
        gorev_dosyasi.parent.mkdir(parents=True, exist_ok=True)
        gorev_dosyasi.write_text(f"# {proje.name} görevleri\n\n- [ ] (buraya görev yaz)\n", encoding="utf-8")
        print(f"Görev dosyası oluşturuldu: {gorev_dosyasi} — görevleri yazıp tekrar çalıştır.")
        return
    ayarlar.gozetimsiz = True
    ayarlar.mod = "otonom"
    if proje not in ayarlar.izinli_dizinler and not any(proje.is_relative_to(k) for k in ayarlar.izinli_dizinler):
        ayarlar.izinli_dizinler.append(proje)

    temel = _git(proje, "rev-parse", "--abbrev-ref", "HEAD")
    print(f"Otonom mod: {proje} (temel dal: {temel}) · görevler: {gorev_dosyasi}")

    while True:
        gorevler = _bekleyen_gorevler(gorev_dosyasi)
        if not gorevler:
            if not surekli:
                print("Bekleyen görev yok.")
                return
            print(f"Bekleyen görev yok; {bekleme_dk} dk sonra tekrar bakılacak. (Ctrl+C ile çık)")
            time.sleep(bekleme_dk * 60)
            continue

        satir_no, gorev = gorevler[0]
        if gorev == "(buraya görev yaz)":
            print(f"Önce {gorev_dosyasi} dosyasına görev yaz.")
            return
        if _git(proje, "status", "--porcelain", "--untracked-files=no"):
            print("Çalışma ağacında commit edilmemiş değişiklik var; güvenlik için durduruluyor.")
            return

        dal = f"{dal_oneki}{_slug(gorev)}"
        mevcut = _git(proje, "branch", "--list", dal)
        _git(proje, "checkout", *(["-b", dal, temel] if not mevcut else [dal]))
        print(f"\n=== Görev: {gorev}\n=== Dal: {dal}")

        ajan = Ajan(ayarlar)  # her görev temiz bağlamla başlar
        ajan.terminal.cwd = str(proje)
        try:
            ozet = ajan.gorev(OTONOM_ISTEMI.format(proje=proje, dal=dal, temel=temel, gorev=gorev))
        finally:
            ajan.terminal.yeniden_baslat()

        if _git(proje, "status", "--porcelain", "--untracked-files=no"):
            _git(proje, "add", "-A")
            _git(proje, "commit", "-m", f"WIP: {gorev}\n\nAsistan görevi tamamlamadan durdu.")

        yeni_commit = _git(proje, "rev-list", "--count", f"{temel}..{dal}")
        if push and yeni_commit != "0":
            try:
                _git(proje, "push", "-u", "origin", dal)
            except RuntimeError as e:
                print(f"[uyarı] push başarısız: {e}")

        _git(proje, "checkout", temel)
        _isaretle(gorev_dosyasi, satir_no, ozet, dal)
        print(f"=== Bitti ({yeni_commit} commit): {gorev}")
