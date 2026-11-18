// STUB — economy-dev gerçek uygulamayla değiştirecek. İmzalar PLAN.md §13.
export function loanLimit(state) { return 5000; }
export function previewLoan(amount, termSeasons) { return { installment: 0, count: termSeasons * 4, totalRepay: amount }; }
