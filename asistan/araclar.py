"""Terminal, dosya düzenleyici ve hafıza araçları + araç tanımları."""

from __future__ import annotations

import os
import platform
import queue
import shutil
import subprocess
import threading
import uuid
from pathlib import Path

from .ayarlar import Ayarlar
from .guvenlik import Guvenlik

CIKTI_SINIRI = 30_000  # modele dönen çıktının karakter sınırı


def _kirp(metin: str) -> str:
    if len(metin) <= CIKTI_SINIRI:
        return metin
    yarim = CIKTI_SINIRI // 2
    return metin[:yarim] + f"\n\n... [{len(metin) - CIKTI_SINIRI} karakter kırpıldı] ...\n\n" + metin[-yarim:]


class AracHatasi(Exception):
    pass


# --------------------------------------------------------------------------- #
# Terminal (bash_20250124)
# --------------------------------------------------------------------------- #


class Terminal:
    """Komutlar arasında durumu (cd, export, venv) koruyan kalıcı kabuk oturumu."""

    def __init__(self, zaman_asimi: int):
        self.zaman_asimi = zaman_asimi
        self.windows = platform.system() == "Windows"
        self.cwd = str(Path.home())
        self._surec: subprocess.Popen | None = None
        self._kuyruk: queue.Queue[str] = queue.Queue()

    def _baslat(self) -> None:
        if self.windows:
            return
        kabuk = shutil.which("bash") or "/bin/sh"
        self._surec = subprocess.Popen(
            [kabuk, "--noprofile", "--norc"] if kabuk.endswith("bash") else [kabuk],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=self.cwd,
            text=True,
            bufsize=1,
            env={**os.environ, "PAGER": "cat", "GIT_PAGER": "cat", "TERM": "dumb"},
        )
        self._kuyruk = queue.Queue()

        def oku(akis, k):
            for satir in iter(akis.readline, ""):
                k.put(satir)

        threading.Thread(target=oku, args=(self._surec.stdout, self._kuyruk), daemon=True).start()

    def yeniden_baslat(self) -> str:
        if self._surec and self._surec.poll() is None:
            self._surec.kill()
        self._surec = None
        return "Terminal yeniden başlatıldı."

    def calistir(self, komut: str) -> str:
        if self.windows:
            return self._windows_calistir(komut)
        if self._surec is None or self._surec.poll() is not None:
            self._baslat()
        assert self._surec and self._surec.stdin
        isaret = f"__ASISTAN_{uuid.uuid4().hex}__"
        self._surec.stdin.write(f"{komut}\n__asistan_kod=$?; echo; echo {isaret}$__asistan_kod\n")
        self._surec.stdin.flush()
        satirlar: list[str] = []
        while True:
            try:
                satir = self._kuyruk.get(timeout=self.zaman_asimi)
            except queue.Empty:
                self.yeniden_baslat()
                return _kirp("".join(satirlar)) + (
                    f"\n[Komut {self.zaman_asimi} sn içinde bitmedi; terminal yeniden başlatıldı. "
                    "Uzun süren işleri arka planda çalıştır: `komut > log 2>&1 &`]"
                )
            if satir.startswith(isaret):
                kod = satir[len(isaret):].strip()
                cikti = "".join(satirlar).rstrip("\n")
                return _kirp(cikti if kod == "0" else f"{cikti}\n[çıkış kodu: {kod}]")
            satirlar.append(satir)

    def _windows_calistir(self, komut: str) -> str:
        isaret = f"__ASISTAN_CWD_{uuid.uuid4().hex}__"
        sarili = f"{komut}\n$__k = $LASTEXITCODE; Write-Output '{isaret}'; (Get-Location).Path; Write-Output $__k"
        try:
            r = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", sarili],
                cwd=self.cwd, capture_output=True, text=True, timeout=self.zaman_asimi,
            )
        except subprocess.TimeoutExpired:
            return f"[Komut {self.zaman_asimi} sn içinde bitmedi.]"
        cikti = r.stdout
        if isaret in cikti:
            cikti, kuyruk = cikti.split(isaret, 1)
            parcalar = kuyruk.strip().splitlines()
            if parcalar:
                self.cwd = parcalar[0].strip()
        return _kirp((cikti + r.stderr).rstrip())


# --------------------------------------------------------------------------- #
# Dosya düzenleyici (text_editor_20250728)
# --------------------------------------------------------------------------- #


class Duzenleyici:
    def __init__(self, ayarlar: Ayarlar, guvenlik: Guvenlik):
        self.ayarlar = ayarlar
        self.guvenlik = guvenlik

    def _yol(self, ham: str) -> Path:
        if not isinstance(ham, str) or not ham:
            raise AracHatasi("'path' gerekli.")
        yol = Path(ham).expanduser().resolve()
        if not any(yol == kok or yol.is_relative_to(kok) for kok in self.ayarlar.izinli_dizinler):
            izinli = ", ".join(str(k) for k in self.ayarlar.izinli_dizinler)
            raise AracHatasi(f"{yol} izinli dizinlerin dışında ({izinli}).")
        return yol

    def calistir(self, girdi: dict) -> str:
        komut = girdi.get("command")
        yol = self._yol(girdi.get("path"))

        if komut == "view":
            if yol.is_dir():
                ogeler = sorted(yol.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
                return "\n".join(f"{p.name}/" if p.is_dir() else p.name for p in ogeler[:1000])
            if not yol.exists():
                raise AracHatasi(f"{yol} bulunamadı.")
            satirlar = yol.read_text(encoding="utf-8", errors="replace").splitlines()
            aralik = girdi.get("view_range")
            bas, son = 1, len(satirlar)
            if aralik:
                bas = max(1, int(aralik[0]))
                son = len(satirlar) if int(aralik[1]) == -1 else min(len(satirlar), int(aralik[1]))
            return _kirp("\n".join(f"{i}\t{satirlar[i - 1]}" for i in range(bas, son + 1)))

        if komut == "create":
            metin = girdi.get("file_text")
            if not isinstance(metin, str):
                raise AracHatasi("'file_text' gerekli.")
            izin, sebep = self.guvenlik.dosya_onayi("oluştur/üzerine yaz", str(yol))
            if not izin:
                raise AracHatasi(sebep)
            if yol.exists():
                shutil.copy2(yol, yol.with_name(yol.name + ".asistan.bak"))
            yol.parent.mkdir(parents=True, exist_ok=True)
            yol.write_text(metin, encoding="utf-8")
            return f"{yol} yazıldı."

        if komut == "str_replace":
            eski, yeni = girdi.get("old_str"), girdi.get("new_str", "")
            if not isinstance(eski, str) or not eski:
                raise AracHatasi("'old_str' gerekli.")
            icerik = yol.read_text(encoding="utf-8")
            adet = icerik.count(eski)
            if adet != 1:
                raise AracHatasi(
                    f"'old_str' {adet} kez bulundu; tam olarak 1 olmalı. Daha fazla bağlam ekle."
                )
            izin, sebep = self.guvenlik.dosya_onayi("düzenle", str(yol))
            if not izin:
                raise AracHatasi(sebep)
            yol.write_text(icerik.replace(eski, yeni, 1), encoding="utf-8")
            return f"{yol} düzenlendi."

        if komut == "insert":
            satir_no, metin = girdi.get("insert_line"), girdi.get("insert_text")
            if not isinstance(satir_no, int) or not isinstance(metin, str):
                raise AracHatasi("'insert_line' (sayı) ve 'insert_text' gerekli.")
            satirlar = yol.read_text(encoding="utf-8").splitlines(keepends=True)
            if not 0 <= satir_no <= len(satirlar):
                raise AracHatasi(f"insert_line 0..{len(satirlar)} aralığında olmalı.")
            izin, sebep = self.guvenlik.dosya_onayi("satır ekle", str(yol))
            if not izin:
                raise AracHatasi(sebep)
            if not metin.endswith("\n"):
                metin += "\n"
            satirlar.insert(satir_no, metin)
            yol.write_text("".join(satirlar), encoding="utf-8")
            return f"{yol} dosyasına {satir_no}. satırdan sonra eklendi."

        raise AracHatasi(f"Bilinmeyen düzenleyici komutu: {komut!r}")


# --------------------------------------------------------------------------- #
# Hafıza — kullanıcı profili ve kalıcı notlar
# --------------------------------------------------------------------------- #


class Hafiza:
    def __init__(self, ayarlar: Ayarlar):
        self.ayarlar = ayarlar

    def _dosya(self, ad: str) -> Path:
        if ad == "profil":
            return self.ayarlar.profil_dosyasi
        if ad == "notlar":
            return self.ayarlar.notlar_dosyasi
        raise AracHatasi("dosya 'profil' veya 'notlar' olmalı.")

    def oku(self, ad: str) -> str:
        d = self._dosya(ad)
        return d.read_text(encoding="utf-8") if d.exists() else ""

    def calistir(self, girdi: dict) -> str:
        islem, ad, metin = girdi.get("islem"), girdi.get("dosya"), girdi.get("metin", "")
        d = self._dosya(ad)
        if islem == "oku":
            return self.oku(ad) or "(boş)"
        if not isinstance(metin, str) or not metin.strip():
            raise AracHatasi("'metin' gerekli.")
        if islem == "ekle":
            with d.open("a", encoding="utf-8") as f:
                f.write(metin.rstrip() + "\n")
            return f"{ad} dosyasına eklendi."
        if islem == "yaz":
            d.write_text(metin.rstrip() + "\n", encoding="utf-8")
            return f"{ad} dosyası yeniden yazıldı."
        raise AracHatasi("islem 'oku', 'ekle' veya 'yaz' olmalı.")


# --------------------------------------------------------------------------- #
# Araç tanımları (OpenAI / DeepSeek fonksiyon çağrısı biçimi)
# --------------------------------------------------------------------------- #

KOORDINAT = {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}


def _fonksiyon(ad: str, aciklama: str, ozellikler: dict, zorunlu: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": ad,
            "description": aciklama,
            "parameters": {
                "type": "object",
                "properties": ozellikler,
                "required": zorunlu,
                "additionalProperties": False,
            },
        },
    }


def bilgisayar_araci(genislik: int, yukseklik: int) -> dict:
    return _fonksiyon(
        "bilgisayar",
        f"Ekranı, fareyi ve klavyeyi kullan. Ekran görüntüsü {genislik}x{yukseklik} pikseldir; koordinatlar "
        "[x, y] biçiminde bu görüntünün piksel uzayındadır (sol üst 0,0). Ekran görüntüsü sonraki mesajda görsel "
        "olarak gelir. Her eylem grubundan sonra 'screenshot' ile sonucu doğrula.",
        {
            "action": {
                "type": "string",
                "enum": [
                    "screenshot", "zoom", "left_click", "right_click", "middle_click", "double_click",
                    "triple_click", "left_click_drag", "mouse_move", "left_mouse_down", "left_mouse_up",
                    "cursor_position", "scroll", "type", "key", "hold_key", "wait",
                ],
                "description": "Yapılacak eylem.",
            },
            "coordinate": {**KOORDINAT, "description": "Tıklama/taşıma/kaydırma/sürükleme hedefi [x, y]."},
            "start_coordinate": {**KOORDINAT, "description": "left_click_drag başlangıç noktası [x, y]."},
            "region": {
                "type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4,
                "description": "zoom için bölge [x0, y0, x1, y1].",
            },
            "text": {
                "type": "string",
                "description": "type: yazılacak metin. key/hold_key: tuş veya kombinasyon (ör. 'Return', "
                "'ctrl+s', 'alt+tab', 'super'). Tıklama/kaydırmada basılı tutulacak değiştirici (ör. 'shift').",
            },
            "scroll_direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
            "scroll_amount": {"type": "integer", "description": "Kaydırma adımı (ör. 3)."},
            "duration": {"type": "number", "description": "wait/hold_key süresi (saniye, en fazla 300)."},
            "repeat": {"type": "integer", "description": "key için tekrar sayısı (1-100)."},
        },
        ["action"],
    )


ARACLAR = [
    _fonksiyon(
        "bash",
        "Kalıcı bir kabuk oturumunda komut çalıştır (Windows'ta PowerShell). cd, ortam değişkenleri ve sanal "
        "ortam komutlar arasında korunur. Etkileşimli komutlardan kaçın; uzun işleri arka planda çalıştır.",
        {
            "command": {"type": "string", "description": "Çalıştırılacak komut."},
            "restart": {"type": "boolean", "description": "true ise kabuğu yeniden başlat."},
        },
        [],
    ),
    _fonksiyon(
        "dosya",
        "Dosyaları görüntüle ve düzenle. view: dosya içeriği (satır numaralı) veya dizin listesi. "
        "create: dosyayı oluştur/üzerine yaz. str_replace: old_str'yi (dosyada tam 1 kez geçmeli) new_str ile "
        "değiştir. insert: insert_line satırından sonra insert_text ekle (0 = dosya başı).",
        {
            "command": {"type": "string", "enum": ["view", "create", "str_replace", "insert"]},
            "path": {"type": "string", "description": "Mutlak dosya yolu."},
            "file_text": {"type": "string"},
            "old_str": {"type": "string"},
            "new_str": {"type": "string"},
            "insert_line": {"type": "integer"},
            "insert_text": {"type": "string"},
            "view_range": {
                "type": "array", "items": {"type": "integer"}, "minItems": 2, "maxItems": 2,
                "description": "view için [başlangıç, bitiş] satırı; bitiş -1 = dosya sonu.",
            },
        },
        ["command", "path"],
    ),
    _fonksiyon(
        "hafiza",
        "Kalıcı hafıza. 'profil' kullanıcının kim olduğunu, nasıl çalıştığını, kod stilini, tercih ettiği "
        "araçları ve kurallarını tutar; her oturumun başında sana verilir. 'notlar' yarım kalan işler, proje "
        "bilgileri ve öğrendiğin şeyler içindir. Kullanıcı hakkında kalıcı ve faydalı bir şey öğrendiğinde "
        "profile ekle. Şifre veya gizli anahtar asla yazma.",
        {
            "islem": {"type": "string", "enum": ["oku", "ekle", "yaz"]},
            "dosya": {"type": "string", "enum": ["profil", "notlar"]},
            "metin": {"type": "string", "description": "ekle/yaz için içerik (Markdown)."},
        },
        ["islem", "dosya"],
    ),
    _fonksiyon(
        "kullaniciya_sor",
        "Kullanıcıya soru sor ve cevabını bekle. Yalnızca gerçekten gerekli olduğunda kullan: geri alınamaz bir "
        "karar, eksik bir bilgi veya belirsiz bir istek.",
        {"soru": {"type": "string"}},
        ["soru"],
    ),
]


def arac_tanimlari(ekran_boyutu: tuple[int, int] | None) -> list[dict]:
    if ekran_boyutu:
        return [bilgisayar_araci(*ekran_boyutu), *ARACLAR]
    return list(ARACLAR)
