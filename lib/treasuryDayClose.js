/**
 * Daily cash close (Phase 2): the cashier counts the drawer, the system
 * compares the count with the stored balance and the tie-out, and the result
 * is saved as an IMMUTABLE record (treasuryDayCloses/{branch}_{account}_{date},
 * create-only in firestore.rules — a second close for the same day fails).
 * A non-zero difference needs a written note.
 */

import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { dayCloseDocId, countDifference } from "@/lib/treasuryTieOut";
import { round2 } from "@/lib/fx";

export async function closeTreasuryDay({ branch, date, account, currency, expected, ledger, counted, note, userName, userUid }) {
  const diff = countDifference(expected, counted);
  if (Math.abs(diff) >= 0.005 && String(note || "").trim().length < 3) {
    throw new Error("فيه فرق في الجرد — اكتب سبب/ملاحظة");
  }
  const id = dayCloseDocId(branch, account, date);
  const ref = doc(db, "treasuryDayCloses", id);
  await runTransaction(db, async (tx) => {
    if ((await tx.get(ref)).exists()) throw new Error("اليوم ده اتقفل بالفعل لهذا الحساب");
    tx.set(ref, {
      branch: String(branch || "1"),
      date,
      account,
      currency,
      expectedBalance: round2(expected),
      ledgerBalance: ledger == null ? null : round2(ledger),
      counted: round2(counted),
      difference: diff,
      note: String(note || "").trim(),
      closedBy: userName || "",
      closedByUid: userUid || "",
      closedAt: serverTimestamp(),
    });
  });
  return id;
}
