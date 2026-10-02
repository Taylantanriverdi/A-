-- Primer Lab V33 - Id sayaçlarını (sequence) tablolardaki en büyük Id ile eşitler.
--
-- Neden gerekli: İş kalemi düzenleme ve Kasa / Arşiv ekranları bazı kayıtlara
-- Id'yi elle (MAX(Id)+1) veriyordu. Bu kayıtlar sayacı ilerletmediği için daha
-- sonra açılan yeni sipariş, Cari tahsilatı veya Cari dönem kapatma aynı Id'yi
-- almaya çalışıp "duplicate key" hatasıyla başarısız olabiliyordu.
--
-- Güvenlidir: hiçbir veriyi değiştirmez, sayacı yalnız ileri alır, asla geri
-- almaz. Birden fazla kez çalıştırılabilir.
--
-- Çalıştırma: pgAdmin'de primerlab veritabanına bağlanıp bu dosyayı çalıştırın.

SET client_encoding = 'UTF8';

DO $$
DECLARE
    r record;
    en_buyuk bigint;
    son bigint;
    cagrildi boolean;
BEGIN
    FOR r IN
        SELECT
            c.relname AS tablo,
            a.attname AS kolon,
            pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) AS sayac
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) IS NOT NULL
    LOOP
        EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM public.%I', r.kolon, r.tablo) INTO en_buyuk;
        EXECUTE format('SELECT last_value, is_called FROM %s', r.sayac) INTO son, cagrildi;

        IF NOT cagrildi THEN
            son := son - 1;
        END IF;

        IF en_buyuk > son THEN
            PERFORM setval(r.sayac, en_buyuk, true);
            RAISE NOTICE '%: sayaç % -> % olarak ileri alındı', r.tablo, son, en_buyuk;
        END IF;
    END LOOP;
END $$;
