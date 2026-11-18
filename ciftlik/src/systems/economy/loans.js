// Kredi hesapları — SAF (state'e yazmaz). PLAN §13. Haftalık eşit taksit (annüite), mevsimlik faiz.
import { BANK } from '../../data/economy.js';
import { netWorth } from './valuation.js';

/** Haftalık faiz oranı: mevsim oranı / (mevsimdeki hafta sayısı = 4). */
export const weeklyRate = () => BANK.seasonRate / 4;

/** Toplam kalan borç (anapara). */
export function totalDebt(state) {
  const loans = state?.finance?.loans;
  let d = 0;
  if (Array.isArray(loans)) for (const l of loans) d += Number(l.remaining) || 0;
  return d;
}

/** Yeni kredi limiti: base + netVarlık × oran − kalan borç (0'dan küçük olmaz, 100 ₺'ye aşağı yuvarlanır). */
export function loanLimit(state) {
  // K22: limit brüt varlık (netWorth + borç) üzerinden; borç yalnızca bir kez düşülür
  const debt = totalDebt(state);
  const raw = BANK.base + (netWorth(state) + debt) * BANK.assetRatio - debt;
  return Math.max(0, Math.floor(raw / 100) * 100);
}

/** Eşit taksit: A·r / (1 − (1+r)^−n), tam ₺'ye yuvarlanır. */
export function installmentFor(amount, count) {
  const r = weeklyRate();
  const n = Math.max(1, count);
  return Math.round(r > 0 ? (amount * r) / (1 - Math.pow(1 + r, -n)) : amount / n);
}

/** Önizleme: {installment, count, totalRepay, totalInterest}. */
export function previewLoan(amount, termSeasons) {
  const a = Math.max(0, Math.round(Number(amount) || 0));
  const count = Math.max(1, Math.floor(Number(termSeasons) || 1)) * 4;
  const installment = installmentFor(a, count);
  const totalRepay = installment * count;
  return { installment, count, totalRepay, totalInterest: totalRepay - a };
}

/** Bir taksidin faiz/anapara dağılımı (son taksitte anapara = kalan). */
export function splitInstallment(loan) {
  const interest = Math.round(loan.remaining * weeklyRate());
  const last = loan.paidCount + 1 >= loan.totalCount;
  const principal = last ? loan.remaining : Math.min(loan.remaining, Math.max(0, loan.installment - interest));
  return { interest, principal, total: principal + interest };
}

/** Erken kapama bedeli: kalan anapara + %1 + birikmiş gecikme borcu. */
export function earlyCloseCost(loan) {
  return Math.round(loan.remaining * (1 + BANK.earlyCloseFeePct)) + (Number(loan.arrears) || 0);
}
