using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Models;

namespace PrimerLabV2.Data;

public class PrimerLabDbContext : DbContext
{
    public PrimerLabDbContext(DbContextOptions<PrimerLabDbContext> options)
        : base(options)
    {
    }

    public DbSet<Hekim> Hekimler => Set<Hekim>();
    public DbSet<Hasta> Hastalar => Set<Hasta>();
    public DbSet<Siparis> Siparisler => Set<Siparis>();
    public DbSet<SiparisKalemi> SiparisKalemleri => Set<SiparisKalemi>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Hekim>(entity =>
        {
            entity.Property(x => x.AdSoyad).HasMaxLength(150).IsRequired();
            entity.Property(x => x.KlinikAdi).HasMaxLength(200);
            entity.Property(x => x.Telefon).HasMaxLength(50);
            entity.Property(x => x.Email).HasMaxLength(250);
            entity.HasIndex(x => x.AdSoyad);
            entity.HasIndex(x => x.Aktif);
        });

        modelBuilder.Entity<Hasta>(entity =>
        {
            entity.Property(x => x.AdSoyad).HasMaxLength(150).IsRequired();
            entity.Property(x => x.Telefon).HasMaxLength(50);
            entity.HasOne(x => x.Hekim)
                .WithMany(x => x.Hastalar)
                .HasForeignKey(x => x.HekimId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(x => x.AdSoyad);
            entity.HasIndex(x => x.HekimId);
            entity.HasIndex(x => x.Aktif);
        });

        modelBuilder.Entity<Siparis>(entity =>
        {
            entity.Property(x => x.Durum).HasMaxLength(80).IsRequired();
            entity.HasOne(x => x.Hasta)
                .WithMany(x => x.Siparisler)
                .HasForeignKey(x => x.HastaId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(x => x.Durum);
            entity.HasIndex(x => x.OlusturmaTarihi);
        });

        modelBuilder.Entity<SiparisKalemi>(entity =>
        {
            entity.Property(x => x.IsTuru).HasMaxLength(200).IsRequired();
            entity.Property(x => x.BirimFiyat).HasPrecision(18, 2);
            entity.HasOne(x => x.Siparis)
                .WithMany(x => x.Kalemler)
                .HasForeignKey(x => x.SiparisId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(x => x.SiparisId);
        });
    }
}
