// Üretim zincirleri — PLAN.md §4 "Üretim zincirleri" ve §11. Denge değerleri yalnızca burada.
// Makine binaları sabit arsalarda (P1'in doğusu, karo 53–66). hours: oyun saati. kwh: iş başına elektrik.
// Çıktı kalitesi = girdilerin en düşük kalitesi; organik = tüm girdiler organikse.
export const MACHINES = {
  dairy:    { name: 'Mandıra',          price: 9000, level: 1,  lot: { x0: 53, x1: 56, y0: 6,  y1: 8 },  color: '#f2efe9' },
  mill:     { name: 'Değirmen',         price: 7000, level: 1,  lot: { x0: 58, x1: 61, y0: 6,  y1: 8 },  color: '#d8c27a' },
  bakery:   { name: 'Fırın',            price: 5000, level: 1,  lot: { x0: 63, x1: 66, y0: 6,  y1: 8 },  color: '#c96a3a' },
  cannery:  { name: 'Konserve Atölyesi', price: 4500, level: 1,  lot: { x0: 53, x1: 56, y0: 11, y1: 13 }, color: '#e8404a' },
  spinning: { name: 'İplikhane',        price: 6000, level: 1,  lot: { x0: 58, x1: 61, y0: 11, y1: 13 }, color: '#f1ece2' },
  loom:     { name: 'Dokuma Tezgâhı',   price: 9000, level: 1, lot: { x0: 63, x1: 66, y0: 11, y1: 13 }, color: '#7a5aa8' },
};

export const MACHINE_RULES = {
  queueMax: 3,
  wearPerJob: 2,          // condition −2 / iş
  slowBelow: 50,          // altında süre ×1.3
  slowMult: 1.3,
  stopBelow: 20,          // altında makine durur
  maintenancePct: 0.04,   // bakım = fiyatın %4'ü → condition 100
  kwhPrice: 2.5,          // ₺/kWh, iş başlarken ödenir (kategori 'electricity')
};

// in: { itemId: adet }, out: { itemId: adet }
export const RECIPES = {
  cheese:       { machine: 'dairy',    in: { milk: 3 },       out: { cheese: 1 },       hours: 6, kwh: 4 },
  butter:       { machine: 'dairy',    in: { milk: 2 },       out: { butter: 1 },       hours: 3, kwh: 2 },
  yogurt:       { machine: 'dairy',    in: { milk: 1 },       out: { yogurt: 1 },       hours: 4, kwh: 1 },
  goat_cheese:  { machine: 'dairy',    in: { goat_milk: 3 },  out: { goat_cheese: 1 },  hours: 6, kwh: 4 },
  flour:        { machine: 'mill',     in: { wheat: 4 },      out: { flour: 1 },        hours: 2, kwh: 3 },
  bread:        { machine: 'bakery',   in: { flour: 1 },      out: { bread: 2 },        hours: 3, kwh: 5 },
  strawberry_jam: { machine: 'cannery', in: { strawberry: 3 }, out: { strawberry_jam: 1 }, hours: 4, kwh: 2 },
  grape_jam:    { machine: 'cannery',  in: { grape: 3 },      out: { grape_jam: 1 },    hours: 4, kwh: 2 },
  tomato_juice: { machine: 'cannery',  in: { tomato: 3 },     out: { tomato_juice: 2 }, hours: 2, kwh: 2 },
  grape_juice:  { machine: 'cannery',  in: { grape: 3 },      out: { grape_juice: 2 },  hours: 2, kwh: 2 },
  yarn:         { machine: 'spinning', in: { wool: 2 },       out: { yarn: 1 },         hours: 4, kwh: 3 },
  fabric:       { machine: 'loom',     in: { yarn: 2 },       out: { fabric: 1 },       hours: 8, kwh: 6 },
};

// İşlenmiş ürünler (category 'processed'; pazarda satılır, mevsim çarpanı yok)
export const PROCESSED = {
  cheese:         { name: 'Peynir',        basePrice: 650,  freshDays: 30,  color: '#f2d27a' },
  butter:         { name: 'Tereyağı',      basePrice: 360,  freshDays: 20,  color: '#f6e08a' },
  yogurt:         { name: 'Yoğurt',        basePrice: 200,  freshDays: 7,   color: '#f7f5ef' },
  goat_cheese:    { name: 'Keçi peyniri',  basePrice: 330,  freshDays: 30,  color: '#efe6d0' },
  flour:          { name: 'Un',            basePrice: 85,   freshDays: 60,  color: '#f4efe4' },
  bread:          { name: 'Ekmek',         basePrice: 70,   freshDays: 3,   color: '#c98a4a' },
  strawberry_jam: { name: 'Çilek reçeli',  basePrice: 130,  freshDays: 120, color: '#c8303a' },
  grape_jam:      { name: 'Üzüm reçeli',   basePrice: 160,  freshDays: 120, color: '#6a2d7a' },
  tomato_juice:   { name: 'Domates suyu',  basePrice: 70,   freshDays: 14,  color: '#d8402a' },
  grape_juice:    { name: 'Üzüm suyu',     basePrice: 75,   freshDays: 14,  color: '#7a3d8f' },
  yarn:           { name: 'İplik',         basePrice: 520,  freshDays: null, color: '#e8dccb' },
  fabric:         { name: 'Kumaş',         basePrice: 1450, freshDays: null, color: '#7a5aa8' },
};
