// Çiftlik çalışanları — PLAN.md §4 "İşçiler" ve §11. İlk çalışan: Çırak (kullanıcının çocuğundan esinlenen karakter).
// Yakın işlere yürür, uzak işlere eşekle gider. Hareket oyun dakikası cinsinden (hız ×oyun hızı).
export const WORKER_TYPES = {
  apprentice: {
    title: 'Çırak', defaultName: 'Çırak', hireLevel: 1, hireCost: 0, wagePerDay: 90, payHour: 20,
    workHours: [7, 19],
    walkTilesPerMin: 0.9,      // yürüyüş: oyun dakikasında ~0.9 karo (1x'te ≈ 2 karo/sn)
    donkeyTilesPerMin: 2.4,    // eşekle
    donkeyAbove: 12,           // bundan uzak hedefe eşekle gider (karo, Öklid)
    actionMinutes: { water: 3, harvest: 4, feed: 6, waterAnimals: 4, collect: 5, clean: 15, machineCollect: 5, machineLoad: 6 },
    tasks: ['water', 'harvest', 'animals', 'machines'],  // oyuncu panelden açıp kapatır; sıra = öncelik
    unique: true, donkey: true, speedMult: 0.8, qualityBonus: 0,   // Aşama 8: çırak yavaş ama ucuz; eşeği yalnızca o kullanır
  },
  // Aşama 8 (PLAN §15): yetişkin çalışanlar — yürür; traktör/biçerdöver varsa makine görevlerinde onları kullanır.
  experienced: {
    title: 'Deneyimli işçi', hireCost: 500, wagePerDay: 170, wageJitter: 0.15, payHour: 20, workHours: [7, 19],
    walkTilesPerMin: 1.0, donkeyAbove: Infinity, speedMult: 1.0, qualityBonus: 0,
    actionMinutes: { water: 3, harvest: 4, feed: 6, waterAnimals: 4, collect: 5, clean: 15, machineCollect: 5, machineLoad: 6, plow: 4, plant: 3 },
    tasks: ['water', 'harvest', 'animals', 'machines', 'plow', 'plant'],
    skillRange: [2, 4],   // farm/animal/machine yetenek 1..5: eylem süresi × (1.25 − 0.1 × yetenek)
  },
  master: {
    title: 'Usta', hireCost: 1500, wagePerDay: 300, wageJitter: 0.15, payHour: 20, workHours: [6, 20],
    walkTilesPerMin: 1.1, donkeyAbove: Infinity, speedMult: 1.5, qualityBonus: 10,  // careScore'a +10 (A kalite şansı)
    actionMinutes: { water: 3, harvest: 4, feed: 6, waterAnimals: 4, collect: 5, clean: 15, machineCollect: 5, machineLoad: 6, plow: 4, plant: 3 },
    tasks: ['water', 'harvest', 'animals', 'machines', 'plow', 'plant'],
    skillRange: [4, 5],
  },
};
export const MAX_WORKERS = 6;
export const WORKER_NAMES = ['Ahmet', 'Ayşe', 'Mehmet', 'Fatma', 'Hasan', 'Zeynep', 'Mustafa', 'Elif', 'Hüseyin', 'Emine', 'Ali', 'Hatice', 'İbrahim', 'Meryem', 'Osman', 'Sevgi', 'Yusuf', 'Gül', 'Kemal', 'Nuray'];
// İş ilanı panosu: her pazartesi (gün % 7 === 1) 3 aday (tür + rastgele yetenek/maaş/isim)
export const HIRING = { candidates: 3, refreshEveryDays: 7 };

// Eşek: çiftlik evinin yanında küçük bir sundurma (P1 dışı, karo 48–49 × 16–17)
export const DONKEY = { name: 'Eşek', homeTile: { tx: 49, ty: 17 }, shed: { x0: 48, x1: 49, y0: 16, y1: 17 } };
// Çalışanın evi / bekleme noktası (çiftlik evi kapısı önü)
export const WORKER_HOME = { tx: 42, ty: 12 };
