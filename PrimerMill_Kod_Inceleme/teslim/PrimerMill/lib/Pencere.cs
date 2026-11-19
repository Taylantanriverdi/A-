// Pencere.cs - Eding penceresini gizle / goster / nazikce kapat (user32 P/Invoke).
// Eski panelin Add-Type blogundan BIREBIR alindi.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Pencere {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    // Eding'i düzgün kapat (gizliyken de): başlığı "CNC" ile başlayan ana pencereye WM_CLOSE.
    // Eding kapanırken G54 ve kalıcı değişkenleri kaydeder; zorla öldürmek bunları kaybettirebilir.
    public static int Kapat(int pid) {
        var l = new List<IntPtr>();
        EnumWindows(delegate (IntPtr h, IntPtr x) {
            uint p; GetWindowThreadProcessId(h, out p);
            if (p == (uint)pid) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.ToString().StartsWith("CNC")) l.Add(h); }
            return true;
        }, IntPtr.Zero);
        foreach (var h in l) PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
        return l.Count;
    }
    static readonly HashSet<IntPtr> gizli = new HashSet<IntPtr>();
    static List<IntPtr> Bul(int pid, bool gorunur) {
        var l = new List<IntPtr>();
        EnumWindows(delegate (IntPtr h, IntPtr x) {
            uint p; GetWindowThreadProcessId(h, out p);
            if (p == (uint)pid && IsWindowVisible(h) == gorunur) l.Add(h);
            return true;
        }, IntPtr.Zero);
        return l;
    }
    public static string SonGizlenen = "";
    public static string Gizlenemedi = "";
    public static int Gizle(int pid) {
        int n = 0;
        foreach (var h in Bul(pid, true)) {
            var sc = new StringBuilder(64); GetClassName(h, sc, 64);
            var st = new StringBuilder(256); GetWindowText(h, st, 256);
            string sinif = sc.ToString(), baslik = st.ToString();
            // Eding'in ana penceresi bir iletişim kutusu sınıfı (#32770) olabilir: başlığı "CNC" ile başlıyorsa her durumda gizle.
            // Başka başlıklı #32770 kutuları (hata / uyarı mesajları) görünür kalsın.
            // Bu makinede ana pencerenin başlığı farklı olabilir: büyük pencereler (ana ekran, açılış ekranı) de gizlenir.
            RECT rc; GetWindowRect(h, out rc);
            bool buyuk = (rc.R - rc.L) > 560 && (rc.B - rc.T) > 360;
            bool ana = baslik.StartsWith("CNC") || buyuk;
            if (!ana && sinif == "#32770" && baslik.Length > 0) continue;
            ShowWindow(h, 0); gizli.Add(h); n++;
            if (IsWindowVisible(h)) Gizlenemedi = "'" + baslik + "'";
            SonGizlenen = "'" + baslik + "' [" + sinif + "]";
        }
        return n;
    }
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
    // Eding'in kendi uyarı/hata kutuları (gizlenmeyen küçük pencereler) panelin ÜSTÜNE alınır; yoksa panel TopMost olduğu için arkada kalırlar
    public static int UyarilariOneAl(int pid) {
        int n = 0;
        foreach (var h in Bul(pid, true)) {
            if (gizli.Contains(h)) continue;
            SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);   // HWND_TOPMOST, NOSIZE|NOMOVE|NOACTIVATE
            n++;
        }
        return n;
    }
    public static int Goster(int pid) {
        int n = 0; IntPtr son = IntPtr.Zero;
        foreach (var h in Bul(pid, false)) { if (gizli.Contains(h)) { ShowWindow(h, 9); gizli.Remove(h); son = h; n++; } }
        if (son != IntPtr.Zero) SetForegroundWindow(son);
        return n;
    }
}
