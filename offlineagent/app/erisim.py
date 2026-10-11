"""Telefondan (yerel ağdan) erişim: şifre, oturum jetonu ve hatalı deneme sınırı.

Bu bilgisayardan (127.0.0.1) gelen istekler şifre istemez. Ağdaki diğer cihazlar önce şifreyle
giriş yapar; ajan modu, klasör açma ve ayarlar onlara kapalıdır.
"""
import hashlib
import hmac
import json
import secrets
import socket
import threading
import time

from ayarlar import KOK

DEPO = KOK / "veri" / "erisim.json"
JETON_OMRU = 30 * 24 * 3600
JETON_CEREZI = "oa_jeton"
MAKS_HATA = 8
HATA_PENCERESI = 10 * 60

_kilit = threading.Lock()
_hatalar: dict[str, list[float]] = {}


def _oku() -> dict:
    try:
        return json.loads(DEPO.read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def _ozet(sifre: str, tuz: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", sifre.encode("utf-8"), bytes.fromhex(tuz), 200_000).hex()


def sifre_var() -> bool:
    return bool(_oku().get("ozet"))


def sifre_belirle(sifre: str) -> None:
    if len(sifre) < 6:
        raise ValueError("Şifre en az 6 karakter olmalı.")
    tuz = secrets.token_hex(16)
    veri = {"tuz": tuz, "ozet": _ozet(sifre, tuz), "gizli": secrets.token_hex(32)}  # yeni gizli: eski oturumlar düşer
    DEPO.parent.mkdir(parents=True, exist_ok=True)
    DEPO.write_text(json.dumps(veri), "utf-8")


def sifre_dogru(sifre: str) -> bool:
    veri = _oku()
    return bool(veri.get("ozet")) and hmac.compare_digest(_ozet(sifre, veri["tuz"]), veri["ozet"])


def kilitli(ip: str) -> bool:
    with _kilit:
        simdi = time.time()
        _hatalar[ip] = [t for t in _hatalar.get(ip, []) if simdi - t < HATA_PENCERESI]
        return len(_hatalar[ip]) >= MAKS_HATA


def hata_kaydet(ip: str) -> None:
    with _kilit:
        _hatalar.setdefault(ip, []).append(time.time())


def jeton_uret() -> str:
    zaman = str(int(time.time()))
    imza = hmac.new(bytes.fromhex(_oku()["gizli"]), zaman.encode(), hashlib.sha256).hexdigest()
    return f"{zaman}.{imza}"


def jeton_gecerli(jeton: str | None) -> bool:
    gizli = _oku().get("gizli")
    if not jeton or not gizli or "." not in jeton:
        return False
    zaman, imza = jeton.split(".", 1)
    beklenen = hmac.new(bytes.fromhex(gizli), zaman.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(imza, beklenen) and zaman.isdigit() and time.time() - int(zaman) < JETON_OMRU


def yerel_ipler() -> list[str]:
    """Bu bilgisayarın yerel ağ adresleri (telefonda yazılacak adres için)."""
    ipler = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # paket gönderilmez; sadece çıkış arayüzü seçilir
            ipler.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in ipler and not ip.startswith("127."):
                ipler.append(ip)
    except OSError:
        pass
    return ipler
