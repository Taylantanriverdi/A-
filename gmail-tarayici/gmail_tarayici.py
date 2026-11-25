#!/usr/bin/env python3
"""Gmail Tarayıcı - Gmail'e gelen mailleri tarar, şüpheli olanları puanlar ve raporlar."""

import argparse
import base64
import csv
import html
import json
import os
import re
import sys
import time
from email.utils import parseaddr
from html.parser import HTMLParser
from urllib.parse import urlparse

KLASOR = os.path.dirname(os.path.abspath(__file__))
OKUMA_IZNI = ["https://www.googleapis.com/auth/gmail.readonly"]
DEGISTIRME_IZNI = ["https://www.googleapis.com/auth/gmail.modify"]

TEHLIKELI_UZANTILAR = {
    ".exe", ".scr", ".bat", ".cmd", ".com", ".pif", ".js", ".jse", ".vbs", ".vbe",
    ".wsf", ".hta", ".msi", ".jar", ".ps1", ".lnk", ".iso", ".img", ".docm",
    ".xlsm", ".pptm", ".apk",
}
KISALTICILAR = {"bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "cutt.ly", "rebrand.ly", "shorturl.at"}
MARKALAR = ["paypal", "apple", "microsoft", "google", "amazon", "netflix", "instagram",
            "facebook", "e-devlet", "edevlet", "ptt", "garanti", "akbank", "ziraat",
            "yapı kredi", "yapikredi", "iş bankası", "isbank", "trendyol", "hepsiburada"]


# --------------------------------------------------------------------------- yardımcılar
def ayarlari_yukle(yol):
    with open(yol, encoding="utf-8") as f:
        return json.load(f)


def ana_alan_adi(alan):
    """'mail.ornek.com.tr' -> 'ornek.com.tr', 'a.b.example.com' -> 'example.com'"""
    alan = (alan or "").lower().strip(".").split(":")[0]
    parcalar = alan.split(".")
    if len(parcalar) >= 3 and parcalar[-2] in {"com", "net", "org", "gov", "edu", "co", "gen", "bel", "k12"}:
        return ".".join(parcalar[-3:])
    return ".".join(parcalar[-2:])


def tr_kucuk(metin):
    """Türkçe uyumlu küçük harf: 'İ'->'i', 'I'->'ı'."""
    return metin.replace("İ", "i").replace("I", "ı").lower()


def adres_alan_adi(adres):
    return ana_alan_adi(adres.rsplit("@", 1)[-1]) if "@" in adres else ""


class LinkToplayici(HTMLParser):
    def __init__(self):
        super().__init__()
        self.linkler, self._href, self._metin = [], None, []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self._href, self._metin = dict(attrs).get("href"), []

    def handle_data(self, data):
        if self._href is not None:
            self._metin.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            self.linkler.append((self._href, "".join(self._metin).strip()))
            self._href = None


def govdeyi_coz(veri):
    return base64.urlsafe_b64decode(veri.encode()).decode("utf-8", errors="replace") if veri else ""


def parcalari_gez(parca, metin, html_parcalar, ekler):
    mime = parca.get("mimeType", "")
    dosya = parca.get("filename")
    govde = parca.get("body", {})
    if dosya:
        ekler.append(dosya)
    elif mime == "text/plain":
        metin.append(govdeyi_coz(govde.get("data")))
    elif mime == "text/html":
        html_parcalar.append(govdeyi_coz(govde.get("data")))
    for alt in parca.get("parts", []) or []:
        parcalari_gez(alt, metin, html_parcalar, ekler)


# --------------------------------------------------------------------------- analiz
def maili_analiz_et(mesaj, ayarlar):
    """Gmail API 'full' formatındaki mesajı analiz eder, sonuç sözlüğü döndürür."""
    yuk = mesaj.get("payload", {})
    basliklar = {b["name"].lower(): b["value"] for b in yuk.get("headers", [])}
    gonderen_ham = basliklar.get("from", "")
    gorunen_ad, gonderen = parseaddr(gonderen_ham)
    gonderen = gonderen.lower()
    gonderen_alan = adres_alan_adi(gonderen)
    konu = basliklar.get("subject", "(konu yok)")

    metin, html_parcalar, ekler = [], [], []
    parcalari_gez(yuk, metin, html_parcalar, ekler)
    html_icerik = "\n".join(html_parcalar)
    duz_metin = "\n".join(metin) or re.sub(r"<[^>]+>", " ", html.unescape(html_icerik))
    tum_metin = tr_kucuk(f"{konu}\n{duz_metin}")

    puan, nedenler = 0, []

    def ekle(p, neden):
        nonlocal puan
        puan += p
        nedenler.append(f"{neden} (+{p})")

    guvenilir = {d.lower() for d in ayarlar.get("guvenilir_alan_adlari", [])}

    # 1) Kimlik doğrulama
    dogrulama = basliklar.get("authentication-results", "").lower()
    for proto in ("spf", "dkim", "dmarc"):
        if re.search(rf"\b{proto}=(fail|softfail|permerror)", dogrulama):
            ekle(25 if proto == "dmarc" else 15, f"{proto.upper()} başarısız")

    # 2) Reply-To farklı alan adı
    _, yanit = parseaddr(basliklar.get("reply-to", ""))
    if yanit and adres_alan_adi(yanit.lower()) != gonderen_alan:
        ekle(15, f"Reply-To farklı: {yanit}")

    # 3) Görünen ad sahteciliği
    ad = gorunen_ad.lower()
    ad_eposta = re.search(r"[\w.+-]+@([\w-]+\.[\w.-]+)", ad)
    if ad_eposta and ana_alan_adi(ad_eposta.group(1)) != gonderen_alan:
        ekle(25, "Görünen adda başka e-posta adresi var")
    for marka in MARKALAR:
        if marka in ad and marka.replace(" ", "").replace("-", "").replace("ı", "i") not in gonderen_alan:
            ekle(20, f"'{marka}' adına gönderilmiş ama alan adı {gonderen_alan}")
            break

    # 4) Linkler
    toplayici = LinkToplayici()
    try:
        toplayici.feed(html_icerik)
    except Exception:
        pass
    linkler = toplayici.linkler + [(u, "") for u in re.findall(r"https?://[^\s<>\"')]+", duz_metin)]
    link_bayraklari = set()
    for href, gorunen in linkler:
        host = (urlparse(href).hostname or "").lower()
        if not host:
            continue
        if re.fullmatch(r"[\d.]+", host) and "ip" not in link_bayraklari:
            link_bayraklari.add("ip"); ekle(25, f"IP adresli link: {host}")
        if host in KISALTICILAR and "kisa" not in link_bayraklari:
            link_bayraklari.add("kisa"); ekle(10, f"Kısaltılmış link: {host}")
        if host.startswith("xn--") or ".xn--" in host:
            if "puny" not in link_bayraklari:
                link_bayraklari.add("puny"); ekle(20, f"Punycode (taklit) alan adı: {host}")
        m = re.search(r"(?:https?://)?([\w-]+(?:\.[\w-]+)+)", gorunen)
        if m and "." in m.group(1) and ana_alan_adi(m.group(1)) != ana_alan_adi(host):
            if "uyusmaz" not in link_bayraklari:
                link_bayraklari.add("uyusmaz")
                ekle(30, f"Link metni '{m.group(1)}' ama gerçek adres '{host}'")

    # 5) Ekler
    for ek in ekler:
        uzanti = os.path.splitext(ek.lower())[1]
        if uzanti in TEHLIKELI_UZANTILAR:
            ekle(35, f"Tehlikeli ek: {ek}")
        elif re.search(r"\.(pdf|docx?|xlsx?|jpg)\.\w+$", ek.lower()):
            ekle(30, f"Çift uzantılı ek: {ek}")

    # 6) Anahtar kelimeler
    eslesen_kelimeler = []
    for kelime, p in ayarlar.get("anahtar_kelimeler", {}).items():
        if tr_kucuk(kelime) in tum_metin or kelime.lower() in tum_metin.replace("ı", "i"):
            eslesen_kelimeler.append(kelime)
            if p:
                ekle(p, f"Anahtar kelime: '{kelime}'")

    # 7) Listeler
    if gonderen in [g.lower() for g in ayarlar.get("engelli_gonderenler", [])] or \
            gonderen_alan in [g.lower() for g in ayarlar.get("engelli_gonderenler", [])]:
        ekle(100, "Engelli gönderici")
    izlenen = gonderen in [g.lower() for g in ayarlar.get("izlenen_gonderenler", [])]

    if gonderen_alan in guvenilir and not any("başarısız" in n for n in nedenler):
        puan = min(puan, ayarlar.get("supheli_esik_puani", 40) - 1)

    esik = ayarlar.get("supheli_esik_puani", 40)
    return {
        "id": mesaj.get("id"),
        "tarih": basliklar.get("date", ""),
        "gonderen": gonderen_ham,
        "konu": konu,
        "puan": puan,
        "durum": "ŞÜPHELİ" if puan >= esik else ("DİKKAT" if puan >= esik / 2 else "TEMİZ"),
        "nedenler": nedenler,
        "anahtar_kelimeler": eslesen_kelimeler,
        "ekler": ekler,
        "izlenen": izlenen,
        "ozet": mesaj.get("snippet", ""),
    }


# --------------------------------------------------------------------------- Gmail
def gmail_servisi(hesap, yazma):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    izinler = DEGISTIRME_IZNI if yazma else OKUMA_IZNI
    token_yolu = os.path.join(KLASOR, f"token_{hesap}.json")
    kimlik = None
    if os.path.exists(token_yolu):
        kimlik = Credentials.from_authorized_user_file(token_yolu)
        if not set(izinler).issubset(set(kimlik.scopes or [])):
            kimlik = None  # yeni izin gerekiyor, tekrar giriş
    if kimlik and kimlik.expired and kimlik.refresh_token:
        try:
            kimlik.refresh(Request())
        except Exception:
            kimlik = None
    if not kimlik or not kimlik.valid:
        cred_yolu = os.path.join(KLASOR, "credentials.json")
        if not os.path.exists(cred_yolu):
            sys.exit("HATA: credentials.json bulunamadı. README.md'deki kurulum adımlarını izleyin.")
        akis = InstalledAppFlow.from_client_secrets_file(cred_yolu, izinler)
        kimlik = akis.run_local_server(port=0)
        with open(token_yolu, "w") as f:
            f.write(kimlik.to_json())
    return build("gmail", "v1", credentials=kimlik, cache_discovery=False)


def mesaj_idlerini_getir(servis, sorgu, limit):
    idler, sayfa = [], None
    while len(idler) < limit:
        cevap = servis.users().messages().list(
            userId="me", q=sorgu, maxResults=min(100, limit - len(idler)), pageToken=sayfa).execute()
        idler += [m["id"] for m in cevap.get("messages", [])]
        sayfa = cevap.get("nextPageToken")
        if not sayfa:
            break
    return idler


def etiket_id(servis, ad, onbellek={}):
    if ad in onbellek:
        return onbellek[ad]
    for e in servis.users().labels().list(userId="me").execute().get("labels", []):
        if e["name"] == ad:
            onbellek[ad] = e["id"]
            return e["id"]
    yeni = servis.users().labels().create(userId="me", body={
        "name": ad, "labelListVisibility": "labelShow", "messageListVisibility": "show"}).execute()
    onbellek[ad] = yeni["id"]
    return yeni["id"]


# --------------------------------------------------------------------------- çıktı
RENK = {"ŞÜPHELİ": "\033[91m", "DİKKAT": "\033[93m", "TEMİZ": "\033[92m"}
SIFIR = "\033[0m"


def sonucu_yazdir(s):
    renk = RENK[s["durum"]] if sys.stdout.isatty() else ""
    sifir = SIFIR if renk else ""
    isaret = " ★ İZLENEN" if s["izlenen"] else ""
    print(f"{renk}[{s['durum']:7}] {s['puan']:>3} puan{sifir}{isaret}  {s['gonderen'][:50]}")
    print(f"           Konu: {s['konu'][:90]}")
    for n in s["nedenler"]:
        print(f"             - {n}")
    if s["ekler"]:
        print(f"             Ekler: {', '.join(s['ekler'])}")


def csv_yaz(yol, sonuclar):
    yeni = not os.path.exists(yol)
    with open(yol, "a", newline="", encoding="utf-8-sig") as f:
        y = csv.writer(f, delimiter=";")
        if yeni:
            y.writerow(["id", "tarih", "gonderen", "konu", "durum", "puan", "nedenler", "anahtar_kelimeler", "ekler"])
        for s in sonuclar:
            y.writerow([s["id"], s["tarih"], s["gonderen"], s["konu"], s["durum"], s["puan"],
                        " | ".join(s["nedenler"]), ", ".join(s["anahtar_kelimeler"]), ", ".join(s["ekler"])])


# --------------------------------------------------------------------------- ana akış
def tara(servis, ayarlar, args, islenmis):
    idler = [i for i in mesaj_idlerini_getir(servis, args.sorgu, args.limit) if i not in islenmis]
    sonuclar = []
    for mid in idler:
        try:
            mesaj = servis.users().messages().get(userId="me", id=mid, format="full").execute()
        except Exception as h:
            print(f"Uyarı: {mid} okunamadı: {h}")
            continue
        s = maili_analiz_et(mesaj, ayarlar)
        sonuclar.append(s)
        islenmis.add(mid)
        if not args.sadece_supheli or s["durum"] != "TEMİZ":
            sonucu_yazdir(s)
        if args.etiketle:
            ekle = [etiket_id(servis, ayarlar["taranan_etiketi"])]
            if s["durum"] == "ŞÜPHELİ":
                ekle.append(etiket_id(servis, ayarlar["supheli_etiketi"]))
            servis.users().messages().modify(userId="me", id=mid, body={"addLabelIds": ekle}).execute()
    if args.csv and sonuclar:
        csv_yaz(args.csv, sonuclar)
    return sonuclar


def ozet_yazdir(sonuclar):
    say = {d: sum(1 for s in sonuclar if s["durum"] == d) for d in ("ŞÜPHELİ", "DİKKAT", "TEMİZ")}
    print(f"\nTaranan: {len(sonuclar)}  |  Şüpheli: {say['ŞÜPHELİ']}  |  Dikkat: {say['DİKKAT']}  |  Temiz: {say['TEMİZ']}")


def main():
    p = argparse.ArgumentParser(description="Gmail'e gelen mailleri tarar ve şüpheli olanları bulur.")
    p.add_argument("--hesap", default="varsayilan", help="Hesap adı (her hesap için ayrı oturum saklanır)")
    p.add_argument("--ayarlar", default=os.path.join(KLASOR, "ayarlar.json"))
    p.add_argument("--sorgu", help="Gmail arama sorgusu (örn: 'is:unread newer_than:1d')")
    p.add_argument("--limit", type=int, help="En fazla taranacak mail sayısı")
    p.add_argument("--izle", action="store_true", help="Sürekli çalış, yeni mailleri tara")
    p.add_argument("--csv", help="Sonuçları bu CSV dosyasına ekle")
    p.add_argument("--etiketle", action="store_true", help="Gmail'de etiket uygula (gmail.modify izni ister)")
    p.add_argument("--sadece-supheli", action="store_true", help="Temiz mailleri ekrana yazma")
    args = p.parse_args()

    ayarlar = ayarlari_yukle(args.ayarlar)
    args.sorgu = args.sorgu or ayarlar.get("sorgu", "in:inbox newer_than:7d")
    args.limit = args.limit or ayarlar.get("en_fazla_mail", 200)
    args.etiketle = args.etiketle or ayarlar.get("etiket_uygula", False)

    servis = gmail_servisi(args.hesap, args.etiketle)
    adres = servis.users().getProfile(userId="me").execute().get("emailAddress")
    print(f"Hesap: {adres}  |  Sorgu: {args.sorgu}\n")

    durum_yolu = os.path.join(KLASOR, f"durum_{args.hesap}.json")
    islenmis = set()
    if args.izle and os.path.exists(durum_yolu):
        with open(durum_yolu) as f:
            islenmis = set(json.load(f))

    if not args.izle:
        ozet_yazdir(tara(servis, ayarlar, args, islenmis))
        return

    aralik = ayarlar.get("izleme_araligi_saniye", 60)
    print(f"İzleme modu: her {aralik} sn'de kontrol ediliyor. Durdurmak için Ctrl+C.\n")
    try:
        while True:
            yeni = tara(servis, ayarlar, args, islenmis)
            if yeni:
                ozet_yazdir(yeni)
            with open(durum_yolu, "w") as f:
                json.dump(sorted(islenmis)[-5000:], f)
            time.sleep(aralik)
    except KeyboardInterrupt:
        print("\nİzleme durduruldu.")


if __name__ == "__main__":
    main()
