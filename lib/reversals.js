/**
 * Transactional reversal (void) writers — the zero-deletion rule.
 *
 *   reverseJournalEntry(id, ctx)   manual / adjustment journals
 *   reverseBankLine(id, ctx)       bank-book lines not yet bank-confirmed
 *   (treasury vouchers: voidTreasuryVoucher in lib/treasury.js)
 *
 * Each runs in ONE Firestore transaction: the original is re-read, checked,
 * flagged, and its mirror written together — so you can never end up with a
 * reversal and no flag, or two reversals of the same entry (the second
 * attempt re-reads status "reversed" and fails).
 *
 * ctx = { reason (required), userName, userUid }
 * Reversals are dated TODAY, not on the original's date: an old closed
 * period is never reopened by a correction; the correction lands in the
 * current open period (and is itself rejected by the rules if THAT period
 * is closed).
 */

import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { todayISO } from "@/lib/period";
import {
  assertReversibleJournal,
  buildJournalReversal,
  buildBankReversal,
  requireReason,
} from "@/lib/reversalBuilders";

export async function reverseJournalEntry(journalId, { reason, userName, userUid } = {}) {
  const r = requireReason(reason);
  const originalRef = doc(db, "journalEntries", journalId);
  const reversalRef = doc(collection(db, "journalEntries"));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(originalRef);
    const original = snap.exists() ? snap.data() : null;
    assertReversibleJournal(original);

    const reversal = buildJournalReversal(original, journalId, { reason: r, userName, userUid, date: todayISO() });
    tx.set(reversalRef, { ...reversal, createdAt: serverTimestamp() });
    tx.update(originalRef, {
      status: "reversed",
      reversedBy: userName || "",
      reversedByUid: userUid || "",
      reversedAt: serverTimestamp(),
      reversalEntryId: reversalRef.id,
      reversalReason: r,
    });
  });

  return { reversalEntryId: reversalRef.id };
}

export async function reverseBankLine(bankLineId, { reason, userName, userUid } = {}) {
  const r = requireReason(reason);
  const originalRef = doc(db, "bankBook", bankLineId);
  const reversalRef = doc(collection(db, "bankBook"));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(originalRef);
    if (!snap.exists()) throw new Error("Bank line not found");
    const original = snap.data();

    const reversal = buildBankReversal(original, bankLineId, { reason: r, userName, userUid, date: todayISO() });
    tx.set(reversalRef, { ...reversal, createdAt: serverTimestamp() });
    tx.update(originalRef, {
      status: "voided",
      cleared: true, // the pair is closed out; see buildBankReversal()
      voidedBy: userName || "",
      voidedByUid: userUid || "",
      voidedAt: serverTimestamp(),
      reversalLineId: reversalRef.id,
      voidReason: r,
    });
  });

  return { reversalLineId: reversalRef.id };
}
