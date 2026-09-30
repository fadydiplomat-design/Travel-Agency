/**
 * Treasury module engine (الخزينة).
 *
 * Design decision: an "order" (أمر توريد/صرف) and a "voucher" (سند
 * توريد/صرف) are the SAME Firestore document, distinguished only by
 * `status`:
 *   draft   -> it's an order: a decision to receive/pay money, not yet
 *              affecting any balance or the books.
 *   posted  -> it's now a voucher: the balance has moved, a journal entry
 *              exists, and it can be printed as a formal receipt.
 *   void    -> reversed. Balance and journal effects are undone via a
 *              reversal, never by deleting history.
 *
 * This mirrors how a real cash desk works (you don't re-key the same data
 * twice into an "order" then a "voucher") and avoids the two documents
 * drifting out of sync with each other.
 *
 * Collections used:
 *   treasuryVouchers  – one doc per order/voucher (see shape below)
 *   treasuryBalances  – one doc per `${account}_${currency}`, e.g. "1000_USD"
 *   journalEntries    – existing collection (see accounts/page.js); every
 *                        posted voucher writes one balanced entry here so
 *                        Trial Balance / GL / Balance Sheet pick it up for
 *                        free, with no extra code on those screens.
 *   counters          – existing atomic-sequence collection (see
 *                        lib/helpers.js) reused for voucher numbering.
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { parseNum } from "@/lib/bookingNormalize";

/* ───────────────────────────── Treasury accounts ───────────────────────
   Kept local to this module (not pulled from the page's CHART_OF_ACCOUNTS,
   which currently isn't defined/imported anywhere in accounts/page.js —
   worth a separate fix, out of scope here) so treasury works standalone.
   Add more rows here if the agency opens more cash points / bank accounts;
   `currency` is what makes an account's balance track separately from the
   same account in another currency (see treasuryBalances doc id below). */
export const TREASURY_ACCOUNTS = [
  { code: "1000", currency: "EGP", name: "الخزينة النقدية - جنيه", kind: "cash" },
  { code: "1000", currency: "USD", name: "الخزينة النقدية - دولار", kind: "cash" },
  { code: "1000", currency: "EUR", name: "الخزينة النقدية - يورو", kind: "cash" },
  { code: "1010", currency: "EGP", name: "البنك - جنيه", kind: "bank" },
  { code: "1010", currency: "USD", name: "البنك - دولار", kind: "bank" },
];

// Common contra accounts a receipt/payment posts against. Free text is
// still allowed in the UI (accountCode input), this is just a convenience
// list — mirrors the accountCode values already used elsewhere in Accounts
// (AR_ACCOUNT / AP_ACCOUNT / service-fee / expense codes).
export const CONTRA_ACCOUNTS = [
  { code: "1100", name: "عملاء (ذمم مدينة)" },
  { code: "2000", name: "موردون (ذمم دائنة)" },
  { code: "4400", name: "إيرادات خدمات/عمولة" },
  { code: "6000", name: "مرتبات وأجور" },
  { code: "6100", name: "مصروفات إدارية عمومية" },
  { code: "3000", name: "رأس المال / سحب الشريك" },
];

export function balanceDocId(accountCode, currency) {
  return `${accountCode}_${currency}`;
}

/**
 * Atomic sequential voucher number, scoped by type + branch, reusing the
 * exact `counters` collection/pattern generateInvoiceNumber() and
 * generateRegNumber() already use in lib/helpers.js — same transaction
 * semantics, so two cashiers in two branches can never collide, and a
 * deleted/voided voucher never frees up its number for reuse.
 */
export async function generateVoucherNumber(type, branch) {
  const branchKey = branch || "1";
  const prefix = type === "receipt" ? "REC" : "PAY";
  const year = new Date().getFullYear();
  const fullPrefix = `${prefix}${year}`;
  const counterRef = doc(db, "counters", `${fullPrefix}_${branchKey}`);

  const nextSeq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    if (snap.exists()) {
      const next = (snap.data().seq || 0) + 1;
      tx.update(counterRef, { seq: next, updatedAt: new Date().toISOString() });
      return next;
    }
    tx.set(counterRef, { seq: 1, prefix: fullPrefix, branch: branchKey, updatedAt: new Date().toISOString() });
    return 1;
  });

  return `${fullPrefix}-${String(nextSeq).padStart(6, "0")}`;
}

/**
 * Step 1 & 2 — أمر توريد / أمر صرف: create the DRAFT order. Nothing is
 * posted yet: no balance touched, no journal line written. This is
 * intentionally cheap/fast (no transaction needed) so an order can be
 * created, edited or thrown away freely before anyone commits it.
 */
export async function createTreasuryOrder({
  type, // "receipt" | "payment"
  date,
  amount,
  currency,
  treasuryAccount,
  contraAccount,
  partyType,
  partyCode,
  partyName,
  method,
  reference,
  memo,
  branch,
  linkedInvoiceId,
  createdBy,
}) {
  if (type !== "receipt" && type !== "payment") {
    throw new Error("Invalid voucher type");
  }
  const amt = Math.abs(parseNum(amount));
  if (!amt) throw new Error("المبلغ مطلوب");
  if (!treasuryAccount) throw new Error("حساب الخزينة مطلوب");

  const voucherNumber = await generateVoucherNumber(type, branch);

  const docRef = await addDoc(collection(db, "treasuryVouchers"), {
    type,
    voucherNumber,
    status: "draft",
    branch: branch || "1",
    date: date || new Date().toISOString().slice(0, 10),
    amount: amt,
    currency: currency || "EGP",
    treasuryAccount,
    contraAccount: contraAccount || "",
    partyType: partyType || "other",
    partyCode: partyCode || "",
    partyName: partyName || "",
    method: method || "cash",
    reference: reference || "",
    memo: memo || "",
    linkedInvoiceId: linkedInvoiceId || "",
    journalEntryId: null,
    createdBy: createdBy || "",
    createdAt: serverTimestamp(),
    postedBy: null,
    postedAt: null,
  });

  return { id: docRef.id, voucherNumber };
}

/**
 * Step 3 & 4 — ترحيل الأمر فيتحول لـ "سند" رسمي قابل للطباعة: تحديث
 * الرصيد وكتابة القيد المحاسبي يحصلوا في معاملة Firestore واحدة ذرية،
 * فمفيش سيناريو ممكن فيه الرصيد يتحدث والقيد ميتكتبش (أو العكس)، ولا
 * سيناريو فيه اتنين مستخدمين بيصرفوا من نفس الخزينة في نفس اللحظة
 * ويحصل تعارض في الرصيد.
 *
 * `allowNegative`: لو false (الافتراضي) وأمر الصرف هيخلي رصيد الخزينة
 * سالب، العملية بترفض قبل ما تكتب أي حاجة.
 */
export async function postTreasuryVoucher(voucherId, { userName, allowNegative = false } = {}) {
  const voucherRef = doc(db, "treasuryVouchers", voucherId);
  const journalRef = doc(collection(db, "journalEntries"));

  await runTransaction(db, async (tx) => {
    const voucherSnap = await tx.get(voucherRef);
    if (!voucherSnap.exists()) throw new Error("السند غير موجود");
    const v = voucherSnap.data();
    if (v.status !== "draft") throw new Error("السند تم ترحيله أو إلغاؤه بالفعل");

    const balRef = doc(db, "treasuryBalances", balanceDocId(v.treasuryAccount, v.currency));
    const balSnap = await tx.get(balRef);
    const currentBalance = balSnap.exists() ? Number(balSnap.data().balance || 0) : 0;
    const isReceipt = v.type === "receipt";
    const nextBalance = isReceipt ? currentBalance + v.amount : currentBalance - v.amount;

    if (!isReceipt && nextBalance < 0 && !allowNegative) {
      throw new Error(
        `رصيد الخزينة غير كافٍ (المتاح ${currentBalance.toLocaleString()} ${v.currency})`
      );
    }

    // Balanced Dr/Cr journal line for this voucher — same convention as
    // buildTransactionJournalLines() in accounts/page.js: receipt debits
    // the treasury account and credits the contra account; payment does
    // the reverse.
    const lines = isReceipt
      ? [
          { accountCode: v.treasuryAccount, accountName: `Treasury ${v.currency}`, debit: v.amount, credit: 0 },
          { accountCode: v.contraAccount, accountName: v.partyName || "", debit: 0, credit: v.amount },
        ]
      : [
          { accountCode: v.contraAccount, accountName: v.partyName || "", debit: v.amount, credit: 0 },
          { accountCode: v.treasuryAccount, accountName: `Treasury ${v.currency}`, debit: 0, credit: v.amount },
        ];

    tx.set(journalRef, {
      date: v.date,
      memo: `${v.voucherNumber} — ${v.memo || (isReceipt ? "سند توريد" : "سند صرف")}`,
      lines,
      totalDebit: v.amount,
      totalCredit: v.amount,
      sourceType: "treasury",
      sourceVoucherId: voucherId,
      createdBy: userName || "",
      createdAt: serverTimestamp(),
    });

    tx.set(balRef, { account: v.treasuryAccount, currency: v.currency, balance: nextBalance, updatedAt: serverTimestamp() }, { merge: true });

    tx.update(voucherRef, {
      status: "posted",
      journalEntryId: journalRef.id,
      postedBy: userName || "",
      postedAt: serverTimestamp(),
    });
  });

  return { journalEntryId: journalRef.id };
}

/**
 * Void a POSTED voucher. Never deletes it (audit trail) — reverses the
 * balance and writes a mirror-image journal entry instead, same pattern
 * accountants use on paper (a storno/reversing entry), so the original
 * voucher number and its full history stay intact and searchable.
 */
export async function voidTreasuryVoucher(voucherId, { userName } = {}) {
  const voucherRef = doc(db, "treasuryVouchers", voucherId);
  const reversalJournalRef = doc(collection(db, "journalEntries"));

  await runTransaction(db, async (tx) => {
    const voucherSnap = await tx.get(voucherRef);
    if (!voucherSnap.exists()) throw new Error("السند غير موجود");
    const v = voucherSnap.data();
    if (v.status !== "posted") throw new Error("لا يمكن إلغاء إلا سند تم ترحيله");

    const balRef = doc(db, "treasuryBalances", balanceDocId(v.treasuryAccount, v.currency));
    const balSnap = await tx.get(balRef);
    const currentBalance = balSnap.exists() ? Number(balSnap.data().balance || 0) : 0;
    const isReceipt = v.type === "receipt";
    // Reverse of whatever posting did originally.
    const nextBalance = isReceipt ? currentBalance - v.amount : currentBalance + v.amount;

    const lines = isReceipt
      ? [
          { accountCode: v.contraAccount, accountName: v.partyName || "", debit: v.amount, credit: 0 },
          { accountCode: v.treasuryAccount, accountName: `Treasury ${v.currency}`, debit: 0, credit: v.amount },
        ]
      : [
          { accountCode: v.treasuryAccount, accountName: `Treasury ${v.currency}`, debit: v.amount, credit: 0 },
          { accountCode: v.contraAccount, accountName: v.partyName || "", debit: 0, credit: v.amount },
        ];

    tx.set(reversalJournalRef, {
      date: new Date().toISOString().slice(0, 10),
      memo: `إلغاء ${v.voucherNumber}`,
      lines,
      totalDebit: v.amount,
      totalCredit: v.amount,
      sourceType: "treasury-void",
      sourceVoucherId: voucherId,
      createdBy: userName || "",
      createdAt: serverTimestamp(),
    });

    tx.set(balRef, { account: v.treasuryAccount, currency: v.currency, balance: nextBalance, updatedAt: serverTimestamp() }, { merge: true });

    tx.update(voucherRef, {
      status: "void",
      voidedBy: userName || "",
      voidedAt: serverTimestamp(),
      voidJournalEntryId: reversalJournalRef.id,
    });
  });
}

/** Delete a DRAFT order only (never a posted/void voucher — those are
 * permanent history; use voidTreasuryVoucher for a posted one). */
export async function deleteTreasuryOrder(voucherId) {
  const { deleteDoc, doc: docRef } = await import("firebase/firestore");
  await deleteDoc(docRef(db, "treasuryVouchers", voucherId));
}
