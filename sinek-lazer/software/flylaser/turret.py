"""Taret arayüzü: gerçek (Arduino seri port) ve sanal (simülatör) uygulamaları.

Seri protokol (NMEA benzeri, ASCII, XOR sağlama toplamı):
    $<GÖVDE>*<CS>\n         CS = GÖVDE baytlarının XOR'u, 2 haneli HEX

    H                 heartbeat (<=200 ms aralıkla gönderilmeli)
    A,1 / A,0         silahı kur (ARM) / indir (DISARM)
    M,<pan>,<tilt>    açı, santi-derece (ör. M,-1250,830 = -12.50°, 8.30°)
    P,1 / P,0         nişan (kırmızı) lazeri aç / kapa
    F,<ms>,<pwm>      güç lazeri darbesi (ms <= MAX_FIRE_MS, pwm 0-255)
    S                 durum sorgusu
    C                 latched hata temizleme (yalnızca DISARM ve girişler güvenliyse)

Yanıtlar: $OK,<komut>*CS  |  $ERR,<kod>*CS  |  $S,<armed>,<fault>,<pan>,<tilt>,<moving>*CS
"""
from __future__ import annotations

import threading
import time
from typing import Protocol


def checksum(body: str) -> str:
    cs = 0
    for ch in body.encode():
        cs ^= ch
    return f"{cs:02X}"


def frame(body: str) -> bytes:
    return f"${body}*{checksum(body)}\n".encode()


def parse(line: str) -> str | None:
    line = line.strip()
    if not line.startswith("$") or "*" not in line:
        return None
    body, cs = line[1:].rsplit("*", 1)
    return body if checksum(body) == cs.upper() else None


class Turret(Protocol):
    def arm(self, on: bool) -> bool: ...
    def move(self, pan_deg: float, tilt_deg: float) -> bool: ...
    def pointer(self, on: bool) -> bool: ...
    def fire(self, ms: int, pwm: int = 255) -> bool: ...
    def wait_settled(self, timeout: float = 1.0) -> bool: ...
    def heartbeat(self) -> None: ...


class SerialTurret:
    """Arduino firmware'i (firmware/laser_turret) ile konuşan gerçek taret."""

    def __init__(self, port: str = "/dev/ttyUSB0", baud: int = 115200):
        import serial  # pyserial
        self.ser = serial.Serial(port, baud, timeout=0.2)
        time.sleep(2.0)            # Nano USB açılışta reset atar
        self.ser.reset_input_buffer()
        self._lock = threading.Lock()
        self._hb_stop = threading.Event()
        self._hb = threading.Thread(target=self._hb_loop, daemon=True)
        self._hb.start()
        # Açılışta firmware F_HEARTBEAT mandallı başlar; bağlantı kurulunca temizle
        if not (self._cmd("C") or "").startswith("OK"):
            raise RuntimeError("Taret hata temizlemeyi reddetti: E-stop / anahtar / varlık sensörünü kontrol edin")

    def _hb_loop(self):
        while not self._hb_stop.is_set():
            self.heartbeat()
            time.sleep(0.1)

    def _cmd(self, body: str) -> str | None:
        with self._lock:
            self.ser.write(frame(body))
            deadline = time.time() + 0.3
            while time.time() < deadline:
                raw = self.ser.readline().decode(errors="ignore")
                resp = parse(raw)
                if resp is not None:
                    return resp
        return None

    def heartbeat(self) -> None:
        with self._lock:
            self.ser.write(frame("H"))
            self.ser.readline()

    def arm(self, on: bool) -> bool:
        return (self._cmd(f"A,{int(on)}") or "").startswith("OK")

    def move(self, pan_deg: float, tilt_deg: float) -> bool:
        return (self._cmd(f"M,{round(pan_deg * 100)},{round(tilt_deg * 100)}") or "").startswith("OK")

    def pointer(self, on: bool) -> bool:
        return (self._cmd(f"P,{int(on)}") or "").startswith("OK")

    def fire(self, ms: int, pwm: int = 255) -> bool:
        return (self._cmd(f"F,{int(ms)},{int(pwm)}") or "").startswith("OK")

    def status(self) -> dict | None:
        r = self._cmd("S")
        if not r or not r.startswith("S,"):
            return None
        _, armed, fault, pan, tilt, moving = r.split(",")
        return dict(armed=armed == "1", fault=int(fault), pan=int(pan) / 100,
                    tilt=int(tilt) / 100, moving=moving == "1")

    def wait_settled(self, timeout: float = 1.0) -> bool:
        t0 = time.time()
        while time.time() - t0 < timeout:
            s = self.status()
            if s and not s["moving"]:
                return True
            time.sleep(0.02)
        return False

    def close(self):
        self._hb_stop.set()
        try:
            self.pointer(False)
            self.arm(False)
        finally:
            self.ser.close()


if __name__ == "__main__":
    # Wokwi seri monitörüne elle yazmak için çerçeve üretici:
    #   python -m flylaser.turret "M,1000,-500" "A,1" "F,40,255"
    import sys
    for body in sys.argv[1:] or ["H", "C", "A,1", "A,0", "M,0,0", "M,1000,-500", "P,1", "P,0", "F,40,255", "S"]:
        print(frame(body).decode().strip())
