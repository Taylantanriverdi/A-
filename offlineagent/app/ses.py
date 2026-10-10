"""Konuşmayı yazıya çevirir (faster-whisper, tamamen yerel, işlemcide çalışır)."""
import sys
import threading
from pathlib import Path

from ayarlar import KOK

_kilit = threading.Lock()
_model = None
_model_adi = None


def model_yolu(boyut: str) -> Path:
    return KOK / "araclar" / "whisper" / boyut


def model_var(boyut: str) -> bool:
    return (model_yolu(boyut) / "model.bin").exists()


def yaziya_cevir(ses_dosyasi: Path, ayarlar: dict) -> str:
    global _model, _model_adi
    boyut = ayarlar["ses_modeli"]
    if not model_var(boyut):
        raise RuntimeError("Ses modeli kurulu değil. İnternet varken GUNCELLE.bat çalıştırın.")
    from faster_whisper import WhisperModel

    with _kilit:
        if _model is None or _model_adi != boyut:
            _model = WhisperModel(str(model_yolu(boyut)), device="cpu", compute_type="int8")
            _model_adi = boyut
        parcalar, _ = _model.transcribe(
            str(ses_dosyasi), language=ayarlar.get("ses_dili") or None, vad_filter=True, beam_size=1
        )
        return " ".join(p.text.strip() for p in parcalar).strip()


if __name__ == "__main__":
    # Kurulum betiği çağırır: python ses.py <boyut>  -> modeli araclar/whisper/<boyut> klasörüne indirir
    from faster_whisper.utils import download_model

    boyut = sys.argv[1] if len(sys.argv) > 1 else "small"
    hedef = model_yolu(boyut)
    if model_var(boyut):
        print(f"Ses modeli zaten var: {hedef}")
    else:
        print(f"Ses modeli indiriliyor: {boyut} -> {hedef}")
        download_model(boyut, output_dir=str(hedef))
        print("Tamam.")
