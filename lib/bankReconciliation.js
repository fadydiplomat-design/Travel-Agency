/**
 * Bank reconciliation engine.
 *
 * The gap this closes: `bankBook` (see accounts/page.js's "Bank Book" tab)
 * is a manual ledger — someone types in deposits/withdrawals. Nothing
 * checks that ledger against what the bank itself says actually happened.
 * A duplicated entry, a missed one, or a typo'd amount sits there
 * invisibly until someone notices the balance looks wrong.
 *
 * This adds the other half: import the bank's own statement, match each
 * statement line to a `bankBook` line (auto where possible, manual for the
 * rest), and surface a reconciliation summary that proves — or disproves —
 * that the two agree.
 *
 * Collections:
 *   bankBook           – existing (unchanged schema), gains one new field:
 *                        `cleared: boolean` (has this line been confirmed
 *                        against an actual statement line yet?)
 *   bankStatementLines – new. One doc per row imported from a bank
 *                        statement file: { account, date, description,
 *                        amount (signed: +deposit / -withdrawal),
 *                        matchedBankLineId: null | string, importedAt }
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Turns parsed spreadsheet rows (from XLSX.utils.sheet_to_json) into
 * bankStatementLines docs. Bank export column names vary wildly, so this
 * tries a handful of common header spellings rather than assuming one
 * fixed format — if your bank's file doesn't match, the "map columns"
 * step in the UI lets you pick which header is which manually before
 * calling this.
 */
export function normalizeStatementRows(rawRows, columnMap) {
  const { dateCol, descCol, amountCol, debitCol, creditCol } = columnMap;
  return rawRows
    .map((row) => {
      const date = parseToISODate(row[dateCol]);
      const description = String(row[descCol] ?? "").trim();
      let amount;
      if (amountCol) {
        amount = toNumber(row[amountCol]);
      } else {
        // Separate Debit/Credit columns (common in Egyptian bank exports):
        // Credit = money IN (+), Debit = money OUT (-).
        const debit = toNumber(row[debitCol]);
        const credit = toNumber(row[creditCol]);
        amount = credit - debit;
      }
      return { date, description, amount };
    })
    .filter((r) => r.date && r.amount !== 0 && !Number.isNaN(r.amount));
}

function toNumber(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

function parseToISODate(v) {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Excel serial date number
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Common DD/MM/YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

/** Writes normalized statement rows to Firestore in one batch (max 450
 * per batch, Firestore's limit is 500 — leaves headroom). */
export async function importStatementRows(rows, account) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += 450) chunks.push(rows.slice(i, i + 450));
  let imported = 0;
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach((r) => {
      const ref = doc(collection(db, "bankStatementLines"));
      batch.set(ref, { account, date: r.date, description: r.description, amount: r.amount, matchedBankLineId: null, importedAt: serverTimestamp() });
      imported += 1;
    });
    await batch.commit();
  }
  return imported;
}

/**
 * Auto-match: for each unmatched statement line, look for an uncleared
 * bankBook line on the same account with the same signed amount (a
 * deposit only matches a deposit, a withdrawal only a withdrawal) within
 * a ±DATE_WINDOW_DAYS window — banks often post a day or two off from
 * when the line was entered in bankBook. Each bankBook line can only be
 * used once (greedy nearest-date match), so two identical same-day
 * amounts don't both grab the same line.
 */
const DATE_WINDOW_DAYS = 5;

export function autoMatch(bankLines, statementLines) {
  const unclearedBankLines = bankLines.filter((b) => !b.cleared);
  const usedBankLineIds = new Set();
  const matches = []; // { statementLineId, bankLineId }

  statementLines
    .filter((s) => !s.matchedBankLineId)
    .forEach((s) => {
      const signedAmount = s.amount; // +in / -out
      let best = null;
      let bestDiff = Infinity;
      unclearedBankLines.forEach((b) => {
        if (usedBankLineIds.has(b.id)) return;
        const bAmount = b.type === "in" ? b.amount : -b.amount;
        if (Math.abs(bAmount - signedAmount) > 0.01) return;
        const diffDays = Math.abs(daysBetween(s.date, b.date));
        if (diffDays > DATE_WINDOW_DAYS) return;
        if (diffDays < bestDiff) {
          bestDiff = diffDays;
          best = b;
        }
      });
      if (best) {
        usedBankLineIds.add(best.id);
        matches.push({ statementLineId: s.id, bankLineId: best.id });
      }
    });

  return matches;
}

function daysBetween(isoA, isoB) {
  if (!isoA || !isoB) return Infinity;
  return (new Date(isoA) - new Date(isoB)) / 86400000;
}

/** Commits a set of { statementLineId, bankLineId } matches: marks each
 * bankBook line `cleared: true` and links the statement line to it. */
export async function applyMatches(matches) {
  const chunks = [];
  for (let i = 0; i < matches.length; i += 225) chunks.push(matches.slice(i, i + 225)); // 2 writes/match
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach(({ statementLineId, bankLineId }) => {
      batch.update(doc(db, "bankStatementLines", statementLineId), { matchedBankLineId: bankLineId });
      batch.update(doc(db, "bankBook", bankLineId), { cleared: true });
    });
    await batch.commit();
  }
}

/** Manual single match (used by the two-pane "click one from each list"
 * UI for whatever auto-match couldn't resolve). */
export async function matchOne(statementLineId, bankLineId) {
  await updateDoc(doc(db, "bankStatementLines", statementLineId), { matchedBankLineId: bankLineId });
  await updateDoc(doc(db, "bankBook", bankLineId), { cleared: true });
}

/** Undo a match — unclears the bankBook line and frees the statement line
 * back up, in case a match was made in error. */
export async function unmatch(statementLineId, bankLineId) {
  await updateDoc(doc(db, "bankStatementLines", statementLineId), { matchedBankLineId: null });
  await updateDoc(doc(db, "bankBook", bankLineId), { cleared: false });
}

/**
 * Reconciliation summary — the actual proof the books agree with the
 * bank, not just a feeling that they probably do. Standard bank-rec math:
 *   Book Balance − Outstanding Deposits-in-transit-equivalent adjustments
 *   should equal the Statement Ending Balance you typed in.
 * Concretely: book balance already includes every bankBook line (cleared
 * or not). The statement only shows what's actually cleared the bank. So
 * Adjusted Book Balance = Book Balance − (uncleared deposits) + (uncleared
 * withdrawals) — i.e. back out whatever hasn't hit the bank yet.
 */
export function reconciliationSummary(bankLines, statementEndingBalance) {
  const relevant = bankLines; // caller passes lines already filtered to one account
  const bookBalance = relevant.reduce((s, b) => s + (b.type === "in" ? b.amount : -b.amount), 0);
  const uncleared = relevant.filter((b) => !b.cleared);
  const unclearedDeposits = uncleared.filter((b) => b.type === "in").reduce((s, b) => s + b.amount, 0);
  const unclearedWithdrawals = uncleared.filter((b) => b.type === "out").reduce((s, b) => s + b.amount, 0);
  const adjustedBookBalance = bookBalance - unclearedDeposits + unclearedWithdrawals;
  const difference = statementEndingBalance - adjustedBookBalance;
  return {
    bookBalance,
    unclearedCount: uncleared.length,
    unclearedDeposits,
    unclearedWithdrawals,
    adjustedBookBalance,
    statementEndingBalance,
    difference,
    reconciled: Math.abs(difference) < 0.01,
  };
}
