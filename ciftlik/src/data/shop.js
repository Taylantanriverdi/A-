// Mağaza kataloğu. level: açılma seviyesi. Fiyat items.js'teki `price`.
export const SHOP_TABS = [
  { id: 'seeds', name: 'Tohumlar' },
  { id: 'soil', name: 'Gübre' },
  { id: 'care', name: 'Bakım' },
];

export const SHOP = [
  { itemId: 'seed_lettuce',    tab: 'seeds', level: 1 },
  { itemId: 'seed_potato',     tab: 'seeds', level: 1 },
  { itemId: 'seed_wheat',      tab: 'seeds', level: 1 },
  { itemId: 'seed_bean',       tab: 'seeds', level: 1 },
  { itemId: 'seed_tomato',     tab: 'seeds', level: 1 },
  { itemId: 'seed_corn',       tab: 'seeds', level: 1 },
  { itemId: 'seed_carrot',     tab: 'seeds', level: 1 },
  { itemId: 'seed_spinach',    tab: 'seeds', level: 1 },
  { itemId: 'seed_strawberry', tab: 'seeds', level: 2 },
  { itemId: 'seed_sunflower',  tab: 'seeds', level: 2 },
  { itemId: 'seed_pumpkin',    tab: 'seeds', level: 3 },
  { itemId: 'seed_grape',      tab: 'seeds', level: 3 },
  { itemId: 'seed_watermelon', tab: 'seeds', level: 4 },
  { itemId: 'compost',         tab: 'soil',  level: 1 },
  { itemId: 'npk',             tab: 'soil',  level: 1 },
  { itemId: 'lime',            tab: 'soil',  level: 1 },
  { itemId: 'organic_spray',   tab: 'care',  level: 1 },
  { itemId: 'pesticide',       tab: 'care',  level: 2 },
];
export const MAX_BUY_QTY = 99;
