// PrimerMill 2 — arayüz veri sözleşmesi (ui/PrimerVeri.cs)
// ---------------------------------------------------------------------------
// Denetleyici (PowerShell) ile görünüm (ui/PrimerUI.cs) arasındaki veri sınıfları. WinForms gerektirmez:
// panel bu dosyayı PrimerUI.cs ile birlikte derler; denetleyici testleri (pwsh, Linux) yalnız bunu derler.
// C# 5, .NET Framework 4.x. Ayrıntılı sözleşme: ui/ARAYUZ_API.md
// ---------------------------------------------------------------------------
using System;
using System.Collections.Generic;

namespace PrimerUI
{
    // =====================================================================
    //  VERİ SÖZLEŞMESİ
    // =====================================================================

    /// <summary>Makinenin genel durumu (durum hapı rengi ve düğme metinleri buna göre).</summary>
    public enum Durum { Pasif, Hazirlik, Hazir, Calisiyor, Duraklatildi, Alarm }

    /// <summary>Mesaj / kayıt türü (renk: Bilgi soluk, Basari yeşil, Uyari kehribar, Hata kırmızı).</summary>
    public enum MesajTuru { Bilgi, Basari, Uyari, Hata }

    /// <summary>Takım yuvası, sensör ya da manuel değişim noktası kartı.</summary>
    public class YuvaBilgisi
    {
        /// <summary>"T1".."T6", "SENSÖR", "MANUEL"</summary>
        public string Ad;
        /// <summary>Kısa açıklama, ör. "Ø1.0 frez".</summary>
        public string Aciklama;
        /// <summary>Konumu Eding'de kayıtlı mı (#4010.. dolu).</summary>
        public bool Kayitli;
        /// <summary>Yuvada frez var mı (bilinmiyorsa true bırakın).</summary>
        public bool Dolu = true;
        /// <summary>Bu takım şu an iş milinde mi.</summary>
        public bool IsMilinde;
        /// <summary>Uyarı metni (ör. "ayarlanmadı"); doluysa kartta ⚠.</summary>
        public string Uyari;
        public double X, Y, Z, A, B;
        /// <summary>Z gösterilsin mi (alma yüksekliği).</summary>
        public bool ZVar;
        /// <summary>Yuva ayarı sihirbazı: yeni alınan değer metni ("—" yoksa).</summary>
        public string Yeni;
        /// <summary>Yuva ayarı sihirbazı: fark metni ("ölçülmedi", "ΔY 0.012").</summary>
        public string Fark;
    }

    /// <summary>Kayıtlar ekranındaki tek satır.</summary>
    public class KayitSatiri
    {
        public DateTime Zaman;
        public MesajTuru Tur;
        public string Metin;
        public KayitSatiri() { }
        public KayitSatiri(DateTime zaman, MesajTuru tur, string metin) { Zaman = zaman; Tur = tur; Metin = metin; }
    }

    /// <summary>Kalibrasyon sonuç tablosu satırı (eksen başına).</summary>
    public class KalSonucSatiri
    {
        /// <summary>"X", "Y", "Z (#4002)", "A", "B"</summary>
        public string Eksen;
        public string Eski;
        public string Duzeltme;
        public string Yeni;
        /// <summary>Düzeltme kabul sınırı içinde mi (✓).</summary>
        public bool Iyi;
        public KalSonucSatiri() { }
        public KalSonucSatiri(string eksen, string eski, string duzeltme, string yeni, bool iyi)
        { Eksen = eksen; Eski = eski; Duzeltme = duzeltme; Yeni = yeni; Iyi = iyi; }
    }

    /// <summary>Ölçüm kalitesi satırı (tekrar, RMS, açı ölçeği...).</summary>
    public class KalKaliteSatiri
    {
        public string Ad;
        public string Deger;
        public MesajTuru Tur;
        public KalKaliteSatiri() { }
        public KalKaliteSatiri(string ad, string deger, MesajTuru tur) { Ad = ad; Deger = deger; Tur = tur; }
    }

    /// <summary>Uzaktan bağlanan cihaz.</summary>
    public class UzakCihaz
    {
        public string Adres;
        public string Zaman;
        public string Son;
        public UzakCihaz() { }
        public UzakCihaz(string adres, string zaman, string son) { Adres = adres; Zaman = zaman; Son = son; }
    }

    /// <summary>Ad / değer çifti (teknik bilgi).</summary>
    public class BilgiSatiri
    {
        public string Ad;
        public string Deger;
        public MesajTuru Tur;
        public BilgiSatiri() { }
        public BilgiSatiri(string ad, string deger) { Ad = ad; Deger = deger; }
        public BilgiSatiri(string ad, string deger, MesajTuru tur) { Ad = ad; Deger = deger; Tur = tur; }
    }

    /// <summary>
    /// Denetleyicinin her tikte doldurup Kabuk.Uygula() ile verdiği tek durum nesnesi.
    /// Görünüm yalnız bunu çizer. Boş (null) alanlar "bilinmiyor" diye gösterilir.
    /// </summary>
    public class MakineDurumu
    {
        // --- genel
        public Durum Durum = Durum.Pasif;
        public string DurumMetni;
        public bool Bagli;
        public bool Demo;
        public bool EdingSimulasyon;
        public bool Onizleme;
        public bool HomeAlindi;
        public bool AcilStop;
        public bool ExtErr;
        public string Mesgul;
        public string MakineAdi;
        public string Surum;

        // --- eksenler (iş = G54'e göre, M* = makine)
        public double X, Y, Z, A, B;
        public double MX, MY, MZ, MA, MB;
        public bool KoordMakine;

        // --- takım
        public int Takim;
        public string TakimAciklama;
        public string FrezModu = "OTOMATIK";
        public bool PensAcik;
        public bool HavaYok;
        public string ManuelMesaj;

        // --- iş
        public string Dosya;
        public string Blok;
        public int Satir;
        public int ToplamSatir;
        public double Yuzde;
        public int GecenSn;
        public int KalanSn;
        public int TahminiSn;
        public string BitisSaati;
        public string IsTakimlari;
        public List<string> IsUyarilari = new List<string>();
        public List<string> IsHatalari = new List<string>();
        public bool IsTamamlandi;
        public int Hiz = 100;

        // --- blok
        public string BlokDurum;
        public bool BekleyenBlok;
        public string BlokSonrakiIsim;
        public double BlokKalinlik = 16;
        public double BlokDerinlik = 0.15;

        // --- mesaj
        public string SonMesaj;
        public MesajTuru SonMesajTuru;
        public DateTime SonMesajZamani;

        // --- yuvalar
        public List<YuvaBilgisi> Yuvalar = new List<YuvaBilgisi>();
        public string YuvaOrtak;
        public string YuvaDurum;
        public bool YuvaKaydedilmemis;

        // --- iş mili / hava
        public int IsMiliDevir;
        public bool IsMiliCalisiyor;
        public bool M7;
        public bool M8;

        // --- makine değişkenleri
        /// <summary>G54 X Y Z A B (#5221–#5225), 5 eleman.</summary>
        public double[] G54 = new double[5];
        /// <summary>G92 X Y Z A B (#5211–#5215), 5 eleman.</summary>
        public double[] G92 = new double[5];
        /// <summary>#4000–#4006, 7 eleman.</summary>
        public double[] Param = new double[7];
        public bool DegiskenlerOkundu;
        public string UreticiFark;
        public string RafOzeti;
        public string SonYedek;

        // --- disk kalibrasyonu
        public int DiskAdim;
        public int DiskTestNo = 1;
        public Dictionary<string, string> DiskOlcum = new Dictionary<string, string>();
        public string DiskYerlesim;
        public string DiskDurum;
        public List<KalSonucSatiri> DiskSonuc = new List<KalSonucSatiri>();
        public List<string> DiskUyarilar = new List<string>();
        public bool DiskSonucHazir;

        // --- otomatik kalibrasyon
        public int OtoAdim;
        public bool ProbTestAktif;
        public bool ProbTemas;
        public bool ProbTestGecti;
        public string ProbGiris;
        public string OtoDurum;
        public bool OtoOlcumBitti;
        public bool OtoSonucHazir;
        public bool OtoBuyuk;
        public List<KalSonucSatiri> OtoSonuc = new List<KalSonucSatiri>();
        public List<KalKaliteSatiri> OtoKalite = new List<KalKaliteSatiri>();
        public List<string> OtoUyarilar = new List<string>();

        // --- tercihler (panel_ayarlar.ini anahtarları)
        public Dictionary<string, string> Ayarlar = new Dictionary<string, string>();

        // --- kayıtlar / teknik
        public List<KayitSatiri> Kayitlar = new List<KayitSatiri>();
        public List<BilgiSatiri> Teknik = new List<BilgiSatiri>();
        public List<BilgiSatiri> Klasorler = new List<BilgiSatiri>();

        // --- uzaktan
        public bool UzakAcik;
        public string UzakAdres;
        public List<string> UzakAdresler = new List<string>();
        public string UzakPin;
        public string UzakIzin = "izle";
        public string UzakDurumMetni;
        public List<UzakCihaz> UzakCihazlar = new List<UzakCihaz>();

        public string Ayar(string anahtar, string varsayilan)
        {
            string v;
            if (Ayarlar != null && anahtar != null && Ayarlar.TryGetValue(anahtar, out v) && v != null) return v;
            return varsayilan;
        }
    }

    /// <summary>Kabuk.Komut olayının argümanı.</summary>
    public class KomutArgs : EventArgs
    {
        private string ad, arg;
        public string Ad { get { return ad; } set { ad = value; } }
        public string Arg { get { return arg; } set { arg = value; } }
        public KomutArgs(string ad, string arg) { this.ad = ad; this.arg = arg ?? ""; }
        public override string ToString() { return ad + (string.IsNullOrEmpty(arg) ? "" : " " + arg); }
    }

    /// <summary>Yeni blok diyaloğu sonucu.</summary>
    public class BlokSonucu
    {
        /// <summary>-1 vazgeç, 0 kazı ve işe başla, 1 sadece ismi kazı, 2 yeni blok hazır, 3 kullanılmış blok hazır, 4 bekleyeni iptal.</summary>
        public int Secim = -1;
        public string Isim;
        public double Kalinlik;
        public double Derinlik;
    }

    /// <summary>Yarım kalan iş diyaloğu sonucu.</summary>
    public class DevamSonucu
    {
        /// <summary>"tam" (önerilen, ~10 sn geriden), "yakin", "guvenli" (işlem başı), "bastan" ya da "iptal".</summary>
        public string Secim = "iptal";
        /// <summary>İş milinde takılı frez (0 = yok).</summary>
        public int Takim;
    }
}
