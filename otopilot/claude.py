"""Claude Code CLI'yi (`claude -p`) gözetimsiz çalıştırır ve sonucu yorumlar."""

from __future__ import annotations

import datetime as dt
import json
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .limit import limit_mesaji_mi, sifirlanma_zamani

SISTEM_EKI = """\
Otopilot tarafından gözetimsiz çalıştırılıyorsun; kullanıcı başında değil, soru soramazsın.
- Verilen görevi eksiksiz uygula; yer tutucu veya yarım iş bırakma. Belirsizlikte makul varsayım yap ve özetinde belirt.
- Mevcut kodun stiline, mimarisine ve isimlendirmesine uy. Görevle ilgisi olmayan dosyalara dokunma.
- Gereksizleşen kodu, dosyayı ve bağımlılığı kaldır; ölü kod bırakma.
- Git commit, push, branch, reset veya rebase YAPMA; testleri ve commit'i otopilot yönetir.
- Bitirdiğinde ne değiştirdiğini kısa bir özetle bildir.
"""


@dataclass
class Sonuc:
    basarili: bool
    metin: str = ""
    oturum: str | None = None
    yapisal: dict | None = None
    limit: bool = False
    sifirlanma: dt.datetime | None = None
    hata: str = ""
    maliyet: float = 0.0
    ham: dict = field(default_factory=dict)


class ClaudeCLI:
    def __init__(self, proje: Path, izin_modu: str = "acceptEdits", ek_izinler: list[str] | None = None,
                 model: str | None = None, zaman_asimi_dk: int = 90):
        yol = shutil.which("claude")
        if not yol:
            raise SystemExit(
                "Claude Code bulunamadı. Kur: https://claude.com/claude-code — sonra bir kez `claude` "
                "çalıştırıp giriş yap."
            )
        self.yol = yol
        self.proje = proje
        self.izin_modu = izin_modu
        self.ek_izinler = ek_izinler or []
        self.model = model
        self.zaman_asimi = zaman_asimi_dk * 60

    def _komut(self, oturum: str | None, sema: dict | None) -> list[str]:
        # Not: kurallar --append-system-prompt yerine istemle stdin'den gider; Windows'ta claude.cmd
        # üzerinden geçen çok satırlı argümanlar cmd.exe tarafından bozulur.
        k = [self.yol, "-p", "--output-format", "json", "--permission-mode", self.izin_modu]
        if self.izin_modu != "bypassPermissions":
            # İzin gerektiren her şey sormadan reddedilir; süreç asla takılı kalmaz
            k += ["--permission-prompts", "none"]
            izinler = ["Read", "Edit", "Write", "Glob", "Grep", "TodoWrite",
                       "Bash(git status*)", "Bash(git diff*)", "Bash(git log*)", "Bash(git show*)",
                       "Bash(ls*)", "Bash(dir*)", *self.ek_izinler]
            k += ["--allowedTools", " ".join(izinler)]
        if self.model:
            k += ["--model", self.model]
        if oturum:
            k += ["--resume", oturum]
        if sema:
            k += ["--json-schema", json.dumps(sema, ensure_ascii=True, separators=(",", ":"))]
        return k

    def calistir(self, istem: str, oturum: str | None = None, sema: dict | None = None) -> Sonuc:
        if not oturum:
            istem = f"<otopilot_kurallari>\n{SISTEM_EKI}</otopilot_kurallari>\n\n{istem}"
        try:
            r = subprocess.run(
                self._komut(oturum, sema), input=istem, cwd=self.proje, capture_output=True,
                text=True, encoding="utf-8", errors="replace", timeout=self.zaman_asimi,
            )
        except subprocess.TimeoutExpired:
            return Sonuc(False, oturum=oturum, hata=f"Claude {self.zaman_asimi // 60} dk içinde bitmedi.")

        cikti = (r.stdout or "").strip()
        veri = None
        for satir in reversed(cikti.splitlines()):  # son JSON satırı sonuçtur
            try:
                veri = json.loads(satir)
                break
            except json.JSONDecodeError:
                continue

        if not isinstance(veri, dict):
            tum = f"{cikti}\n{r.stderr or ''}".strip()
            if limit_mesaji_mi(tum):
                return Sonuc(False, metin=tum, oturum=oturum, limit=True, sifirlanma=sifirlanma_zamani(tum),
                             hata="Kullanım limiti doldu.")
            return Sonuc(False, metin=tum, oturum=oturum, hata=f"Claude beklenmeyen çıktı verdi (kod {r.returncode}): {tum[-800:]}")

        metin = str(veri.get("result") or "")
        sonuc = Sonuc(
            basarili=not veri.get("is_error") and veri.get("subtype") == "success",
            metin=metin,
            oturum=veri.get("session_id") or oturum,
            yapisal=veri.get("structured_output") if isinstance(veri.get("structured_output"), dict) else None,
            maliyet=float(veri.get("total_cost_usd") or 0),
            ham=veri,
        )
        if not sonuc.basarili:
            durum = veri.get("api_error_status")
            if limit_mesaji_mi(metin, durum if isinstance(durum, int) else None):
                sonuc.limit = True
                sonuc.sifirlanma = sifirlanma_zamani(metin)
                sonuc.hata = "Kullanım limiti doldu."
            else:
                sonuc.hata = metin[-800:] or f"Claude hata verdi ({veri.get('subtype')}, {veri.get('terminal_reason')})."
        return sonuc
