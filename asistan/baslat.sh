#!/usr/bin/env bash
# macOS / Linux başlatıcı: günceller ve asistanı açar.
# Her şey bir fonksiyonun içinde: bash fonksiyonu baştan okur, böylece
# güncelleyici bu dosyayı çalışırken değiştirse bile sorun çıkmaz.
main() {
  cd "$(dirname "$0")" || exit 1
  if [ ! -x .venv/bin/python ]; then
    echo "İlk kurulum yapılıyor, biraz sürebilir..."
    python3 -m venv .venv || { echo "Python bulunamadı. Önce kurulum.sh dosyasını çalıştır."; exit 1; }
    .venv/bin/python -m pip install -q --disable-pip-version-check -r requirements.txt
  fi
  # kurulum.sh API anahtarını buraya kaydeder
  [ -f anahtar.env ] && . ./anahtar.env
  .venv/bin/python guncelle.py
  .venv/bin/python asistan.py "$@"
}
main "$@"
exit $?
