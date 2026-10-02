#!/usr/bin/env python3
import json
import sys
from pathlib import Path
from datetime import datetime

if len(sys.argv) < 4:
    print("usage: legacy_import.py input.json output.sql display_name", file=sys.stderr)
    sys.exit(2)

src = Path(sys.argv[1])
out = Path(sys.argv[2])
display_name = sys.argv[3]

data = json.loads(src.read_text(encoding="utf-8-sig"))

def q(v):
    if v is None:
        return "NULL"
    s = str(v).replace("\x00", "").replace("'", "''")
    return "'" + s + "'"

def b(v):
    return "TRUE" if bool(v) else "FALSE"

def n(v, default=0):
    try:
        x = float(v)
        if x != x or x in (float("inf"), float("-inf")):
            return str(default)
        return str(x)
    except Exception:
        return str(default)

def i(v, default=0):
    try:
        return int(v)
    except Exception:
        return default

def cur(v):
    c = str(v or "TRY").strip().upper()
    return c if c in {"TRY","EUR","USD"} else "TRY"

def dt(v, fallback="2026-01-01T12:00:00Z"):
    if not v:
        v = fallback
    if isinstance(v, (int, float)) or (isinstance(v, str) and v.isdigit()):
        try:
            num = float(v)
            if num > 10_000_000_000:
                num = num / 1000.0
            v = datetime.utcfromtimestamp(num).isoformat(timespec="milliseconds") + "Z"
        except Exception:
            v = fallback
    s = str(v).strip()
    if len(s) == 10:
        s += "T12:00:00Z"
    return q(s) + "::timestamptz"

def date_dt(v):
    return dt(v, "2026-01-01T12:00:00Z")

def clean_status(s):
    s = str(s or "").strip()
    allowed = {"Bekliyor","Tasarımda","Üretimde","Makyajda","Tamamlama Onayı","Tamamlandı"}
    if s in allowed:
        return s
    if s in {"Teslim","Hazır","Arşiv"}:
        return "Tamamlandı"
    if s in {"Yeni","Devam Eden","Devam Ediyor"}:
        return "Devam Ediyor"
    return "Bekliyor"

def json_text(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",",":"))

def values(obj):
    if isinstance(obj, dict):
        return list(obj.values())
    if isinstance(obj, list):
        return obj
    return []

doctors = data.get("doctors") or {}
techs = data.get("technicians") or {}
jobs = data.get("jobs") or {}
pending = data.get("pendingJobs") or {}
payments = data.get("payments") or {}
expenses = data.get("expenses") or {}
closures = data.get("statementClosures") or {}

lines = []
A = lines.append

A("SET client_encoding TO 'UTF8';")
A("BEGIN;")
A("SET LOCAL statement_timeout = '0';")
A("")
# V33.07.4: Yardimci tablolar uygulama baslarken/veritabani kurulumunda olusturulur.
# Uygulama rolu (primerlab_app) bu tablolarin sahibi degildir. Bu nedenle importer
# CREATE INDEX / ALTER gibi sahiplik gerektiren DDL calistirmaz; yalniz DML yapar.
# Bu, mevcut LegacyImportMap sahibi postgres/admin oldugunda olusan
# "must be owner of table LegacyImportMap" hatasini kalici olarak onler.
A("")

# Doctors
for key, d in (doctors.items() if isinstance(doctors, dict) else []):
    lid = i(d.get("id", key))
    name = (d.get("name") or f"Legacy Hekim {lid}").strip()
    clinic = (d.get("clinic") or d.get("clinicName") or name).strip()
    email = (d.get("email") or "").strip()
    phone = (d.get("phone") or "").strip()
    A(f"""DO $pl$
DECLARE v_id int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "LegacyImportMap" WHERE "Tur"='doctor' AND "LegacyId"={lid}) THEN
    SELECT "Id" INTO v_id FROM "Hekimler"
    WHERE LOWER(BTRIM("AdSoyad"))=LOWER(BTRIM({q(name)}))
    ORDER BY "Id" LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO "Hekimler" ("AdSoyad","KlinikAdi","Telefon","Email","Aktif","OlusturmaTarihi")
      VALUES ({q(name)},{q(clinic)},{q(phone)},{q(email)},TRUE,NOW())
      RETURNING "Id" INTO v_id;
    ELSE
      UPDATE "Hekimler"
      SET "KlinikAdi"=COALESCE(NULLIF(BTRIM("KlinikAdi"),''),{q(clinic)}),
          "Telefon"=CASE WHEN COALESCE(BTRIM("Telefon"),'')='' THEN {q(phone)} ELSE "Telefon" END,
          "Email"=CASE WHEN COALESCE(BTRIM("Email"),'')='' THEN {q(email)} ELSE "Email" END,
          "Aktif"=TRUE
      WHERE "Id"=v_id;
    END IF;

    INSERT INTO "LegacyImportMap" ("Tur","LegacyId","NewId")
    VALUES ('doctor',{lid},v_id)
    ON CONFLICT ("Tur","LegacyId") DO NOTHING;
  END IF;
END $pl$;""")
    # price rows
    for pos, p in enumerate(values(d.get("prices")), 1):
        pname = str(p.get("name") or "").strip()
        if not pname:
            continue
        price = n(p.get("price"), 0)
        pc = cur(p.get("currency"))
        A(f"""INSERT INTO "HekimFiyatlari" ("HekimId","IsTuru","BirimFiyat","ParaBirimi","Sira","Aktif")
SELECT m."NewId"::int,{q(pname)},{price},{q(pc)},{pos},TRUE
FROM "LegacyImportMap" m
WHERE m."Tur"='doctor' AND m."LegacyId"={lid}
ON CONFLICT ("HekimId","IsTuru") DO UPDATE
SET "BirimFiyat"=EXCLUDED."BirimFiyat",
    "ParaBirimi"=EXCLUDED."ParaBirimi",
    "Aktif"=TRUE;""")

# Technicians
for key, t in (techs.items() if isinstance(techs, dict) else []):
    lid = i(t.get("id", key))
    name = (t.get("name") or f"Legacy Teknisyen {lid}").strip()
    A(f"""DO $pl$
DECLARE v_id int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "LegacyImportMap" WHERE "Tur"='technician' AND "LegacyId"={lid}) THEN
    SELECT "Id" INTO v_id FROM "Teknisyenler"
    WHERE LOWER(BTRIM("AdSoyad"))=LOWER(BTRIM({q(name)}))
    ORDER BY "Id" LIMIT 1;
    IF v_id IS NULL THEN
      INSERT INTO "Teknisyenler" ("AdSoyad","Aktif","OlusturmaTarihi")
      VALUES ({q(name)},TRUE,NOW())
      RETURNING "Id" INTO v_id;
    END IF;
    INSERT INTO "LegacyImportMap" ("Tur","LegacyId","NewId")
    VALUES ('technician',{lid},v_id)
    ON CONFLICT ("Tur","LegacyId") DO NOTHING;
  END IF;
END $pl$;""")

def job_sql(kind, key, j, pending_mode=False):
    lid = i(j.get("id", key))
    drid = i(j.get("drId"))
    techid = i(j.get("techId"))
    patient = str(j.get("patient") or "İsimsiz").strip()[:150]
    typ = str(j.get("type") or j.get("jobType") or j.get("finalType") or "Belirsiz").strip()[:200]
    qty = max(1, i(j.get("qty"), 1))
    price = n(j.get("price"), 0)
    currency = cur(j.get("currency"))
    raw_status = "Bekliyor" if pending_mode else clean_status(j.get("status"))
    onay = "Gelen Onay" if pending_mode else "Onaylandı"
    deleted = bool(j.get("deleted", False))
    note = j.get("note")
    of = j.get("orderForm") if isinstance(j.get("orderForm"), dict) else {}
    notes = str(note or of.get("notes") or j.get("notes") or "").strip()
    color = str(j.get("toothColor") or j.get("color") or of.get("color") or "").strip()[:50]
    material = str(j.get("material") or of.get("material") or "").strip()[:120]
    teeth = of.get("teeth") or j.get("teeth") or []
    if isinstance(teeth, list):
        tooths = ",".join(str(x) for x in teeth)
    else:
        tooths = str(teeth or "")
    tooths = tooths[:250]
    source = str(j.get("sourceType") or j.get("source") or ("Legacy Pending" if pending_mode else "Legacy JSON")).strip()[:40]
    when = j.get("createdAt") or j.get("approvedAt") or j.get("completedAt") or j.get("dateout")
    termin = j.get("dateout")
    completion = j.get("completedAt") or j.get("dateout") or when
    return f"""DO $pl$
DECLARE v_h int; v_t int; v_p int; v_s int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "LegacyImportMap" WHERE "Tur"={q(kind)} AND "LegacyId"={lid}) THEN
    SELECT "NewId"::int INTO v_h FROM "LegacyImportMap" WHERE "Tur"='doctor' AND "LegacyId"={drid};
    SELECT "NewId"::int INTO v_t FROM "LegacyImportMap" WHERE "Tur"='technician' AND "LegacyId"={techid};

    IF v_h IS NOT NULL THEN
      SELECT s."Id" INTO v_s
      FROM "Siparisler" s
      JOIN "Hastalar" p ON p."Id"=s."HastaId"
      JOIN "SiparisKalemleri" k ON k."SiparisId"=s."Id"
      WHERE p."HekimId"=v_h
        AND LOWER(BTRIM(p."AdSoyad"))=LOWER(BTRIM({q(patient)}))
        AND LOWER(BTRIM(k."IsTuru"))=LOWER(BTRIM({q(typ)}))
        AND k."Adet"={qty}
        AND k."BirimFiyat"={price}
        AND COALESCE(s."ParaBirimi",'TRY')={q(currency)}
        AND (s."TerminTarihi"::date={date_dt(termin)}::date OR s."TeslimTarihi"::date={date_dt(termin)}::date)
      ORDER BY s."Id"
      LIMIT 1;

      IF v_s IS NULL THEN
        INSERT INTO "Hastalar" ("AdSoyad","HekimId","Telefon","Notlar","OlusturmaTarihi","Aktif")
        VALUES ({q(patient)},v_h,NULL,{q(notes)},{dt(when)},TRUE)
        RETURNING "Id" INTO v_p;

        INSERT INTO "Siparisler" ("HastaId","Durum","Notlar","OlusturmaTarihi","TeslimTarihi","Aktif")
        VALUES (v_p,{q(raw_status)},{q(notes)},{dt(when)},{date_dt(termin)},TRUE)
        RETURNING "Id" INTO v_s;

        UPDATE "Siparisler"
        SET "OnayDurumu"={q(onay)},
            "Kaynak"={q(source)},
            "TerminTarihi"={date_dt(termin)},
            "DisRengi"={q(color)},
            "DisSemasi"={q(tooths)},
            "Materyal"={q(material)},
            "ParaBirimi"={q(currency)},
            "Silindi"={b(deleted)},
            "SilinmeTarihi"=CASE WHEN {b(deleted)} THEN {dt(j.get("deletedAt") or when)} ELSE NULL END,
            "TeknisyenId"=v_t,
            "TamamlamaTalepTarihi"=CASE WHEN {q(raw_status)}='Tamamlama Onayı' THEN {dt(completion)} ELSE NULL END
        WHERE "Id"=v_s;

        INSERT INTO "SiparisKalemleri" ("SiparisId","IsTuru","Adet","BirimFiyat")
        VALUES (v_s,{q(typ)},{qty},{price});

        INSERT INTO "SiparisDurumGecmisi" ("SiparisId","EskiDurum","YeniDurum","DegisimTarihi","Aciklama")
        VALUES (v_s,NULL,{q(raw_status)},{dt(completion)},'Eski JSON yedeğinden aktarıldı.');
      END IF;

      INSERT INTO "LegacyImportMap" ("Tur","LegacyId","NewId")
      VALUES ({q(kind)},{lid},v_s)
      ON CONFLICT ("Tur","LegacyId") DO NOTHING;
    END IF;
  END IF;
END $pl$;"""

for key,j in (jobs.items() if isinstance(jobs,dict) else []):
    A(job_sql("job", key, j, False))
for key,j in (pending.items() if isinstance(pending,dict) else []):
    A(job_sql("pendingJob", key, j, True))

# Payments
for key,p in (payments.items() if isinstance(payments,dict) else []):
    lid=i(p.get("id",key)); dr=i(p.get("drId"))
    amount=n(p.get("amount"),0); currency=cur(p.get("currency"))
    note=str(p.get("note") or "").strip()
    collector=str(p.get("collectorName") or "").strip()
    desc = note
    if collector:
        desc = (desc + (" · " if desc else "") + "Tahsil eden: " + collector)[:500]
    A(f"""DO $pl$
DECLARE v_h int; v_id int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "LegacyImportMap" WHERE "Tur"='payment' AND "LegacyId"={lid}) THEN
    SELECT "NewId"::int INTO v_h FROM "LegacyImportMap" WHERE "Tur"='doctor' AND "LegacyId"={dr};
    IF v_h IS NOT NULL AND {amount}::numeric > 0 THEN
      SELECT "Id" INTO v_id FROM "Tahsilatlar"
      WHERE "HekimId"=v_h AND "Tutar"={amount} AND COALESCE("ParaBirimi",'TRY')={q(currency)}
        AND "Tarih"::date={date_dt(p.get("date"))}::date
      ORDER BY "Id" LIMIT 1;
      IF v_id IS NULL THEN
        INSERT INTO "Tahsilatlar" ("HekimId","Tutar","ParaBirimi","Tarih","OdemeTuru","IslemNo","Aciklama","OlusturmaTarihi")
        VALUES (v_h,{amount},{q(currency)},{date_dt(p.get("date"))},'Nakit',{q(str(lid))},{q(desc)},{date_dt(p.get("date"))})
        RETURNING "Id" INTO v_id;
      END IF;
      INSERT INTO "LegacyImportMap" ("Tur","LegacyId","NewId")
      VALUES ('payment',{lid},v_id) ON CONFLICT ("Tur","LegacyId") DO NOTHING;
    END IF;
  END IF;
END $pl$;""")

# Expenses
for key,e in (expenses.items() if isinstance(expenses,dict) else []):
    lid=i(e.get("id",key)); amount=n(e.get("amount"),0)
    title=str(e.get("title") or "").strip()
    vendor=str(e.get("vendor") or "").strip()
    note=str(e.get("note") or "").strip()
    payment=str(e.get("payment") or "").strip()
    bits=[x for x in [title,vendor,note,("Ödeme: "+payment if payment else "")] if x]
    desc=" · ".join(bits)[:500]
    cat=str(e.get("category") or e.get("subcategory") or "Diğer").strip()[:100]
    A(f"""DO $pl$
DECLARE v_id int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "LegacyImportMap" WHERE "Tur"='expense' AND "LegacyId"={lid}) THEN
    IF {amount}::numeric > 0 THEN
      INSERT INTO "Giderler" ("Tarih","Kategori","Aciklama","Tutar","OlusturmaTarihi")
      VALUES ({date_dt(e.get("date"))},{q(cat)},{q(desc)},{amount},{dt(e.get("createdAt") or e.get("date"))})
      RETURNING "Id" INTO v_id;
      INSERT INTO "LegacyImportMap" ("Tur","LegacyId","NewId")
      VALUES ('expense',{lid},v_id) ON CONFLICT ("Tur","LegacyId") DO NOTHING;
    END IF;
  END IF;
END $pl$;""")

# Statement closures -> current Kasa archive
for key,c in (closures.items() if isinstance(closures,dict) else []):
    lid=i(c.get("id",key)); dr=i(c.get("drId"))
    job_ids=[i(x) for x in (c.get("jobIds") or [])]
    pay_ids=[i(x) for x in (c.get("paymentIds") or [])]
    job_snaps=[]
    for jid in job_ids:
        j = jobs.get(str(jid)) if isinstance(jobs,dict) else None
        if not j: continue
        job_snaps.append({
            "id": jid,
            "hastaAdi": j.get("patient") or "İsimsiz",
            "isTuru": j.get("type") or j.get("jobType") or "Belirsiz",
            "tutar": float(j.get("price") or 0) * max(1,i(j.get("qty"),1)),
            "paraBirimi": cur(j.get("currency")),
            "teslimTarihi": j.get("dateout")
        })
    pay_snaps=[]
    for pid in pay_ids:
        p=payments.get(str(pid)) if isinstance(payments,dict) else None
        if not p: continue
        pay_snaps.append({
            "id": pid,
            "tutar": p.get("amount") or 0,
            "paraBirimi": cur(p.get("currency")),
            "tarih": p.get("date"),
            "odemeTuru": "Nakit",
            "aciklama": p.get("note") or ""
        })
    jt=c.get("jobTotal") if isinstance(c.get("jobTotal"),dict) else {"TRY":0,"EUR":0,"USD":0}
    pt=c.get("paymentTotal") if isinstance(c.get("paymentTotal"),dict) else {"TRY":0,"EUR":0,"USD":0}
    bal=c.get("balance") if isinstance(c.get("balance"),dict) else (c.get("balanceAutoCalculated") or {"TRY":0,"EUR":0,"USD":0})
    note=str(c.get("note") or ("Legacy dönem · "+str(c.get("drName") or ""))).strip()
    A(f"""DO $pl$
DECLARE v_h int; v_id int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "LegacyImportMap" WHERE "Tur"='closure' AND "LegacyId"={lid}) THEN
    SELECT "NewId"::int INTO v_h FROM "LegacyImportMap" WHERE "Tur"='doctor' AND "LegacyId"={dr};
    IF v_h IS NOT NULL THEN
      INSERT INTO "CariDonemleri"
      ("HekimId","BaslangicTarihi","KapanisTarihi","IsSayisi","ToplamlarJson","TahsilatlarJson",
       "BakiyelerJson","IslerSnapshotJson","TahsilatlarSnapshotJson","DevirEklendi","GeriAlindi","Notlar","OlusturmaTarihi")
      VALUES
      (v_h,NULL,{dt(c.get("closedAt"))},{len(job_snaps)},{q(json_text(jt))},{q(json_text(pt))},
       {q(json_text(bal))},{q(json_text(job_snaps))},{q(json_text(pay_snaps))},{b(c.get("carriedForward",True))},FALSE,
       {q(note)},{dt(c.get("closedAt"))})
      RETURNING "Id" INTO v_id;
      INSERT INTO "LegacyImportMap" ("Tur","LegacyId","NewId")
      VALUES ('closure',{lid},v_id) ON CONFLICT ("Tur","LegacyId") DO NOTHING;
    END IF;
  END IF;
END $pl$;""")

# Archive every legacy top-level collection, sanitized input is expected.
archive_keys = ["doctors","jobs","payments","technicians","pendingJobs","expenses","sales",
                "orderForms","doctorSubmissions","mailFilters","deletionLogs","statementClosures","settings"]
for tur in archive_keys:
    obj=data.get(tur)
    if isinstance(obj,dict):
        iterable=obj.items()
    elif isinstance(obj,list):
        iterable=[(str(i+1),v) for i,v in enumerate(obj)]
    else:
        continue
    for key, item in iterable:
        if not isinstance(item,(dict,list)):
            continue
        lid = i(item.get("id",key) if isinstance(item,dict) else key, 0)
        legacy_id_sql = str(lid) if lid else "NULL"
        A(f"""INSERT INTO "LegacyArsivKayitlari" ("Tur","LegacyId","KayitTarihi","JsonData")
SELECT {q(tur)},{legacy_id_sql},NOW(),{q(json_text(item))}::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM "LegacyArsivKayitlari"
  WHERE "Tur"={q(tur)}
    AND (("LegacyId"={legacy_id_sql}) OR ("LegacyId" IS NULL AND {legacy_id_sql} IS NULL))
);""")

A(f"""INSERT INTO "LegacyImportBilgisi"
("DosyaAdi","ImportTarihi","DoktorSayisi","TeknisyenSayisi","IsSayisi","BekleyenIsSayisi","TahsilatSayisi","GiderSayisi","Notlar")
SELECT
{q(display_name)},NOW(),{len(doctors) if isinstance(doctors,dict) else 0},{len(techs) if isinstance(techs,dict) else 0},
{len(jobs) if isinstance(jobs,dict) else 0},{len(pending) if isinstance(pending,dict) else 0},
{len(payments) if isinstance(payments,dict) else 0},{len(expenses) if isinstance(expenses,dict) else 0},
'V32.19 tam yedek/restore sistemi ile operasyonel alanlara ve güvenli arşive aktarıldı.'
WHERE NOT EXISTS (
  SELECT 1 FROM "LegacyImportBilgisi" WHERE "DosyaAdi"={q(display_name)}
);""")

A("COMMIT;")
out.write_text("\n\n".join(lines), encoding="utf-8", newline="\n")
print(
    f"doctors={len(doctors) if isinstance(doctors,dict) else 0}; "
    f"jobs={len(jobs) if isinstance(jobs,dict) else 0}; "
    f"pending={len(pending) if isinstance(pending,dict) else 0}; "
    f"payments={len(payments) if isinstance(payments,dict) else 0}; "
    f"expenses={len(expenses) if isinstance(expenses,dict) else 0}; "
    f"closures={len(closures) if isinstance(closures,dict) else 0}"
)
