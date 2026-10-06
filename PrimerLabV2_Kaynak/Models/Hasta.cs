namespace PrimerLabV2.Models
{
    public class Hasta
    {
        public int Id { get; set; }

        public string AdSoyad { get; set; } = string.Empty;

        public int HekimId { get; set; }

        public Hekim? Hekim { get; set; }

        public string? Telefon { get; set; }

        public string? Notlar { get; set; }

        public DateTime OlusturmaTarihi { get; set; } = DateTime.UtcNow;

        public bool Aktif { get; set; } = true;

        public ICollection<Siparis> Siparisler { get; set; }
            = new List<Siparis>();
    }
}