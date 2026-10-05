#!/usr/bin/env bash
# macOS / Linux başlatıcı
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "İlk kurulum yapılıyor..."
  python3 -m venv .venv
  .venv/bin/python -m pip install -q -r requirements.txt
fi
exec .venv/bin/python asistan.py "$@"
