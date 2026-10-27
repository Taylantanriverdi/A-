#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Device Guard - Uzaktan cihaz kullanim engelleme ajani
-------------------------------------------------------
Bu ajan, sahip oldugunuz bir Windows bilgisayarda acilista calisir, internet
uzerinden sizin kontrol ettiginiz bir "durum bayragi" (LOCK / UNLOCK) okur ve
LOCK durumunda ekrani kaplayan bir kilit ekrani gosterir.

Seffaflik notu: Bu arac gizli degildir; gorev cubugundan/Gorev Yoneticisi'nden
gorulebilir. Amaci sahibinin kendi cihazini uzaktan yonetmesidir (ebeveyn
kontrolu, kiosk, kendini-disiplin, anti-hirsizlik gibi mesru senaryolar).

Kullanim:
    python device_guard.py
Ayarlar config.json dosyasindan okunur.
"""

import json
import os
import sys
import time
import hashlib
import threading
import urllib.request

try:
    import tkinter as tk
except Exception:  # pragma: no cover
    print("Tkinter bulunamadi. Python'un tkinter ile kurulu oldugundan emin olun.")
    sys.exit(1)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

DEFAULT_CONFIG = {
    # Durumu okuyacagimiz URL. Icerigi "LOCK" ya da "UNLOCK" olmali.
    # Ornek: bir GitHub raw dosyasi, Gist, Dropbox, Pastebin raw linki.
    "status_url": "https://raw.githubusercontent.com/KULLANICI/REPO/main/durum.txt",
    # Kac saniyede bir kontrol edilsin.
    "poll_interval_seconds": 15,
    # Internete ulasamazsak ne yapilsin: "lock" (guvenli taraf) ya da "keep"
    # (son bilinen durumu koru). Varsayilan: son durumu koru.
    "on_network_error": "keep",
    # Yerel acil-acma sifresinin SHA-256 ozeti. set_password.py ile uretin.
    # Bos birakilirsa acil-acma devre disidir.
    "emergency_password_sha256": "",
    # Kilit ekraninda gosterilecek mesaj.
    "lock_message": "Bu cihaz gecici olarak kullanima kapatilmistir.",
}


def load_config():
    if not os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_CONFIG, f, indent=2, ensure_ascii=False)
        print(f"Varsayilan config olusturuldu: {CONFIG_PATH}")
        print("Lutfen status_url ve emergency_password_sha256 degerlerini ayarlayin.")
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    merged = dict(DEFAULT_CONFIG)
    merged.update(cfg)
    return merged


def fetch_status(url, timeout=10):
    """URL'den durumu okur. 'LOCK' veya 'UNLOCK' dondurur, hata olursa None."""
    req = urllib.request.Request(url, headers={"User-Agent": "DeviceGuard/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        text = resp.read().decode("utf-8", errors="ignore").strip().upper()
    if "LOCK" in text and "UNLOCK" not in text:
        return "LOCK"
    if "UNLOCK" in text:
        return "UNLOCK"
    return None


class LockScreen:
    """Ekrani kaplayan, en ustte duran kilit penceresi."""

    def __init__(self, config):
        self.config = config
        self.root = tk.Tk()
        self.root.withdraw()  # baslangicta gizli
        self.visible = False
        self.locked_logical = False      # uzaktan istenen mantiksal durum
        self.manually_unlocked = False    # acil sifre ile gecici acma
        self._build_window()
        self._reassert_topmost()

    # ---------- pencere kurulumu ----------
    def _build_window(self):
        self.win = tk.Toplevel(self.root)
        self.win.withdraw()
        self.win.configure(bg="#0b0f1a")
        self.win.attributes("-fullscreen", True)
        self.win.attributes("-topmost", True)
        self.win.overrideredirect(True)  # baslik cubugu yok
        # Alt+F4 / kapatma dugmesini etkisiz kil
        self.win.protocol("WM_DELETE_WINDOW", lambda: None)
        self.win.bind("<Alt-F4>", lambda e: "break")

        frame = tk.Frame(self.win, bg="#0b0f1a")
        frame.place(relx=0.5, rely=0.5, anchor="center")

        tk.Label(frame, text="🔒", font=("Segoe UI Emoji", 72),
                 bg="#0b0f1a", fg="#e8ecf4").pack(pady=(0, 10))
        self.msg_label = tk.Label(
            frame, text=self.config.get("lock_message", "Cihaz kilitli."),
            font=("Segoe UI", 22, "bold"), bg="#0b0f1a", fg="#e8ecf4",
            wraplength=900, justify="center")
        self.msg_label.pack(pady=(0, 24))

        # Acil-acma alani (sadece sifre ayarlanmissa goster)
        if self.config.get("emergency_password_sha256"):
            tk.Label(frame, text="Acil acma sifresi:", font=("Segoe UI", 12),
                     bg="#0b0f1a", fg="#8b93a7").pack()
            self.entry = tk.Entry(frame, show="*", font=("Segoe UI", 16),
                                  width=24, justify="center")
            self.entry.pack(pady=8)
            self.entry.bind("<Return>", lambda e: self._try_emergency_unlock())
            tk.Button(frame, text="Ac", font=("Segoe UI", 12),
                      command=self._try_emergency_unlock).pack()
            self.status_label = tk.Label(frame, text="", font=("Segoe UI", 11),
                                         bg="#0b0f1a", fg="#ff6b6b")
            self.status_label.pack(pady=(8, 0))

    def _reassert_topmost(self):
        # Kilitliyken pencerenin hep onde kalmasini saglar.
        if self.visible:
            try:
                self.win.attributes("-topmost", True)
                self.win.lift()
                self.win.focus_force()
            except Exception:
                pass
        self.root.after(1000, self._reassert_topmost)

    # ---------- acil acma ----------
    def _try_emergency_unlock(self):
        pw = self.entry.get()
        digest = hashlib.sha256(pw.encode("utf-8")).hexdigest()
        if digest == self.config.get("emergency_password_sha256"):
            self.manually_unlocked = True
            self._hide()
        else:
            self.status_label.config(text="Hatali sifre.")
            self.entry.delete(0, "end")

    # ---------- goster/gizle ----------
    def _show(self):
        if not self.visible:
            self.visible = True
            self.win.deiconify()
            self.win.attributes("-fullscreen", True)
            self.win.attributes("-topmost", True)
            self.win.lift()
            self.win.focus_force()

    def _hide(self):
        if self.visible:
            self.visible = False
            self.win.withdraw()

    def apply_logical_state(self, locked):
        """Uzaktan gelen mantiksal durumu uygular."""
        self.locked_logical = locked
        if not locked:
            # Uzaktan acildi: acil-acma bayragini sifirla.
            self.manually_unlocked = False
            self._hide()
        else:
            if not self.manually_unlocked:
                self._show()

    def run(self):
        self.root.mainloop()


def poller(lock_screen, config):
    """Arka planda durumu periyodik okuyan dongu."""
    last_known_locked = False
    interval = max(5, int(config.get("poll_interval_seconds", 15)))
    while True:
        status = None
        try:
            status = fetch_status(config["status_url"])
        except Exception as e:
            print(f"[uyari] Durum okunamadi: {e}")

        if status == "LOCK":
            last_known_locked = True
        elif status == "UNLOCK":
            last_known_locked = False
        else:
            # Okuyamadik ya da anlamadik -> politikaya gore davran.
            if config.get("on_network_error") == "lock":
                last_known_locked = True
            # "keep" ise last_known_locked aynen korunur.

        # UI thread'inde uygula
        lock_screen.root.after(0, lock_screen.apply_logical_state, last_known_locked)
        time.sleep(interval)


def main():
    config = load_config()
    lock_screen = LockScreen(config)
    t = threading.Thread(target=poller, args=(lock_screen, config), daemon=True)
    t.start()
    lock_screen.run()


if __name__ == "__main__":
    main()
