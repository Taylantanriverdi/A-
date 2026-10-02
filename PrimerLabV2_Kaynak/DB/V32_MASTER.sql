BEGIN;

-- Primer Lab V32 MASTER - güvenlik, izleme ve performans şeması

ALTER TABLE "Siparisler"
    ADD COLUMN IF NOT EXISTS "ParaBirimi" character varying(10) NOT NULL DEFAULT 'TRY';

ALTER TABLE "HekimFiyatlari"
    ADD COLUMN IF NOT EXISTS "ParaBirimi" character varying(10) NOT NULL DEFAULT 'TRY';

CREATE TABLE IF NOT EXISTS "SistemIslemGunlugu"
(
    "Id" bigserial PRIMARY KEY,
    "Tarih" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Metot" character varying(12) NOT NULL,
    "Yol" character varying(500) NOT NULL,
    "DurumKodu" integer NOT NULL,
    "SureMs" integer NOT NULL DEFAULT 0,
    "RequestId" character varying(150) NOT NULL
);

CREATE INDEX IF NOT EXISTS "IX_SistemIslemGunlugu_Tarih"
    ON "SistemIslemGunlugu" ("Tarih" DESC);

CREATE INDEX IF NOT EXISTS "IX_Siparisler_Silindi_Durum"
    ON "Siparisler" ("Silindi", "Durum");
CREATE INDEX IF NOT EXISTS "IX_Siparisler_OnayDurumu"
    ON "Siparisler" ("OnayDurumu");
CREATE INDEX IF NOT EXISTS "IX_Siparisler_TeknisyenId"
    ON "Siparisler" ("TeknisyenId");
CREATE INDEX IF NOT EXISTS "IX_Siparisler_TerminTarihi"
    ON "Siparisler" ("TerminTarihi");
CREATE INDEX IF NOT EXISTS "IX_SiparisDurumGecmisi_Siparis_Tarih"
    ON "SiparisDurumGecmisi" ("SiparisId", "DegisimTarihi" DESC);
CREATE INDEX IF NOT EXISTS "IX_Tahsilatlar_Hekim_Tarih"
    ON "Tahsilatlar" ("HekimId", "Tarih" DESC);
CREATE INDEX IF NOT EXISTS "IX_IsDosyalari_Siparis_Tarih"
    ON "IsDosyalari" ("SiparisId", "YuklemeTarihi" DESC);
CREATE INDEX IF NOT EXISTS "IX_IsMesajlari_Siparis_Tarih"
    ON "IsMesajlari" ("SiparisId", "Tarih");
CREATE INDEX IF NOT EXISTS "IX_Giderler_Tarih"
    ON "Giderler" ("Tarih" DESC);
CREATE INDEX IF NOT EXISTS "IX_LegacyArsiv_Tur_Tarih"
    ON "LegacyArsivKayitlari" ("Tur", "KayitTarihi" DESC);

-- Eski JSON aktarımından kalan düz metin portal parolalarını kalıcı olarak arşivden temizle.
UPDATE "LegacyArsivKayitlari"
SET "JsonData" = "JsonData" - 'password' - 'pass'
WHERE ("JsonData" ? 'password') OR ("JsonData" ? 'pass');

-- Uygulama rolünün yalnız ihtiyaç duyduğu yeni tablo erişimi.
GRANT SELECT, INSERT ON TABLE "SistemIslemGunlugu" TO primerlab_app;
GRANT USAGE, SELECT ON SEQUENCE "SistemIslemGunlugu_Id_seq" TO primerlab_app;


-- V32.2: primerlab_app uygulama rolunun mevcut ve gelecek nesnelere erisimi.
-- Rol superuser yapilmaz; yalnizca primerlab veritabaninin public semasinda
-- uygulamanin ihtiyac duydugu veri islemleri verilir.
GRANT USAGE ON SCHEMA public TO primerlab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO primerlab_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO primerlab_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO primerlab_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO primerlab_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO primerlab_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO primerlab_app;

COMMIT;
