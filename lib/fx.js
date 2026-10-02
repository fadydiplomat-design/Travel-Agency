/**
 * Foreign-currency structures (Phase 0).
 *
 * Collection: exchangeRates  — one IMMUTABLE doc per (currency, date):
 *   { currency, date: "YYYY-MM-DD", rate (EGP per 1 unit), source,
 *     enteredBy, enteredByUid, createdAt }
 * Rates are never edited or deleted (Firestore rules enforce it); a
 * correction is a new row with a later `enteredAt`, and the latest row for
 * a (currency, date) wins. That keeps every historical posting explainable.
 *
 * Every journal line that touches a foreign-currency account should carry
 * { currency, originalAmount, rate } next to its EGP debit/credit — see
 * stampFx(). debit/credit stay in EGP so the trial balance never mixes
 * currencies.
 */

import { BASE_CURRENCY } from "@/lib/chartOfAccounts";

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Latest-entered rate on or before `date` for `currency`; null if none. */
export function rateOn(rates, currency, date) {
  if (!currency || currency === BASE_CURRENCY) return 1;
  const candidates = (rates || [])
    .filter((r) => r.currency === currency && r.date && r.date <= date && Number(r.rate) > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.enteredAt || "").localeCompare(String(a.enteredAt || "")));
  return candidates.length ? Number(candidates[0].rate) : null;
}

/** Original-currency amount -> EGP (rounded to 2dp). */
export function toBase(amount, rate) {
  return round2((Number(amount) || 0) * (Number(rate) || 1));
}

/**
 * Attach FX metadata to a journal line. `baseAmount` is the EGP figure that
 * goes in debit/credit; originalAmount/currency/rate preserve what was
 * actually paid so settlements and revaluation can be computed later.
 */
export function stampFx(line, { currency, originalAmount, rate }) {
  if (!currency || currency === BASE_CURRENCY) return line;
  return { ...line, currency, originalAmount: round2(originalAmount), rate: Number(rate) };
}

/**
 * Realized FX on settling a foreign-currency balance.
 *   bookedRate  – rate the receivable/payable was originally booked at
 *   settleRate  – rate on the settlement date
 * For a RECEIVABLE settled at a higher rate -> gain; for a PAYABLE settled
 * at a higher rate -> loss. `side` is "receivable" | "payable".
 * Returns a signed number: positive = GAIN, negative = LOSS (in EGP).
 */
export function realizedFx({ originalAmount, bookedRate, settleRate, side }) {
  const diff = (Number(settleRate) - Number(bookedRate)) * Number(originalAmount);
  return round2(side === "payable" ? -diff : diff);
}

/**
 * Month-end revaluation of one open foreign-currency balance.
 *   foreignBalance – signed balance in original currency (debit-normal
 *                    accounts positive)
 *   bookValueEGP   – current EGP carrying amount in the ledger
 *   closeRate      – month-end rate
 * Returns the EGP adjustment to post (positive = increase carrying value).
 */
export function revaluationAdjustment({ foreignBalance, bookValueEGP, closeRate }) {
  return round2(Number(foreignBalance) * Number(closeRate) - Number(bookValueEGP));
}

/**
 * Journal lines that book a realized FX result. Gain: Cr fxRealized;
 * loss: Dr fxRealized. `counterAccount` is the account that absorbs the
 * other side (the settled AR / AP / bank line the difference came from).
 */
export function realizedFxLines(result, counterAccount, fxAccount) {
  const amt = Math.abs(round2(result));
  if (!amt) return [];
  return result > 0
    ? [
        { accountCode: counterAccount, debit: amt, credit: 0 },
        { accountCode: fxAccount, debit: 0, credit: amt },
      ]
    : [
        { accountCode: fxAccount, debit: amt, credit: 0 },
        { accountCode: counterAccount, debit: 0, credit: amt },
      ];
}
