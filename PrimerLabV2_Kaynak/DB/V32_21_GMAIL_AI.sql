-- Windows'ta psql konsol kodlaması (WIN1254) ile çalıştırıldığında "Gövde"
-- sütunu "GÃ¶vde" adıyla oluşuyordu; kodlama açıkça UTF-8 yapılır.
SET client_encoding = 'UTF8';

BEGIN;

CREATE TABLE IF NOT EXISTS "MailGelenler"
(
    "Id" serial PRIMARY KEY,
    "Tarih" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Gonderen" character varying(300) NULL,
    "Konu" character varying(500) NULL,
    "Gövde" text NULL,
    "HekimId" integer NULL,
    "HastaAdi" character varying(300) NULL,
    "IsTuru" character varying(300) NULL,
    "DisRengi" character varying(100) NULL,
    "Materyal" character varying(150) NULL,
    "Notlar" text NULL,
    "Aktarildi" boolean NOT NULL DEFAULT false
);


ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "Tarih" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "Gonderen" character varying(300) NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "Konu" character varying(500) NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "Gövde" text NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "HekimId" integer NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "HastaAdi" character varying(300) NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "IsTuru" character varying(300) NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "DisRengi" character varying(100) NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "Materyal" character varying(150) NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "Notlar" text NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "Aktarildi" boolean NOT NULL DEFAULT false;

ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "MesajId" character varying(200) NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "Klinik" character varying(300) NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "UyeSayisi" integer NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "DisNo" character varying(200) NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "ReferansKodu" character varying(200) NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "Dosyalar" text NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "WetransferLinkleri" text NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "AnalizKaynagi" character varying(100) NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "Guven" double precision NULL;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "IncelemeGerekli" boolean NOT NULL DEFAULT false;
ALTER TABLE "MailGelenler" ADD COLUMN IF NOT EXISTS "SenkronTarihi" timestamp with time zone NULL;

-- Silinmiş hekime işaret eden eski kayıtlar varsa yabancı anahtar eklenemiyor
-- ve tüm betik geri alınıyordu. Bu kayıtlar, kısıtın kendi davranışıyla aynı
-- şekilde (ON DELETE SET NULL) hekimsiz hale getirilir.
UPDATE "MailGelenler" m
SET "HekimId" = NULL
WHERE m."HekimId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Hekimler" h WHERE h."Id" = m."HekimId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='FK_MailGelenler_Hekimler'
    ) THEN
        ALTER TABLE "MailGelenler"
        ADD CONSTRAINT "FK_MailGelenler_Hekimler"
        FOREIGN KEY ("HekimId") REFERENCES "Hekimler"("Id") ON DELETE SET NULL;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "UX_MailGelenler_MesajId"
    ON "MailGelenler" ("MesajId")
    WHERE "MesajId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "IX_MailGelenler_Tarih"
    ON "MailGelenler" ("Tarih" DESC);

CREATE INDEX IF NOT EXISTS "IX_MailGelenler_Inceleme"
    ON "MailGelenler" ("IncelemeGerekli","Aktarildi");

CREATE TABLE IF NOT EXISTS "MailDosyalari"
(
    "Id" serial PRIMARY KEY,
    "MailId" integer NOT NULL REFERENCES "MailGelenler"("Id") ON DELETE CASCADE,
    "DosyaAdi" character varying(300) NOT NULL,
    "DosyaYolu" text NOT NULL,
    "Boyut" bigint NOT NULL DEFAULT 0,
    "MimeType" character varying(200) NULL,
    "OlusturmaTarihi" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "IX_MailDosyalari_MailId"
    ON "MailDosyalari" ("MailId");

GRANT USAGE ON SCHEMA public TO primerlab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MailGelenler" TO primerlab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MailDosyalari" TO primerlab_app;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE "MailGelenler_Id_seq" TO primerlab_app;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE "MailDosyalari_Id_seq" TO primerlab_app;

COMMIT;
