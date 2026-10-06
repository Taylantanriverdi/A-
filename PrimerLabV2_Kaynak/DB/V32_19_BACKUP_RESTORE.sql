BEGIN;

CREATE TABLE IF NOT EXISTS "LegacyImportMap"
(
    "Tur" character varying(50) NOT NULL,
    "LegacyId" bigint NOT NULL,
    "NewId" bigint NOT NULL,
    "OlusturmaTarihi" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PK_LegacyImportMap" PRIMARY KEY ("Tur","LegacyId")
);

CREATE INDEX IF NOT EXISTS "IX_LegacyImportMap_NewId"
    ON "LegacyImportMap" ("NewId");

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "LegacyImportMap" TO primerlab_app;

GRANT USAGE ON SCHEMA public TO primerlab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO primerlab_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO primerlab_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO primerlab_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO primerlab_app;

COMMIT;
