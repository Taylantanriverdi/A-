"""Ekran, fare ve klavye kontrolü — `computer_toolset_20260801` üyelerini uygular.

Windows, macOS ve Linux (X11) üzerinde mss + pyautogui ile çalışır.
Acil durdurma: fareyi ekranın bir köşesine hızlıca götür (pyautogui FAILSAFE).
"""

from __future__ import annotations

import base64
import io
import math
import platform
import time

# Model ekran görüntüsünü bu sınırlara sığacak şekilde küçültülmüş olarak görür.
# Daha küçük görüntü = daha hızlı ve daha isabetli tıklama.
UZUN_KENAR_SINIRI = 1568
PIKSEL_SINIRI = 1_150_000

# xdotool tarzı tuş adları -> pyautogui adları
TUS_ESLEME = {
    "return": "enter", "enter": "enter", "kp_enter": "enter",
    "escape": "esc", "esc": "esc",
    "backspace": "backspace", "back_space": "backspace",
    "tab": "tab", "space": "space", "delete": "delete", "insert": "insert",
    "home": "home", "end": "end",
    "page_up": "pageup", "prior": "pageup", "pageup": "pageup",
    "page_down": "pagedown", "next": "pagedown", "pagedown": "pagedown",
    "up": "up", "down": "down", "left": "left", "right": "right",
    "ctrl": "ctrl", "control": "ctrl", "control_l": "ctrl", "control_r": "ctrl",
    "alt": "alt", "alt_l": "alt", "alt_r": "alt", "option": "alt",
    "shift": "shift", "shift_l": "shift", "shift_r": "shift",
    "super": "win", "super_l": "win", "super_r": "win", "win": "win", "meta": "win",
    "cmd": "command", "command": "command",
    "caps_lock": "capslock", "print": "printscreen",
    "minus": "-", "plus": "+", "equal": "=", "comma": ",", "period": ".",
    "slash": "/", "backslash": "\\", "semicolon": ";", "apostrophe": "'",
    "bracketleft": "[", "bracketright": "]", "grave": "`",
}


class EylemHatasi(Exception):
    pass


class Bilgisayar:
    def __init__(self) -> None:
        import mss
        import pyautogui

        self.pg = pyautogui
        self.pg.FAILSAFE = True
        self.pg.PAUSE = 0.05
        self.mss = mss.mss()
        mon = self.mss.monitors[1]  # birincil ekran
        self.monitor = mon
        self.fiziksel_w, self.fiziksel_h = mon["width"], mon["height"]
        self.mantiksal_w, self.mantiksal_h = self.pg.size()
        olcek_uzun = UZUN_KENAR_SINIRI / max(self.fiziksel_w, self.fiziksel_h)
        olcek_piksel = math.sqrt(PIKSEL_SINIRI / (self.fiziksel_w * self.fiziksel_h))
        self.olcek = min(1.0, olcek_uzun, olcek_piksel)
        self.goruntu_w = int(self.fiziksel_w * self.olcek)
        self.goruntu_h = int(self.fiziksel_h * self.olcek)
        self._macos = platform.system() == "Darwin"

    # --- koordinat dönüşümleri -------------------------------------------------

    def _ekrana(self, koordinat) -> tuple[int, int]:
        """Model koordinatı (küçültülmüş görüntü) -> pyautogui mantıksal koordinatı."""
        if not (isinstance(koordinat, (list, tuple)) and len(koordinat) == 2):
            raise EylemHatasi(f"Geçersiz koordinat: {koordinat!r}")
        x, y = (float(v) for v in koordinat)
        if not (0 <= x <= self.goruntu_w and 0 <= y <= self.goruntu_h):
            raise EylemHatasi(
                f"Koordinat ekran dışında: {koordinat}. Ekran {self.goruntu_w}x{self.goruntu_h}."
            )
        fx, fy = x / self.olcek, y / self.olcek
        mx = fx * self.mantiksal_w / self.fiziksel_w
        my = fy * self.mantiksal_h / self.fiziksel_h
        return int(round(mx)), int(round(my))

    def _modele(self, mx: float, my: float) -> tuple[int, int]:
        fx = mx * self.fiziksel_w / self.mantiksal_w
        fy = my * self.fiziksel_h / self.mantiksal_h
        return int(fx * self.olcek), int(fy * self.olcek)

    # --- görüntü ---------------------------------------------------------------

    def _yakala(self):
        from PIL import Image

        ham = self.mss.grab(self.monitor)
        return Image.frombytes("RGB", ham.size, ham.bgra, "raw", "BGRX")

    @staticmethod
    def _png_blok(img) -> dict:
        tampon = io.BytesIO()
        img.save(tampon, format="PNG", optimize=True)
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": base64.b64encode(tampon.getvalue()).decode(),
            },
        }

    def ekran_goruntusu(self) -> dict:
        from PIL import Image

        img = self._yakala()
        if self.olcek < 1.0:
            img = img.resize((self.goruntu_w, self.goruntu_h), Image.LANCZOS)
        return self._png_blok(img)

    def yakinlastir(self, bolge) -> dict:
        from PIL import Image

        if not (isinstance(bolge, (list, tuple)) and len(bolge) == 4):
            raise EylemHatasi(f"Geçersiz bölge: {bolge!r}")
        x0, y0, x1, y1 = (float(v) / self.olcek for v in bolge)
        if x1 <= x0 or y1 <= y0:
            raise EylemHatasi("Bölge boş: x1>x0 ve y1>y0 olmalı.")
        img = self._yakala().crop((int(x0), int(y0), int(x1), int(y1)))
        # Kırpılan bölgeyi görüntü sınırlarına sığdır
        w, h = img.size
        s = min(1.0, UZUN_KENAR_SINIRI / max(w, h), math.sqrt(PIKSEL_SINIRI / (w * h)))
        if s < 1.0:
            img = img.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
        return self._png_blok(img)

    # --- klavye ----------------------------------------------------------------

    def _tuslar(self, metin: str) -> list[str]:
        parcalar = [p for p in metin.replace(" ", "").split("+") if p]
        sonuc = []
        for p in parcalar:
            k = TUS_ESLEME.get(p.lower(), p.lower() if len(p) > 1 else p)
            if k == "win" and self._macos:
                k = "command"
            sonuc.append(k)
        return sonuc

    def _modifiye(self, metin: str | None):
        """Tıklama/kaydırma sırasında basılı tutulacak değiştirici tuşlar."""
        return self._tuslar(metin) if metin else []

    def _yaz(self, metin: str) -> None:
        # pyautogui.write ASCII dışı karakterleri (ç, ğ, ş, ı, ö, ü) yazamaz;
        # bu durumda panoya kopyalayıp yapıştırırız.
        if metin.isascii():
            self.pg.write(metin, interval=0.01)
            return
        try:
            import pyperclip

            eski = pyperclip.paste()
            pyperclip.copy(metin)
            self.pg.hotkey("command" if self._macos else "ctrl", "v")
            time.sleep(0.1)
            pyperclip.copy(eski)
        except Exception:
            self.pg.write(metin, interval=0.01)

    # --- üye dağıtımı -----------------------------------------------------------

    def calistir(self, eylem: str, girdi: dict) -> list[dict] | str:
        """Bir toolset üyesini çalıştırır. Görüntü blokları listesi veya metin döner."""
        pg = self.pg

        if eylem == "screenshot":
            return [self.ekran_goruntusu()]
        if eylem == "zoom":
            return [self.yakinlastir(girdi.get("region"))]
        if eylem == "cursor_position":
            x, y = self._modele(*pg.position())
            return f"X={x}, Y={y}"
        if eylem == "wait":
            time.sleep(min(float(girdi.get("duration", 1)), 300))
            return "OK"

        if eylem in ("left_click", "right_click", "middle_click", "double_click", "triple_click"):
            if girdi.get("coordinate") is not None:
                pg.moveTo(*self._ekrana(girdi["coordinate"]))
            mods = self._modifiye(girdi.get("text"))
            for m in mods:
                pg.keyDown(m)
            try:
                if eylem == "left_click":
                    pg.click()
                elif eylem == "right_click":
                    pg.click(button="right")
                elif eylem == "middle_click":
                    pg.click(button="middle")
                elif eylem == "double_click":
                    pg.click(clicks=2, interval=0.08)
                else:
                    pg.click(clicks=3, interval=0.08)
            finally:
                for m in reversed(mods):
                    pg.keyUp(m)
            return "OK"

        if eylem == "left_click_drag":
            bas = self._ekrana(girdi.get("start_coordinate"))
            son = self._ekrana(girdi.get("coordinate"))
            mods = self._modifiye(girdi.get("text"))
            for m in mods:
                pg.keyDown(m)
            try:
                pg.moveTo(*bas)
                pg.mouseDown()
                pg.moveTo(*son, duration=0.4)
                pg.mouseUp()
            finally:
                for m in reversed(mods):
                    pg.keyUp(m)
            return "OK"

        if eylem == "mouse_move":
            pg.moveTo(*self._ekrana(girdi.get("coordinate")), duration=0.15)
            return "OK"
        if eylem == "left_mouse_down":
            pg.mouseDown()
            return "OK"
        if eylem == "left_mouse_up":
            pg.mouseUp()
            return "OK"

        if eylem == "scroll":
            if girdi.get("coordinate") is not None:
                pg.moveTo(*self._ekrana(girdi["coordinate"]))
            yon = girdi.get("scroll_direction")
            miktar = int(girdi.get("scroll_amount", 3))
            mods = self._modifiye(girdi.get("text"))
            for m in mods:
                pg.keyDown(m)
            try:
                if yon == "up":
                    pg.scroll(miktar * 100)
                elif yon == "down":
                    pg.scroll(-miktar * 100)
                elif yon in ("left", "right"):
                    pg.hscroll(miktar * 100 * (-1 if yon == "left" else 1))
                else:
                    raise EylemHatasi(f"Geçersiz kaydırma yönü: {yon!r}")
            finally:
                for m in reversed(mods):
                    pg.keyUp(m)
            return "OK"

        if eylem == "type":
            metin = girdi.get("text")
            if not isinstance(metin, str):
                raise EylemHatasi("type için 'text' gerekli.")
            self._yaz(metin)
            return "OK"

        if eylem == "key":
            metin = girdi.get("text")
            if not isinstance(metin, str) or not metin:
                raise EylemHatasi("key için 'text' gerekli.")
            tekrar = max(1, min(int(girdi.get("repeat", 1)), 100))
            tuslar = self._tuslar(metin)
            for _ in range(tekrar):
                pg.hotkey(*tuslar) if len(tuslar) > 1 else pg.press(tuslar[0])
            return "OK"

        if eylem == "hold_key":
            tuslar = self._tuslar(girdi.get("text") or "")
            if not tuslar:
                raise EylemHatasi("hold_key için 'text' gerekli.")
            for t in tuslar:
                pg.keyDown(t)
            try:
                time.sleep(min(float(girdi.get("duration", 1)), 300))
            finally:
                for t in reversed(tuslar):
                    pg.keyUp(t)
            return "OK"

        raise EylemHatasi(f"Bilinmeyen eylem: {eylem}")
