#!/usr/bin/env bash
# Primer Lab — tek zip teslim paketi.
#
# Kullanım:  ./paket_olustur.sh V10 [cikti_klasoru]
#
# 1. Ana kaynakları (PrimerLabV2_Kaynak + PrimerLabV2_Paket/Pages + DB şeması)
#    kurulum klasöründeki kopyaya eşitler (kurulum klasörü hep güncel kalır).
# 2. Sürüm bilgisini YeniBilgisayarKurulumu/SURUM.txt dosyasına yazar.
# 3. Tüm yazılımı tek bir zipte toplar:  PrimerLab_TumYazilim_<SURUM>.zip
#    (yeni bilgisayara kurulum, güncelleme, internet portalı ve tüm kaynak kod).
#
# Bu zip hem yeni kurulumda (KURULUM.bat) hem güncellemede (PrimerLab_Guncelle.bat)
# kullanılır; ayrı paket yoktur.
set -euo pipefail

SURUM="${1:?Sürüm adı gerekli, ör: ./paket_olustur.sh V10}"
KOK="$(cd "$(dirname "$0")" && pwd)"
CIKTI="${2:-$KOK/dagitim}"
KIT="$KOK/YeniBilgisayarKurulumu"
HEDEF="$KIT/kaynak/PrimerLabV2"
AD="PrimerLab_TumYazilim_${SURUM}"

# 1) Kaynak eşitleme (csproj ve appsettings.json kurulum klasörüne özeldir, dokunulmaz)
esitle() { rm -rf "$2"; cp -r "$1" "$2"; }
for d in Controllers Data Infrastructure Migrations Models Tools; do
    esitle "$KOK/PrimerLabV2_Kaynak/$d" "$HEDEF/$d"
done
cp "$KOK/PrimerLabV2_Kaynak/Program.cs" "$HEDEF/Program.cs"
esitle "$KOK/PrimerLabV2_Paket/PrimerLabV2/Pages" "$HEDEF/Pages"
cp "$KOK/PrimerLabV2_Kaynak/DB/V33_TAM_KURULUM_SEMA.sql" "$KIT/kaynak/DB/V33_TAM_KURULUM_SEMA.sql"

# .bat dosyaları Windows için ASCII + CRLF olmalı (aksi halde komutlar bozulur)
for b in "$KIT"/*.bat; do
    if LC_ALL=C grep -q $'[\x80-\xff]' "$b"; then echo "HATA: $b ASCII değil" >&2; exit 1; fi
    if grep -qv $'\r$' "$b"; then echo "HATA: $b CRLF değil" >&2; exit 1; fi
done

# 2) Sürüm dosyası
printf 'Primer Lab %s\r\nPaket tarihi: %s\r\n' "$SURUM" "$(date +%Y-%m-%d)" > "$KIT/SURUM.txt"

# 3) Zip
GECICI="$(mktemp -d)"
trap 'rm -rf "$GECICI"' EXIT
mkdir -p "$CIKTI"
cp -r "$KIT" "$GECICI/$AD"
find "$GECICI/$AD" -type d \( -name bin -o -name obj \) -prune -exec rm -rf {} +
rm -f "$CIKTI/$AD.zip"
(cd "$GECICI" && zip -qr "$CIKTI/$AD.zip" "$AD")

echo "$CIKTI/$AD.zip"
unzip -l "$CIKTI/$AD.zip" | tail -1
