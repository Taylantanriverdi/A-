// EkranYakala.cs - uzaktan izleme icin ekran goruntusu (JPEG). Eski panelin WebSunucu.Ekran() kodu BIREBIR
// buraya alindi (WebSunucu artik WinForms gerektirmez; panel WebSunucu.EkranKaynagi = EkranYakala.Jpeg atar).
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;

public static class EkranYakala {
    static readonly object ekranKilit = new object();
    static byte[] sonKare; static DateTime sonKareAni = DateTime.MinValue;
    static ImageCodecInfo jpeg;
    public static byte[] Ekran() {
        lock (ekranKilit) {
            if (sonKare != null && (DateTime.Now - sonKareAni).TotalMilliseconds < 150) return sonKare;
            Rectangle r = Screen.PrimaryScreen.Bounds;
            using (Bitmap b = new Bitmap(r.Width, r.Height, PixelFormat.Format24bppRgb)) {
                using (Graphics g = Graphics.FromImage(b)) g.CopyFromScreen(r.Left, r.Top, 0, 0, r.Size);
                int w = Math.Min(r.Width, 1600), h = r.Height * w / r.Width;
                using (Bitmap k = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
                    using (Graphics g2 = Graphics.FromImage(k)) { g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear; g2.DrawImage(b, 0, 0, w, h); }
                    if (jpeg == null) foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") jpeg = c;
                    EncoderParameters ep = new EncoderParameters(1); ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 72L);
                    using (MemoryStream ms = new MemoryStream()) { k.Save(ms, jpeg, ep); sonKare = ms.ToArray(); }
                }
            }
            sonKareAni = DateTime.Now; return sonKare;
        }
    }
    public static Func<byte[]> Kaynak() { return new Func<byte[]>(Ekran); }
}
