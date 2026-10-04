"""Otopilot ana döngüsü.

Görev seç → Claude'a talimat ver → testleri çalıştır → gerekirse hatayı Claude'a geri ver →
commit et → sıradakine geç. Görev listesi biterse hedefe göre yeni görevler planlatır.
Claude'un kullanım limiti dolunca sıfırlanma saatine kadar bekler ve kaldığı yerden devam eder.
"""

from __future__ import annotations

import datetime as dt
import re
import time
from pathlib import Path

from . import proje as pj
from .claude import ClaudeCLI, Sonuc
from .durum import AktifGorev, Durum, ProjeAyarlari

LIMIT_PAYI = dt.timedelta(minutes=3)  # sıfırlanmadan sonra güvenlik payı
BILINMEYEN_LIMIT_BEKLEME = dt.timedelta(minutes=30)
HATA_BEKLEME_DK = [2, 5, 10, 20, 30]

UYGULA = """\
Proje: {proje}
Genel hedef: {hedef}

GÖREV:
{gorev}

Önce ilgili kodu oku ve anla, sonra görevi uygula. Gerekiyorsa yeni test ekle, gereksizleşen kodu sil.
Değişiklikten sonra doğrulama komutu: {test}
(Bu komutu çalıştırma iznin olmayabilir; otopilot senden sonra çalıştırıp sonucu sana bildirecek.)
{taban_notu}"""

DEVAM = ("Önceki çalışma yarıda kaldı (kullanım limiti, bağlantı sorunu veya yeniden başlatma). "
         "Durumu kontrol et ve görevi kaldığın yerden tamamla: {gorev}")

DUZELT = """\
Doğrulama başarısız oldu. Komut: {komut}
Deneme {deneme}/{max_deneme}. Çıktı:

```
{cikti}
```

Hatanın kök nedenini bul ve düzelt. Testleri silme, atlama veya devre dışı bırakma; bir test gerçekten
yanlışsa gerekçesini özetinde açıkla. Bitirince ne değiştirdiğini kısaca yaz."""

PLANLA = """\
Bu projenin geliştirilmesini yöneten otopilotsun. Kodu incele ve hedefe ulaşmak için sıradaki görevleri planla.
Dosya değiştirme; yalnızca oku ve planla.

Hedef: {hedef}

Tamamlanan görevler (son {n_bitti}):
{bitti}

Başarısız olan görevler:
{basarisiz}

Kurallar:
- 3 ila 8 arası somut, birbirinden bağımsız ve tek oturumda bitirilebilecek görev yaz; sıralı olsun.
- Her görev tek cümle, Türkçe ve ne yapılacağı açık olsun (dosya/özellik adı ver).
- Başarısız görevleri aynen tekrarlama; gerekirse daha küçük parçalara böl.
- Projede otomatik doğrulama yoksa ilk görev olarak test altyapısı kurmayı öner.
- test_komutu: projeyi doğrulayan komut (test, yoksa derleme). Bilmiyorsan boş bırak.
- Hedef tamamen karşılandıysa hedef_tamamlandi=true ve gorevler boş olsun."""

PLAN_SEMASI = {
    "type": "object",
    "properties": {
        "gorevler": {"type": "array", "items": {"type": "string"}},
        "test_komutu": {"type": "string"},
        "hedef_tamamlandi": {"type": "boolean"},
        "aciklama": {"type": "string"},
    },
    "required": ["gorevler", "test_komutu", "hedef_tamamlandi", "aciklama"],
    "additionalProperties": False,
}


class Otopilot:
    def __init__(self, durum: Durum, ayar: ProjeAyarlari, tek_sefer: bool = False):
        self.d = durum
        self.a = ayar
        self.proje = durum.proje
        self.tek_sefer = tek_sefer
        self.claude = ClaudeCLI(self.proje, ayar.izin_modu, self._izinler(), ayar.model)

    def _izinler(self) -> list[str]:
        izinler = list(self.a.ek_izinler)
        if self.a.test_komutu:
            izinler.append(f"Bash({self.a.test_komutu}*)")
        return izinler

    # ------------------------------------------------------------------ #
    # Claude çağrısı: limit ve geçici hatalarda bekle, sonra devam et
    # ------------------------------------------------------------------ #

    def _bekle(self, ne_zamana: dt.datetime, sebep: str) -> None:
        self.d.yaz(bekle_until=ne_zamana.isoformat(), bekleme_sebebi=sebep)
        self.d.gunluk(f"⏸  {sebep}. {ne_zamana:%d.%m %H:%M} itibarıyla devam edilecek.")
        while True:
            kalan = (ne_zamana - dt.datetime.now().astimezone()).total_seconds()
            if kalan <= 0:
                break
            time.sleep(min(60, kalan))  # kısa aralıklar: uyku/hazırda bekletmeden sonra doğru uyanır
        self.d.yaz(bekle_until=None, bekleme_sebebi=None)
        self.d.gunluk("▶  Devam ediliyor.")

    def _onceki_beklemeyi_tamamla(self) -> None:
        """Bilgisayar beklerken kapandıysa kalan süreyi bekler."""
        v = self.d.oku().get("bekle_until")
        if v:
            zaman = dt.datetime.fromisoformat(v)
            if zaman > dt.datetime.now().astimezone():
                self._bekle(zaman, self.d.oku().get("bekleme_sebebi") or "Önceki bekleme sürüyor")

    def claude_cagir(self, istem: str, oturum: str | None = None, sema: dict | None = None,
                     devam_istemi: str | None = None) -> Sonuc:
        hata_sayisi = 0
        while True:
            s = self.claude.calistir(istem, oturum, sema)
            self.d.yaz(toplam_maliyet=round(float(self.d.oku().get("toplam_maliyet", 0)) + s.maliyet, 4))
            if s.basarili:
                return s
            if s.oturum and devam_istemi:  # yarıda kalan oturumu sürdür, işi baştan isteme
                oturum, istem = s.oturum, devam_istemi
            if s.limit:
                zaman = (s.sifirlanma + LIMIT_PAYI) if s.sifirlanma else dt.datetime.now().astimezone() + BILINMEYEN_LIMIT_BEKLEME
                if not s.sifirlanma:
                    self.d.gunluk(f"Limit mesajında sıfırlanma saati okunamadı: {s.metin[:200]!r}")
                self._bekle(zaman, "Claude kullanım limiti doldu")
                hata_sayisi = 0
                continue
            self.d.gunluk(f"⚠  Claude hatası: {s.hata[:300]}")
            if hata_sayisi >= len(HATA_BEKLEME_DK):
                return s  # kalıcı hata: çağıran taraf karar versin
            bekleme = HATA_BEKLEME_DK[hata_sayisi]
            hata_sayisi += 1
            self._bekle(dt.datetime.now().astimezone() + dt.timedelta(minutes=bekleme), "Geçici hata")

    # ------------------------------------------------------------------ #

    def hazirla(self) -> None:
        try:
            pj.git(self.proje, "rev-parse", "--is-inside-work-tree")
        except pj.GitHatasi:
            raise SystemExit(f"{self.proje} bir git deposu değil. Önce `git init` ve ilk commit'i yap.")
        if not pj.git(self.proje, "rev-parse", "--verify", "-q", "HEAD", kontrol=False):
            raise SystemExit("Depoda hiç commit yok. Önce mevcut dosyaları commit et.")

        aktif = self.d.aktif_gorev()
        if pj.kirli_mi(self.proje) and not aktif:
            raise SystemExit(
                "Projede commit edilmemiş değişiklikler var. Kendi değişikliklerini commit et veya sakla "
                "(git stash), sonra otopilotu yeniden başlat."
            )
        mevcut_dal = pj.git(self.proje, "rev-parse", "--abbrev-ref", "HEAD")
        if mevcut_dal != self.a.dal:
            if aktif:
                raise SystemExit(f"Yarım görev {self.a.dal} dalında ama şu an {mevcut_dal} dalındasın. "
                                 f"`git checkout {self.a.dal}` yapıp tekrar başlat.")
            var = pj.git(self.proje, "branch", "--list", self.a.dal)
            pj.git(self.proje, "checkout", "-q", *([self.a.dal] if var else ["-b", self.a.dal]))
            self.d.gunluk(f"Çalışma dalı: {self.a.dal} (temel: {mevcut_dal})")

        if not self.a.test_komutu:
            self.a.test_komutu = pj.test_komutunu_bul(self.proje)
            if self.a.test_komutu:
                self.d.gunluk(f"Test komutu otomatik bulundu: {self.a.test_komutu}")
                self.d.ayarlari_yaz(self.a)
                self.claude.ek_izinler = self._izinler()

    def planla(self) -> bool | None:
        """Hedefe göre yeni görevler üretir. True: görev eklendi, False: hedef tamam, None: planlama başarısız."""
        gorevler = self.d.gorevleri_oku()
        bitti = [m for d, m in gorevler if d == "x"][-30:]
        basarisiz = [m for d, m in gorevler if d == "!"][-15:]
        self.d.gunluk("🧭 Yeni görevler planlanıyor...")
        s = self.claude_cagir(PLANLA.format(
            hedef=self.a.hedef, n_bitti=len(bitti),
            bitti="\n".join(f"- {m}" for m in bitti) or "(yok)",
            basarisiz="\n".join(f"- {m}" for m in basarisiz) or "(yok)",
        ), sema=PLAN_SEMASI)
        if not s.basarili or s.yapisal is None:
            self.d.gunluk(f"Planlama başarısız: {(s.hata or s.metin)[:300]}")
            return None
        plan = s.yapisal
        yeni = [g for g in plan.get("gorevler", []) if isinstance(g, str) and g.strip()]
        if not self.a.test_komutu and (plan.get("test_komutu") or "").strip():
            self.a.test_komutu = plan["test_komutu"].strip()
            self.d.ayarlari_yaz(self.a)
            self.claude.ek_izinler = self._izinler()
            self.d.gunluk(f"Test komutu (plandan): {self.a.test_komutu}")
        if plan.get("aciklama"):
            self.d.gunluk(f"Plan: {plan['aciklama'][:400]}")
        if not yeni:
            return False if plan.get("hedef_tamamlandi") else None
        self.d.gorev_ekle(yeni, baslik=f"Plan · {dt.datetime.now():%Y-%m-%d %H:%M}")
        for g in yeni:
            self.d.gunluk(f"   + {g}")
        return True

    def gorevi_yurut(self, g: AktifGorev) -> None:
        self.d.gunluk(f"🔧 Görev: {g.satir}")
        devam = DEVAM.format(gorev=g.satir)

        if g.asama == "uygula":
            if g.oturum:  # önceki çalıştırmada yarıda kaldı
                s = self.claude_cagir(devam, g.oturum, devam_istemi=devam)
            else:
                taban = self.d.oku().get("taban_hatasi")
                istem = UYGULA.format(
                    proje=self.proje.name, hedef=self.a.hedef or "(belirtilmedi)", gorev=g.satir,
                    test=self.a.test_komutu or "(tanımlı değil)",
                    taban_notu=(f"\nNot: Görevden önce doğrulama zaten başarısızdı; bunu da düzelt:\n```\n{taban}\n```\n"
                                if taban else ""),
                )
                s = self.claude_cagir(istem, devam_istemi=devam)
            g.oturum, g.asama, g.son_test = s.oturum, "test", s.metin[-1500:]
            self.d.aktif_gorev_yaz(g)

        while True:
            t = pj.testleri_calistir(self.proje, self.a.test_komutu)
            if t.gecti:
                break
            g.deneme += 1
            if g.deneme > self.a.max_deneme:
                self.d.gunluk("❌ Doğrulama yine başarısız; deneme hakkı bitti.")
                self._basarisiz(g, t.cikti)
                return
            self.d.gunluk(f"❌ Doğrulama başarısız, Claude düzeltiyor (deneme {g.deneme}/{self.a.max_deneme}).")
            self.d.aktif_gorev_yaz(g)
            s = self.claude_cagir(
                DUZELT.format(komut=t.komut, deneme=g.deneme, max_deneme=self.a.max_deneme, cikti=t.cikti),
                g.oturum, devam_istemi=devam,
            )
            g.oturum, g.son_test = s.oturum, s.metin[-1500:]
            self.d.aktif_gorev_yaz(g)

        ozet = " ".join((g.son_test or "").split())
        if pj.hepsini_commit_et(self.proje, f"{g.satir}\n\n{ozet[:1500]}\n\nOtopilot (Claude Code) tarafından yapıldı."):
            self.d.gorevi_isaretle(g.satir, "x", ozet[:400])
            self.d.gunluk(f"✅ Bitti ve commit edildi: {g.satir}")
        elif pj.git(self.proje, "rev-parse", "HEAD") != g.baslangic:
            self.d.gorevi_isaretle(g.satir, "x", ozet[:400])
            self.d.gunluk(f"✅ Bitti: {g.satir}")
        else:
            self.d.gorevi_isaretle(g.satir, "x", "Değişiklik gerekmedi. " + ozet[:300])
            self.d.gunluk(f"✅ Değişiklik gerekmedi: {g.satir}")
        self.d.yaz(taban_hatasi=None)
        self.d.aktif_gorev_yaz(None)

    def _basarisiz(self, g: AktifGorev, cikti: str) -> None:
        ad = re.sub(r"[^A-Za-z0-9]+", "-", g.satir.translate(str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")))
        ad = ad[:40].strip("-") or "gorev"
        yama = self.d.dizin / "basarisiz" / f"{dt.datetime.now():%Y%m%d-%H%M}-{ad}.patch"
        pj.geri_al(self.proje, g.baslangic, yama)
        son = cikti.strip().splitlines()[-1][:200] if cikti.strip() else ""
        self.d.gorevi_isaretle(g.satir, "!", f"{self.a.max_deneme} denemede testler geçmedi, geri alındı. "
                                             f"Yama: {yama.name}. Son hata: {son}")
        self.d.gunluk(f"🛑 Başarısız, değişiklikler geri alındı (yama: {yama}).")
        self.d.aktif_gorev_yaz(None)

    # ------------------------------------------------------------------ #

    def calistir(self) -> None:
        if not self.d.kilitle():
            raise SystemExit("Bu proje için otopilot zaten çalışıyor.")
        try:
            self.hazirla()
            self._onceki_beklemeyi_tamamla()
            self.d.gunluk(f"🚀 Otopilot başladı: {self.proje} · dal {self.a.dal} · test: {self.a.test_komutu or 'yok'}")

            if not self.d.aktif_gorev():
                taban = pj.testleri_calistir(self.proje, self.a.test_komutu)
                self.d.yaz(taban_hatasi=None if taban.gecti else taban.cikti[-3000:])
                if not taban.gecti:
                    self.d.gunluk("Başlangıçta doğrulama zaten başarısız; ilk görevde bu da düzeltilecek.")

            while True:
                g = self.d.aktif_gorev()
                if not g:
                    sira = self.d.siradaki_gorev()
                    if not sira:
                        if not self.a.hedef:
                            self.d.gunluk("Bekleyen görev yok ve hedef tanımlı değil. "
                                          "`otopilot gorev` ile görev ekle veya --hedef ver.")
                            return
                        sonuc = self.planla()
                        if sonuc is False:
                            self.d.gunluk("🎯 Planlayıcı hedefin tamamlandığını bildirdi.")
                            return
                        if sonuc is None:
                            self._bekle(dt.datetime.now().astimezone() + dt.timedelta(minutes=30),
                                        "Planlama başarısız")
                        continue
                    g = AktifGorev(satir=sira, baslangic=pj.git(self.proje, "rev-parse", "HEAD"))
                    self.d.aktif_gorev_yaz(g)
                self.gorevi_yurut(g)
                if self.tek_sefer:
                    return
        except KeyboardInterrupt:
            self.d.gunluk("Durduruldu. Yeniden başlatınca kaldığı yerden devam eder.")
        finally:
            self.d.kilidi_birak()
