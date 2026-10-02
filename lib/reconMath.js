/**
 * Month-end bank reconciliation math (Phase 2) — pure functions, no Firebase.
 *
 * The old reconciliationSummary() used each bank line's CURRENT `cleared`
 * flag, so a June reconciliation re-run in August gave a different answer
 * once July's statement cleared June's outstanding items. These functions
 * compute the position AS OF a date, which is what a sign-off must freeze.
 *
 * A bank-book line counts as OUTSTANDING at `asOf` when it is dated on or
 * before `asOf` and the bank had not yet confirmed it by then:
 *   - not cleared at all, or
 *   - cleared by a statement line dated AFTER asOf (a cheque that cleared
 *     next month), or
 *   - voided by a reversal dated AFTER asOf (it was still a live item then).
 * Reversal lines dated after asOf are simply excluded by the date filter.
 */

import { round2 } from "@/lib/fx";

export const monthOf = (d) => String(d || "").slice(0, 7);

export function monthEndISO(month) {
  const [y, m] = String(month).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

export const closeDocId = (account, month) => `${account}_${month}`;

const signed = (b) => (b.type === "in" ? Number(b.amount) || 0 : -(Number(b.amount) || 0));

export function reconciliationAsOf({ bankLines, statementLines, asOf, statementEndingBalance }) {
  const clearedOn = new Map(); // bankLineId -> date of the statement line that cleared it
  (statementLines || []).forEach((s) => {
    if (s.matchedBankLineId) clearedOn.set(s.matchedBankLineId, s.date || "");
  });
  const reversalDate = new Map(); // reversal line id -> its date
  (bankLines || []).forEach((b) => {
    if (b.status === "reversal") reversalDate.set(b.id, b.date || "");
  });

  const lines = (bankLines || []).filter((b) => b.date && b.date <= asOf);
  const outstanding = lines.filter((b) => {
    if (b.status === "voided") {
      const vd = reversalDate.get(b.reversalLineId);
      return !!vd && vd > asOf; // still live at asOf; its reversal comes later
    }
    if (b.status === "reversal") return false;
    if (!b.cleared) return true;
    const cd = clearedOn.get(b.id);
    return !!cd && cd > asOf;
  });

  const bookBalance = round2(lines.reduce((s, b) => s + signed(b), 0));
  const outstandingDeposits = round2(outstanding.filter((b) => b.type === "in").reduce((s, b) => s + b.amount, 0));
  const outstandingWithdrawals = round2(outstanding.filter((b) => b.type === "out").reduce((s, b) => s + b.amount, 0));
  const adjustedBookBalance = round2(bookBalance - outstandingDeposits + outstandingWithdrawals);
  const end = Number(statementEndingBalance) || 0;
  const difference = round2(end - adjustedBookBalance);
  const unmatchedStatement = (statementLines || []).filter((s) => !s.matchedBankLineId && s.date && s.date <= asOf);

  return {
    asOf,
    bookBalance,
    outstanding,
    outstandingDeposits,
    outstandingWithdrawals,
    adjustedBookBalance,
    statementEndingBalance: end,
    difference,
    unmatchedStatement,
    reconciled: Math.abs(difference) < 0.005,
  };
}

/** What gets frozen into reconciliationCloses/{account}_{YYYY-MM}.
 *  `blockers` lists every reason this month can't be prepared for sign-off. */
export function buildCloseSnapshot({ account, month, bankLines, statementLines, statementEndingBalance }) {
  const asOf = monthEndISO(month);
  const r = reconciliationAsOf({ bankLines, statementLines, asOf, statementEndingBalance });
  const blockers = [];
  if (statementEndingBalance === "" || statementEndingBalance == null || Number.isNaN(Number(statementEndingBalance))) {
    blockers.push("رصيد نهاية الكشف مطلوب");
  }
  if (r.unmatchedStatement.length) {
    blockers.push(`${r.unmatchedStatement.length} حركة في الكشف لسه مش متطابقة ولا مسجّلة — اربطها بقيد أو سجّلها (رسوم/Suspense)`);
  }
  if (!r.reconciled) blockers.push(`الفرق = ${r.difference} (لازم يبقى صفر)`);
  return {
    blockers,
    snapshot: {
      account,
      month,
      asOf,
      statementEndingBalance: r.statementEndingBalance,
      bookBalance: r.bookBalance,
      outstandingDeposits: r.outstandingDeposits,
      outstandingWithdrawals: r.outstandingWithdrawals,
      adjustedBookBalance: r.adjustedBookBalance,
      difference: r.difference,
      outstandingCount: r.outstanding.length,
      outstandingItems: r.outstanding.slice(0, 200).map((b) => ({
        id: b.id, date: b.date, type: b.type, amount: b.amount, memo: b.memo || "",
      })),
      unmatchedStatementCount: r.unmatchedStatement.length,
    },
  };
}
