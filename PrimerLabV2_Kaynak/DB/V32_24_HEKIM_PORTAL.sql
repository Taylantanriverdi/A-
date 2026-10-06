BEGIN;

CREATE TABLE IF NOT EXISTS "HekimPortalHesaplari"
(
    "Id" serial PRIMARY KEY,
    "HekimId" integer NOT NULL REFERENCES "Hekimler"("Id") ON DELETE CASCADE,
    "KullaniciAdi" character varying(100) NOT NULL,
    "ParolaHash" character varying(300) NOT NULL,
    "ParolaSalt" character varying(200) NOT NULL,
    "Aktif" boolean NOT NULL DEFAULT true,
    "SonGirisTarihi" timestamp with time zone NULL,
    "OlusturmaTarihi" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "GuncellemeTarihi" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UX_HekimPortalHesaplari_HekimId" UNIQUE ("HekimId"),
    CONSTRAINT "UX_HekimPortalHesaplari_KullaniciAdi" UNIQUE ("KullaniciAdi")
);

ALTER TABLE "Siparisler"
    ADD COLUMN IF NOT EXISTS "PortalTasarimKaynagi" character varying(20) NULL;
ALTER TABLE "Siparisler"
    ADD COLUMN IF NOT EXISTS "PortalGonderimId" uuid NULL;

-- Kullanıcı adı büyük/küçük harf farkıyla iki kez açılamasın
-- ("Ahmet" ve "ahmet" aynı kişi gibi görünür). Mevcut veride böyle bir çakışma
-- varsa betik bozulmaz; indeks atlanır ve uyarı verilir.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = 'UX_HekimPortalHesaplari_KullaniciAdi_Lower'
    ) THEN
        IF EXISTS (
            SELECT 1 FROM "HekimPortalHesaplari"
            GROUP BY LOWER("KullaniciAdi")
            HAVING COUNT(*) > 1
        ) THEN
            RAISE NOTICE 'Büyük/küçük harf farkıyla aynı portal kullanıcı adları var; benzersizlik indeksi eklenmedi.';
        ELSE
            CREATE UNIQUE INDEX "UX_HekimPortalHesaplari_KullaniciAdi_Lower"
                ON "HekimPortalHesaplari" (LOWER("KullaniciAdi"));
        END IF;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IX_HekimPortalHesaplari_Aktif"
    ON "HekimPortalHesaplari" ("Aktif","KullaniciAdi");
CREATE INDEX IF NOT EXISTS "IX_Siparisler_PortalGonderimId"
    ON "Siparisler" ("PortalGonderimId")
    WHERE "PortalGonderimId" IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "HekimPortalHesaplari" TO primerlab_app;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE "HekimPortalHesaplari_Id_seq" TO primerlab_app;
GRANT SELECT, UPDATE ON TABLE "Siparisler" TO primerlab_app;

COMMIT;
