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
  },
};

// Eşek: çiftlik evinin yanında küçük bir sundurma (P1 dışı, karo 48–49 × 16–17)
export const DONKEY = { name: 'Eşek', homeTile: { tx: 49, ty: 17 }, shed: { x0: 48, x1: 49, y0: 16, y1: 17 } };
// Çalışanın evi / bekleme noktası (çiftlik evi kapısı önü)
export const WORKER_HOME = { tx: 42, ty: 12 };
