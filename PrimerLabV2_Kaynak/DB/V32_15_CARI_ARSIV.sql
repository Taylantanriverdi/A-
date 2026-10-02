BEGIN;

ALTER TABLE "Tahsilatlar"
    ADD COLUMN IF NOT EXISTS "ParaBirimi" character varying(10) NOT NULL DEFAULT 'TRY';

UPDATE "Tahsilatlar"
SET "ParaBirimi"='TRY'
WHERE "ParaBirimi" IS NULL OR BTRIM("ParaBirimi")='';

ALTER TABLE "Tahsilatlar"
    DROP CONSTRAINT IF EXISTS "CK_Tahsilatlar_ParaBirimi";

ALTER TABLE "Tahsilatlar"
    ADD CONSTRAINT "CK_Tahsilatlar_ParaBirimi"
    CHECK ("ParaBirimi" IN ('TRY','EUR','USD'));

CREATE TABLE IF NOT EXISTS "CariDonemleri"
(
    "Id" serial PRIMARY KEY,
    "HekimId" integer NOT NULL REFERENCES "Hekimler"("Id") ON DELETE RESTRICT,
    "BaslangicTarihi" timestamp with time zone NULL,
    "KapanisTarihi" timestamp with time zone NOT NULL,
    "IsSayisi" integer NOT NULL DEFAULT 0,
    "ToplamlarJson" text NOT NULL DEFAULT '{}',
    "TahsilatlarJson" text NOT NULL DEFAULT '{}',
    "BakiyelerJson" text NOT NULL DEFAULT '{}',
    "IslerSnapshotJson" text NOT NULL DEFAULT '[]',
    "TahsilatlarSnapshotJson" text NOT NULL DEFAULT '[]',
    "DevirEklendi" boolean NOT NULL DEFAULT true,
    "GeriAlindi" boolean NOT NULL DEFAULT false,
    "Notlar" text NULL,
    "OlusturmaTarihi" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "GuncellemeTarihi" timestamp with time zone NULL
);

CREATE INDEX IF NOT EXISTS "IX_CariDonemleri_Hekim_Kapanis"
    ON "CariDonemleri" ("HekimId","KapanisTarihi" DESC);

CREATE INDEX IF NOT EXISTS "IX_CariDonemleri_Aktif"
    ON "CariDonemleri" ("HekimId","GeriAlindi","KapanisTarihi" DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "CariDonemleri" TO primerlab_app;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE "CariDonemleri_Id_seq" TO primerlab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Tahsilatlar" TO primerlab_app;

COMMIT;
