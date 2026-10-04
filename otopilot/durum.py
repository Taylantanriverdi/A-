"""Kalıcı durum: ayarlar, görev listesi, kaldığı yer, günlük ve tek örnek kilidi.

Her proje için ~/.otopilot/<proje-adı>/ altında tutulur (proje deposunun dışında), böylece
bilgisayar kapanıp açılsa da otopilot kaldığı yerden devam eder.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import platform
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

KOK = Path(os.environ.get("OTOPILOT_DIZIN", Path.home() / ".otopilot"))

GOREV = re.compile(r"^(\s*)- \[( |x|X|!)\] (.+)$")


@dataclass
class ProjeAyarlari:
    proje: str
    hedef: str = ""
    motor: str = "deepseek"  # deepseek (DeepSeek API) | claude (Claude Code CLI)
    test_komutu: str | None = None
    dal: str = "otopilot/gelistirme"
    izin_modu: str = "acceptEdits"
    ek_izinler: list[str] = field(default_factory=list)
    model: str | None = None
    max_deneme: int = 3


@dataclass
class AktifGorev:
    satir: str
    baslangic: str
    oturum: str | None = None
    asama: str = "uygula"  # uygula | duzelt
    deneme: int = 0
    son_test: str = ""


class Durum:
    def __init__(self, proje: Path):
        self.proje = proje.resolve()
        self.dizin = KOK / re.sub(r"[^A-Za-z0-9._-]+", "_", self.proje.name)
        self.dizin.mkdir(parents=True, exist_ok=True)
        self.ayar_dosyasi = self.dizin / "ayarlar.json"
        self.gorev_dosyasi = self.dizin / "gorevler.md"
        self.durum_dosyasi = self.dizin / "durum.json"
        self.gunluk_dosyasi = self.dizin / "gunluk.log"
        self.kilit_dosyasi = self.dizin / "kilit"

    # --- ayarlar ---------------------------------------------------------------

    def ayarlari_oku(self) -> ProjeAyarlari | None:
        if not self.ayar_dosyasi.exists():
            return None
        veri = json.loads(self.ayar_dosyasi.read_text(encoding="utf-8"))
        bilinen = ProjeAyarlari.__dataclass_fields__
        return ProjeAyarlari(**{k: v for k, v in veri.items() if k in bilinen})

    def ayarlari_yaz(self, a: ProjeAyarlari) -> None:
        self.ayar_dosyasi.write_text(json.dumps(asdict(a), ensure_ascii=False, indent=2), encoding="utf-8")

    # --- kaldığı yer -------------------------------------------------------------

    def oku(self) -> dict:
        if not self.durum_dosyasi.exists():
            return {}
        try:
            return json.loads(self.durum_dosyasi.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}

    def yaz(self, **degerler) -> None:
        d = self.oku()
        d.update(degerler)
        gecici = self.durum_dosyasi.with_suffix(".tmp")
        gecici.write_text(json.dumps(d, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        gecici.replace(self.durum_dosyasi)

    def aktif_gorev(self) -> AktifGorev | None:
        v = self.oku().get("aktif")
        return AktifGorev(**v) if v else None

    def aktif_gorev_yaz(self, g: AktifGorev | None) -> None:
        self.yaz(aktif=asdict(g) if g else None)

    # --- görev listesi -----------------------------------------------------------

    def gorevleri_oku(self) -> list[tuple[str, str]]:
        """[(durum, metin)] — durum: ' ' bekliyor, 'x' bitti, '!' başarısız."""
        if not self.gorev_dosyasi.exists():
            return []
        return [(m.group(2).lower(), m.group(3).strip())
                for satir in self.gorev_dosyasi.read_text(encoding="utf-8").splitlines()
                if (m := GOREV.match(satir))]

    def siradaki_gorev(self) -> str | None:
        return next((metin for d, metin in self.gorevleri_oku() if d == " "), None)

    def gorev_ekle(self, gorevler: list[str], baslik: str | None = None) -> None:
        if not self.gorev_dosyasi.exists():
            self.gorev_dosyasi.write_text(f"# {self.proje.name} — otopilot görevleri\n", encoding="utf-8")
        with self.gorev_dosyasi.open("a", encoding="utf-8") as f:
            if baslik:
                f.write(f"\n## {baslik}\n")
            for g in gorevler:
                g = " ".join(g.split())
                if g:
                    f.write(f"- [ ] {g}\n")

    def gorevi_isaretle(self, metin: str, isaret: str, not_: str) -> None:
        satirlar = self.gorev_dosyasi.read_text(encoding="utf-8").splitlines()
        for i, satir in enumerate(satirlar):
            m = GOREV.match(satir)
            if m and m.group(2) == " " and m.group(3).strip() == metin:
                satirlar[i] = f"{m.group(1)}- [{isaret}] {m.group(3)}"
                ozet = " ".join(not_.split())[:500] or "-"
                satirlar.insert(i + 1, f"{m.group(1)}  - _{dt.datetime.now():%Y-%m-%d %H:%M}_ {ozet}")
                break
        self.gorev_dosyasi.write_text("\n".join(satirlar) + "\n", encoding="utf-8")

    # --- günlük ----------------------------------------------------------------

    def gunluk(self, mesaj: str) -> None:
        satir = f"[{dt.datetime.now():%Y-%m-%d %H:%M:%S}] {mesaj}"
        print(satir, flush=True)
        with self.gunluk_dosyasi.open("a", encoding="utf-8") as f:
            f.write(satir + "\n")

    # --- tek örnek kilidi ----------------------------------------------------------

    def kilitle(self) -> bool:
        if self.kilit_dosyasi.exists():
            try:
                pid = int(self.kilit_dosyasi.read_text().strip())
            except ValueError:
                pid = 0
            if pid and pid != os.getpid() and _surec_yasiyor(pid):
                return False
        self.kilit_dosyasi.write_text(str(os.getpid()))
        return True

    def kilidi_birak(self) -> None:
        try:
            if self.kilit_dosyasi.read_text().strip() == str(os.getpid()):
                self.kilit_dosyasi.unlink()
        except OSError:
            pass


def _surec_yasiyor(pid: int) -> bool:
    if platform.system() == "Windows":
        # Windows'ta os.kill(pid, 0) süreci sonlandırır; bunun yerine OpenProcess kullanılır
        import ctypes

        k32 = ctypes.windll.kernel32
        tutamac = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not tutamac:
            return False
        kod = ctypes.c_ulong()
        k32.GetExitCodeProcess(tutamac, ctypes.byref(kod))
        k32.CloseHandle(tutamac)
        return kod.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:  # süreç var ama başka kullanıcıya ait
        return True
    except OSError:
        return False
