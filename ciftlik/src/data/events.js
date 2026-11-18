// Rastgele olaylar — PLAN.md §4 "Rastgele olaylar" ve §14. Her sabah 06:00'da en fazla bir yeni olay (rng).
// chance: günlük olasılık; seasons: yalnızca bu mevsimlerde; days: süre aralığı. Aynı türden aktif olay varken tekrar çıkmaz.
export const EVENTS = {
  drought:     { title: 'Bölgesel kuraklık', chance: 0.03, seasons: ['spring', 'summer', 'autumn'], days: [5, 10], summerMult: 2,
                 effect: { priceMult: [1.3, 1.5], priceItems: 'randomCrops2', moistureLossMult: 1.5, noRain: true },
                 text: (e) => `Bölgede kuraklık: ${e.itemNames} fiyatları %${e.pct} arttı.` },
  hail:        { title: 'Dolu', chance: 0.015, seasons: ['spring', 'summer'], days: [1, 1],
                 effect: { cropDamage: 30, forceWeather: 'storm' }, text: () => 'Dolu yağdı! Açık alandaki ekinler zarar gördü.' },
  frost:       { title: 'Ani don', chance: 0.02, seasons: ['spring', 'autumn'], when: 'edge', days: [1, 1],
                 effect: { cropDamage: 40, onlyNonHardy: true }, text: () => 'Ani don! Soğuğa dayanıksız ekinler zarar gördü.' },
  outbreak:    { title: 'Hayvan hastalığı salgını', chance: 0.01, seasons: null, days: [3, 6],
                 effect: { sickChanceMult: 5 }, text: () => 'Bölgede hayvan hastalığı salgını var. Ahırları temiz tut!' },
  priceCrash:  { title: 'Fiyat çöküşü', chance: 0.02, seasons: null, days: [5, 8],
                 effect: { priceMult: [0.6, 0.7], priceItems: 'randomSellable1' }, text: (e) => `${e.itemNames} fiyatları %${e.pct} düştü.` },
  subsidy:     { title: 'Devlet teşviki', chance: 0.015, seasons: null, days: [7, 7],
                 effect: { buildDiscount: 0.2, grant: 2000 }, text: () => 'Devlet teşviki: 2.000 ₺ hibe ve 7 gün boyunca inşaatlarda %20 indirim!' },
  pestWave:    { title: 'Zararlı istilası', chance: 0.02, seasons: ['summer'], days: [3, 3],
                 effect: { pestChanceMult: 3 }, text: () => 'Zararlı istilası: önümüzdeki 3 gün ekinlerini ilaçla.' },
};
// 'edge': yalnızca mevsimin ilk veya son 5 günü
export const FESTIVAL = {
  dayOfSeason: 21, hour: 10,
  title: 'Ürün yarışması festivali',
  prizes: [3000, 1500, 500],        // 1., 2., 3. — oyuncunun en değerli tek ürünü (envanterden seçer) rakiplerle yarışır
  reputation: [8, 4, 2],
  rivals: 3,                         // rakip puanı: rng × mevsimin en değerli ürün fiyatı × kalite
};
