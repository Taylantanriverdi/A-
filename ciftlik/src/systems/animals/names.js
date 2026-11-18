// Hayvan isim havuzu (Türkçe). Seçim yalnızca tohumlu rng ile yapılır.
export const ANIMAL_NAMES = {
  chicken: ['Pamuk', 'Cıvıl', 'Sarı', 'Fındık', 'Çiko', 'Bıcır', 'Gülbahar', 'Kınalı', 'Minik', 'Tombik', 'Ceylan', 'Zeytin'],
  cow: ['Sarıkız', 'Benekli', 'Alaca', 'Karagöz', 'Gelin', 'Fatoş', 'Çiçek', 'Mırnav', 'Dolunay', 'Kınalı', 'Bahar', 'Tosun'],
  goat: ['Karabaş', 'Minnoş', 'Zıpzıp', 'Boncuk', 'Fındıkkıran', 'Cilveli', 'Tüylü', 'Kirpik', 'Gamze', 'Düdük'],
  sheep: ['Pofuduk', 'Bulut', 'Kuzu', 'Karakız', 'Tırtıl', 'Kar', 'Pamuk', 'Elmas', 'Yumak', 'Beyaz'],
  bee: ['Arılar'],
};

/** Aynı binada yinelenmemeye çalışan isim seçimi. */
export function pickName(rng, type, taken) {
  const pool = ANIMAL_NAMES[type] || ANIMAL_NAMES.chicken;
  let name = rng.pick(pool);
  for (let i = 0; i < 6 && taken.has(name) && pool.length > taken.size; i++) name = rng.pick(pool);
  return name;
}
