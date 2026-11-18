import { MIN_PER_DAY, DAYS_PER_SEASON, SEASONS } from './constants.js';

/**
 * totalMinutes'tan takvim türetir. Gün 1'den başlar.
 * @param {number} totalMinutes
 * @returns {{day:number, dayOfSeason:number, hour:number, minute:number, season:string, seasonIndex:number, year:number, dayFraction:number}}
 */
export function calendar(totalMinutes) {
  const dayIndex = Math.floor(totalMinutes / MIN_PER_DAY);
  const minOfDay = totalMinutes - dayIndex * MIN_PER_DAY;
  const seasonAbs = Math.floor(dayIndex / DAYS_PER_SEASON);
  const seasonIndex = seasonAbs % 4;
  return {
    day: dayIndex + 1,
    dayOfSeason: (dayIndex % DAYS_PER_SEASON) + 1,
    hour: Math.floor(minOfDay / 60),
    minute: Math.floor(minOfDay % 60),
    season: SEASONS[seasonIndex],
    seasonIndex,
    year: Math.floor(seasonAbs / 4) + 1,
    dayFraction: minOfDay / MIN_PER_DAY,
  };
}

export function formatClock(totalMinutes) {
  const c = calendar(totalMinutes);
  return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}
