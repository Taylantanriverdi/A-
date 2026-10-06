namespace PrimerLabV2.Models
{
    public class Siparis
    {
        public int Id { get; set; }

        public int HastaId { get; set; }
        public Hasta Hasta { get; set; } = null!;

        public string Durum { get; set; } = "Onay Bekliyor";

        public string? Notlar { get; set; }

        public DateTime OlusturmaTarihi { get; set; } = DateTime.UtcNow;

        public DateTime? TeslimTarihi { get; set; }

        public bool Aktif { get; set; } = true;

        public ICollection<SiparisKalemi> Kalemler { get; set; }
            = new List<SiparisKalemi>();
    }
}