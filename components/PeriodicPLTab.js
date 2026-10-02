"use client";

/**
 * PeriodicPLTab — تقرير الربح والخسارة الشهري / الربع سنوي / السنوي.
 *
 * All three views are derived from the SAME monthly buckets (see
 * lib/financialReports.js): quarterly and yearly are sums of monthly, so
 * they can never disagree with each other. The small badge under the
 * period switcher is a visible proof of that (reconciles()).
 */

import { useMemo, useState } from "react";
import { buildMonthlyPL, rollUpQuarterly, rollUpYearly, reconciles } from "@/lib/financialReports";
import { fmtMoney as fmt } from "@/lib/bookingNormalize";
import { openPrintWindow } from "@/lib/helpers";
import { CheckCircle2, XCircle, Printer } from "lucide-react";

const VIEWS = [
  { id: "monthly", label: "شهري" },
  { id: "quarterly", label: "ربع سنوي" },
  { id: "yearly", label: "سنوي" },
];

export default function PeriodicPLTab({ ledgerLines, chartOfAccounts }) {
  const [view, setView] = useState("monthly");
  const [yearFilter, setYearFilter] = useState("all");

  const monthly = useMemo(() => buildMonthlyPL(ledgerLines, chartOfAccounts), [ledgerLines, chartOfAccounts]);
  const quarterly = useMemo(() => rollUpQuarterly(monthly), [monthly]);
  const yearly = useMemo(() => rollUpYearly(quarterly), [quarterly]);
  const isReconciled = useMemo(() => reconciles(monthly, yearly), [monthly, yearly]);

  const years = useMemo(() => {
    const s = new Set(yearly.map((y) => y.key));
    return Array.from(s).sort();
  }, [yearly]);

  const rows = useMemo(() => {
    const src = view === "monthly" ? monthly : view === "quarterly" ? quarterly : yearly;
    if (yearFilter === "all") return src;
    return src.filter((r) => r.key.startsWith(yearFilter));
  }, [view, monthly, quarterly, yearly, yearFilter]);

  const grandTotal = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        revenue: acc.revenue + r.revenue,
        cogs: acc.cogs + r.cogs,
        grossProfit: acc.grossProfit + r.grossProfit,
        expenses: acc.expenses + r.expenses,
        netIncome: acc.netIncome + r.netIncome,
      }),
      { revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netIncome: 0 }
    );
  }, [rows]);

  const handlePrint = () => {
    const viewLabel = VIEWS.find((v) => v.id === view)?.label || "";
    const body = `
      <h2>تقرير الربح والخسارة — ${viewLabel}${yearFilter !== "all" ? " — " + yearFilter : ""}</h2>
      <div class="sub">تم إصداره في ${new Date().toLocaleString("ar-EG")}</div>
      <table>
        <tr><th>الفترة</th><th style="text-align:right">الإيرادات</th><th style="text-align:right">تكلفة المبيعات</th><th style="text-align:right">مجمل الربح</th><th style="text-align:right">المصروفات</th><th style="text-align:right">صافي الربح/الخسارة</th></tr>
        ${rows
          .map(
            (r) => `<tr><td>${r.label}</td><td style="text-align:right">${fmt(r.revenue)}</td><td style="text-align:right">${fmt(r.cogs)}</td><td style="text-align:right">${fmt(r.grossProfit)}</td><td style="text-align:right">${fmt(r.expenses)}</td><td style="text-align:right">${fmt(r.netIncome)}</td></tr>`
          )
          .join("")}
        <tr style="font-weight:bold"><td>الإجمالي</td><td style="text-align:right">${fmt(grandTotal.revenue)}</td><td style="text-align:right">${fmt(grandTotal.cogs)}</td><td style="text-align:right">${fmt(grandTotal.grossProfit)}</td><td style="text-align:right">${fmt(grandTotal.expenses)}</td><td style="text-align:right">${fmt(grandTotal.netIncome)}</td></tr>
      </table>
    `;
    openPrintWindow(`P&L - ${viewLabel}`, body);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`px-3 py-1 text-xs rounded-md ${view === v.id ? "bg-white shadow font-semibold text-blue-700" : "text-slate-500"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="border rounded px-2 py-1 text-xs">
            <option value="all">كل السنوات</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <span
            title="يثبت أن مجموع الشهور = مجموع السنوات (تطابق مضمون هيكليًا)"
            className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full ${isReconciled ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
          >
            {isReconciled ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {isReconciled ? "الأرقام متطابقة بين كل المستويات" : "تعارض في الأرقام!"}
          </span>
        </div>
        <button onClick={handlePrint} className="inline-flex items-center gap-1 px-3 py-1.5 border rounded text-xs">
          <Printer size={12} /> طباعة
        </button>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-right px-3 py-1.5">الفترة</th>
              <th className="text-right px-3 py-1.5">الإيرادات</th>
              <th className="text-right px-3 py-1.5">تكلفة المبيعات</th>
              <th className="text-right px-3 py-1.5">مجمل الربح</th>
              <th className="text-right px-3 py-1.5">المصروفات</th>
              <th className="text-right px-3 py-1.5">صافي الربح/الخسارة</th>
              <th className="text-right px-3 py-1.5">الهامش %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t hover:bg-slate-50">
                <td className="px-3 py-1.5 font-medium">{r.label}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.revenue)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.cogs)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmt(r.grossProfit)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.expenses)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums font-bold ${r.netIncome >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt(r.netIncome)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{r.marginPct.toFixed(1)}%</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">لا توجد بيانات</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-slate-50 font-bold">
                <td className="px-3 py-1.5">الإجمالي</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(grandTotal.revenue)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(grandTotal.cogs)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(grandTotal.grossProfit)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(grandTotal.expenses)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${grandTotal.netIncome >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt(grandTotal.netIncome)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-[10px] text-slate-400">
        الربع سنوي = مجموع 3 شهور بالظبط، والسنوي = مجموع أرباعه — مفيش حساب منفصل ممكن يختلف عن التاني.
      </p>
    </div>
  );
}
