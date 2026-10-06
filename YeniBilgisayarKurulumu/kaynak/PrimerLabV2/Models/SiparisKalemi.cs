using System.ComponentModel.DataAnnotations.Schema;

namespace PrimerLabV2.Models
{
    public class SiparisKalemi
    {
        public int Id { get; set; }

        public int SiparisId { get; set; }
        public Siparis Siparis { get; set; } = null!;

        public string IsTuru { get; set; } = string.Empty;

        public int Adet { get; set; } = 1;

        [Column(TypeName = "numeric(18,2)")]
        public decimal BirimFiyat { get; set; }

        [NotMapped]
        public decimal Toplam => Adet * BirimFiyat;
    }
}