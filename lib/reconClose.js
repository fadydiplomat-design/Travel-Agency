/**
 * Firestore writers for month-end reconciliation close (Phase 2).
 *
 *   reconciliationCloses/{account}_{YYYY-MM}
 *     status: prepared -> signed -> (reopened -> prepared -> signed ...)
 *
 * prepare  – whoever reconciles (Accountant) freezes the snapshot
 * sign     – a DIFFERENT person with `reconciliationSignoff` (Controller)
 * reopen   – signoff holder only, reason required; history is kept on the doc
 *
 * Once `signed`, firestore.rules freeze statement lines of that account/month,
 * new or voided bank lines dated in it, and un-clearing its lines. The doc is
 * never deleted.
 */

import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { closeDocId } from "@/lib/reconMath";
import { requireReason } from "@/lib/reversalBuilders";

export async function prepareClose(snapshot, { userName, userUid } = {}) {
  const id = closeDocId(snapshot.account, snapshot.month);
  const ref = doc(db, "reconciliationCloses", id);
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    if (cur.exists() && cur.data().status === "signed") throw new Error("هذا الشهر موقَّع ومقفول — اطلب من المدير المالي إعادة فتحه");
    const prev = cur.exists() ? cur.data() : {};
    tx.set(ref, {
      ...snapshot,
      status: "prepared",
      preparedBy: userName || "",
      preparedByUid: userUid || "",
      preparedAt: serverTimestamp(),
      signedBy: null, signedByUid: null, signedAt: null,
      reopenCount: prev.reopenCount || 0,
      reopenReason: prev.reopenReason || null,
    });
  });
  return id;
}

export async function signOffClose(id, { userName, userUid } = {}) {
  const ref = doc(db, "reconciliationCloses", id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("لا يوجد تسوية مُعدّة لهذا الشهر");
    const d = snap.data();
    if (d.status !== "prepared") throw new Error("التسوية ليست في حالة 'مُعدّة'");
    if (d.preparedByUid && d.preparedByUid === userUid) throw new Error("لا يمكن لمُعدّ التسوية أن يوقّعها (فصل المهام) — يوقّعها شخص آخر");
    if (Math.abs(Number(d.difference) || 0) >= 0.005 || d.unmatchedStatementCount > 0) {
      throw new Error("التسوية فيها فرق أو حركات غير متطابقة — أعد إعدادها");
    }
    tx.update(ref, { status: "signed", signedBy: userName || "", signedByUid: userUid || "", signedAt: serverTimestamp() });
  });
}

export async function reopenClose(id, { reason, userName, userUid } = {}) {
  const r = requireReason(reason);
  const ref = doc(db, "reconciliationCloses", id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().status !== "signed") throw new Error("الشهر غير موقَّع");
    tx.update(ref, {
      status: "reopened",
      reopenedBy: userName || "",
      reopenedByUid: userUid || "",
      reopenedAt: serverTimestamp(),
      reopenReason: r,
      reopenCount: (snap.data().reopenCount || 0) + 1,
    });
  });
}
