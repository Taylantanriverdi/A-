// Gece İstilası modu — PLAN.md §16 (K29). Mod kapalıyken bu dosyadaki hiçbir şey oyunu etkilemez.
// Tarz: ürkütücü ama sevimli (aile oyunu) — kan/vahşet yok; parlayan gözler, kızıl ay, sis.

export const RAID_MODE = { default: false };   // state.settings.raids (Ayarlar'dan aç/kapat; yeni oyunda sorulur)

// Baskın takvimi: gece 21:00–04:30. 19:00'da uyarı. Her 14 günde bir "kızıl ay" → kesin baskın, daha güçlü.
export const RAID_SCHEDULE = {
  firstDay: 4, warnHour: 19, startHour: 21, endMin: 4 * 60 + 30,
  baseChance: 0.18, chancePerDay: 0.012, maxChance: 0.55, bloodMoonEvery: 14, bloodMoonMult: 1.6,
};

// Dalgalar: gece boyunca 3 dalga; canavar sayısı = base + gün × perDay (üst sınır)
export const WAVES = { perNight: 3, gapMinutes: 70, base: 3, perDay: 0.22, max: 20 }; // K30: daha yavaş artış

// Canavarlar. speed: oyun dakikasında karo. dmg: saldırı başına hasar, rate: dakikadaki saldırı.
// targets: öncelik sırası. reward: öldürülünce düşen ₺ (yerde parıltı, otomatik toplanır).
export const MONSTERS = {
  zombie:   { name: 'Zombi',   hp: 40, speed: 0.35, dmg: 6, rate: 1.0, reward: [8, 14],  weight: 5, minDay: 1,
              targets: ['crop', 'animalBuilding', 'house', 'building'], color: '#7fa86a' },
  skeleton: { name: 'İskelet', hp: 26, speed: 0.6,  dmg: 4, rate: 1.4, reward: [10, 18], weight: 3, minDay: 6,
              targets: ['animalBuilding', 'house', 'building', 'crop'], color: '#e8e2d0' },
  ghost:    { name: 'Hayalet', hp: 18, speed: 0.5,  dmg: 3, rate: 1.2, reward: [12, 20], weight: 2, minDay: 10,
              passFences: true, fleesLight: true,      // çit ve duvarların üstünden geçer, meşaleden kaçar
              targets: ['house', 'animalBuilding', 'building'], color: '#bcd6f2' },
};

// Hasar: yapıların can puanı (placed.hp). 0'a inen yapı "harap" olur (çalışmaz) — onarım bedeli fiyatın %30'u.
export const DAMAGE = {
  houseHp: 600, buildingHpPerPrice: 0.05, minBuildingHp: 80,  // hp = max(min, fiyat × oran)
  cropTrample: 35,             // ekin karosuna basınca sağlık kaybı
  animalScare: -15,            // saldırılan binadaki hayvan mutluluğu
  repairPct: 0.3,              // harap yapı onarımı (fiyatın %30'u); hasarlı yapı orantılı
  houseRepairPerHp: 4,         // ev onarımı ₺/hp
  houseDownPenaltyPct: 0.1,    // ev 0 olursa sabah paranın %10'u "yağmalandı"
  houseDownPenaltyMax: 1500,   // K30: yağma cezası üst sınırı
};

// Savunma yapıları (data/placeables.js 'defense' kategorisi bunlardan türetilir)
export const DEFENSES = {
  barbedFence: { name: 'Telli çit', w: 1, h: 1, price: 15,   hp: 60,  blocks: true, paint: true, contactDmg: 2 },
  stoneWall:   { name: 'Taş duvar', w: 1, h: 1, price: 45,   hp: 220, blocks: true, paint: true },
  spikeTrap:   { name: 'Kazık tuzağı', w: 1, h: 1, price: 150, hp: 0, trap: true, trapDmg: 25, uses: 6 },
  brazier:     { name: 'Meşale', w: 1, h: 1, price: 400,  hp: 80, light: 4, slowZombies: 0.5 },     // ışık yarıçapı (karo)
  tower:       { name: 'Gözcü kulesi', w: 2, h: 2, price: 3000, hp: 300, range: 6, dmg: 9, rate: 1.0, mannedMult: 2.2 },  // K30: dmg 5→9
};

// Askerler (çalışan gibi kiralanır; günlük maaş 20:00'de). Gündüz uyurlar, gece 20:30'dan itibaren nöbet tutar.
export const SOLDIERS = {
  guard:  { title: 'Bekçi', hireCost: 400,  wagePerDay: 140, hp: 90,  dmg: 8,  rate: 1.2, range: 1.2, speed: 0.8, look: 'spear' },
  archer: { title: 'Okçu',  hireCost: 800,  wagePerDay: 200, hp: 60,  dmg: 6,  rate: 1.0, range: 5,   speed: 0.7, look: 'bow', towerBonus: true },
  knight: { title: 'Şövalye', hireCost: 2000, wagePerDay: 320, hp: 220, dmg: 14, rate: 1.0, range: 1.3, speed: 0.75, look: 'armor' },
};
export const MAX_SOLDIERS = 6;
export const SOLDIER_NAMES = ['Demir', 'Kaya', 'Bora', 'Tuna', 'Alp', 'Ece', 'Ilgın', 'Doğan', 'Selin', 'Kartal', 'Yiğit', 'Nehir'];
// Yaralanan asker ölmez: hp 0 → bayılır, sabah iyileşir (aile dostu).

// K30: canavarların girebildiği alan — kuzey şeridi (ufuk yamacı, çiftlik evinin arkası) kapalı.
export const MONSTER_AREA = { minTy: 6 };
