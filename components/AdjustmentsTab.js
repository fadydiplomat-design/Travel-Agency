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
 */

import { useMemo, useState } from "react";
import { collection, addDoc, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth, logActivity } from "@/lib/auth";
import toast from "react-hot-toast";
import { fmtMoney as fmt, fmtTimestamp as fmtTs, parseNum } from "@/lib/bookingNormalize";
import { AlertTriangle, Plus, X, RotateCcw } from "lucide-react";
import { periodStamp, isPeriodClosed } from "@/lib/period";
import { useClosedFiscalYearKeys } from "@/lib/fiscalYear";

const SUSPENSE_ACCOUNT = "1900";

const ADJUSTMENT_TYPES = [
  { id: "accrual", label: "استحقاق (مصروف/إيراد مستحق لم يُسجَّل بعد)" },
  { id: "prepayment", label: "مقدم (مصروف/إيراد مدفوع مقدمًا يخص فترة قادمة)" },
  { id: "reclass", label: "إعادة تصنيف (نقل مبلغ من حساب معلّق لحسابه الصحيح)" },
  { id: "correction", label: "تصحيح خطأ" },
];

const EMPTY_FORM = {
  type: "accrual",
  date: new Date().toISOString().slice(0, 10),
  fromAccount: "1900",
  toAccount: "6900",
  amount: "",
  memo: "",
  reversing: false,
};

export default function AdjustmentsTab({ ledgerLines, journals, chartOfAccounts, canWrite, userName }) {
  const { userData, activeBranch } = useAuth();
  const closedYearKeys = useClosedFiscalYearKeys();
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
    if (!amt) return toast.error("المبلغ مطلوب");
    if (form.fromAccount === form.toAccount) return toast.error("لازم يكون الحسابين مختلفين");
    if (isPeriodClosed(closedYearKeys, form.date, activeBranch)) return toast.error("الفترة المحاسبية لهذا التاريخ مقفلة");
    setSaving(true);
    try {
      const typeLabel = ADJUSTMENT_TYPES.find((t) => t.id === form.type)?.label || form.type;
      const adjRef = await addDoc(collection(db, "journalEntries"), {
        ...periodStamp(form.date, activeBranch), // { date, branch, fiscalYear } — checked by the rules against closed periods
        status: "posted",
        createdByUid: userData?.uid || "",
        memo: `تسوية (${typeLabel}) — ${form.memo || ""}`.trim(),
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
      // Audit trail — same fix as the journal entries and treasury vouchers
      // above: an adjustment moves real Dr/Cr balances (including out of
      // the Suspense account), so it belongs on the Activity Log too.
      logActivity({
        userId: userData?.uid,
        username: userData?.username,
        name: userData?.name,
        action: "adjustment_posted",
        meta: { adjustmentId: adjRef.id, type: form.type, amount: amt, fromAccount: form.fromAccount, toAccount: form.toAccount, reversing: !!form.reversing },
      });

      // Reversing entry: auto-post the exact opposite on the 1st of next
      // month — standard practice so an accrual doesn't double-count once
      // the real invoice/bill for it lands next period.
      if (form.reversing) {
        const d = new Date(form.date);
        const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        await addDoc(collection(db, "journalEntries"), {
          ...periodStamp(nextMonth.toISOString().slice(0, 10), activeBranch),
          status: "posted",
          createdByUid: userData?.uid || "",
          memo: `عكس تسوية (${typeLabel}) — ${form.memo || ""}`.trim(),
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

      toast.success("تم ترحيل قيد التسوية");
      setShowForm(false);
    } catch (e) {
      toast.error(e.message || "فشل الحفظ");
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
            <div className="text-xs font-semibold">حساب المعلّق (1900) — Suspense / Clearing</div>
            <div className="text-[10px] text-slate-500">مبالغ لسه مش معروف تصنيفها النهائي (إيداع بنكي غير مُطابَق، سلفة تحت التسوية...)</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`text-lg font-bold tabular-nums ${Math.abs(suspenseBalance) > 0.01 ? "text-amber-700" : "text-slate-400"}`}>{fmt(suspenseBalance)} EGP</div>
          {Math.abs(suspenseBalance) > 0.01 && canWrite && (
            <button
              onClick={() => openNew({ type: "reclass", fromAccount: "1900", toAccount: "6900", amount: String(Math.abs(suspenseBalance)) })}
              className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs"
            >
              تصنيف الآن
            </button>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center">
        <div className="text-[11px] text-slate-500">قيود التسوية (استحقاقات، مقدمات، تصحيحات، إعادة تصنيف)</div>
        <button onClick={() => openNew()} disabled={!canWrite} className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs disabled:opacity-50">
          <Plus size={12} /> قيد تسوية جديد
        </button>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-right px-3 py-1.5">التاريخ</th>
              <th className="text-right px-3 py-1.5">النوع</th>
              <th className="text-right px-3 py-1.5">البيان</th>
              <th className="text-right px-3 py-1.5">من حساب</th>
              <th className="text-right px-3 py-1.5">إلى حساب</th>
              <th className="text-right px-3 py-1.5">المبلغ</th>
              <th className="text-center px-3 py-1.5">عكسي؟</th>
            </tr>
          </thead>
          <tbody>
            {adjustments.map((a) => (
              <tr key={a.id} className="border-t hover:bg-slate-50">
                <td className="px-3 py-1.5">{a.date}</td>
                <td className="px-3 py-1.5">{ADJUSTMENT_TYPES.find((t) => t.id === a.adjustmentType)?.label || a.adjustmentType}</td>
                <td className="px-3 py-1.5">{a.memo}</td>
                <td className="px-3 py-1.5 font-mono">{a.lines?.[1]?.accountCode}</td>
                <td className="px-3 py-1.5 font-mono">{a.lines?.[0]?.accountCode}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmt(a.totalDebit)}</td>
                <td className="px-3 py-1.5 text-center">{a.reversing ? <RotateCcw size={12} className="inline text-blue-500" /> : "—"}</td>
              </tr>
            ))}
            {adjustments.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">لا توجد قيود تسوية</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">قيد تسوية جديد</h3>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="col-span-2">
                <span className="text-slate-500">نوع التسوية</span>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5">
                  {ADJUSTMENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              <label>
                <span className="text-slate-500">التاريخ</span>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>
              <label>
                <span className="text-slate-500">المبلغ</span>
                <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>
              <label>
                <span className="text-slate-500">مدين (يزيد)</span>
                <select value={form.toAccount} onChange={(e) => setForm({ ...form, toAccount: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5">
                  {chartOfAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </label>
              <label>
                <span className="text-slate-500">دائن (يقل)</span>
                <select value={form.fromAccount} onChange={(e) => setForm({ ...form, fromAccount: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5">
                  {chartOfAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </label>
              <label className="col-span-2">
                <span className="text-slate-500">البيان</span>
                <input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>
              <label className="col-span-2 flex items-center gap-2 mt-1">
                <input type="checkbox" checked={form.reversing} onChange={(e) => setForm({ ...form, reversing: e.target.checked })} />
                <span className="text-slate-600">قيد عكسي تلقائي في أول الشهر القادم (للاستحقاقات/المقدمات)</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 border rounded text-xs">إلغاء</button>
              <button onClick={submit} disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs disabled:opacity-50">
                {saving ? "جارٍ الترحيل..." : "ترحيل القيد"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
