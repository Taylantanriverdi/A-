"""Belgelerden düz metin çıkarır. Her belge (sayfa etiketi, metin) listesine dönüşür."""
from pathlib import Path

METIN_UZANTILARI = {".txt", ".md", ".csv", ".json", ".log"}
DESTEKLENEN = METIN_UZANTILARI | {".pdf", ".docx", ".xlsx"}


def _pdf(yol: Path) -> list[tuple[str, str]]:
    from pypdf import PdfReader

    okuyucu = PdfReader(str(yol))
    return [(f"s.{i + 1}", sayfa.extract_text() or "") for i, sayfa in enumerate(okuyucu.pages)]


def _docx(yol: Path) -> list[tuple[str, str]]:
    import docx

    belge = docx.Document(str(yol))
    satirlar = [p.text for p in belge.paragraphs]
    for tablo in belge.tables:
        for satir in tablo.rows:
            satirlar.append(" | ".join(h.text.strip() for h in satir.cells))
    return [("", "\n".join(satirlar))]


def _xlsx(yol: Path) -> list[tuple[str, str]]:
    from openpyxl import load_workbook

    kitap = load_workbook(str(yol), read_only=True, data_only=True)
    try:
        sonuc = []
        for sayfa in kitap.worksheets:
            satirlar = []
            for satir in sayfa.iter_rows(values_only=True):
                metin = " | ".join("" if h is None else str(h) for h in satir)
                if metin.strip(" |"):
                    satirlar.append(metin)
            sonuc.append((f"sayfa: {sayfa.title}", "\n".join(satirlar)))
        return sonuc
    finally:
        kitap.close()


def _metin(yol: Path) -> list[tuple[str, str]]:
    ham = yol.read_bytes()
    for kodlama in ("utf-8-sig", "cp1254"):
        try:
            return [("", ham.decode(kodlama))]
        except UnicodeDecodeError:
            continue
    return [("", ham.decode("latin-1"))]


def belgeyi_oku(yol: Path) -> list[tuple[str, str]]:
    uzanti = yol.suffix.lower()
    if uzanti == ".pdf":
        return _pdf(yol)
    if uzanti == ".docx":
        return _docx(yol)
    if uzanti == ".xlsx":
        return _xlsx(yol)
    return _metin(yol)
