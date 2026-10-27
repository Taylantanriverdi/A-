#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Acil-acma sifresinin SHA-256 ozetini uretir ve config.json'a yazar.
Kullanim:
    python set_password.py
"""
import json
import os
import hashlib
import getpass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")


def main():
    pw1 = getpass.getpass("Yeni acil-acma sifresi: ")
    pw2 = getpass.getpass("Tekrar: ")
    if pw1 != pw2:
        print("Sifreler eslesmedi.")
        return
    if not pw1:
        print("Bos sifre olmaz.")
        return
    digest = hashlib.sha256(pw1.encode("utf-8")).hexdigest()

    config = {}
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
    config["emergency_password_sha256"] = digest
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print(f"Sifre ozeti config.json'a yazildi: {CONFIG_PATH}")


if __name__ == "__main__":
    main()
