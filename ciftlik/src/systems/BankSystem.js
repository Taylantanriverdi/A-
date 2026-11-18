// BankSystem — kredi (PLAN §13). Phaser import ETMEZ.
// Komutlar: bank:borrow {amount, termSeasons}, bank:repay {loanId}. Sonuç: bank:result {ok, kind, reason?, loanId?}.
// Olaylar: bank:changed {}, bank:late {loanId, lates, fee}. Para: yalnızca EconomySystem.transact.
import { BANK } from '../data/economy.js';
import { MIN_PER_DAY } from '../core/constants.js';
import { isPlainObject } from '../core/GameState.js';
import { transact } from './EconomySystem.js';
import { loanLimit, previewLoan, splitInstallment, earlyCloseCost, totalDebt } from './economy/loans.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmt = (n) => Math.round(n).toLocaleString('tr-TR');
let offs = [];

function loansOf(state) {
  if (!isPlainObject(state.finance)) state.finance = { money: 0, ledger: [], loans: [], dailySummary: [], receivables: [] };
  if (!Array.isArray(state.finance.loans)) state.finance.loans = [];
  if (!isNum(state.finance.bankLates)) state.finance.bankLates = 0;
  return state.finance.loans;
}

const result = (bus, ok, kind, extra = {}) => { bus.emit('bank:result', { ok, kind, ...extra }); return ok; };

/** Sonraki taksit zamanı: bugünden `days` gün sonra payHour:00. */
function dueAfter(state, days) {
  const day = Math.floor(state.time.totalMinutes / MIN_PER_DAY);
  return (day + days) * MIN_PER_DAY + BANK.payHour * 60;
}

export function borrow(state, bus, p = {}) {
  const loans = loansOf(state);
  const amount = Math.round(Number(p.amount));
  const term = Math.floor(Number(p.termSeasons));
  if (!(amount > 0)) return result(bus, false, 'borrow', { reason: 'Geçersiz tutar' });
  if (!BANK.termsSeasons.includes(term)) return result(bus, false, 'borrow', { reason: 'Geçersiz vade' });
  if (state.finance.bankLates >= BANK.maxLatesBeforeFreeze) return result(bus, false, 'borrow', { reason: 'Gecikmelerin yüzünden yeni kredi kapalı' });
  if (amount < BANK.minLoan) return result(bus, false, 'borrow', { reason: `En az ${fmt(BANK.minLoan)} ₺ çekebilirsin` });
  if (amount > loanLimit(state)) return result(bus, false, 'borrow', { reason: 'Kredi limitin yetmiyor' });
  const pv = previewLoan(amount, term);
  const loan = {
    id: `loan${(state.finance.loanSeq = (Number(state.finance.loanSeq) || 0) + 1)}`,
    principal: amount, remaining: amount, rate: BANK.seasonRate, termSeasons: term,
    installment: pv.installment, nextDueMin: dueAfter(state, BANK.installmentEveryDays),
    paidCount: 0, totalCount: pv.count, lates: 0, arrears: 0,
  };
  transact(state, bus, { amount, category: 'loan', label: `Kredi çekildi (${term} mevsim)` });
  loans.push(loan);
  bus.emit('bank:changed', {});
  bus.emit('toast', { text: `Kredi onaylandı: +${fmt(amount)} ₺, ${pv.count} haftalık taksit ${fmt(pv.installment)} ₺`, kind: 'good' });
  return result(bus, true, 'borrow', { loanId: loan.id });
}

export function repay(state, bus, p = {}) {
  const loans = loansOf(state);
  const i = loans.findIndex((l) => l.id === p.loanId);
  if (i < 0) return result(bus, false, 'repay', { reason: 'Kredi bulunamadı' });
  const l = loans[i];
  const cost = earlyCloseCost(l);
  if (state.finance.money < cost) return result(bus, false, 'repay', { reason: 'Erken kapama için paran yetmiyor' });
  const fee = Math.round(l.remaining * BANK.earlyCloseFeePct) + (Number(l.arrears) || 0);
  transact(state, bus, { amount: -l.remaining, category: 'loan', label: 'Kredi erken kapama (anapara)' });
  if (fee > 0) transact(state, bus, { amount: -fee, category: 'interest', label: 'Erken kapama bedeli' });
  loans.splice(i, 1);
  if (loans.length === 0) state.finance.bankLates = 0;
  bus.emit('bank:changed', {});
  bus.emit('toast', { text: 'Kredi erken kapatıldı', kind: 'good' });
  return result(bus, true, 'repay', { loanId: l.id });
}

/** Vadesi gelen taksitleri öder; yetmezse %3 ceza ile ertesi güne erteler. */
export function processDue(state, bus) {
  const loans = loansOf(state);
  const now = state.time.totalMinutes;
  let changed = false;
  for (let i = loans.length - 1; i >= 0; i--) {
    const l = loans[i];
    let guard = 0;
    while (l.nextDueMin <= now && guard++ < 8) {
      const s = splitInstallment(l);
      const due = s.total + (Number(l.arrears) || 0);
      if (state.finance.money >= due) {
        if (s.interest > 0) transact(state, bus, { amount: -s.interest, category: 'interest', label: 'Kredi faizi' });
        if (s.principal > 0) transact(state, bus, { amount: -s.principal, category: 'loan', label: 'Kredi taksiti (anapara)' });
        if (l.arrears > 0) transact(state, bus, { amount: -l.arrears, category: 'penalty', label: 'Gecikme cezası' });
        l.arrears = 0;
        l.remaining -= s.principal;
        l.paidCount++;
        changed = true;
        if (l.paidCount >= l.totalCount || l.remaining <= 0) {
          loans.splice(i, 1);
          if (loans.length === 0) state.finance.bankLates = 0;
          bus.emit('toast', { text: 'Kredi tamamen ödendi', kind: 'good' });
          break;
        }
        l.nextDueMin = dueAfter(state, BANK.installmentEveryDays);
      } else {
        // ertelenir: taksit bir hafta sonra yeniden denenir; her ıskalama gecikme sayar (3 → yeni kredi kapalı)
        const fee = Math.round(l.installment * BANK.lateFeePct);
        l.nextDueMin = dueAfter(state, BANK.installmentEveryDays);
        l.arrears = (Number(l.arrears) || 0) + fee;
        l.lates++; state.finance.bankLates++;
        changed = true;
        bus.emit('bank:late', { loanId: l.id, lates: l.lates, fee });
        bus.emit('toast', { text: `Kredi taksidi ödenemedi: +${fmt(fee)} ₺ gecikme cezası eklendi`, kind: 'bad' });
        break;
      }
    }
  }
  if (changed) bus.emit('bank:changed', {});
}

export function validate(state, onFix = () => {}) {
  if (!isPlainObject(state.finance)) return state;
  const f = state.finance;
  if (!isNum(f.bankLates) || f.bankLates < 0) { if ('bankLates' in f) onFix('finance.bankLates'); f.bankLates = 0; }
  if (!Array.isArray(f.loans)) f.loans = [];
  const ok = f.loans.filter((l) => isPlainObject(l) && typeof l.id === 'string' && isNum(l.principal) && isNum(l.remaining) && l.remaining >= 0
    && isNum(l.installment) && l.installment > 0 && isNum(l.nextDueMin) && isNum(l.paidCount) && isNum(l.totalCount) && l.totalCount > 0);
  if (ok.length !== f.loans.length) onFix('finance.loans');
  for (const l of ok) {
    if (!isNum(l.lates)) l.lates = 0;
    if (!isNum(l.arrears)) l.arrears = 0;
    if (!isNum(l.rate)) l.rate = BANK.seasonRate;
    if (!isNum(l.termSeasons)) l.termSeasons = Math.max(1, Math.round(l.totalCount / 4));
  }
  f.loans = ok;
  return state;
}

const BankSystem = {
  id: 'bank',
  borrow, repay, processDue, validate, loanLimit, totalDebt,

  init(state, bus) {
    for (const off of offs) off();
    offs = [];
    loansOf(state);
    offs.push(bus.on('bank:borrow', (p) => borrow(state, bus, p)));
    offs.push(bus.on('bank:repay', (p) => repay(state, bus, p)));
  },

  onHour(state, bus) { processDue(state, bus); },
};

export default BankSystem;
