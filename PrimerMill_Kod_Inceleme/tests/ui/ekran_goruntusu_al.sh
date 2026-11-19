#!/usr/bin/env bash
# PrimerMill 2 arayüzünün ekran görüntülerini Mono + Xvfb ile üretir (yalnız geliştirme).
# Gerekenler: mono-complete (mcs), xvfb (xvfb-run), fonts-dejavu.
# Kullanım: tests/ui/ekran_goruntusu_al.sh [çıktı klasörü] [dosya adı süzgeci (regex)]
set -euo pipefail
KOK="$(cd "$(dirname "$0")/../.." && pwd)"
CIKIS="${1:-$KOK/teslim/ekran_goruntuleri}"
DERLE="$(mktemp -d)"
trap 'rm -rf "$DERLE"' EXIT
cd "$KOK"
mcs -langversion:5 -nowarn:219,414 -r:System.Windows.Forms -r:System.Drawing -r:System.Core \
    -out:"$DERLE/EkranGoruntusu.exe" ui/PrimerUI.cs tests/ui/EkranGoruntusu.cs
mkdir -p "$CIKIS"
xvfb-run -a -s "-screen 0 1920x1080x24" mono "$DERLE/EkranGoruntusu.exe" "$CIKIS" ${2:+"$2"}
