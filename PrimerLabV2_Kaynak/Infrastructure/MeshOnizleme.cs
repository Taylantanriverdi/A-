using System.Buffers.Binary;
using System.Globalization;
using System.Text;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Tarama / tasarım dosyalarının (STL, PLY, OBJ) hafif 3B önizlemesi.
/// Büyük ağız içi taramaları (milyonlarca üçgen) fare ile üzerine gelindiğinde hızlı
/// açılabilsin diye ağ "vertex clustering" ile sadeleştirilir ve ikili bir dosyaya yazılır:
///   "PLM1" | uint32 noktaSayisi | uint32 ucgenSayisi | float32[3*nokta] | uint32[3*ucgen]
/// Sonuç App_Data\Onizleme altında saklanır; aynı dosya ikinci kez hesaplanmaz.
/// </summary>
public static class MeshOnizleme
{
    public static readonly HashSet<string> Desteklenen = new(StringComparer.OrdinalIgnoreCase) { ".stl", ".ply", ".obj" };

    private const int HedefUcgen = 160_000;
    private static readonly SemaphoreSlim Esik = new(2, 2);

    public static async Task<string?> OnizlemeYolu(string kaynak, string uzanti, string onbellekKlasoru, string anahtar, CancellationToken ct)
    {
        if (!Desteklenen.Contains(uzanti) || !File.Exists(kaynak)) return null;

        Directory.CreateDirectory(onbellekKlasoru);
        var bilgi = new FileInfo(kaynak);
        var hedef = Path.Combine(onbellekKlasoru, $"{anahtar}_{bilgi.Length}.bin");
        if (File.Exists(hedef)) return hedef;

        await Esik.WaitAsync(ct);
        try
        {
            if (File.Exists(hedef)) return hedef;
            var mesh = await Task.Run(() => Oku(kaynak, uzanti), ct);
            if (mesh == null || mesh.Ucgenler.Count == 0) return null;
            var sade = mesh.Ucgenler.Count / 3 > HedefUcgen ? Sadelestir(mesh) : mesh;

            var gecici = hedef + ".tmp";
            await using (var akis = new FileStream(gecici, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                var bas = new byte[12];
                Encoding.ASCII.GetBytes("PLM1").CopyTo(bas, 0);
                BinaryPrimitives.WriteUInt32LittleEndian(bas.AsSpan(4), (uint)(sade.Noktalar.Count / 3));
                BinaryPrimitives.WriteUInt32LittleEndian(bas.AsSpan(8), (uint)(sade.Ucgenler.Count / 3));
                await akis.WriteAsync(bas, ct);
                var nokta = new byte[sade.Noktalar.Count * 4];
                for (var i = 0; i < sade.Noktalar.Count; i++)
                    BinaryPrimitives.WriteSingleLittleEndian(nokta.AsSpan(i * 4), sade.Noktalar[i]);
                await akis.WriteAsync(nokta, ct);
                var ucgen = new byte[sade.Ucgenler.Count * 4];
                for (var i = 0; i < sade.Ucgenler.Count; i++)
                    BinaryPrimitives.WriteInt32LittleEndian(ucgen.AsSpan(i * 4), sade.Ucgenler[i]);
                await akis.WriteAsync(ucgen, ct);
            }
            File.Move(gecici, hedef, overwrite: true);
            return hedef;
        }
        finally
        {
            Esik.Release();
        }
    }

    private sealed class Mesh
    {
        public List<float> Noktalar { get; } = new();
        public List<int> Ucgenler { get; } = new();
    }

    private static Mesh? Oku(string yol, string uzanti) => uzanti.ToLowerInvariant() switch
    {
        ".stl" => StlOku(yol),
        ".ply" => PlyOku(yol),
        ".obj" => ObjOku(yol),
        _ => null
    };

    // ---------------------------------------------------------------- STL
    private static Mesh StlOku(string yol)
    {
        var uzunluk = new FileInfo(yol).Length;
        using var fs = new FileStream(yol, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 20);
        var bas = new byte[84];
        var okunan = fs.Read(bas, 0, 84);
        if (okunan == 84)
        {
            var n = BinaryPrimitives.ReadUInt32LittleEndian(bas.AsSpan(80));
            if (84L + 50L * n == uzunluk)
            {
                var m = new Mesh();
                var kayit = new byte[50];
                for (long i = 0; i < n; i++)
                {
                    fs.ReadExactly(kayit);
                    var b = m.Noktalar.Count / 3;
                    for (var k = 0; k < 9; k++)
                        m.Noktalar.Add(BinaryPrimitives.ReadSingleLittleEndian(kayit.AsSpan(12 + k * 4)));
                    m.Ucgenler.Add(b); m.Ucgenler.Add(b + 1); m.Ucgenler.Add(b + 2);
                }
                return m;
            }
        }

        // ASCII STL
        fs.Position = 0;
        using var sr = new StreamReader(fs);
        var mesh = new Mesh();
        var say = 0;
        string? satir;
        while ((satir = sr.ReadLine()) != null)
        {
            var t = satir.Trim();
            if (!t.StartsWith("vertex", StringComparison.OrdinalIgnoreCase)) continue;
            var p = t.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
            if (p.Length < 4) continue;
            mesh.Noktalar.Add(F(p[1])); mesh.Noktalar.Add(F(p[2])); mesh.Noktalar.Add(F(p[3]));
            if (++say % 3 == 0)
            {
                var b = say - 3;
                mesh.Ucgenler.Add(b); mesh.Ucgenler.Add(b + 1); mesh.Ucgenler.Add(b + 2);
            }
        }
        return mesh;
    }

    // ---------------------------------------------------------------- OBJ
    private static Mesh ObjOku(string yol)
    {
        var m = new Mesh();
        foreach (var satir in File.ReadLines(yol))
        {
            if (satir.StartsWith("v ", StringComparison.Ordinal))
            {
                var p = satir.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (p.Length >= 4) { m.Noktalar.Add(F(p[1])); m.Noktalar.Add(F(p[2])); m.Noktalar.Add(F(p[3])); }
            }
            else if (satir.StartsWith("f ", StringComparison.Ordinal))
            {
                var p = satir.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                var adet = m.Noktalar.Count / 3;
                var idx = new List<int>();
                for (var i = 1; i < p.Length; i++)
                {
                    var s = p[i];
                    var kes = s.IndexOf('/');
                    if (kes >= 0) s = s[..kes];
                    if (!int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v)) continue;
                    idx.Add(v < 0 ? adet + v : v - 1);
                }
                for (var i = 1; i + 1 < idx.Count; i++) { m.Ucgenler.Add(idx[0]); m.Ucgenler.Add(idx[i]); m.Ucgenler.Add(idx[i + 1]); }
            }
        }
        Temizle(m);
        return m;
    }

    // ---------------------------------------------------------------- PLY
    private sealed record PlyOzellik(string Ad, string Tip, string? ListeSayiTipi);
    private sealed record PlyEleman(string Ad, long Adet, List<PlyOzellik> Ozellikler);

    private static Mesh? PlyOku(string yol)
    {
        using var fs = new FileStream(yol, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 20);
        var elemanlar = new List<PlyEleman>();
        string bicim = "ascii";
        var baslik = new StringBuilder();
        // Başlık satır satır, ham bayt olarak okunur (ikili veri başlığın hemen ardından başlar).
        while (true)
        {
            var satir = HamSatir(fs);
            if (satir == null) return null;
            var t = satir.Trim();
            if (t == "end_header") break;
            var p = t.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (p.Length == 0) continue;
            if (p[0] == "format" && p.Length > 1) bicim = p[1];
            else if (p[0] == "element" && p.Length >= 3)
                elemanlar.Add(new PlyEleman(p[1], long.Parse(p[2], CultureInfo.InvariantCulture), new List<PlyOzellik>()));
            else if (p[0] == "property" && elemanlar.Count > 0)
            {
                if (p.Length >= 5 && p[1] == "list") elemanlar[^1].Ozellikler.Add(new PlyOzellik(p[4], p[3], p[2]));
                else if (p.Length >= 3) elemanlar[^1].Ozellikler.Add(new PlyOzellik(p[2], p[1], null));
            }
        }

        var m = new Mesh();
        if (bicim == "ascii")
        {
            using var sr = new StreamReader(fs);
            foreach (var e in elemanlar)
            {
                for (long i = 0; i < e.Adet; i++)
                {
                    var satir = sr.ReadLine();
                    if (satir == null) break;
                    var p = satir.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                    var j = 0; float x = 0, y = 0, z = 0; var yuz = new List<int>();
                    foreach (var oz in e.Ozellikler)
                    {
                        if (oz.ListeSayiTipi != null)
                        {
                            var n = (int)F(p[j++]);
                            for (var k = 0; k < n; k++) yuz.Add((int)F(p[j++]));
                        }
                        else
                        {
                            var v = j < p.Length ? F(p[j]) : 0; j++;
                            if (oz.Ad == "x") x = v; else if (oz.Ad == "y") y = v; else if (oz.Ad == "z") z = v;
                        }
                    }
                    PlyEkle(m, e.Ad, x, y, z, yuz);
                }
            }
        }
        else
        {
            var buyuk = bicim == "binary_big_endian";
            using var br = new BinaryReader(new BufferedStream(fs, 1 << 20));
            foreach (var e in elemanlar)
            {
                for (long i = 0; i < e.Adet; i++)
                {
                    float x = 0, y = 0, z = 0; var yuz = new List<int>();
                    foreach (var oz in e.Ozellikler)
                    {
                        if (oz.ListeSayiTipi != null)
                        {
                            var n = (int)Deger(br, oz.ListeSayiTipi, buyuk);
                            for (var k = 0; k < n; k++) yuz.Add((int)Deger(br, oz.Tip, buyuk));
                        }
                        else
                        {
                            var v = (float)Deger(br, oz.Tip, buyuk);
                            if (oz.Ad == "x") x = v; else if (oz.Ad == "y") y = v; else if (oz.Ad == "z") z = v;
                        }
                    }
                    PlyEkle(m, e.Ad, x, y, z, yuz);
                }
            }
        }
        Temizle(m);
        return m;
    }

    private static void PlyEkle(Mesh m, string eleman, float x, float y, float z, List<int> yuz)
    {
        if (eleman == "vertex") { m.Noktalar.Add(x); m.Noktalar.Add(y); m.Noktalar.Add(z); }
        else if (eleman == "face")
            for (var i = 1; i + 1 < yuz.Count; i++) { m.Ucgenler.Add(yuz[0]); m.Ucgenler.Add(yuz[i]); m.Ucgenler.Add(yuz[i + 1]); }
    }

    private static double Deger(BinaryReader br, string tip, bool buyuk)
    {
        switch (tip)
        {
            case "char": case "int8": return br.ReadSByte();
            case "uchar": case "uint8": return br.ReadByte();
            case "short": case "int16": { var b = br.ReadBytes(2); return buyuk ? BinaryPrimitives.ReadInt16BigEndian(b) : BinaryPrimitives.ReadInt16LittleEndian(b); }
            case "ushort": case "uint16": { var b = br.ReadBytes(2); return buyuk ? BinaryPrimitives.ReadUInt16BigEndian(b) : BinaryPrimitives.ReadUInt16LittleEndian(b); }
            case "int": case "int32": { var b = br.ReadBytes(4); return buyuk ? BinaryPrimitives.ReadInt32BigEndian(b) : BinaryPrimitives.ReadInt32LittleEndian(b); }
            case "uint": case "uint32": { var b = br.ReadBytes(4); return buyuk ? BinaryPrimitives.ReadUInt32BigEndian(b) : BinaryPrimitives.ReadUInt32LittleEndian(b); }
            case "float": case "float32": { var b = br.ReadBytes(4); return buyuk ? BinaryPrimitives.ReadSingleBigEndian(b) : BinaryPrimitives.ReadSingleLittleEndian(b); }
            case "double": case "float64": { var b = br.ReadBytes(8); return buyuk ? BinaryPrimitives.ReadDoubleBigEndian(b) : BinaryPrimitives.ReadDoubleLittleEndian(b); }
            default: throw new InvalidDataException("Bilinmeyen PLY tipi: " + tip);
        }
    }

    private static string? HamSatir(Stream s)
    {
        var b = new List<byte>();
        int c;
        while ((c = s.ReadByte()) != -1)
        {
            if (c == '\n') return Encoding.ASCII.GetString(b.ToArray()).TrimEnd('\r');
            b.Add((byte)c);
            if (b.Count > 4096) return null;
        }
        return b.Count > 0 ? Encoding.ASCII.GetString(b.ToArray()) : null;
    }

    // Geçersiz indeksli üçgenleri at.
    private static void Temizle(Mesh m)
    {
        var n = m.Noktalar.Count / 3;
        var temiz = new List<int>(m.Ucgenler.Count);
        for (var i = 0; i + 2 < m.Ucgenler.Count; i += 3)
        {
            int a = m.Ucgenler[i], b = m.Ucgenler[i + 1], c = m.Ucgenler[i + 2];
            if (a < 0 || b < 0 || c < 0 || a >= n || b >= n || c >= n) continue;
            temiz.Add(a); temiz.Add(b); temiz.Add(c);
        }
        m.Ucgenler.Clear();
        m.Ucgenler.AddRange(temiz);
    }

    // ---------------------------------------------------------------- sadeleştirme
    // Vertex clustering: uzay ızgaraya bölünür, aynı hücredeki noktalar ortalamalarıyla birleşir,
    // çökmüş ve tekrarlanan üçgenler atılır. Hedef sayının üstünde kalırsa daha kaba ızgarayla tekrarlanır.
    private static Mesh Sadelestir(Mesh m)
    {
        float minX = float.MaxValue, minY = float.MaxValue, minZ = float.MaxValue;
        float maxX = float.MinValue, maxY = float.MinValue, maxZ = float.MinValue;
        for (var i = 0; i < m.Noktalar.Count; i += 3)
        {
            float x = m.Noktalar[i], y = m.Noktalar[i + 1], z = m.Noktalar[i + 2];
            if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
            if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
        }
        var boyut = Math.Max(maxX - minX, Math.Max(maxY - minY, maxZ - minZ));
        if (boyut <= 0) return m;

        Mesh sonuc = m;
        foreach (var bolum in new[] { 260, 200, 150, 110, 80 })
        {
            sonuc = Kumele(m, minX, minY, minZ, boyut / bolum);
            if (sonuc.Ucgenler.Count / 3 <= HedefUcgen) break;
        }
        return sonuc;
    }

    private static Mesh Kumele(Mesh m, float minX, float minY, float minZ, float hucre)
    {
        var hucreNo = new Dictionary<long, int>();
        var toplam = new List<double>();
        var adet = new List<int>();
        var eslem = new int[m.Noktalar.Count / 3];
        for (var i = 0; i < eslem.Length; i++)
        {
            float x = m.Noktalar[i * 3], y = m.Noktalar[i * 3 + 1], z = m.Noktalar[i * 3 + 2];
            long cx = (long)((x - minX) / hucre), cy = (long)((y - minY) / hucre), cz = (long)((z - minZ) / hucre);
            var anahtar = (cx << 42) | (cy << 21) | cz;
            if (!hucreNo.TryGetValue(anahtar, out var no))
            {
                no = adet.Count;
                hucreNo[anahtar] = no;
                toplam.Add(0); toplam.Add(0); toplam.Add(0);
                adet.Add(0);
            }
            toplam[no * 3] += x; toplam[no * 3 + 1] += y; toplam[no * 3 + 2] += z;
            adet[no]++;
            eslem[i] = no;
        }

        var sonuc = new Mesh();
        for (var i = 0; i < adet.Count; i++)
        {
            sonuc.Noktalar.Add((float)(toplam[i * 3] / adet[i]));
            sonuc.Noktalar.Add((float)(toplam[i * 3 + 1] / adet[i]));
            sonuc.Noktalar.Add((float)(toplam[i * 3 + 2] / adet[i]));
        }

        var gorulen = new HashSet<(int, int, int)>();
        for (var i = 0; i + 2 < m.Ucgenler.Count; i += 3)
        {
            int a = eslem[m.Ucgenler[i]], b = eslem[m.Ucgenler[i + 1]], c = eslem[m.Ucgenler[i + 2]];
            if (a == b || b == c || a == c) continue;
            // Yönü koruyarak en küçük indeksten başlayan sıraya döndür (tekrar tespiti için)
            (int, int, int) k = a < b && a < c ? (a, b, c) : b < c ? (b, c, a) : (c, a, b);
            if (!gorulen.Add(k)) continue;
            sonuc.Ucgenler.Add(a); sonuc.Ucgenler.Add(b); sonuc.Ucgenler.Add(c);
        }
        return sonuc;
    }

    private static float F(string s) =>
        float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : 0f;
}
