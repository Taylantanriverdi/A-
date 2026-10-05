"""Ekran, fare ve klavye kontrolü.

Claude'un computer toolset'inden gelen her eylemi (screenshot, left_click,
type, key, scroll, zoom, ...) gerçek bilgisayarda uygular.

Koordinatlar: Claude, kendisine gönderdiğimiz (küçültülmüş) ekran görüntüsünün
piksel uzayında konuşur. Biz de bunları pyautogui'nin mantıksal ekran
koordinatlarına çeviririz. Böylece Retina / yüksek DPI ekranlarda da doğru
noktaya tıklanır.
"""

from __future__ import annotations

import base64
import io
import math
import platform
import time

import mss
import pyautogui
import pyperclip
from PIL import Image

# Fareyi ekranın bir köşesine hızla götürmek her şeyi anında durdurur.
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05

SISTEM = platform.system()  # "Windows", "Darwin" (macOS), "Linux"

# Görüntü sınırları: uzun kenar ve toplam piksel (modelin görüntü limitleri içinde kalır).
MAKS_UZUN_KENAR = 1568
MAKS_PIKSEL = 1_150_000

# Claude'un kullandığı (xdotool tarzı) tuş adlarını pyautogui adlarına çevirir.
TUS_ESLEME = {
    "return": "enter",
    "enter": "enter",
    "kp_enter": "enter",
    "escape": "esc",
    "esc": "esc",
    "backspace": "backspace",
    "delete": "delete",
    "tab": "tab",
    "space": "space",
    "page_up": "pageup",
    "prior": "pageup",
    "page_down": "pagedown",
    "next": "pagedown",
    "home": "home",
    "end": "end",
    "insert": "insert",
    "up": "up",
    "down": "down",
    "left": "left",
    "right": "right",
    "ctrl": "ctrl",
    "control": "ctrl",
    "control_l": "ctrl",
    "control_r": "ctrl",
    "shift": "shift",
    "shift_l": "shift",
    "shift_r": "shift",
    "alt": "alt",
    "alt_l": "alt",
    "alt_r": "altright",
    "option": "option",
    "super": "command" if SISTEM == "Darwin" else "win",
    "super_l": "command" if SISTEM == "Darwin" else "win",
    "meta": "command" if SISTEM == "Darwin" else "win",
    "win": "win",
    "cmd": "command",
    "command": "command",
    "caps_lock": "capslock",
    "print": "printscreen",
    "minus": "-",
    "plus": "+",
    "equal": "=",
    "comma": ",",
    "period": ".",
    "slash": "/",
    "backslash": "\\",
    "semicolon": ";",
    "apostrophe": "'",
    "grave": "`",
    "bracketleft": "[",
    "bracketright": "]",
    "audiomute": "volumemute",
    "audiolowervolume": "volumedown",
    "audioraisevolume": "volumeup",
    "audioplay": "playpause",
}
for _i in range(1, 25):
    TUS_ESLEME[f"f{_i}"] = f"f{_i}"


def tus_cevir(ad: str) -> str:
    """Tek bir tuş adını pyautogui'nin anladığı ada çevirir."""
    temiz = ad.strip()
    kucuk = temiz.lower()
    if kucuk in TUS_ESLEME:
        return TUS_ESLEME[kucuk]
    if len(temiz) == 1:
        return temiz.lower()
    if kucuk in pyautogui.KEYBOARD_KEYS:
        return kucuk
    raise ValueError(f"Bilinmeyen tuş: {ad!r}")


def kombinasyon_cevir(metin: str) -> list[str]:
    """'ctrl+shift+t' gibi bir kombinasyonu tuş listesine çevirir."""
    if metin.strip() == "+":
        return ["+"]
    return [tus_cevir(parca) for parca in metin.split("+") if parca.strip()]


def olcek_hesapla(genislik: int, yukseklik: int) -> float:
    uzun_kenar_olcek = MAKS_UZUN_KENAR / max(genislik, yukseklik)
    piksel_olcek = math.sqrt(MAKS_PIKSEL / (genislik * yukseklik))
    return min(1.0, uzun_kenar_olcek, piksel_olcek)


def _png_base64(img: Image.Image) -> str:
    tampon = io.BytesIO()
    img.save(tampon, format="PNG", optimize=True)
    return base64.standard_b64encode(tampon.getvalue()).decode()


def _gorsel_blok(img: Image.Image) -> list[dict]:
    return [
        {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": _png_base64(img)},
        }
    ]


def _metin_blok(metin: str) -> list[dict]:
    return [{"type": "text", "text": metin}]


class Bilgisayar:
    """Ana ekranı kontrol eden yürütücü."""

    def __init__(self) -> None:
        # pyautogui'nin mantıksal ekran boyutu (tıklamalar bu uzayda yapılır).
        self.ekran_g, self.ekran_y = pyautogui.size()
        self.olcek = olcek_hesapla(self.ekran_g, self.ekran_y)
        # Claude'a gönderilen görüntünün boyutu.
        self.goruntu_g = max(1, round(self.ekran_g * self.olcek))
        self.goruntu_y = max(1, round(self.ekran_y * self.olcek))

    # --- koordinat dönüşümleri -------------------------------------------------

    def _ekrana(self, koordinat) -> tuple[int, int]:
        """Ekran görüntüsü koordinatını gerçek ekran koordinatına çevirir."""
        if not isinstance(koordinat, (list, tuple)) or len(koordinat) != 2:
            raise ValueError(f"Geçersiz koordinat: {koordinat!r}")
        x, y = (float(koordinat[0]), float(koordinat[1]))
        if not (0 <= x <= self.goruntu_g and 0 <= y <= self.goruntu_y):
            raise ValueError(
                f"Koordinat ekran dışında: {koordinat!r} "
                f"(ekran görüntüsü {self.goruntu_g}x{self.goruntu_y})"
            )
        ex = min(self.ekran_g - 1, round(x / self.olcek))
        ey = min(self.ekran_y - 1, round(y / self.olcek))
        return ex, ey

    def _goruntuye(self, x: int, y: int) -> list[int]:
        return [round(x * self.olcek), round(y * self.olcek)]

    # --- ekran yakalama --------------------------------------------------------

    def _ham_goruntu(self) -> Image.Image:
        """Ana monitörün tam çözünürlüklü görüntüsü (fiziksel pikseller)."""
        with mss.mss() as sct:
            ham = sct.grab(sct.monitors[1])
            return Image.frombytes("RGB", ham.size, ham.bgra, "raw", "BGRX")

    def ekran_goruntusu(self) -> Image.Image:
        return self._ham_goruntu().resize((self.goruntu_g, self.goruntu_y), Image.LANCZOS)

    def yakinlastir(self, bolge) -> Image.Image:
        if not isinstance(bolge, (list, tuple)) or len(bolge) != 4:
            raise ValueError(f"Geçersiz bölge: {bolge!r}")
        x0, y0, x1, y1 = (float(v) for v in bolge)
        if x1 <= x0 or y1 <= y0:
            raise ValueError(f"Bölge boş: {bolge!r}")
        ham = self._ham_goruntu()
        oran_x = ham.width / self.goruntu_g
        oran_y = ham.height / self.goruntu_y
        kutu = (
            max(0, round(x0 * oran_x)),
            max(0, round(y0 * oran_y)),
            min(ham.width, round(x1 * oran_x)),
            min(ham.height, round(y1 * oran_y)),
        )
        parca = ham.crop(kutu)
        olcek = olcek_hesapla(parca.width, parca.height)
        if olcek < 1.0:
            parca = parca.resize(
                (max(1, round(parca.width * olcek)), max(1, round(parca.height * olcek))),
                Image.LANCZOS,
            )
        return parca

    # --- yardımcılar ----------------------------------------------------------

    def _yaz(self, metin: str) -> None:
        """Metni yazar. Türkçe karakterler (ç, ğ, ı, ö, ş, ü) için panoyu kullanır."""
        if metin.isascii():
            pyautogui.write(metin, interval=0.01)
            return
        eski = None
        try:
            eski = pyperclip.paste()
        except pyperclip.PyperclipException:
            pass
        pyperclip.copy(metin)
        pyautogui.hotkey("command" if SISTEM == "Darwin" else "ctrl", "v")
        time.sleep(0.2)
        if eski is not None:
            try:
                pyperclip.copy(eski)
            except pyperclip.PyperclipException:
                pass

    def _tikla(self, girdi: dict, dugme: str, sayi: int) -> None:
        if girdi.get("coordinate") is not None:
            pyautogui.moveTo(*self._ekrana(girdi["coordinate"]))
        tuslar = kombinasyon_cevir(girdi["text"]) if girdi.get("text") else []
        for t in tuslar:
            pyautogui.keyDown(t)
        try:
            pyautogui.click(button=dugme, clicks=sayi, interval=0.08)
        finally:
            for t in reversed(tuslar):
                pyautogui.keyUp(t)

    @staticmethod
    def _sure(girdi: dict) -> float:
        sure = float(girdi.get("duration", 1))
        if not 0 <= sure <= 300:
            raise ValueError("duration 0 ile 300 saniye arasında olmalı")
        return sure

    # --- eylemler -------------------------------------------------------------

    def uygula(self, eylem: str, girdi: dict) -> list[dict]:
        """Bir computer toolset eylemini uygular ve tool_result içeriğini döndürür."""
        girdi = girdi or {}

        if eylem == "screenshot":
            return _gorsel_blok(self.ekran_goruntusu())

        if eylem == "zoom":
            return _gorsel_blok(self.yakinlastir(girdi.get("region")))

        if eylem in ("left_click", "right_click", "middle_click"):
            self._tikla(girdi, eylem.split("_")[0], 1)
        elif eylem == "double_click":
            self._tikla(girdi, "left", 2)
        elif eylem == "triple_click":
            self._tikla(girdi, "left", 3)
        elif eylem == "left_click_drag":
            bas = self._ekrana(girdi.get("start_coordinate"))
            son = self._ekrana(girdi.get("coordinate"))
            tuslar = kombinasyon_cevir(girdi["text"]) if girdi.get("text") else []
            for t in tuslar:
                pyautogui.keyDown(t)
            try:
                pyautogui.moveTo(*bas)
                pyautogui.mouseDown(button="left")
                pyautogui.moveTo(*son, duration=0.4)
                pyautogui.mouseUp(button="left")
            finally:
                for t in reversed(tuslar):
                    pyautogui.keyUp(t)
        elif eylem == "mouse_move":
            pyautogui.moveTo(*self._ekrana(girdi.get("coordinate")), duration=0.15)
        elif eylem == "left_mouse_down":
            pyautogui.mouseDown(button="left")
        elif eylem == "left_mouse_up":
            pyautogui.mouseUp(button="left")
        elif eylem == "cursor_position":
            x, y = pyautogui.position()
            gx, gy = self._goruntuye(x, y)
            return _metin_blok(f"X={gx},Y={gy}")
        elif eylem == "scroll":
            self._kaydir(girdi)
        elif eylem == "type":
            metin = girdi.get("text")
            if not isinstance(metin, str):
                raise ValueError("type için 'text' gerekli")
            self._yaz(metin)
        elif eylem == "key":
            metin = girdi.get("text")
            if not isinstance(metin, str) or not metin:
                raise ValueError("key için 'text' gerekli")
            tuslar = kombinasyon_cevir(metin)
            tekrar = int(girdi.get("repeat", 1))
            if not 1 <= tekrar <= 100:
                raise ValueError("repeat 1 ile 100 arasında olmalı")
            for _ in range(tekrar):
                pyautogui.hotkey(*tuslar)
        elif eylem == "hold_key":
            tuslar = kombinasyon_cevir(girdi.get("text") or "")
            if not tuslar:
                raise ValueError("hold_key için 'text' gerekli")
            sure = self._sure(girdi)
            for t in tuslar:
                pyautogui.keyDown(t)
            try:
                time.sleep(sure)
            finally:
                for t in reversed(tuslar):
                    pyautogui.keyUp(t)
        elif eylem == "wait":
            time.sleep(self._sure(girdi))
        else:
            raise ValueError(f"Desteklenmeyen eylem: {eylem}")

        return _metin_blok("OK")

    def _kaydir(self, girdi: dict) -> None:
        yon = girdi.get("scroll_direction")
        miktar = int(girdi.get("scroll_amount", 3))
        if yon not in ("up", "down", "left", "right"):
            raise ValueError(f"Geçersiz kaydırma yönü: {yon!r}")
        if girdi.get("coordinate") is not None:
            pyautogui.moveTo(*self._ekrana(girdi["coordinate"]))
        tuslar = kombinasyon_cevir(girdi["text"]) if girdi.get("text") else []
        # Windows'ta tek "tık" çok küçük kalıyor; biraz büyütelim.
        carpan = 120 if SISTEM == "Windows" else 1
        for t in tuslar:
            pyautogui.keyDown(t)
        try:
            if yon in ("up", "down"):
                pyautogui.scroll(miktar * carpan * (1 if yon == "up" else -1))
            elif SISTEM == "Windows":
                # pyautogui.hscroll Windows'ta yok: Shift + dikey kaydırma kullan.
                with pyautogui.hold("shift"):
                    pyautogui.scroll(miktar * carpan * (1 if yon == "left" else -1))
            else:
                pyautogui.hscroll(miktar * (1 if yon == "right" else -1))
        finally:
            for t in reversed(tuslar):
                pyautogui.keyUp(t)
