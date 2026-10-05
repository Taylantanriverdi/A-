#!/usr/bin/env bash
# Kişisel Asistan - macOS / Linux kurulumu
# Kullanım:  bash kurulum.sh
main() {
  set -e
  DEPO="Taylantanriverdi/A-"
  DAL="${ASISTAN_DAL:-main}"
  HEDEF="$HOME/.kisisel-asistan"
  ISLETIM="$(uname -s)"

  echo "=================================================="
  echo "   Kişisel Asistan - Kurulum"
  echo "=================================================="
  echo "Kurulum klasörü: $HEDEF"
  echo

  # 1) Python
  echo "[1/5] Python kontrol ediliyor..."
  PY=""
  for aday in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$aday" >/dev/null 2>&1 && \
       "$aday" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
      PY="$(command -v "$aday")"; break
    fi
  done
  if [ -z "$PY" ]; then
    if [ "$ISLETIM" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
      echo "     Python kuruluyor (Homebrew)..."
      brew install python@3.12 python-tk@3.12
      PY="$(brew --prefix)/bin/python3.12"
    elif [ "$ISLETIM" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then
      echo "     Python kuruluyor (şifren istenebilir)..."
      sudo apt-get update -qq && sudo apt-get install -y python3 python3-venv python3-tk python3-dev xclip
      PY="$(command -v python3)"
    else
      echo "HATA: Python 3.10+ bulunamadı. https://www.python.org/downloads/ adresinden kurup tekrar dene."
      exit 1
    fi
  fi
  if [ "$ISLETIM" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then
    eksik=""
    for paket in python3-venv python3-tk python3-dev xclip; do
      dpkg -s "$paket" >/dev/null 2>&1 || eksik="$eksik $paket"
    done
    if [ -n "$eksik" ]; then
      echo "     Eksik sistem paketleri kuruluyor:$eksik (şifren istenebilir)"
      sudo apt-get install -y $eksik
    fi
  fi
  echo "     Python hazır: $PY"

  # 2) Dosyalar
  echo "[2/5] Asistan dosyaları hazırlanıyor..."
  mkdir -p "$HEDEF"
  KAYNAK="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
  if [ -f "$KAYNAK/asistan.py" ] && [ "$KAYNAK" != "$HEDEF" ]; then
    # ZIP'ten çıkarılmış klasörden çalışıyor: dosyaları oradan kopyala.
    cp "$KAYNAK"/*.py "$KAYNAK"/*.sh "$KAYNAK"/*.bat "$KAYNAK"/*.txt "$KAYNAK"/*.md "$HEDEF"/ 2>/dev/null || true
    chmod +x "$HEDEF"/*.sh
  else
    curl -fsSL "https://raw.githubusercontent.com/$DEPO/$DAL/asistan/guncelle.py" -o "$HEDEF/guncelle.py"
  fi
  "$PY" "$HEDEF/guncelle.py"
  [ -f "$HEDEF/asistan.py" ] || { echo "HATA: Dosyalar indirilemedi. İnternet bağlantını kontrol et."; exit 1; }

  # 3) Kütüphaneler
  echo "[3/5] Gerekli kütüphaneler kuruluyor..."
  [ -x "$HEDEF/.venv/bin/python" ] || "$PY" -m venv "$HEDEF/.venv"
  "$HEDEF/.venv/bin/python" -m pip install -q --disable-pip-version-check --upgrade pip
  "$HEDEF/.venv/bin/python" -m pip install -q --disable-pip-version-check -r "$HEDEF/requirements.txt"

  # 4) API anahtarı
  echo "[4/5] API anahtarı..."
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    echo "     Kayıtlı bir API anahtarı bulundu."
  else
    echo "     Anahtarını https://console.anthropic.com adresinden 'API Keys' bölümünde oluşturabilirsin."
    ANAHTAR=""
    while [ -z "$ANAHTAR" ]; do
      read -r -p "     API anahtarını yapıştır ve Enter'a bas: " ANAHTAR </dev/tty
    done
    # Anahtar sadece bu kullanıcının okuyabileceği bir dosyada saklanır.
    ( umask 077; printf 'export ANTHROPIC_API_KEY=%q\n' "$ANAHTAR" > "$HEDEF/anahtar.env" )
    export ANTHROPIC_API_KEY="$ANAHTAR"
    echo "     Anahtar kaydedildi."
  fi

  # 5) Kısayol
  echo "[5/5] Kısayol oluşturuluyor..."
  if [ "$ISLETIM" = "Darwin" ]; then
    KISAYOL="$HOME/Desktop/Kisisel Asistan.command"
    printf '#!/bin/bash\nexec "%s/baslat.sh"\n' "$HEDEF" > "$KISAYOL"
    chmod +x "$KISAYOL"
    echo "     Masaüstüne 'Kisisel Asistan' eklendi."
    echo
    echo "ÖNEMLİ (macOS): Sistem Ayarları > Gizlilik ve Güvenlik altında Terminal'e"
    echo "'Erişilebilirlik' ve 'Ekran Kaydı' izni ver, sonra Terminal'i yeniden başlat."
  else
    mkdir -p "$HOME/.local/share/applications"
    cat > "$HOME/.local/share/applications/kisisel-asistan.desktop" <<MASAUSTU
[Desktop Entry]
Type=Application
Name=Kişisel Asistan
Comment=Bilgisayarını kullanan yapay zeka asistanı
Exec="$HEDEF/baslat.sh"
Icon=computer
Terminal=true
Categories=Utility;
MASAUSTU
    if [ -d "$HOME/Desktop" ]; then
      cp "$HOME/.local/share/applications/kisisel-asistan.desktop" "$HOME/Desktop/"
      chmod +x "$HOME/Desktop/kisisel-asistan.desktop"
    fi
    echo "     Uygulama menüsüne 'Kişisel Asistan' eklendi."
  fi

  echo
  echo "=================================================="
  echo "   Kurulum tamamlandı!"
  echo "   Başlatmak için: $HEDEF/baslat.sh"
  echo "   Her açılışta en yeni sürüme otomatik güncellenir."
  echo "=================================================="
  read -r -p "Şimdi başlatılsın mı? [E/h] " cevap </dev/tty || cevap="h"
  case "$cevap" in
    h|H|hayır|n|N) exit 0 ;;
    *) exec "$HEDEF/baslat.sh" ;;
  esac
}
main "$@"
exit $?
