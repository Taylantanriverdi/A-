"""Claude kullanım limiti mesajlarını tanır ve limitin ne zaman sıfırlanacağını hesaplar.

Claude Code limit dolduğunda farklı biçimlerde mesaj verebilir, örneğin:
    "Claude AI usage limit reached|1759590000"
    "You've hit your limit · resets 3pm (Europe/Istanbul)"
    "5-hour limit reached ∙ resets 2:30pm"
    "Weekly limit reached · resets Oct 9, 10am"
    "Usage limit reached. Resets in 2h 15m."
Sıfırlanma zamanı okunamazsa None döner; çağıran taraf belirli aralıklarla yeniden dener.
"""

from __future__ import annotations

import datetime as dt
import re

LIMIT_KALIPLARI = re.compile(
    r"usage limit|hit your limit|limit reached|limit will reset|rate limit|out of (extra )?usage|"
    r"quota exceeded|too many requests",
    re.IGNORECASE,
)

AYLAR = {a: i for i, a in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}


def limit_mesaji_mi(metin: str, http_durumu: int | None = None) -> bool:
    return http_durumu == 429 or bool(LIMIT_KALIPLARI.search(metin or ""))


def _saat_dilimi(ad: str | None):
    if not ad:
        return None
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(ad.strip())
    except Exception:  # Windows'ta tzdata yoksa yerel saate düşeriz
        return None


def _saat_24(saat: int, ogleden: str | None) -> int:
    if ogleden:
        ogleden = ogleden.lower()
        if ogleden == "pm" and saat != 12:
            return saat + 12
        if ogleden == "am" and saat == 12:
            return 0
    return saat


def sifirlanma_zamani(metin: str, simdi: dt.datetime | None = None) -> dt.datetime | None:
    """Mesajdan sıfırlanma anını (saat dilimli datetime) çıkarır."""
    if not metin:
        return None
    simdi = simdi or dt.datetime.now().astimezone()

    # 1) "...|1759590000" (Unix zamanı)
    m = re.search(r"\|\s*(\d{10})\b", metin) or re.search(r"reset\w*\D{0,20}(\d{10})\b", metin, re.I)
    if m:
        return dt.datetime.fromtimestamp(int(m.group(1))).astimezone()

    # 2) "resets in 2h 15m" / "in 45 minutes"
    m = re.search(r"resets?\s+in\s+(?:(\d+)\s*h\w*)?\s*(?:(\d+)\s*m\w*)?", metin, re.I)
    if m and (m.group(1) or m.group(2)):
        return simdi + dt.timedelta(hours=int(m.group(1) or 0), minutes=int(m.group(2) or 0))

    # 3) "resets Oct 9, 10am (Europe/Istanbul)"
    m = re.search(
        r"resets?\s+(?:at\s+|on\s+)?([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?"
        r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?",
        metin, re.I,
    )
    if m and m.group(1).lower()[:3] in AYLAR:
        tz = _saat_dilimi(m.group(6)) or simdi.tzinfo
        yerel = simdi.astimezone(tz)
        ay, gun = AYLAR[m.group(1).lower()[:3]], int(m.group(2))
        saat, dakika = _saat_24(int(m.group(3)), m.group(5)), int(m.group(4) or 0)
        aday = yerel.replace(month=ay, day=gun, hour=saat, minute=dakika, second=0, microsecond=0)
        if aday < yerel - dt.timedelta(days=1):
            aday = aday.replace(year=aday.year + 1)
        return aday

    # 4) "resets 3pm" / "resets at 14:30 (Europe/Istanbul)"
    m = re.search(r"resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?", metin, re.I)
    if m and (m.group(2) or m.group(3)):
        tz = _saat_dilimi(m.group(4)) or simdi.tzinfo
        yerel = simdi.astimezone(tz)
        saat, dakika = _saat_24(int(m.group(1)), m.group(3)), int(m.group(2) or 0)
        aday = yerel.replace(hour=saat, minute=dakika, second=0, microsecond=0)
        if aday <= yerel:
            aday += dt.timedelta(days=1)
        return aday

    return None
