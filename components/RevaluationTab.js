"use client";

/**
 * RevaluationTab — إعادة تقييم أرصدة العملات الأجنبية آخر الشهر (Phase 3).
 *
 * Shows, per foreign cash/bank account, the foreign balance, the EGP carrying
 * amount, the closing rate from the exchange-rate table and the adjustment to
 * post to 6810. Posting creates ONE balanced journal (sourceType
 * "revaluation", Controller permission). Undo = reverse that entry from the
 * Journals tab. See lib/revaluation.js for the method and its limits.
 */

import { useMemo, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth, logActivity } from "@/lib/auth";
import toast from "react-hot-toast";
import { computeRevaluation, buildRevaluationLines } from "@/lib/revaluation";
import { monthEndISO, monthOf } from "@/lib/reconMath";
import { periodStamp, isPeriodClosed, todayISO } from "@/lib/period";
import { useClosedFiscalYearKeys } from "@/lib/fiscalYear";
import { fmtMoney as fmt } from "@/lib/bookingNormalize";

export default function RevaluationTab({ ledgerLines, rates, journals, canWrite }) {
  const { userData, activeBranch } = useAuth();
  const closedYearKeys = useClosedFiscalYearKeys();
  const [month, setMonth] = useState(monthOf(todayISO()));
  const [saving, setSaving] = useState(false);
  const asOf = monthEndISO(month);

  const rows = useMemo(() => computeRevaluation({ ledgerLines, rates, asOf }), [ledgerLines, rates, asOf]);
  const lines = useMemo(() => buildRevaluationLines(rows), [rows]);
  const totalAdj = rows.reduce((s, r) => s + (r.adjustment || 0), 0);
  const missing = rows.filter((r) => r.missingRate && (r.foreignBalance !== 0 || r.unstamped > 0));
  const previous = (journals || []).filter((j) => j.sourceType === "revaluation" && j.date === asOf && (j.status || "posted") === "posted");

  const post = async () => {
    if (!canWrite || !lines.length) return;
    if (missing.length) return toast.error(`مفيش سعر صرف لـ ${missing.map((m) => m.currency).join(", ")} — ادخله من تبويب أسعار الصرف`);
    if (isPeriodClosed(closedYearKeys, asOf, activeBranch)) return toast.error("الفترة المحاسبية لتاريخ آخر الشهر مقفلة");
    if (!confirm(`ترحيل قيد إعادة تقييم بتاريخ ${asOf} بصافي ${fmt(totalAdj)} EGP؟`)) return;
    setSaving(true);
    try {
      const debit = lines.reduce((s, l) => s + l.debit, 0);
      const ref = await addDoc(collection(db, "journalEntries"), {
        ...periodStamp(asOf, activeBranch),
        sourceType: "revaluation",
        status: "posted",
        memo: `إعادة تقييم عملات أجنبية — ${asOf}`,
        lines,
        totalDebit: Math.round(debit * 100) / 100,
        totalCredit: Math.round(debit * 100) / 100,
        rates: Object.fromEntries(rows.filter((r) => r.closeRate).map((r) => [r.currency, r.closeRate])),
        createdBy: userData?.name || userData?.username || "",
        createdByUid: userData?.uid || "",
        createdAt: serverTimestamp(),
      });
      logActivity({
        userId: userData?.uid, username: userData?.username, name: userData?.name,
        action: "fx_revaluation_posted",
        meta: { journalId: ref.id, asOf, net: totalAdj },
      });
      toast.success("تم ترحيل قيد إعادة التقييم");
    } catch (e) {
      toast.error(e.message || "فشل الترحيل");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="inline-flex items-center gap-1">
          <span className="text-slate-500">الشهر</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value || monthOf(todayISO()))} className="border rounded px-2 py-1" />
        </label>
        <span className="text-slate-400">بسعر إقفال {asOf}</span>
      </div>

      {previous.length > 0 && (
        <div className="bg-slate-50 border rounded-xl p-3 text-[11px] text-slate-600">
          فيه {previous.length} قيد إعادة تقييم مرحّل بتاريخ {asOf}. الجدول تحت محسوب بعد خصمه — لو الفرق صفر يبقى مفيش حاجة تترحّل.
        </div>
      )}
      {missing.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-3 text-xs">
          مفيش سعر صرف لحد {asOf} لعملة: <b>{missing.map((m) => m.currency).join("، ")}</b> — أدخله من تبويب "أسعار الصرف" الأول.
        </div>
      )}

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 text-[10px] text-slate-500">
            <tr>
              <th className="px-3 py-1.5 text-left">الحساب</th>
              <th className="px-3 py-1.5 text-right">الرصيد بالعملة</th>
              <th className="px-3 py-1.5 text-right">القيمة الدفترية EGP</th>
              <th className="px-3 py-1.5 text-right">سعر الإقفال</th>
              <th className="px-3 py-1.5 text-right">التسوية (+ ربح / − خسارة)</th>
              <th className="px-3 py-1.5 text-left">تنبيه</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-t">
                <td className="px-3 py-1.5">{r.code} {r.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.foreignBalance)} {r.currency}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.bookEGP)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.closeRate ?? "—"}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${r.adjustment > 0 ? "text-emerald-700" : r.adjustment < 0 ? "text-red-600" : ""}`}>
                  {r.adjustment == null ? "—" : fmt(r.adjustment)}
                </td>
                <td className="px-3 py-1.5 text-amber-700">
                  {r.unstamped > 0 ? `${r.unstamped} حركة قديمة بدون عملة/سعر — مش داخلة في الحساب` : ""}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-semibold">
              <td className="px-3 py-1.5" colSpan={4}>صافي التسوية</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totalAdj)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={post} disabled={!canWrite || saving || !lines.length || missing.length > 0} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs disabled:opacity-40">
          ترحيل قيد إعادة التقييم
        </button>
        {!canWrite && <span className="text-[11px] text-slate-500">عرض فقط — الترحيل للمدير المالي.</span>}
      </div>
      <p className="text-[10px] text-slate-400">
        بيغطي حسابات النقدية والبنك بالدولار واليورو فقط. أرصدة العملاء والموردين والعربون بعملة أجنبية مش داخلة لسه (محتاجة قرار بعملة كل رصيد). التسوية تراكمية: لو شغّلتها تاني في نفس الشهر هتطلع صفر، ولو القيد غلط اعكسه من تبويب القيود.
      </p>
    </div>
  );
}
