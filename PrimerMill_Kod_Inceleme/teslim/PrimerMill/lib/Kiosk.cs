// Kiosk.cs - kiosk modu klavye kilidi (WH_KEYBOARD_LL) ve Windows kabugu yardimcilari.
// C# 5 (PowerShell 5.1 Add-Type). Yalniz kiosk.on varken (ve DEMO degilken) KazimaBaslat.ps1 baslatir.
// Kanca, PowerShell arayuz is parcacigi yerine KENDI is parcaciginda ve kendi ileti dongusunde calisir: arayuz is parcacigi
// uzun bir islemde (Eding cagrisi, bekleme) takilirsa Windows dusuk duzey kancayi zaman asimindan sonra sessizce kaldirir;
// ayri is parcaciginda kanca hep hemen cevap verir ve PowerShell koduna hic girmez.
// Engellenen: Win (sol/sag) ve Win+her tus, Menu (Apps) tusu, Alt+Tab, Alt+Esc, Ctrl+Esc, Ctrl+Shift+Esc, Alt+F4, Alt+Bosluk.
// Engellenmeyen: tek basina Esc (panelde ACIL STOP), normal yazi, Ctrl+C/V vb. Ctrl+Alt+Del yazilimla engellenemez (politikalar).
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class KioskKilit
{
    public const int VK_TAB = 0x09, VK_ESCAPE = 0x1B, VK_SPACE = 0x20, VK_F4 = 0x73;
    public const int VK_LWIN = 0x5B, VK_RWIN = 0x5C, VK_APPS = 0x5D, VK_CONTROL = 0x11;
    const int WH_KEYBOARD_LL = 13;
    const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105, WM_QUIT = 0x0012;
    const int LLKHF_ALTDOWN = 0x20;

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT { public int vkCode; public int scanCode; public int flags; public int time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }

    delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc fn, IntPtr hMod, uint threadId);
    [DllImport("user32.dll", SetLastError = true)] static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint threadId, uint msg, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string ad);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string sinif, string baslik);

    // GC: temsilci (delegate) statik alanda tutulur; yoksa toplanir ve Windows olmayan bir adrese atlar
    static LowLevelKeyboardProc kancaTemsilci;
    static IntPtr kanca = IntPtr.Zero;
    static Thread isParcacigi;
    static uint isParcacigiNo;
    static volatile bool winBasili;
    static readonly object kilit = new object();

    /// <summary>Kanca kurulu mu.</summary>
    public static bool Aktif { get { return kanca != IntPtr.Zero; } }
    /// <summary>Engellenen tus sayisi (bilgi).</summary>
    public static int Engellenen;
    /// <summary>Son hata (kanca kurulamadiysa Win32 hata kodu).</summary>
    public static string SonHata = "";

    /// <summary>Saf karar: bu tus vurusu engellensin mi. vk = sanal tus kodu; alt/ctrl = basili mi; winBasiliMi = Win tusu basili.</summary>
    public static bool Engelle(int vk, bool alt, bool ctrl, bool winBasiliMi)
    {
        if (vk == VK_LWIN || vk == VK_RWIN || vk == VK_APPS) return true;
        if (winBasiliMi) return true;
        if (alt && (vk == VK_TAB || vk == VK_ESCAPE || vk == VK_F4 || vk == VK_SPACE)) return true;
        if (ctrl && vk == VK_ESCAPE) return true;   // Ctrl+Esc ve Ctrl+Shift+Esc
        return false;
    }

    /// <summary>Kancayi ayri is parcaciginda kurar. Zaten kuruluysa bir sey yapmaz. Basari: true.</summary>
    public static bool Baslat()
    {
        lock (kilit)
        {
            if (isParcacigi != null && isParcacigi.IsAlive) return Aktif;
            var hazir = new ManualResetEvent(false);
            isParcacigi = new Thread(delegate ()
            {
                try { KancaDongusu(hazir); }
                catch (Exception ex) { SonHata = ex.Message; kanca = IntPtr.Zero; hazir.Set(); }   // is parcacigi hatasi sureci dusurmesin
            });
            isParcacigi.IsBackground = true;   // panel kapanirken sureci tutmasin
            isParcacigi.Name = "KioskKilit";
            isParcacigi.Start();
            hazir.WaitOne(3000);
            return Aktif;
        }
    }

    static void KancaDongusu(ManualResetEvent hazir)
    {
        isParcacigiNo = GetCurrentThreadId();
        kancaTemsilci = new LowLevelKeyboardProc(KancaIslev);
        IntPtr mod = IntPtr.Zero;
        try { mod = GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName); } catch { }
        kanca = SetWindowsHookEx(WH_KEYBOARD_LL, kancaTemsilci, mod, 0);
        if (kanca == IntPtr.Zero) SonHata = "SetWindowsHookEx hata " + Marshal.GetLastWin32Error();
        hazir.Set();
        if (kanca == IntPtr.Zero) return;
        MSG m;
        while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
        UnhookWindowsHookEx(kanca);
        kanca = IntPtr.Zero;
        winBasili = false;
    }

    /// <summary>Kancayi kaldirir (Windows'a gecis, panel kapanisi).</summary>
    public static void Durdur()
    {
        lock (kilit)
        {
            var t = isParcacigi;
            if (t == null) return;
            if (t.IsAlive) { PostThreadMessage(isParcacigiNo, WM_QUIT, IntPtr.Zero, IntPtr.Zero); t.Join(2000); }
            isParcacigi = null;
        }
    }

    static IntPtr KancaIslev(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            try
            {
                var k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                int msg = wParam.ToInt32();
                bool asagi = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
                bool yukari = msg == WM_KEYUP || msg == WM_SYSKEYUP;
                if (k.vkCode == VK_LWIN || k.vkCode == VK_RWIN) { if (asagi) winBasili = true; else if (yukari) winBasili = false; }
                bool alt = (k.flags & LLKHF_ALTDOWN) != 0;
                bool ctrl = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
                if (Engelle(k.vkCode, alt, ctrl, winBasili)) { if (asagi) Engellenen++; return (IntPtr)1; }
            }
            catch { }
        }
        return CallNextHookEx(kanca, nCode, wParam, lParam);
    }

    /// <summary>Windows gorev cubugu (explorer kabugu) calisiyor mu.</summary>
    public static bool GorevCubuguVar()
    {
        try { return FindWindow("Shell_TrayWnd", null) != IntPtr.Zero; } catch { return false; }
    }
}
