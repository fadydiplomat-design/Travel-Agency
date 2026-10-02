/**
 * Month-end revaluation of foreign-currency cash & bank accounts (Phase 3).
 *
 * For each monetary account bound to a foreign currency (1001, 1002, 1020,
 * 1030) we compare:
 *   foreign balance × closing rate   (what it is worth now, in EGP)
 *   EGP carrying amount in the ledger (what the books say, incl. earlier
 *                                       revaluation entries)
 * and post the difference to 6810 (unrealized FX gain/loss).
 *
 * CUMULATIVE method: the adjustment is always against the balance INCLUDING
 * previous revaluation entries, so re-running in the same month gives ~0 and
 * undoing a wrong one is just reversing that single entry (the generic
 * "reverse" with the voids permission) — no auto-reversing pairs to keep in
 * step.
 *
 * Only ledger lines carrying { currency, originalAmount } count toward the
 * foreign balance. Older lines without them (pre-Phase-3 bank lines etc.)
 * are counted as `unstamped` and reported, never guessed.
 *
 * Not covered here: foreign receivables/payables (1100, 2000, 2100, 1200).
 * Those need a decision on which currency each client/supplier balance is
 * kept in; see CHANGES-PHASE-3.md.
 */

import { CHART_OF_ACCOUNTS, SYSTEM_ACCOUNTS, BASE_CURRENCY } from "@/lib/chartOfAccounts";
import { rateOn, revaluationAdjustment, round2 } from "@/lib/fx";

const EPS = 0.005;

export function computeRevaluation({ ledgerLines, rates, asOf }) {
  return CHART_OF_ACCOUNTS.filter((a) => a.fx === "monetary" && a.currency && a.currency !== BASE_CURRENCY).map((a) => {
    let units = 0;
    let book = 0;
    let unstamped = 0;
    (ledgerLines || [])
      .filter((l) => l.accountCode === a.code && l.date && l.date <= asOf)
      .forEach((l) => {
        const net = (Number(l.debit) || 0) - (Number(l.credit) || 0);
        const stamped = l.currency === a.currency && Number(l.originalAmount) > 0;
        if (stamped) {
          units += (Number(l.debit) || 0) > 0 ? Number(l.originalAmount) : -Number(l.originalAmount);
          book += net;
        } else if (l.sourceType === "revaluation") {
          book += net; // earlier adjustments are part of the carrying amount
        } else if (Math.abs(net) > EPS) {
          unstamped++;
        }
      });
    const closeRate = rateOn(rates, a.currency, asOf);
    const adjustment =
      closeRate == null ? null : revaluationAdjustment({ foreignBalance: units, bookValueEGP: book, closeRate });
    return {
      code: a.code,
      name: a.name,
      currency: a.currency,
      foreignBalance: round2(units),
      bookEGP: round2(book),
      closeRate,
      adjustment,
      unstamped,
      missingRate: closeRate == null,
    };
  });
}

/** Balanced journal lines for the rows that need an adjustment. Gain:
 *  Dr account / Cr 6810; loss: Dr 6810 / Cr account. */
export function buildRevaluationLines(rows) {
  const fx = SYSTEM_ACCOUNTS.fxUnrealized;
  const lines = [];
  rows.forEach((r) => {
    if (r.adjustment == null || Math.abs(r.adjustment) < EPS) return;
    const amt = round2(Math.abs(r.adjustment));
    if (r.adjustment > 0) {
      lines.push({ accountCode: r.code, accountName: r.name, debit: amt, credit: 0 });
      lines.push({ accountCode: fx, accountName: "FX (Gain) / Loss – Unrealized", debit: 0, credit: amt });
    } else {
      lines.push({ accountCode: fx, accountName: "FX (Gain) / Loss – Unrealized", debit: amt, credit: 0 });
      lines.push({ accountCode: r.code, accountName: r.name, debit: 0, credit: amt });
    }
  });
  return lines;
}
