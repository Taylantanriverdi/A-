# A-

## Dental NC Simülatörü

`NC_Simulator/` hyperDENT NC dosyaları için çevrimdışı kazıma simülatörüdür (tek dosya: `NC_Simulator.html`, kullanım için `NC_Simulator/OKUBENI.txt`).

- `src/core.js`: DOM'suz çekirdek (NC ayrıştırıcı, takım çapı tanıma). `npm run build` ile `NC_Simulator.html` içine gömülür.
- `tools/gen_synthetic.mjs`: gerçek takım çapları bilinen sentetik NC dosyası üretir.
- `npm test`: takım çapı tanımayı sentetik dosyalarla doğrular.
