#!/usr/bin/env bash
# Tüm çıktıları sırayla yeniden üretir:
#   SIMULASYON.html -> belge/gorseller/*.jpg -> ROBOT_KOL_KILAVUZ.pdf -> ROBOT_KOL_KURULUM_V<n>.bat
set -euo pipefail
cd "$(dirname "$0")"
( cd simulasyon && { [ -d node_modules ] || npm install --no-audit --no-fund; } && node derle.mjs )
node belge/gorsel_uret.mjs
python3 belge/kilavuz_olustur.py
./kurulum/bat_olustur.sh
