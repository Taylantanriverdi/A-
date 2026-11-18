// Hayvanlar — PLAN.md §4 "Hayvanlar" ve §10. Denge değerleri yalnızca burada.
// price: satın alma. feed: yem eşyası ve günlük porsiyon (ekin alternatifi: altFeed {itemId: porsiyon değeri}).
// product: ürün eşyası, intervalDays: üretim aralığı, qty: adet. adultDays: yetişkinliğe (üretim) kadar gün.
// lifeDays: ömür (oyun günü; 1 yıl = 112 gün). oldAt: bu oranından sonra üretim %50.
export const ANIMALS = {
  chicken: { name: 'Tavuk',  price: 350,  building: 'coop', level: 2, feed: { itemId: 'chicken_feed', perDay: 1 },   altFeed: { wheat: 1, corn: 2 },
             product: { itemId: 'egg', intervalDays: 1, qty: 1 }, adultDays: 7,  lifeDays: 448, oldAt: 0.75, breedChance: 0.02, color: '#f3ead8', accent: '#d9472b' },
  goat:    { name: 'Keçi',   price: 1800, building: 'barn', level: 4, feed: { itemId: 'hay', perDay: 0.7 },          altFeed: { corn: 2, wheat: 1 },
             product: { itemId: 'goat_milk', intervalDays: 1, qty: 1 }, adultDays: 14, lifeDays: 672, oldAt: 0.75, breedChance: 0.015, color: '#e9e1d2', accent: '#8a6a4a' },
  sheep:   { name: 'Koyun',  price: 2200, building: 'barn', level: 4, feed: { itemId: 'hay', perDay: 0.7 },          altFeed: { corn: 2, wheat: 1 },
             product: { itemId: 'wool', intervalDays: 3, qty: 1 }, adultDays: 14, lifeDays: 672, oldAt: 0.75, breedChance: 0.015, color: '#f4f0e8', accent: '#3a3230' },
  cow:     { name: 'İnek',   price: 4000, building: 'barn', level: 4, feed: { itemId: 'hay', perDay: 1.4 },          altFeed: { corn: 2, wheat: 1 },
             product: { itemId: 'milk', intervalDays: 1, qty: 1 }, adultDays: 14, lifeDays: 896, oldAt: 0.75, breedChance: 0.01, color: '#f2efe9', accent: '#2b2522' },
  bee:     { name: 'Arı kovanı', price: 1200, building: 'hive', level: 3, feed: null, upkeepPerDay: 3, altFeed: null,
             product: { itemId: 'honey', intervalDays: 5, qty: 1 }, adultDays: 0, lifeDays: Infinity, oldAt: 1, breedChance: 0, noWinter: true,
             flowerBonus: { crops: ['sunflower'], minPlants: 4, mult: 1.3 }, color: '#f2b84b', accent: '#4a3520' },
};

// Bakım kuralları (saatlik/günlük). Değerler 0..100 (100 = iyi).
export const CARE = {
  hungerPerHourEmpty: 4,       // yemlikte yem yokken açlık düşüşü (100 = tok)
  thirstPerHourEmpty: 5,
  recoverPerHour: 6,           // yem/su varken toparlanma
  lowThreshold: 30,            // altında sağlık düşer
  healthLossPerHour: 1.0,
  dirtPerDay: { coop: 12, barn: 15, hive: 0 },  // temizlik 0 = temiz, 100 = çok kirli
  sickChanceDaily: 0.03,       // kir > 60 iken hayvan başına; salgın olayında ×5 (Aşama 7)
  sickHealthPerHour: 1.5,
  petHappiness: 10,            // günde bir kez sevme
  productQuality: { A: 80, B: 50 }, // mutluluk eşikleri
  minForProduction: 40,        // açlık/susuzluk/sağlık bunun üstünde olmalı
};

export const VET = { visitPrice: 300, cureChance: 1.0, healthAfter: 70 };

// Ürünler (pazarda satılır; seasonMult = 1)
export const ANIMAL_PRODUCTS = {
  egg:       { name: 'Yumurta',    basePrice: 18,  freshDays: 10,  color: '#f3e3c3' },
  milk:      { name: 'Süt',        basePrice: 130, freshDays: 2,   color: '#f7f5ef' },
  goat_milk: { name: 'Keçi sütü',  basePrice: 70,  freshDays: 2,   color: '#efe8da' },
  wool:      { name: 'Yün',        basePrice: 200, freshDays: 60,  color: '#f1ece2' },
  honey:     { name: 'Bal',        basePrice: 280, freshDays: 120, color: '#e8a93a' },
};
