namespace PrimerLabV2.Models
{
    public class Hekim
    {
        public int Id { get; set; }

        public string AdSoyad { get; set; } = string.Empty;

        public string? KlinikAdi { get; set; }

        public string? Telefon { get; set; }

        public string? Email { get; set; }

        public bool Aktif { get; set; } = true;

        public DateTime OlusturmaTarihi { get; set; } = DateTime.UtcNow;

        public ICollection<Hasta> Hastalar { get; set; }
            = new List<Hasta>();
    }
}