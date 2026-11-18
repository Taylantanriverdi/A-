// Binalar ve sabit yerleşim arsaları — PLAN.md §4 ve §10.
// Arsalar P1 dışında (data/land.js P1_BLOCKED'i etkilemez). lot: karo dikdörtgeni (uçlar dahil); pen: hayvan gezinme alanı.
export const BUILDINGS = {
  coop: { name: 'Kümes', price: 1500, level: 2, capacity: 8, kind: 'coop',
          lots: [{ id: 'coop1', x0: 26, x1: 29, y0: 6, y1: 8, pen: { x0: 25, x1: 30, y0: 9, y1: 10 } }] },
  barn: { name: 'Ahır',  price: 6000, level: 4, capacity: 6, kind: 'barn',
          lots: [{ id: 'barn1', x0: 24, x1: 29, y0: 11, y1: 14, pen: { x0: 23, x1: 30, y0: 15, y1: 17 } }] },
  hive: { name: 'Arı kovanı yeri', price: 0, level: 3, capacity: 1, kind: 'hive',
          lots: [{ id: 'hive1', x0: 50, x1: 50, y0: 9, y1: 9 }, { id: 'hive2', x0: 51, x1: 51, y0: 11, y1: 11 },
                 { id: 'hive3', x0: 50, x1: 50, y0: 13, y1: 13 }, { id: 'hive4', x0: 51, x1: 51, y0: 15, y1: 15 }] },
};
// Yemlik/suluk: "Yem koy" bir günlük ihtiyacı (hayvan başına perDay) envanterden yemliğe aktarır; yemlik kapasitesi 3 gün.
export const TROUGH = { feedDaysMax: 3, waterDaysMax: 2 };
