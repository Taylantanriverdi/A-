// STUB — economy-dev gerçek uygulamayla değiştirecek. İmzalar PLAN.md §13.
export function netWorth(state) { return Number(state?.finance?.money) || 0; }
export function assetBreakdown(state) { return { money: Number(state?.finance?.money) || 0, buildings: 0, animals: 0, inventory: 0, debt: 0 }; }
