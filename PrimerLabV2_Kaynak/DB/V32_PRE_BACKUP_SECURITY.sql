DO $$
BEGIN
    IF to_regclass('public."LegacyArsivKayitlari"') IS NOT NULL THEN
        UPDATE "LegacyArsivKayitlari"
        SET "JsonData" = "JsonData" - 'password' - 'pass'
        WHERE ("JsonData" ? 'password') OR ("JsonData" ? 'pass');
    END IF;
END $$;
