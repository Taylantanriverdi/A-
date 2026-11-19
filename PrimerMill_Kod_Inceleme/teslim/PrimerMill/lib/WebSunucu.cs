// WebSunucu.cs - uzaktan erisim HTTP sunucusu (TcpListener, arka plan is parcacigi).
// Eski panelin Add-Type blogundan alindi. Entegrasyon degisiklikleri (yalniz bunlar):
//  1) Ekran goruntusu WinForms gerektirdigi icin lib/EkranYakala.cs icine tasindi; burada EkranKaynagi temsilcisi var.
//  2) YalnizYerel: demo modunda sunucu yalniz 127.0.0.1 dinler.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
public class UzakIstek {
    public string Ad, Arg, Ip, Sonuc;
    public ManualResetEvent Bitti = new ManualResetEvent(false);
    public DateTime Zaman = DateTime.Now;   // UZ-08: bekleme süresini aşan istek geç çalıştırılmaz
    public volatile bool Iptal;
}
class PinDeneme { public int Yanlis; public DateTime Kilit = DateTime.MinValue; }
public static class WebSunucu {
    public static string Pin = "";
    public static string SayfaYolu = "";
    public static string IsKlasor = "";
    public static volatile string DurumJson = "{}";
    public static int Port = 0;
    // Demo modu: yalnız bu bilgisayardan (127.0.0.1) erişilir
    public static bool YalnizYerel = false;
    public static string SonHata = "";
    static TcpListener dinleyici;
    static Thread kabulIs;
    static volatile bool calis;
    static readonly Queue<UzakIstek> kuyruk = new Queue<UzakIstek>();
    public static DateTime SonUzakGirdi = DateTime.MinValue;
    // UZ-05: panel her saniye günceller. İş sürerken / duraklıyken yükleme yok; seçili iş dosyasının üstüne yazılmaz.
    public static volatile bool YuklemeKilit = false;
    public static volatile string SeciliAd = "";
    // UZ-03: IP başına yanlış PIN sayacı (5 yanlış -> 60 sn kilit)
    static readonly Dictionary<string, PinDeneme> denemeler = new Dictionary<string, PinDeneme>();
    const int KuyrukOmruSn = 30;

    // ---- Ekran yansıtma: makinedeki ekranın aynısı (JPEG), yalnız izleme ----
    // K4 (UZ-01): uzaktan fare / klavye (tıklama, tuş) kaldırıldı; /api/tikla ve /api/tus 403 döner.
    // Entegrasyon: görüntü lib/EkranYakala.cs (WinForms) ile alınır; panel EkranKaynagi = EkranYakala.Jpeg atar.
    public static Func<byte[]> EkranKaynagi;
    public static byte[] Ekran() {
        Func<byte[]> k = EkranKaynagi;
        if (k == null) throw new InvalidOperationException("ekran kaynağı yok");
        return k();
    }

    public static bool Baslat(int port) {
        int[] portlar = { port, port + 1, port + 2, port + 3, port + 4, 18080, 28080 };
        foreach (int p in portlar) {
            try {
                dinleyici = new TcpListener(YalnizYerel ? IPAddress.Loopback : IPAddress.Any, p);
                dinleyici.Start();
                Port = p; calis = true;
                kabulIs = new Thread(Kabul); kabulIs.IsBackground = true; kabulIs.Start();
                return true;
            } catch (Exception ex) { SonHata = ex.Message; dinleyici = null; }
        }
        return false;
    }
    public static void Durdur() { calis = false; try { if (dinleyici != null) dinleyici.Stop(); } catch { } }

    // UZ-08: süresi dolmuş (ya da istemcisi vazgeçmiş) istekler çalıştırılmadan atılır
    public static UzakIstek Al() {
        lock (kuyruk) {
            while (kuyruk.Count > 0) {
                UzakIstek i = kuyruk.Dequeue();
                if (i.Iptal || (DateTime.Now - i.Zaman).TotalSeconds > KuyrukOmruSn) { i.Sonuc = "HATA: Komut zaman asimina ugradi, calistirilmadi"; i.Bitti.Set(); continue; }
                return i;
            }
            return null;
        }
    }

    // UZ-04 (DNS rebinding): Host başlığı yalnız IP, localhost ya da bu bilgisayarın adı olabilir
    static bool HostUygun(string host) {
        if (string.IsNullOrEmpty(host)) return false;
        string h = host.Trim();
        if (h.StartsWith("[")) { int k = h.IndexOf(']'); if (k < 0) return false; h = h.Substring(1, k - 1); }
        else { int c = h.LastIndexOf(':'); if (c >= 0 && h.IndexOf(':') == c) h = h.Substring(0, c); }
        IPAddress ipa;
        if (IPAddress.TryParse(h, out ipa)) return true;
        if (h.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return true;
        try { if (h.Equals(Environment.MachineName, StringComparison.OrdinalIgnoreCase) || h.Equals(Dns.GetHostName(), StringComparison.OrdinalIgnoreCase)) return true; } catch { }
        return false;
    }
    // UZ-03: true = kilitli (429). Doğru PIN sayacı sıfırlar.
    static bool PinKilitli(string ip) {
        lock (denemeler) { PinDeneme d; return denemeler.TryGetValue(ip, out d) && d.Kilit > DateTime.Now; }
    }
    static void PinSonuc(string ip, bool dogru) {
        lock (denemeler) {
            PinDeneme d;
            if (!denemeler.TryGetValue(ip, out d)) { if (dogru) return; d = new PinDeneme(); denemeler[ip] = d; }
            if (dogru) { d.Yanlis = 0; return; }
            d.Yanlis++;
            if (d.Yanlis >= 5) { d.Yanlis = 0; d.Kilit = DateTime.Now.AddSeconds(60); }
        }
    }
    static bool Ayrilmis(string ad) {
        return ad.Equals("AKTIF_IS.nc", StringComparison.OrdinalIgnoreCase) || ad.StartsWith("PM_", StringComparison.OrdinalIgnoreCase) ||
               ad.EndsWith("_devam.nc", StringComparison.OrdinalIgnoreCase);
    }

    public static string[] Adresler() {
        List<string> l = new List<string>();
        try {
            foreach (IPAddress a in Dns.GetHostAddresses(Dns.GetHostName()))
                if (a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a)) l.Add(a.ToString());
        } catch { }
        return l.ToArray();
    }

    static void Kabul() {
        while (calis) {
            try {
                TcpClient c = dinleyici.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(delegate(object o) { Isle((TcpClient)o); }, c);
            } catch { if (!calis) return; Thread.Sleep(200); }
        }
    }

    static string SatirOku(Stream s) {
        StringBuilder sb = new StringBuilder();
        while (true) {
            int b = s.ReadByte();
            if (b < 0) return sb.Length > 0 ? sb.ToString() : null;
            if (b == '\n') break;
            if (b != '\r') sb.Append((char)b);
            if (sb.Length > 8192) return null;
        }
        return sb.ToString();
    }

    static void Gonder(Stream s, int kod, string tur, byte[] govde) {
        string durum = kod == 200 ? "OK" : kod == 204 ? "No Content" : kod == 400 ? "Bad Request" : kod == 401 ? "Unauthorized" : kod == 403 ? "Forbidden" :
                       kod == 404 ? "Not Found" : kod == 409 ? "Conflict" : kod == 429 ? "Too Many Requests" : kod == 503 ? "Service Unavailable" : "Error";
        // UZ-04: CORS başlıkları yok (başka sitelerden gelen tarayıcı istekleri cevabı okuyamaz)
        string h = "HTTP/1.1 " + kod + " " + durum + "\r\nContent-Type: " + tur + "\r\nContent-Length: " + govde.Length +
                   "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n";
        byte[] hb = Encoding.ASCII.GetBytes(h);
        s.Write(hb, 0, hb.Length); s.Write(govde, 0, govde.Length); s.Flush();
    }
    static void Json(Stream s, int kod, string json) { Gonder(s, kod, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json)); }
    static string Kacis(string t) {
        StringBuilder sb = new StringBuilder();
        foreach (char ch in t ?? "") {
            if (ch == '"' || ch == '\\') { sb.Append('\\'); sb.Append(ch); }
            else if (ch < 32) sb.Append("\\u" + ((int)ch).ToString("x4"));
            else sb.Append(ch);
        }
        return sb.ToString();
    }

    static void Isle(TcpClient c) {
        try {
            c.ReceiveTimeout = 30000; c.SendTimeout = 30000;
            using (NetworkStream s = c.GetStream()) {
                string ilk = SatirOku(s);
                if (ilk == null) return;
                string[] p = ilk.Split(' ');
                if (p.Length < 2) return;
                string yontem = p[0].ToUpperInvariant(), yol = p[1], sorgu = "";
                int q = yol.IndexOf('?'); if (q >= 0) { sorgu = yol.Substring(q + 1); yol = yol.Substring(0, q); }
                Dictionary<string, string> bas = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                string l;
                while ((l = SatirOku(s)) != null && l.Length > 0) { int i = l.IndexOf(':'); if (i > 0) bas[l.Substring(0, i).Trim()] = l.Substring(i + 1).Trim(); }
                Dictionary<string, string> par = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (string kv in sorgu.Split('&')) {
                    if (kv.Length == 0) continue;
                    int e = kv.IndexOf('=');
                    string k = e >= 0 ? kv.Substring(0, e) : kv, v = e >= 0 ? kv.Substring(e + 1) : "";
                    par[Uri.UnescapeDataString(k.Replace('+', ' '))] = Uri.UnescapeDataString(v.Replace('+', ' '));
                }
                long uzunluk = 0; string cl; if (bas.TryGetValue("Content-Length", out cl)) long.TryParse(cl, out uzunluk);
                string ip = ((IPEndPoint)c.Client.RemoteEndPoint).Address.ToString();

                string host; bas.TryGetValue("Host", out host);
                if (!HostUygun(host)) { Json(s, 403, "{\"hata\":\"Adres kabul edilmedi (makineye IP adresiyle baglanin)\"}"); return; }
                // Tarayıcı ön kontrolü: CORS izni verilmez (UZ-04)
                if (yontem == "OPTIONS") { Gonder(s, 204, "text/plain", new byte[0]); return; }
                if (yol == "/" || yol == "/index.html" || yol == "/portal" || yol == "/tek") {
                    string ad = yol == "/tek" ? "uzak.html" : "portal.html";
                    string sp = Path.Combine(Path.GetDirectoryName(SayfaYolu), ad);
                    byte[] sayfa = File.Exists(sp) ? File.ReadAllBytes(sp) : Encoding.UTF8.GetBytes(ad + " yok");
                    Gonder(s, 200, "text/html; charset=utf-8", sayfa); return;
                }
                if (!yol.StartsWith("/api/")) { Gonder(s, 404, "text/plain", Encoding.ASCII.GetBytes("yok")); return; }
                // UZ-03: PIN her zaman gerekli (en az 6 hane; panel kısa/boş PIN'i yenisiyle değiştirir). PIN başlıkta (X-PIN);
                // sorgu parametresi yalnız GET (ekran görüntüsü / durum) için kabul edilir. 5 yanlış -> 60 sn kilit.
                if (PinKilitli(ip)) { Json(s, 429, "{\"hata\":\"Cok fazla yanlis PIN: 1 dakika bekleyin\"}"); return; }
                string beklenen = Pin ?? "";
                if (beklenen.Length < 6) { Json(s, 503, "{\"hata\":\"Makinede uzaktan erisim PIN'i ayarli degil\"}"); return; }
                string pin; bas.TryGetValue("X-Pin", out pin);
                if (string.IsNullOrEmpty(pin) && yontem == "GET") par.TryGetValue("pin", out pin);
                if (pin != beklenen) { PinSonuc(ip, false); Json(s, 401, "{\"hata\":\"PIN yanlis\"}"); return; }
                PinSonuc(ip, true);

                if (yol == "/api/durum") { Json(s, 200, DurumJson); return; }
                if (yol == "/api/ekran") {
                    byte[] k;
                    try { k = Ekran(); } catch (Exception ex) { Json(s, 500, "{\"hata\":\"Ekran alinamadi (makine kilitli olabilir): " + Kacis(ex.Message) + "\"}"); return; }
                    Gonder(s, 200, "image/jpeg", k); return;
                }
                if (yol == "/api/tikla" || yol == "/api/tus") { Json(s, 403, "{\"hata\":\"Uzaktan tıklama kapalı\"}"); return; }   // K4
                if (yol == "/api/dosyalar") {
                    StringBuilder sb = new StringBuilder("[");
                    if (Directory.Exists(IsKlasor)) {
                        List<FileInfo> fl = new List<FileInfo>();
                        foreach (string f in Directory.GetFiles(IsKlasor, "*.nc")) {
                            string ad = Path.GetFileName(f);
                            if (ad.Equals("AKTIF_IS.nc", StringComparison.OrdinalIgnoreCase) || ad.StartsWith("PM_") || ad.Contains("_blok")) continue;
                            fl.Add(new FileInfo(f));
                        }
                        fl.Sort(delegate(FileInfo a, FileInfo b) { return b.LastWriteTime.CompareTo(a.LastWriteTime); });
                        for (int i = 0; i < fl.Count && i < 60; i++) {
                            if (i > 0) sb.Append(',');
                            sb.Append("{\"ad\":\"" + Kacis(fl[i].Name) + "\",\"kb\":" + (fl[i].Length / 1024) + ",\"tarih\":\"" + fl[i].LastWriteTime.ToString("dd.MM HH:mm") + "\"}");
                        }
                    }
                    sb.Append(']'); Json(s, 200, sb.ToString()); return;
                }
                if (yol == "/api/yukle" && yontem == "POST") {
                    string ad; par.TryGetValue("ad", out ad);
                    ad = Path.GetFileName(ad ?? "");
                    if (!ad.EndsWith(".nc", StringComparison.OrdinalIgnoreCase) || ad.Length < 4) { Json(s, 400, "{\"hata\":\"Sadece .nc dosyasi yuklenebilir\"}"); return; }
                    if (uzunluk <= 0 || uzunluk > 200L * 1024 * 1024) { Json(s, 400, "{\"hata\":\"Dosya bos ya da cok buyuk\"}"); return; }
                    if (Ayrilmis(ad)) { Json(s, 400, "{\"hata\":\"Bu dosya adi panele ayrilmis (AKTIF_IS, PM_..., ..._devam): dosyanin adini degistirin\"}"); return; }
                    if (YuklemeKilit) { Json(s, 409, "{\"hata\":\"Makinede is suruyor ya da duraklatilmis: yukleme yapilamaz\"}"); return; }
                    string secili = SeciliAd ?? "";
                    if (secili.Length > 0 && ad.Equals(secili, StringComparison.OrdinalIgnoreCase)) { Json(s, 409, "{\"hata\":\"Bu ad makinede secili isin dosyasi: uzerine yazilamaz, adini degistirin\"}"); return; }
                    Directory.CreateDirectory(IsKlasor);
                    string gecici = Path.Combine(IsKlasor, ad + ".yukleniyor");
                    using (FileStream fs = new FileStream(gecici, FileMode.Create)) {
                        byte[] tampon = new byte[65536]; long kalan = uzunluk;
                        while (kalan > 0) { int n = s.Read(tampon, 0, (int)Math.Min(tampon.Length, kalan)); if (n <= 0) break; fs.Write(tampon, 0, n); kalan -= n; }
                        if (kalan > 0) { fs.Close(); File.Delete(gecici); Json(s, 400, "{\"hata\":\"Yukleme yarim kaldi\"}"); return; }
                    }
                    string hedef = Path.Combine(IsKlasor, ad);
                    if (File.Exists(hedef)) File.Delete(hedef);
                    File.Move(gecici, hedef);
                    Json(s, 200, "{\"sonuc\":\"OK: " + Kacis(ad) + " yuklendi\",\"ad\":\"" + Kacis(ad) + "\"}"); return;
                }
                if (yol == "/api/komut" && yontem == "POST") {
                    UzakIstek ist = new UzakIstek();
                    par.TryGetValue("ad", out ist.Ad); par.TryGetValue("arg", out ist.Arg); ist.Ip = ip;
                    if (ist.Arg == null) ist.Arg = "";
                    lock (kuyruk) kuyruk.Enqueue(ist);
                    string sonuc;
                    if (ist.Bitti.WaitOne(45000)) sonuc = ist.Sonuc;
                    else { ist.Iptal = true; sonuc = "HATA: Panel cevap vermedi (makinedeki ekranda bir pencere acik olabilir)"; }
                    Json(s, 200, "{\"sonuc\":\"" + Kacis(sonuc) + "\"}"); return;
                }
                Gonder(s, 404, "text/plain", Encoding.ASCII.GetBytes("yok"));
            }
        } catch { }
        finally { try { c.Close(); } catch { } }
    }
}
