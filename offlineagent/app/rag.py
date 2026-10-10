"""Belge indeksi: belgeleri parçalara böler, Ollama ile vektöre çevirir ve benzerlik araması yapar.

Her belge için veri/indeks/<sha1>.json (parçalar) ve <sha1>.npy (vektörler) saklanır;
sadece değişen belgeler yeniden işlenir.
"""
import hashlib
import json
import re
import threading
import time
from pathlib import Path
from typing import Callable

import httpx
import numpy as np

from belge_oku import DESTEKLENEN, belgeyi_oku
from ollama_api import gorsel_oku

OCR_ISTEMI = (
    "Bu görseldeki tüm yazıyı, satır düzenini koruyarak olduğu gibi yaz. "
    "Yorum veya açıklama ekleme. Görselde yazı yoksa hiçbir şey yazma."
)

PARCA_BOYU = 1000
ORTUSME = 150
TOPLU = 16


def parcala(metin: str) -> list[str]:
    metin = re.sub(r"[ \t]+", " ", metin)
    metin = re.sub(r"\n{3,}", "\n\n", metin).strip()
    if len(metin) <= PARCA_BOYU:
        return [metin] if metin else []
    parcalar, bas = [], 0
    while bas < len(metin):
        son = min(bas + PARCA_BOYU, len(metin))
        if son < len(metin):
            # Mümkünse paragraf ya da cümle sonunda kes
            kesim = max(metin.rfind("\n\n", bas + PARCA_BOYU // 2, son), metin.rfind(". ", bas + PARCA_BOYU // 2, son))
            if kesim > bas:
                son = kesim + 1
        parca = metin[bas:son].strip()
        if parca:
            parcalar.append(parca)
        if son >= len(metin):
            break
        bas = max(son - ORTUSME, bas + 1)
    return parcalar


class BelgeIndeksi:
    def __init__(self, belge_dizini: Path, indeks_dizini: Path, ollama_url: str, ayar_getir: Callable[[], dict]):
        self.belge_dizini = belge_dizini
        self.indeks_dizini = indeks_dizini
        self.ollama_url = ollama_url
        self.ayar_getir = ayar_getir
        self.kilit = threading.Lock()
        self.dosyalar: dict[str, dict] = {}
        self._matris: np.ndarray | None = None
        self._meta: list[dict] = []
        self.bilgi = {"calisiyor": False, "mesaj": "", "islenen": 0, "toplam": 0, "hatalar": [], "son_tarama": None}

    def _kayit_adi(self, rel: str) -> str:
        return hashlib.sha1(rel.encode("utf-8")).hexdigest()

    def yukle(self) -> None:
        self.indeks_dizini.mkdir(parents=True, exist_ok=True)
        for js in self.indeks_dizini.glob("*.json"):
            try:
                kayit = json.loads(js.read_text("utf-8"))
                kayit["vektor"] = np.load(js.with_suffix(".npy"))
                self.dosyalar[kayit["rel"]] = kayit
            except (OSError, ValueError, KeyError):
                continue
        self._matris = None

    def _embed(self, metinler: list[str], onek: str) -> np.ndarray:
        vektorler = []
        with httpx.Client(timeout=300) as istemci:
            for i in range(0, len(metinler), TOPLU):
                yanit = istemci.post(
                    f"{self.ollama_url}/api/embed",
                    json={"model": self.ayar_getir()["embed_model"], "input": [onek + m for m in metinler[i:i + TOPLU]]},
                )
                yanit.raise_for_status()
                vektorler.extend(yanit.json()["embeddings"])
        dizi = np.asarray(vektorler, dtype=np.float32)
        return dizi / np.maximum(np.linalg.norm(dizi, axis=1, keepdims=True), 1e-9)

    def tara_baslat(self) -> bool:
        if self.bilgi["calisiyor"]:
            return False
        self.bilgi.update(calisiyor=True, mesaj="Başlıyor", islenen=0, toplam=0, hatalar=[])
        threading.Thread(target=self._tara, daemon=True).start()
        return True

    def _tara(self) -> None:
        try:
            self.belge_dizini.mkdir(parents=True, exist_ok=True)
            model = self.ayar_getir()["embed_model"]
            mevcut = {}
            for yol in self.belge_dizini.rglob("*"):
                if yol.is_file() and yol.suffix.lower() in DESTEKLENEN and not yol.name.startswith("~$"):
                    st = yol.stat()
                    mevcut[yol.relative_to(self.belge_dizini).as_posix()] = f"{st.st_size}-{int(st.st_mtime)}"

            with self.kilit:
                for rel in set(self.dosyalar) - set(mevcut):
                    self._sil(rel)

            degisen = [
                rel for rel, imza in mevcut.items()
                if self.dosyalar.get(rel, {}).get("imza") != imza or self.dosyalar[rel].get("model") != model
            ]
            self.bilgi["toplam"] = len(degisen)
            for rel in degisen:
                self.bilgi["mesaj"] = rel
                try:
                    self._isle(rel, mevcut[rel], model)
                except Exception as hata:  # Bir belge bozuksa diğerlerine devam et
                    self.bilgi["hatalar"].append(f"{rel}: {hata}")
                self.bilgi["islenen"] += 1
            self.bilgi["mesaj"] = "Tamamlandı"
        except Exception as hata:
            self.bilgi["mesaj"] = "Hata"
            self.bilgi["hatalar"].append(str(hata))
        finally:
            self.bilgi["calisiyor"] = False
            self.bilgi["son_tarama"] = time.strftime("%Y-%m-%d %H:%M")

    def _isle(self, rel: str, imza: str, model: str) -> None:
        ayarlar = self.ayar_getir()
        ocr = None
        if ayarlar.get("ocr", True):
            def ocr(resim_b64: str) -> str:
                self.bilgi["mesaj"] = f"{rel} (yazı okunuyor…)"
                return gorsel_oku(ayarlar["gorsel_model"], resim_b64, OCR_ISTEMI)
        parcalar = []
        for sayfa, metin in belgeyi_oku(self.belge_dizini / rel, ocr):
            parcalar.extend({"sayfa": sayfa, "metin": p} for p in parcala(metin))
        vektor = self._embed([p["metin"] for p in parcalar], "search_document: ") if parcalar else np.zeros((0, 1), np.float32)
        kayit = {"rel": rel, "imza": imza, "model": model, "parcalar": parcalar}
        ad = self._kayit_adi(rel)
        (self.indeks_dizini / f"{ad}.json").write_text(json.dumps(kayit, ensure_ascii=False), "utf-8")
        np.save(self.indeks_dizini / f"{ad}.npy", vektor)
        with self.kilit:
            self.dosyalar[rel] = {**kayit, "vektor": vektor}
            self._matris = None

    def _sil(self, rel: str) -> None:
        ad = self._kayit_adi(rel)
        for uzanti in (".json", ".npy"):
            (self.indeks_dizini / f"{ad}{uzanti}").unlink(missing_ok=True)
        self.dosyalar.pop(rel, None)
        self._matris = None

    def ara(self, soru: str, adet: int = 5, esik: float = 0.3) -> list[dict]:
        with self.kilit:
            if self._matris is None:
                self._meta, parcalar = [], []
                for kayit in self.dosyalar.values():
                    if len(kayit["parcalar"]):
                        parcalar.append(kayit["vektor"])
                        self._meta.extend({"kaynak": kayit["rel"], **p} for p in kayit["parcalar"])
                self._matris = np.vstack(parcalar) if parcalar else np.zeros((0, 1), np.float32)
            matris, meta = self._matris, self._meta
        if not len(meta):
            return []
        skorlar = matris @ self._embed([soru], "search_query: ")[0]
        sira = np.argsort(-skorlar)[:adet]
        return [{**meta[i], "skor": round(float(skorlar[i]), 3)} for i in sira if skorlar[i] >= esik]

    def durum(self) -> dict:
        return {
            **self.bilgi,
            "dosya_sayisi": len(self.dosyalar),
            "parca_sayisi": sum(len(k["parcalar"]) for k in self.dosyalar.values()),
        }
