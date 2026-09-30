"use client";

/**
 * AdjustmentsTab — حساب التسويات.
 *
 * Two things this covers, per the requirement "معالجة الحسابات المعلقة
 * والتعديلات المحاسبية اللازمة":
 *
 *   1. المعلّق (Suspense/Clearing, account 1900) — a dedicated account for
 *      any amount whose real classification isn't known yet (e.g. an
 *      unmatched bank deposit). Its balance is surfaced prominently here
 *      so it never gets silently forgotten, with a one-click reclass form
 *      to move it to its real account once identified.
 *   2. Adjusting entries (accruals, prepayments, reclassifications) — a
 *      normal balanced Dr/Cr journal entry, written to the SAME
 *      journalEntries collection everything else uses (so it flows into
 *      Trial Balance / P&L automatically), just tagged
 *      `sourceType: "adjustment"` so it can be listed/audited separately
 *      here and optionally auto-reversed at the start of next month
 *      (standard practice for accrual entries).
 *
 * `t` is passed down from accounts/page.js's useLanguage() — see the
 * accounts.adjustments.* keys in locales/ar.json / locales/en.json.
 */

import { useMemo, useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import toast from "react-hot-toast";
import { fmtMoney as fmt, parseNum } from "@/lib/bookingNormalize";
import { AlertTriangle, Plus, X, RotateCcw } from "lucide-react";

const SUSPENSE_ACCOUNT = "1900";

const ADJUSTMENT_TYPE_IDS = ["accrual", "prepayment", "reclass", "correction"];
const ADJUSTMENT_TYPE_KEY = {
  accrual: "accounts.adjustments.typeAccrual",
  prepayment: "accounts.adjustments.typePrepayment",
  reclass: "accounts.adjustments.typeReclass",
  correction: "accounts.adjustments.typeCorrection",
};

const EMPTY_FORM = {
  type: "accrual",
  date: new Date().toISOString().slice(0, 10),
  fromAccount: "1900",
  toAccount: "6900",
  amount: "",
  memo: "",
  reversing: false,
};

export default function AdjustmentsTab({ ledgerLines, journals, chartOfAccounts, canWrite, userName, t }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Suspense account running balance — computed the same way trialBalance
  // does (debit-normal, since 1900 is an Asset-type clearing account).
  const suspenseBalance = useMemo(() => {
    let debit = 0, credit = 0;
    ledgerLines.forEach((l) => {
      if (l.accountCode !== SUSPENSE_ACCOUNT) return;
      debit += l.debit || 0;
      credit += l.credit || 0;
    });
    return debit - credit;
  }, [ledgerLines]);

  const adjustments = useMemo(() => {
    return journals
      .filter((j) => j.sourceType === "adjustment")
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [journals]);

  const acctName = (code) => chartOfAccounts.find((a) => a.code === code)?.name || code;

  const openNew = (prefill = {}) => {
    setForm({ ...EMPTY_FORM, ...prefill });
    setShowForm(true);
  };

  const submit = async () => {
    if (!canWrite) return;
    const amt = Math.abs(parseNum(form.amount));
    if (!amt) return toast.error(t("common.amount"));
    if (form.fromAccount === form.toAccount) return toast.error(t("common.error"));
    setSaving(true);
    try {
      const typeLabel = t(ADJUSTMENT_TYPE_KEY[form.type] || form.type);
      await addDoc(collection(db, "journalEntries"), {
        date: form.date,
        memo: `${typeLabel} — ${form.memo || ""}`.trim(),
        lines: [
          { accountCode: form.toAccount, accountName: acctName(form.toAccount), debit: amt, credit: 0 },
          { accountCode: form.fromAccount, accountName: acctName(form.fromAccount), debit: 0, credit: amt },
        ],
        totalDebit: amt,
        totalCredit: amt,
        sourceType: "adjustment",
        adjustmentType: form.type,
        reversing: !!form.reversing,
        reversed: false,
        createdBy: userName || "",
        createdAt: serverTimestamp(),
      });

      // Reversing entry: auto-post the exact opposite on the 1st of next
      // month — standard practice so an accrual doesn't double-count once
      // the real invoice/bill for it lands next period.
      if (form.reversing) {
        const d = new Date(form.date);
        const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        await addDoc(collection(db, "journalEntries"), {
          date: nextMonth.toISOString().slice(0, 10),
          memo: `${typeLabel} (reversal) — ${form.memo || ""}`.trim(),
          lines: [
            { accountCode: form.fromAccount, accountName: acctName(form.fromAccount), debit: amt, credit: 0 },
            { accountCode: form.toAccount, accountName: acctName(form.toAccount), debit: 0, credit: amt },
          ],
          totalDebit: amt,
          totalCredit: amt,
          sourceType: "adjustment",
          adjustmentType: `${form.type}_reversal`,
          reversing: false,
          reversed: false,
          createdBy: userName || "",
          createdAt: serverTimestamp(),
        });
      }

      toast.success(t("common.success"));
      setShowForm(false);
    } catch (e) {
      toast.error(e.message || t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* الحساب المعلّق — دايمًا ظاهر فوق عشان محدش ينساه */}
      <div className={`border rounded-xl p-4 flex items-center justify-between ${Math.abs(suspenseBalance) > 0.01 ? "bg-amber-50 border-amber-200" : "bg-white"}`}>
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className={Math.abs(suspenseBalance) > 0.01 ? "text-amber-600" : "text-slate-300"} />
          <div>
            <div className="text-xs font-semibold">{t("accounts.adjustments.suspenseAccount")}</div>
            <div className="text-[10px] text-slate-500">{t("accounts.adjustments.suspenseHint")}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`text-lg font-bold tabular-nums ${Math.abs(suspenseBalance) > 0.01 ? "text-amber-700" : "text-slate-400"}`}>{fmt(suspenseBalance)} EGP</div>
          {Math.abs(suspenseBalance) > 0.01 && canWrite && (
            <button
              onClick={() => openNew({ type: "reclass", fromAccount: "1900", toAccount: "6900", amount: String(Math.abs(suspenseBalance)) })}
              className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs"
            >
              {t("accounts.adjustments.classifyNow")}
            </button>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center">
        <div className="text-[11px] text-slate-500">{t("accounts.adjustments.entriesTitle")}</div>
        <button onClick={() => openNew()} disabled={!canWrite} className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs disabled:opacity-50">
          <Plus size={12} /> {t("accounts.adjustments.newEntry")}
        </button>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-right px-3 py-1.5">{t("common.date")}</th>
              <th className="text-right px-3 py-1.5">{t("accounts.adjustments.type")}</th>
              <th className="text-right px-3 py-1.5">{t("accounts.adjustments.memo")}</th>
              <th className="text-right px-3 py-1.5">{t("accounts.adjustments.fromAccount")}</th>
              <th className="text-right px-3 py-1.5">{t("accounts.adjustments.toAccount")}</th>
              <th className="text-right px-3 py-1.5">{t("common.amount")}</th>
              <th className="text-center px-3 py-1.5">{t("accounts.adjustments.reversing")}</th>
            </tr>
          </thead>
          <tbody>
            {adjustments.map((a) => (
              <tr key={a.id} className="border-t hover:bg-slate-50">
                <td className="px-3 py-1.5">{a.date}</td>
                <td className="px-3 py-1.5">{t(ADJUSTMENT_TYPE_KEY[a.adjustmentType] || a.adjustmentType)}</td>
                <td className="px-3 py-1.5">{a.memo}</td>
                <td className="px-3 py-1.5 font-mono">{a.lines?.[1]?.accountCode}</td>
                <td className="px-3 py-1.5 font-mono">{a.lines?.[0]?.accountCode}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmt(a.totalDebit)}</td>
                <td className="px-3 py-1.5 text-center">{a.reversing ? <RotateCcw size={12} className="inline text-blue-500" /> : "—"}</td>
              </tr>
            ))}
            {adjustments.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">{t("accounts.adjustments.noEntries")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">{t("accounts.adjustments.newEntry")}</h3>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="col-span-2">
                <span className="text-slate-500">{t("accounts.adjustments.type")}</span>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5">
                  {ADJUSTMENT_TYPE_IDS.map((id) => <option key={id} value={id}>{t(ADJUSTMENT_TYPE_KEY[id])}</option>)}
                </select>
              </label>
              <label>
                <span className="text-slate-500">{t("common.date")}</span>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>
              <label>
                <span className="text-slate-500">{t("common.amount")}</span>
                <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>
              <label>
                <span className="text-slate-500">{t("accounts.adjustments.debitLabel")}</span>
                <select value={form.toAccount} onChange={(e) => setForm({ ...form, toAccount: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5">
                  {chartOfAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </label>
              <label>
                <span className="text-slate-500">{t("accounts.adjustments.creditLabel")}</span>
                <select value={form.fromAccount} onChange={(e) => setForm({ ...form, fromAccount: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5">
                  {chartOfAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </label>
              <label className="col-span-2">
                <span className="text-slate-500">{t("accounts.adjustments.memo")}</span>
                <input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>
              <label className="col-span-2 flex items-center gap-2 mt-1">
                <input type="checkbox" checked={form.reversing} onChange={(e) => setForm({ ...form, reversing: e.target.checked })} />
                <span className="text-slate-600">{t("accounts.adjustments.reversingHint")}</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 border rounded text-xs">{t("common.cancel")}</button>
              <button onClick={submit} disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs disabled:opacity-50">
                {saving ? t("accounts.adjustments.posting") : t("accounts.adjustments.postEntry")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
