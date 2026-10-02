/**
 * Pure builders for reversing entries — no Firestore imports, so they can be
 * unit-tested and reused. The transactional writers are in lib/reversals.js.
 *
 * Rule of the system: a posted record is NEVER edited or deleted. To undo
 * it you post its mirror image (debits <-> credits) dated TODAY, and flag the
 * original as reversed. Both stay in the ledger and net to zero.
 */

import { round2 } from "@/lib/fx";
import { periodStamp } from "@/lib/period";

// Sources that must be undone through their OWN flow, never by a generic
// journal reversal (so voucher + treasury balance + ledger stay in step).
export const NON_REVERSIBLE_SOURCES = ["treasury", "treasury-void", "reversal"];

/** Swap debit/credit on every line, keeping FX metadata untouched. */
export function mirrorLines(lines) {
  return (lines || []).map((l) => ({
    ...l,
    debit: round2(l.credit || 0),
    credit: round2(l.debit || 0),
  }));
}

export function totals(lines) {
  let debit = 0;
  let credit = 0;
  (lines || []).forEach((l) => {
    debit += Number(l.debit) || 0;
    credit += Number(l.credit) || 0;
  });
  return { debit: round2(debit), credit: round2(credit), balanced: Math.abs(debit - credit) < 0.005 };
}

export function assertReversibleJournal(j) {
  if (!j) throw new Error("Entry not found");
  const status = j.status || "posted";
  if (status === "reversed") throw new Error("This entry has already been reversed");
  if (status !== "posted") throw new Error("Only a posted entry can be reversed");
  if (NON_REVERSIBLE_SOURCES.includes(j.sourceType || "manual")) {
    throw new Error(
      j.sourceType === "reversal"
        ? "A reversal entry can't itself be reversed — post a new correcting entry instead"
        : "Treasury entries are reversed by voiding the voucher in the Treasury tab"
    );
  }
}

export function requireReason(reason) {
  const r = String(reason || "").trim();
  if (r.length < 3) throw new Error("A reason is required (at least 3 characters)");
  return r;
}

/** The mirror journal document for `original` (id included in the memo). */
export function buildJournalReversal(original, originalId, { reason, userName, userUid, date }) {
  const r = requireReason(reason);
  const lines = mirrorLines(original.lines);
  const t = totals(lines);
  if (!t.balanced || t.debit === 0) throw new Error("Original entry is not balanced — cannot reverse automatically");
  const stamp = periodStamp(date, original.branch);
  return {
    ...stamp,
    memo: `Reversal of ${original.memo || originalId} — ${r}`,
    lines,
    totalDebit: t.debit,
    totalCredit: t.credit,
    sourceType: "reversal",
    status: "posted",
    reversalOf: originalId,
    reversalReason: r,
    createdBy: userName || "",
    createdByUid: userUid || "",
  };
}

/** The mirror bank-book line for `original`. It is born `cleared: true`
 *  together with the original (a voided pair must not show up as
 *  "unmatched" in Bank Reconciliation, and nets to zero in its summary). */
export function buildBankReversal(original, originalId, { reason, userName, userUid, date }) {
  const r = requireReason(reason);
  if ((original.status || "active") !== "active") throw new Error("This bank line is already voided or is a reversal");
  if (original.cleared) {
    throw new Error("This line is already matched to the bank statement — unmatch it in Bank Reconciliation first, or post a correcting line");
  }
  const stamp = periodStamp(date, original.branch);
  return {
    ...stamp,
    type: original.type === "in" ? "out" : "in",
    amount: round2(original.amount),
    currency: original.currency || "EGP",
    // Same rate/base amount as the original so the pair nets to exactly zero in EGP.
    exchangeRate: Number(original.exchangeRate) > 0 ? Number(original.exchangeRate) : 1,
    baseAmount: Number(original.baseAmount) > 0 ? Number(original.baseAmount) : round2(original.amount),
    account: original.account,
    contraAccount: original.contraAccount || "",
    supplierCode: original.supplierCode || "",
    supplierName: original.supplierName || "",
    memo: `Reversal of ${original.memo || originalId} — ${r}`,
    cleared: true,
    status: "reversal",
    reversalOf: originalId,
    voidReason: r,
    createdBy: userName || "",
    createdByUid: userUid || "",
  };
}
