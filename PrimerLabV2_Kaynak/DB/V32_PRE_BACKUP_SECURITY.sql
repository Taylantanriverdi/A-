SET client_encoding = 'UTF8';

-- Parola alanları JSON'un her seviyesinden (iç içe nesne ve listeler dahil)
-- temizlenir. Önceki sürüm yalnızca en üst seviyedeki anahtarları siliyordu;
-- örn. {"liste":[{"password":"..."}]} içindeki parolalar arşivde kalıyordu.
CREATE OR REPLACE FUNCTION pg_temp.primer_parola_temizle(j jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
BEGIN
    IF jsonb_typeof(j) = 'object' THEN
        RETURN COALESCE(
            (SELECT jsonb_object_agg(e.key, pg_temp.primer_parola_temizle(e.value))
             FROM jsonb_each(j) AS e
             WHERE lower(e.key) NOT IN ('password', 'pass', 'parola', 'sifre', 'şifre')),
            '{}'::jsonb);
    ELSIF jsonb_typeof(j) = 'array' THEN
        RETURN COALESCE(
            (SELECT jsonb_agg(pg_temp.primer_parola_temizle(a.value) ORDER BY a.sira)
             FROM jsonb_array_elements(j) WITH ORDINALITY AS a(value, sira)),
            '[]'::jsonb);
    END IF;
    RETURN j;
END
$fn$;

DO $$
BEGIN
    IF to_regclass('public."LegacyArsivKayitlari"') IS NOT NULL THEN
        UPDATE "LegacyArsivKayitlari"
        SET "JsonData" = pg_temp.primer_parola_temizle("JsonData")
        WHERE "JsonData" IS DISTINCT FROM pg_temp.primer_parola_temizle("JsonData");
    END IF;
END $$;
