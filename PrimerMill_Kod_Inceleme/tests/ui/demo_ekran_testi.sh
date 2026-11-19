#!/usr/bin/env bash
# PrimerMill 2 - teslimdeki bütün C# dosyalarının BİRLİKTE derlendiğini kanıtlar (Mono mcs, C# 5 = PowerShell 5.1 Add-Type sınırı).
# KazimaBaslat.ps1 ile aynı iki takım: demo (EdingSim.cs) ve makine (EdingApi.cs). Ayrıca her dosya tek başına -langversion:5.
# WinForms Linux'ta çalıştırılamadığı için panelin kendisi burada açılmaz: Windows'ta tests/Demo_Ekran_Testi.ps1.
# Kullanım: tests/ui/demo_ekran_testi.sh [teslim/PrimerMill]
set -euo pipefail
KOK="$(cd "$(dirname "$0")/../.." && pwd)"
T="${1:-$KOK/teslim/PrimerMill}"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
REF="-r:System.Windows.Forms -r:System.Drawing -r:System.Core"
ORTAK="$T/ui/PrimerVeri.cs $T/ui/PrimerUI.cs $T/lib/Kayit.cs $T/lib/NcAnaliz.cs $T/lib/SimGorunum.cs $T/lib/WebSunucu.cs $T/lib/EkranYakala.cs $T/lib/Pencere.cs"
hata=0
for takim in EdingSim EdingApi; do
  if mcs -langversion:5 -target:library -nowarn:414,219,169,649 $REF -out:"$OUT/$takim.dll" $ORTAK "$T/lib/$takim.cs" >"$OUT/$takim.txt" 2>&1; then
    echo "[GECTI] birlikte derleme: ui + lib + $takim.cs"
  else echo "[KALDI] birlikte derleme: ui + lib + $takim.cs"; cat "$OUT/$takim.txt"; hata=$((hata+1)); fi
done
for f in "$T"/lib/*.cs "$T"/ui/PrimerVeri.cs; do
  b="$(basename "$f")"
  ek=""; case "$b" in SimGorunum.cs) ek="$T/lib/NcAnaliz.cs";; esac
  if mcs -langversion:5 -target:library -nowarn:414,219,169,649 $REF -out:"$OUT/t.dll" "$f" $ek >"$OUT/t.txt" 2>&1; then echo "[GECTI] tek başına: $b"
  else echo "[KALDI] tek başına: $b"; cat "$OUT/t.txt"; hata=$((hata+1)); fi
done
# Görünüm dosyası kanonik kopyayla aynı mı
for f in PrimerUI.cs PrimerVeri.cs; do
  if cmp -s "$KOK/ui/$f" "$T/ui/$f"; then echo "[GECTI] teslim ui/$f = ui/$f"; else echo "[KALDI] teslim ui/$f kanonik kopyadan farklı"; hata=$((hata+1)); fi
done
if cmp -s "$KOK/lib/EdingSim.cs" "$T/lib/EdingSim.cs"; then echo "[GECTI] teslim lib/EdingSim.cs = lib/EdingSim.cs"; else echo "[KALDI] lib/EdingSim.cs farklı"; hata=$((hata+1)); fi
echo "SONUC demo ekran derleme: kaldi $hata"
exit $hata
