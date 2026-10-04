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


# --------------------------------------------------------------------------- #
# Proje ekleme
# --------------------------------------------------------------------------- #

VARSAYILAN_GITIGNORE = "\n".join([
    "node_modules/", ".venv/", "venv/", "__pycache__/", "dist/", "build/", "bin/", "obj/",
    "*.log", ".env", ".DS_Store", "Thumbs.db", "",
])

# Bir klasörün yazılım projesi olduğunu gösteren işaretler -> tür adı
PROJE_ISARETLERI = [
    ("package.json", "Node / web"), ("pyproject.toml", "Python"), ("requirements.txt", "Python"),
    ("setup.py", "Python"), ("go.mod", "Go"), ("Cargo.toml", "Rust"), ("pom.xml", "Java"),
    ("build.gradle", "Java / Android"), ("pubspec.yaml", "Flutter"), ("composer.json", "PHP"),
    ("index.html", "Web"), ("manage.py", "Django"),
]
UZANTI_TURLERI = {".py": "Python", ".html": "Web", ".js": "JavaScript", ".ts": "TypeScript", ".cs": "C#",
                  ".java": "Java", ".php": "PHP", ".cpp": "C++", ".c": "C", ".go": "Go", ".kt": "Kotlin",
                  ".swift": "Swift", ".dart": "Flutter", ".rb": "Ruby"}
ATLANACAK = {"node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build", "bin", "obj", ".idea",
             ".vscode", "AppData", "$RECYCLE.BIN", "System Volume Information"}


def tehlikeli_klasor(yol: Path) -> str | None:
    """Otopilota verilmemesi gereken klasörler (sürücü kökü, ev dizini, sistem klasörleri)."""
    yol = yol.resolve()
    if yol.parent == yol:
        return "Sürücü kökü proje olarak eklenemez; projenin kendi klasörünü seç."
    if yol == Path.home().resolve():
        return "Ev klasörünün tamamı eklenemez; projenin kendi klasörünü seç."
    sistem = [os.environ.get(k) for k in ("SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData")]
    for s in filter(None, sistem):
        if yol == Path(s).resolve() or yol.is_relative_to(Path(s).resolve()):
            return "Sistem klasörleri eklenemez."
    if str(yol) in ("/usr", "/etc", "/bin", "/var", "/System", "/Library"):
        return "Sistem klasörleri eklenemez."
    return None


def proje_turu(yol: Path) -> str | None:
    """Klasör bir yazılım projesine benziyorsa türünü, benzemiyorsa None döner."""
    for dosya, tur in PROJE_ISARETLERI:
        if (yol / dosya).exists():
            return tur
    try:
        sayac: dict[str, int] = {}
        for i, f in enumerate(yol.iterdir()):
            if i > 300:
                break
            if f.is_file() and f.suffix.lower() in UZANTI_TURLERI:
                t = UZANTI_TURLERI[f.suffix.lower()]
                sayac[t] = sayac.get(t, 0) + 1
    except OSError:
        return None
    if sayac:
        return max(sayac, key=sayac.get)
    return "Git deposu" if (yol / ".git").exists() else None


def projeleri_tara(kok: Path, derinlik: int = 2) -> list[dict]:
    """Bir klasörün altındaki yazılım projelerini bulur (iç içe projelere girmez)."""
    bulunan: list[dict] = []

    def gez(yol: Path, kalan: int) -> None:
        try:
            alt = sorted((p for p in yol.iterdir() if p.is_dir() and p.name not in ATLANACAK
                          and not p.name.startswith(".")), key=lambda p: p.name.lower())
        except OSError:
            return
        for p in alt:
            tur = proje_turu(p)
            if tur:
                bulunan.append({"yol": str(p), "isim": p.name, "tur": tur, "git": (p / ".git").exists()})
            elif kalan > 1:
                gez(p, kalan - 1)

    gez(kok, derinlik)
    return bulunan[:200]


def projeyi_hazirla(yol: Path, dal: str = "otopilot/gelistirme") -> list[str]:
    """Klasörü otopilota hazırlar: git deposu yoksa oluşturur, kaydedilmemiş değişiklikleri kaydeder.

    Dosyalara dokunmaz; yalnızca .gitignore yoksa ekler. Yapılanları açıklayan satırlar döner.
    """
    yapilan: list[str] = []
    if not (yol / ".git").exists():
        if not (yol / ".gitignore").exists():
            (yol / ".gitignore").write_text(VARSAYILAN_GITIGNORE, encoding="utf-8")
            yapilan.append(".gitignore eklendi")
        git(yol, "init", "-q")
        yapilan.append("git deposu oluşturuldu")
    if not git(yol, "config", "user.name", kontrol=False):
        git(yol, "config", "user.name", os.environ.get("USERNAME") or os.environ.get("USER") or "Otopilot")
    if not git(yol, "config", "user.email", kontrol=False):
        git(yol, "config", "user.email", "otopilot@localhost")

    commit_yok = not git(yol, "rev-parse", "--verify", "-q", "HEAD", kontrol=False)
    mevcut_dal = "" if commit_yok else git(yol, "rev-parse", "--abbrev-ref", "HEAD")
    if commit_yok or (mevcut_dal != dal and kirli_mi(yol)):
        git(yol, "add", "-A")
        mesaj = "Otopilot öncesi ilk sürüm" if commit_yok else "Otopilot öncesi kaydedilen değişiklikler"
        git(yol, "commit", "-q", "--allow-empty", "-m", mesaj)
        yapilan.append(f"mevcut hali kaydedildi ({mesaj.lower()})")
    return yapilan
