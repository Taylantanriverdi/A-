"""Proje işlemleri: git ve test komutu."""

from __future__ import annotations

import json
import os
import platform
import subprocess
from dataclasses import dataclass
from pathlib import Path


class GitHatasi(Exception):
    pass


def git(proje: Path, *args: str, kontrol: bool = True) -> str:
    r = subprocess.run(["git", *args], cwd=proje, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if kontrol and r.returncode != 0:
        raise GitHatasi(f"git {' '.join(args)}: {(r.stderr or r.stdout).strip()}")
    return r.stdout.strip()


def kirli_mi(proje: Path) -> bool:
    return bool(git(proje, "status", "--porcelain"))


def degisiklik_var_mi(proje: Path, baslangic: str) -> bool:
    return kirli_mi(proje) or git(proje, "rev-parse", "HEAD") != baslangic


def hepsini_commit_et(proje: Path, mesaj: str) -> bool:
    git(proje, "add", "-A")
    if not git(proje, "diff", "--cached", "--name-only"):
        return False
    git(proje, "commit", "-q", "-m", mesaj)
    return True


def geri_al(proje: Path, baslangic: str, yama_dosyasi: Path) -> None:
    """Görev başından beri yapılan her şeyi bir yama dosyasına kaydeder ve geri alır."""
    git(proje, "add", "-A")
    yama = git(proje, "diff", "--binary", baslangic, kontrol=False)
    if yama:
        yama_dosyasi.parent.mkdir(parents=True, exist_ok=True)
        yama_dosyasi.write_text(yama + "\n", encoding="utf-8")
    git(proje, "reset", "-q", "--hard", baslangic)
    git(proje, "clean", "-q", "-fd")  # yalnızca bu görevde oluşan, git'in izlemediği dosyalar


def test_komutunu_bul(proje: Path) -> str | None:
    """Yaygın proje türleri için test komutunu tahmin eder."""
    pkg = proje / "package.json"
    if pkg.exists():
        try:
            betikler = json.loads(pkg.read_text(encoding="utf-8")).get("scripts", {})
        except (json.JSONDecodeError, OSError):
            betikler = {}
        test = betikler.get("test", "")
        if test and "no test specified" not in test:
            yonetici = "pnpm" if (proje / "pnpm-lock.yaml").exists() else "yarn" if (proje / "yarn.lock").exists() else "npm"
            return f"{yonetici} test"
        if "build" in betikler:
            return "npm run build"
    if any((proje / f).exists() for f in ("pytest.ini", "conftest.py", "tox.ini")) or (proje / "tests").is_dir():
        return "python -m pytest -q"
    if (proje / "pyproject.toml").exists() and "pytest" in (proje / "pyproject.toml").read_text(encoding="utf-8", errors="ignore"):
        return "python -m pytest -q"
    if (proje / "go.mod").exists():
        return "go test ./..."
    if (proje / "Cargo.toml").exists():
        return "cargo test"
    if list(proje.glob("*.sln")) or list(proje.glob("*.csproj")):
        return "dotnet test"
    if (proje / "pom.xml").exists():
        return "mvn -q test"
    if (proje / "gradlew").exists() or (proje / "gradlew.bat").exists():
        return "gradlew.bat test" if platform.system() == "Windows" else "./gradlew test"
    return None


@dataclass
class TestSonucu:
    gecti: bool
    cikti: str
    komut: str | None


def testleri_calistir(proje: Path, komut: str | None, zaman_asimi_dk: int = 20) -> TestSonucu:
    if not komut:
        return TestSonucu(True, "(test komutu yok; doğrulama atlandı)", None)
    try:
        r = subprocess.run(komut, shell=True, cwd=proje, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=zaman_asimi_dk * 60,
                           env={**os.environ, "CI": "1"})
    except subprocess.TimeoutExpired:
        return TestSonucu(False, f"Testler {zaman_asimi_dk} dk içinde bitmedi.", komut)
    cikti = ((r.stdout or "") + "\n" + (r.stderr or "")).strip()
    if len(cikti) > 6000:
        cikti = "...\n" + cikti[-6000:]
    return TestSonucu(r.returncode == 0, cikti, komut)
