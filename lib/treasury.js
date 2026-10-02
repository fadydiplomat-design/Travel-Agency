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
import { CHART_OF_ACCOUNTS, BASE_CURRENCY, treasuryAccountCode } from "@/lib/chartOfAccounts";
import { round2, toBase, stampFx } from "@/lib/fx";
import { periodStamp, todayISO } from "@/lib/period";
import { requireReason } from "@/lib/reversalBuilders";

/* ───────────────────────────── Treasury accounts ───────────────────────
   Kept local to this module (not pulled from the page's CHART_OF_ACCOUNTS,
   which currently isn't defined/imported anywhere in accounts/page.js —
   worth a separate fix, out of scope here) so treasury works standalone.
   Add more rows here if the agency opens more cash points / bank accounts;
   `currency` is what makes an account's balance track separately from the
   same account in another currency (see treasuryBalances doc id below). */
export const TREASURY_ACCOUNTS = [
  { code: treasuryAccountCode("cash", "EGP"), currency: "EGP", name: "الخزينة النقدية - جنيه", kind: "cash" },
  { code: treasuryAccountCode("cash", "USD"), currency: "USD", name: "الخزينة النقدية - دولار", kind: "cash" },
  { code: treasuryAccountCode("cash", "EUR"), currency: "EUR", name: "الخزينة النقدية - يورو", kind: "cash" },
  { code: treasuryAccountCode("bank", "EGP"), currency: "EGP", name: "البنك - جنيه", kind: "bank" },
  { code: treasuryAccountCode("bank", "USD"), currency: "USD", name: "البنك - دولار", kind: "bank" },
  { code: treasuryAccountCode("bank", "EUR"), currency: "EUR", name: "البنك - يورو", kind: "bank" },
];

// Common contra accounts a receipt/payment posts against. Free text is
// still allowed in the UI (accountCode input), this is just a convenience
// list — mirrors the accountCode values already used elsewhere in Accounts
// (AR_ACCOUNT / AP_ACCOUNT / service-fee / expense codes).
export const CONTRA_ACCOUNTS = CHART_OF_ACCOUNTS.filter((a) => !a.currency && !a.legacy).map((a) => ({
  code: a.code,
  name: a.name,
}));

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
  createdByUid,
  exchangeRate, // EGP per 1 unit of `currency`; REQUIRED when currency != EGP
}) {
  if (type !== "receipt" && type !== "payment") {
    throw new Error("Invalid voucher type");
  }
  const amt = Math.abs(parseNum(amount));
  if (!amt) throw new Error("المبلغ مطلوب");
  if (!treasuryAccount) throw new Error("حساب الخزينة مطلوب");

  const cur = currency || BASE_CURRENCY;
  const rate = cur === BASE_CURRENCY ? 1 : Number(parseNum(exchangeRate));
  if (cur !== BASE_CURRENCY && !(rate > 0)) {
    throw new Error("سعر الصرف مطلوب للعملات الأجنبية (Exchange rate required)");
  }
  const stamp = periodStamp(date, branch);
  const voucherNumber = await generateVoucherNumber(type, branch);

  const docRef = await addDoc(collection(db, "treasuryVouchers"), {
    type,
    voucherNumber,
    status: "draft",
    branch: stamp.branch,
    fiscalYear: stamp.fiscalYear,
    date: stamp.date,
    amount: amt,
    currency: cur,
    // FX: journal debit/credit are always in EGP so the trial balance never
    // mixes currencies; the original amount + rate stay on the voucher.
    exchangeRate: rate,
    baseAmount: toBase(amt, rate),
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
    createdByUid: createdByUid || "",
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
export async function postTreasuryVoucher(voucherId, { userName, userUid, canApprove = false, allowNegative = false } = {}) {
  const voucherRef = doc(db, "treasuryVouchers", voucherId);
  const journalRef = doc(collection(db, "journalEntries"));
  const policyRef = doc(db, "settings", "accountingPolicy");

  await runTransaction(db, async (tx) => {
    const voucherSnap = await tx.get(voucherRef);
    if (!voucherSnap.exists()) throw new Error("السند غير موجود");
    const v = voucherSnap.data();
    if (v.status !== "draft") throw new Error("السند تم ترحيله أو إلغاؤه بالفعل");

    // Approval limit (mirrors treasuryPostOk() in firestore.rules): above the
    // per-currency limit, a DIFFERENT person holding treasuryApprove must post.
    const policySnap = await tx.get(policyRef);
    const limit = policySnap.exists() ? policySnap.data()?.approvalLimits?.[v.currency] : undefined;
    if (typeof limit === "number" && v.amount > limit) {
      if (!canApprove) {
        throw new Error(`المبلغ ${v.amount.toLocaleString()} ${v.currency} يتجاوز حد الاعتماد (${limit.toLocaleString()}) — يلزم اعتماد المدير المالي`);
      }
      if (v.createdByUid && v.createdByUid === userUid) {
        throw new Error("لا يمكن لمنشئ الأمر اعتماده (فصل المهام) — يجب أن يعتمده شخص آخر");
      }
    }

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

    // Balanced Dr/Cr journal for this voucher — receipt debits the treasury
    // account and credits the contra account; payment does the reverse.
    // debit/credit are in EGP (baseAmount); the foreign amount + rate ride on
    // the lines so settlements / revaluation can be computed later. Vouchers
    // created before FX support have no baseAmount and are treated as EGP-par.
    const rate = Number(v.exchangeRate) > 0 ? Number(v.exchangeRate) : 1;
    const base = Number(v.baseAmount) > 0 ? Number(v.baseAmount) : round2(v.amount * rate);
    const fx = { currency: v.currency, originalAmount: v.amount, rate };
    const treasuryName = `Treasury ${v.currency}`;
    const lines = isReceipt
      ? [
          stampFx({ accountCode: v.treasuryAccount, accountName: treasuryName, debit: base, credit: 0 }, fx),
          { accountCode: v.contraAccount, accountName: v.partyName || "", debit: 0, credit: base },
        ]
      : [
          { accountCode: v.contraAccount, accountName: v.partyName || "", debit: base, credit: 0 },
          stampFx({ accountCode: v.treasuryAccount, accountName: treasuryName, debit: 0, credit: base }, fx),
        ];

    tx.set(journalRef, {
      date: v.date,
      memo: `${v.voucherNumber} — ${v.memo || (isReceipt ? "سند توريد" : "سند صرف")}`,
      lines,
      totalDebit: base,
      totalCredit: base,
      branch: v.branch || "1",
      fiscalYear: v.fiscalYear || String(v.date || "").slice(2, 4),
      status: "posted",
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
      postedByUid: userUid || "",
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
export async function voidTreasuryVoucher(voucherId, { userName, userUid, reason } = {}) {
  const r = requireReason(reason);
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

    // Mirror of the posted journal, at the SAME rate/base amount it was posted
    // with (never today's rate — that would leave an FX residue).
    const rate = Number(v.exchangeRate) > 0 ? Number(v.exchangeRate) : 1;
    const base = Number(v.baseAmount) > 0 ? Number(v.baseAmount) : round2(v.amount * rate);
    const fx = { currency: v.currency, originalAmount: v.amount, rate };
    const treasuryName = `Treasury ${v.currency}`;
    const lines = isReceipt
      ? [
          { accountCode: v.contraAccount, accountName: v.partyName || "", debit: base, credit: 0 },
          stampFx({ accountCode: v.treasuryAccount, accountName: treasuryName, debit: 0, credit: base }, fx),
        ]
      : [
          stampFx({ accountCode: v.treasuryAccount, accountName: treasuryName, debit: base, credit: 0 }, fx),
          { accountCode: v.contraAccount, accountName: v.partyName || "", debit: 0, credit: base },
        ];
    // Dated TODAY (a correction lands in the current open period); the
    // original voucher and its journal are untouched.
    const stamp = periodStamp(todayISO(), v.branch);

    tx.set(reversalJournalRef, {
      date: stamp.date,
      branch: stamp.branch,
      fiscalYear: stamp.fiscalYear,
      memo: `إلغاء ${v.voucherNumber} — ${r}`,
      lines,
      totalDebit: base,
      totalCredit: base,
      status: "posted",
      sourceType: "treasury-void",
      sourceVoucherId: voucherId,
      reversalOf: v.journalEntryId || "",
      createdBy: userName || "",
      createdAt: serverTimestamp(),
    });

    tx.set(balRef, { account: v.treasuryAccount, currency: v.currency, balance: nextBalance, updatedAt: serverTimestamp() }, { merge: true });

    tx.update(voucherRef, {
      status: "void",
      voidedBy: userName || "",
      voidedByUid: userUid || "",
      voidReason: r,
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
