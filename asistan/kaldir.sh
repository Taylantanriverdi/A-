#!/usr/bin/env bash
# Kişisel Asistan - macOS / Linux kaldırma
HEDEF="$HOME/.kisisel-asistan"
echo "Kişisel Asistan kaldırılacak: $HEDEF ve kısayolları (API anahtarı dahil)."
read -r -p "Devam edilsin mi? [e/H] " cevap
case "$cevap" in e|E|evet) ;; *) exit 0 ;; esac
rm -rf "$HEDEF"
rm -f "$HOME/Desktop/Kisisel Asistan.command" \
      "$HOME/Desktop/kisisel-asistan.desktop" \
      "$HOME/.local/share/applications/kisisel-asistan.desktop"
echo "Kaldırma tamamlandı."
