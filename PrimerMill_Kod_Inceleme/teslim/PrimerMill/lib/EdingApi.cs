// EdingApi.cs - gercek Eding CNC API sinifi (cncapi.dll, stdcall, 32 bit).
// Eski panelin (KazimaBaslat.ps1) Add-Type blogundan BIREBIR alindi; degisiklik yok.
// Demo modunda bunun yerine lib/EdingSim.cs (ayni ad, ayni uyeler) yuklenir.
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct Cart { public double X, Y, Z, A, B, C; }

public static class Eding {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetDllDirectory(string path);

    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    public static extern int CncConnectServer(string iniFile);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncDisConnectServer();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    public static extern int CncLoadJobA(string fileName);
    // Yazılım acil stopu basılıyken hareket komutları Eding'e gitmez
    public static volatile bool AcilKilit = false;
    [DllImport("cncapi.dll", EntryPoint = "CncRunOrResumeJob", CallingConvention = CallingConvention.StdCall)]
    static extern int _CncRunOrResumeJob();
    public static int CncRunOrResumeJob() { if (AcilKilit) return -1; return _CncRunOrResumeJob(); }
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncPauseJob();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncAbortJob();
    [DllImport("cncapi.dll", EntryPoint = "CncRunSingleLine", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    static extern int _CncRunSingleLine(string line);
    public static int CncRunSingleLine(string line) { if (AcilKilit) return -1; return _CncRunSingleLine(line); }
    // Sadece acil stop rutini kullanır (M5 / M9 gibi güvenli kapatma satırları)
    public static int CncRunSingleLineZorla(string line) { return _CncRunSingleLine(line); }
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncSetOutput(int ioId, int value);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetState();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern IntPtr CncGetStateText(int state);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern IntPtr CncGetRCText(int rc);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetAllAxesHomed();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetCurrentToolNumber();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern double CncGetActualSpeed();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetOutput(int ioId);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetInput(int ioId);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetRunningStatus();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetPauseStatus();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetEMStopActive();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetCurExecLine();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncReset();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern double CncGetVariable(int varNr);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetSimulationMode();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncSetFeedOverride(double factor);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern double CncGetActualFeedOverride();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern Cart CncGetMachinePosition();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern Cart CncGetWorkPosition();

    public static Cart WorkPos() {
        try { return CncGetWorkPosition(); }
        catch {
            Cart c = new Cart();
            c.X = CncGetVariable(5001); c.Y = CncGetVariable(5002); c.Z = CncGetVariable(5003);
            c.A = CncGetVariable(5004); c.B = CncGetVariable(5005);
            return c;
        }
    }

    // Makine konumu; okunamazsa iş konumu + ofsetlerden hesaplanır
    public static Cart MachinePos() {
        try { return CncGetMachinePosition(); }
        catch {
            Cart c = new Cart();
            c.X = CncGetVariable(5001) + CncGetVariable(5221) + CncGetVariable(5211);
            c.Y = CncGetVariable(5002) + CncGetVariable(5222) + CncGetVariable(5212);
            c.Z = CncGetVariable(5003) + CncGetVariable(5223) + CncGetVariable(5213);
            c.A = CncGetVariable(5004) + CncGetVariable(5224) + CncGetVariable(5214);
            c.B = CncGetVariable(5005) + CncGetVariable(5225) + CncGetVariable(5215);
            return c;
        }
    }

    public static string StateText(int s) { IntPtr p = CncGetStateText(s); return p == IntPtr.Zero ? s.ToString() : Marshal.PtrToStringAnsi(p); }
    public static string RCText(int rc)   { IntPtr p = CncGetRCText(rc);   return p == IntPtr.Zero ? rc.ToString() : Marshal.PtrToStringAnsi(p); }
}
