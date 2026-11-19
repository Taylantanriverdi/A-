// Kayit.cs - panel günlüğü (loglar\Panel_*.log). Eski panelin Kayit sınıfının günlük kısmı BİREBİR.
// Eski Kayit.Show (WinForms mesaj kutusu) yeni arayüzde PrimerUI.Diyalog ile yapılır (lib/ArayuzKapisi.ps1);
// pencere metni ve cevabı yine burada günlüğe yazılır. WinForms gerektirmez (testlerde pwsh ile yüklenir).
using System;
using System.IO;

public static class Kayit {
    static StreamWriter w;
    static readonly object kilit = new object();
    public static string Dosya = "";
    public static void Ac(string klasor) {
        try {
            Directory.CreateDirectory(klasor);
            Dosya = Path.Combine(klasor, "Panel_" + DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss") + ".log");
            w = new StreamWriter(Dosya, true, new System.Text.UTF8Encoding(true));
            w.AutoFlush = true;
        } catch { w = null; }
    }
    public static void Yaz(string metin) {
        lock (kilit) {
            if (w == null) return;
            try { w.WriteLine(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + (metin ?? "").Replace("\r\n", " | ").Replace("\n", " | ")); } catch { }
        }
    }
    public static void Kapat() { lock (kilit) { try { if (w != null) { w.Flush(); w.Close(); } } catch { } w = null; } }
}
