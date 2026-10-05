"""Bar tasarım parametreleri. Tüm uzunluklar mm."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, fields


@dataclass
class Params:
    # --- Bar kesiti ---
    bar_width: float = 3.5          # bukko-lingual genişlik
    bar_height: float = 4.0         # okluzo-gingival yükseklik
    corner_radius: float = 0.8      # kesit köşe radyüsü (freze takımı yarıçapından büyük olmalı)

    # --- İmplant bağlantısı ---
    sleeve_diameter: float = 5.0    # implant (MUA) üstü Ti silindir çapı
    channel_diameter: float = 2.2   # vida kanalı çapı (bardan çıkarılır)
    max_offset_at_implant: float = 1.2  # bar merkezi ile implant ekseni arası maks. yatay sapma
    seat_diameter: float = 3.0      # vida başı yuvası (eksene dik oturma yüzeyli counterbore)
    pad_extra: float = 0.6          # implant üstünde bar genişliği = silindir çapı + pad_extra
    pad_transition: float = 1.5     # ped -> normal bar genişliği geçiş uzunluğu

    # --- Safety zone / restorasyon ---
    min_cover: float = 2.0          # bar çevresinde min. restoratif materyal (zirkonyum/kompozit)
    min_ti_thickness: float = 1.2   # bar metalinin hiçbir yerde inemeyeceği kalınlık
    design_margin: float = 0.15     # optimizasyonda min_cover'a eklenen güvenlik payı
    cement_gap: float = 0.05        # restorasyon iç boşluğunda bar etrafındaki siman aralığı
    fill_screw_holes: bool = True   # restorasyondaki vida giriş deliklerini analiz için doldur
    hole_fill_diameter: float = 3.5
    access_hole_diameter: float = 2.8  # restorasyon kesiminde açılacak vida giriş deliği

    # --- Kantilever ---
    max_cantilever: float = 15.0    # son implanttan sonra maks. distal uzantı
    cantilever_ap_ratio: float = 1.5  # kantilever <= oran * A-P mesafesi

    # --- Merkez hattı optimizasyonu ---
    lateral_search: float = 5.0     # guide hattından bukkal/lingual arama mesafesi
    z_max_above_platform: float = 18.0
    grid_step: float = 0.25
    station_step: float = 1.0
    smooth_weight: float = 2.0      # ani yön/yükseklik değişimine ceza
    vertical_bias: float = 0.0      # >0: barı gingivaya yakın tercih et, <0: okluzale yakın
    min_bend_radius: float = 4.0    # merkez hattı min. eğrilik yarıçapı

    # --- Üretilebilirlik ---
    tool_diameter: float = 1.0      # en küçük freze takımı çapı

    # --- Analiz ---
    sdf_spacing: float = 0.2

    @classmethod
    def from_json(cls, path: str | None) -> "Params":
        if not path:
            return cls()
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        known = {f.name for f in fields(cls)}
        unknown = set(data) - known
        if unknown:
            raise ValueError(f"Bilinmeyen parametre(ler): {sorted(unknown)}")
        return cls(**data)

    def to_dict(self) -> dict:
        return asdict(self)
