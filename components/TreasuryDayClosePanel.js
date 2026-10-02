"use client";

/**
 * TreasuryDayClosePanel — المطابقة اليومية وجرد الخزينة (Phase 2).
 *
 * Top: tie-out of the STORED balance against the vouchers and (for roles that
 * can read the ledger) against the journal lines — see lib/treasuryTieOut.js.
 * Bottom: the cashier counts each cash drawer and closes the day; the result
 * is saved immutably (lib/treasuryDayClose.js). A difference needs a note.
 */

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { logActivity } from "@/lib/auth";
import toast from "react-hot-toast";
import { TREASURY_ACCOUNTS } from "@/lib/treasury";
import { tieOut, countDifference } from "@/lib/treasuryTieOut";
import { closeTreasuryDay } from "@/lib/treasuryDayClose";
import { todayISO } from "@/lib/period";
import { fmtMoney as fmt } from "@/lib/bookingNormalize";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export default function TreasuryDayClosePanel({ balances, vouchers, journals, canWrite, branch, userData }) {
  const today = todayISO();
  const [closes, setCloses] = useState([]);
  const [counted, setCounted] = useState({});
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const q = query(collection(db, "treasuryDayCloses"), where("date", "==", today));
    const unsub = onSnapshot(q, (snap) => setCloses(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
    return () => unsub();
  }, [today]);

  const t = useMemo(
    () => tieOut({ accounts: TREASURY_ACCOUNTS, balances, vouchers: vouchers || [], journals: journals || [] }),
    [balances, vouchers, journals]
  );

  const doClose = async (row) => {
    const value = counted[row.code];
    if (value === undefined || value === "") return toast.error("اكتب المبلغ المعدود");
    setBusy(row.code);
    try {
      await closeTreasuryDay({
        branch,
        date: today,
        account: row.code,
        currency: row.currency,
        expected: row.stored,
        ledger: row.ledger,
        counted: Number(value),
        note: notes[row.code],
        userName: userData?.name || userData?.username || "",
        userUid: userData?.uid || "",
      });
      logActivity({
        userId: userData?.uid, username: userData?.username, name: userData?.name,
        action: "treasury_day_closed",
        meta: { account: row.code, currency: row.currency, date: today, expected: row.stored, counted: Number(value), difference: countDifference(row.stored, value) },
      });
      toast.success("تم إقفال اليوم لهذا الحساب");
    } catch (e) {
      toast.error(e.message || "فشل الإقفال");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="bg-white border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold">المطابقة اليومية وجرد الخزينة — {today}</div>
        {!t.ledgerAvailable && <span className="text-[10px] text-slate-400">المطابقة مع دفتر الأستاذ متاحة للمحاسبين والمدير المالي</span>}
      </div>
      {t.legacy > 0 && (
        <div className="text-[11px] text-amber-700">{t.legacy} سند بعملة أجنبية على كود جنيه قديم — مش داخل في المطابقة لحد ما يترحّل.</div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-[10px] text-slate-500 bg-slate-50">
            <tr>
              <th className="px-2 py-1 text-left">الحساب</th>
              <th className="px-2 py-1 text-right">الرصيد المخزّن</th>
              <th className="px-2 py-1 text-right">من السندات</th>
              <th className="px-2 py-1 text-right">من الأستاذ</th>
              <th className="px-2 py-1 text-center">الحالة</th>
              <th className="px-2 py-1 text-right">المعدود</th>
              <th className="px-2 py-1 text-right">الفرق</th>
              <th className="px-2 py-1 text-left">ملاحظة</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => {
              const done = closes.find((c) => c.account === r.code && c.currency === r.currency && (c.branch || "1") === String(branch || "1"));
              const val = counted[r.code];
              const diff = val === undefined || val === "" ? null : countDifference(r.stored, val);
              return (
                <tr key={r.code} className="border-t">
                  <td className="px-2 py-1.5">{r.name} <span className="text-slate-400">({r.currency})</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.stored)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.voucherBalance)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.ledger == null ? "—" : fmt(r.ledger)}</td>
                  <td className="px-2 py-1.5 text-center">
                    {r.ok ? <CheckCircle2 size={14} className="inline text-emerald-600" /> : (
                      <span title={`مخزّن − سندات = ${r.leg1}${r.leg2 != null ? ` · سندات − أستاذ = ${r.leg2}` : ""}`} className="inline-flex items-center gap-1 text-red-600 font-semibold">
                        <AlertTriangle size={13} /> {r.leg1 !== 0 ? r.leg1 : r.leg2}
                      </span>
                    )}
                  </td>
                  {r.kind === "cash" ? (
                    done ? (
                      <>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt(done.counted)}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${done.difference ? "text-red-600 font-semibold" : ""}`}>{fmt(done.difference)}</td>
                        <td className="px-2 py-1.5 text-slate-500" colSpan={2}>اتقفل بواسطة {done.closedBy}{done.note ? ` — ${done.note}` : ""}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-2 py-1.5 text-right">
                          <input type="number" step="0.01" disabled={!canWrite} value={val ?? ""} onChange={(e) => setCounted({ ...counted, [r.code]: e.target.value })} className="w-24 border rounded px-1.5 py-1 text-right" />
                        </td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${diff ? "text-red-600 font-semibold" : ""}`}>{diff == null ? "—" : fmt(diff)}</td>
                        <td className="px-2 py-1.5">
                          <input disabled={!canWrite} value={notes[r.code] || ""} onChange={(e) => setNotes({ ...notes, [r.code]: e.target.value })} placeholder={diff ? "سبب الفرق (إجباري)" : "اختياري"} className="w-full border rounded px-1.5 py-1" />
                        </td>
                        <td className="px-2 py-1.5">
                          <button onClick={() => doClose(r)} disabled={!canWrite || busy === r.code} className="px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-40">إقفال اليوم</button>
                        </td>
                      </>
                    )
                  ) : (
                    <td className="px-2 py-1.5 text-slate-400" colSpan={4}>حساب بنكي — بيتطابق من تبويب التسوية البنكية</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-400">أي رقم أحمر في عمود الحالة = الرصيد المخزّن مش مطابق للسندات أو للقيود — يتراجع قبل ما اليوم يتقفل. سجل إقفال اليوم ما بيتعدّلش.</p>
    </div>
  );
}
