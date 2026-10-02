"use client";

/**
 * AccountingHealthTab — لوحة سلامة المحاسبة (Phase 4).
 *
 * The "how do we know it's working" screen for the Controller: setup
 * readiness, treasury tie-out, suspense ageing, stale bank items,
 * reconciliation coverage, and the full log of corrections (nothing in the
 * books is ever deleted, so every change is listed here with who and why).
 * Also the editor for approval limits and the go-live month, stored in
 * settings/accountingPolicy (read by firestore.rules for the approval limit).
 */

import { useEffect, useMemo, useState } from "react";
import { collection, deleteField, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth, logActivity } from "@/lib/auth";
import toast from "react-hot-toast";
import { TREASURY_ACCOUNTS } from "@/lib/treasury";
import { tieOut } from "@/lib/treasuryTieOut";
import { computeRevaluation } from "@/lib/revaluation";
import { findLegacyTreasuryVouchers } from "@/lib/chartOfAccounts";
import { suspenseAgeing, staleOutstanding, reconciliationCoverage, correctionsLog, readiness } from "@/lib/accountingHealth";
import { todayISO } from "@/lib/period";
import { fmtMoney as fmt } from "@/lib/bookingNormalize";
import { CheckCircle2, AlertTriangle } from "lucide-react";

const BANK_ACCOUNTS = ["1010", "1020", "1030"];

function Card({ ok, title, children }) {
  return (
    <div className={`rounded-xl border p-3 ${ok ? "bg-white" : "bg-amber-50 border-amber-300"}`}>
      <div className="flex items-center gap-1 text-[11px] font-semibold mb-1">
        {ok ? <CheckCircle2 size={13} className="text-emerald-600" /> : <AlertTriangle size={13} className="text-amber-600" />}
        {title}
      </div>
      <div className="text-[11px] text-slate-600">{children}</div>
    </div>
  );
}

export default function AccountingHealthTab({ journals, bankLines, ledgerLines, rates, canEditPolicy }) {
  const { userData } = useAuth();
  const today = todayISO();
  const [policy, setPolicy] = useState(null);
  const [vouchers, setVouchers] = useState([]);
  const [balances, setBalances] = useState([]);
  const [closes, setCloses] = useState([]);
  const [form, setForm] = useState({ EGP: "", USD: "", EUR: "", goLiveMonth: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const quiet = () => {};
    const u1 = onSnapshot(doc(db, "settings", "accountingPolicy"), (d) => setPolicy(d.exists() ? d.data() : {}), quiet);
    const u2 = onSnapshot(collection(db, "treasuryVouchers"), (s) => setVouchers(s.docs.map((d) => ({ id: d.id, ...d.data() }))), quiet);
    const u3 = onSnapshot(collection(db, "treasuryBalances"), (s) => setBalances(s.docs.map((d) => ({ id: d.id, ...d.data() }))), quiet);
    const u4 = onSnapshot(collection(db, "reconciliationCloses"), (s) => setCloses(s.docs.map((d) => ({ id: d.id, ...d.data() }))), quiet);
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  useEffect(() => {
    if (!policy) return;
    const l = policy.approvalLimits || {};
    setForm({ EGP: l.EGP ?? "", USD: l.USD ?? "", EUR: l.EUR ?? "", goLiveMonth: policy.goLiveMonth || "" });
  }, [policy]);

  const tie = useMemo(() => tieOut({ accounts: TREASURY_ACCOUNTS, balances, vouchers, journals }), [balances, vouchers, journals]);
  const susp = useMemo(() => suspenseAgeing(ledgerLines, today), [ledgerLines, today]);
  const stale = useMemo(() => staleOutstanding(bankLines, today, 30), [bankLines, today]);
  const coverage = useMemo(() => reconciliationCoverage(closes, BANK_ACCOUNTS, today, policy?.goLiveMonth || ""), [closes, policy, today]);
  const unstamped = useMemo(
    () => computeRevaluation({ ledgerLines, rates, asOf: today }).reduce((s, r) => s + r.unstamped, 0),
    [ledgerLines, rates, today]
  );
  const legacyCount = useMemo(() => findLegacyTreasuryVouchers(vouchers).filter((v) => v.status === "posted").length, [vouchers]);
  const checklist = useMemo(
    () => readiness({ policy, rates, today, legacyCount, unstampedForeign: unstamped }),
    [policy, rates, today, legacyCount, unstamped]
  );
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const log = useMemo(() => correctionsLog({ journals, bankLines, vouchers, closes, sinceDate: since }), [journals, bankLines, vouchers, closes, since]);

  const savePolicy = async () => {
    if (!canEditPolicy) return;
    const vals = {};
    for (const c of ["EGP", "USD", "EUR"]) {
      const n = Number(form[c]);
      if (form[c] !== "" && !(n > 0)) return toast.error(`حد ${c} لازم يكون رقم أكبر من صفر`);
      vals[c] = form[c] === "" ? null : n;
    }
    if (form.goLiveMonth && !/^20\d{2}-\d{2}$/.test(form.goLiveMonth)) return toast.error("شهر البدء بصيغة YYYY-MM");
    setSaving(true);
    try {
      const ref = doc(db, "settings", "accountingPolicy");
      await setDoc(ref, { updatedBy: userData?.name || userData?.username || "", updatedByUid: userData?.uid || "", updatedAt: serverTimestamp() }, { merge: true });
      await updateDoc(ref, {
        "approvalLimits.EGP": vals.EGP ?? deleteField(),
        "approvalLimits.USD": vals.USD ?? deleteField(),
        "approvalLimits.EUR": vals.EUR ?? deleteField(),
        goLiveMonth: form.goLiveMonth || deleteField(),
      });
      logActivity({ userId: userData?.uid, username: userData?.username, name: userData?.name, action: "accounting_policy_updated", meta: { limits: vals, goLiveMonth: form.goLiveMonth || null } });
      toast.success("تم حفظ السياسة");
    } catch (e) {
      toast.error(e.message || "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const tieBad = tie.rows.filter((r) => !r.ok).length;
  const behind = coverage.reduce((s, c) => s + c.behind, 0);

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-xl p-4">
        <div className="text-xs font-semibold mb-2">جاهزية التشغيل</div>
        <ul className="space-y-1 text-[11px]">
          {checklist.map((c) => (
            <li key={c.key} className={`flex items-center gap-1 ${c.ok ? "text-slate-600" : "text-amber-700 font-semibold"}`}>
              {c.ok ? <CheckCircle2 size={13} className="text-emerald-600" /> : <AlertTriangle size={13} />} {c.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card ok={tieBad === 0} title="مطابقة الخزينة">
          {tieBad === 0 ? "كل الحسابات متطابقة (مخزّن ↔ سندات ↔ أستاذ)" : `${tieBad} حساب فيه فرق — راجع تبويب الخزينة`}
          {!tie.ledgerAvailable && <div className="text-slate-400">المطابقة مع الأستاذ مش متاحة دلوقتي</div>}
        </Card>
        <Card ok={Math.abs(susp.balance) < 0.005} title="حساب الـ Suspense (1900)">
          الرصيد: <b>{fmt(susp.balance)}</b>
          <div>0–30 يوم: {fmt(susp.buckets["0-30"])} · 31–60: {fmt(susp.buckets["31-60"])} · +60: <span className={susp.buckets["61+"] ? "text-red-600 font-semibold" : ""}>{fmt(susp.buckets["61+"])}</span></div>
        </Card>
        <Card ok={stale.length === 0} title="بنود بنك معلّقة +30 يوم">
          {stale.length === 0 ? "مفيش" : `${stale.length} بند لسه ما اتطابقش مع الكشف`}
        </Card>
        <Card ok={behind === 0} title="تسويات البنك الموقّعة">
          {coverage.map((c) => (
            <div key={c.account}>{c.account}: {c.lastSigned || "—"}{c.behind > 0 && <span className="text-red-600 font-semibold"> ({c.behind} شهر ناقص)</span>}</div>
          ))}
          {!policy?.goLiveMonth && <div className="text-slate-400">حدّد شهر البدء تحت عشان يتحسب النقص</div>}
        </Card>
      </div>

      <div className="bg-white border rounded-xl p-4">
        <div className="text-xs font-semibold mb-2">سياسة الاعتماد</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs items-end">
          {["EGP", "USD", "EUR"].map((c) => (
            <label key={c}>
              <span className="text-slate-500">حد الاعتماد {c}</span>
              <input type="number" min="0" disabled={!canEditPolicy} value={form[c]} onChange={(e) => setForm({ ...form, [c]: e.target.value })} className="w-full border rounded px-2 py-1.5" />
            </label>
          ))}
          <label>
            <span className="text-slate-500">شهر بدء النظام (YYYY-MM)</span>
            <input disabled={!canEditPolicy} value={form.goLiveMonth} placeholder="2026-11" onChange={(e) => setForm({ ...form, goLiveMonth: e.target.value })} className="w-full border rounded px-2 py-1.5" />
          </label>
          <button onClick={savePolicy} disabled={!canEditPolicy || saving} className="px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-40">حفظ</button>
        </div>
        <p className="text-[10px] text-slate-400 mt-2">فوق الحد: سند الخزينة يعتمده المدير المالي (مش منشئه). الحد الفاضي = بلا حد. الحفظ للمدير المالي أو الأدمن.</p>
      </div>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <div className="px-4 pt-3 text-xs font-semibold">سجل التصحيحات — آخر 90 يوم ({log.length})</div>
        <table className="w-full text-[11px] mt-2">
          <thead className="bg-slate-50 text-[10px] text-slate-500">
            <tr><th className="px-3 py-1.5 text-left">التاريخ</th><th className="px-3 py-1.5 text-left">النوع</th><th className="px-3 py-1.5 text-left">المرجع</th><th className="px-3 py-1.5 text-left">بواسطة</th><th className="px-3 py-1.5 text-left">السبب</th></tr>
          </thead>
          <tbody>
            {log.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-1.5 whitespace-nowrap">{(r.at || "").slice(0, 10)}</td>
                <td className="px-3 py-1.5">{r.kind}</td>
                <td className="px-3 py-1.5">{r.ref}</td>
                <td className="px-3 py-1.5">{r.by}</td>
                <td className="px-3 py-1.5">{r.reason}</td>
              </tr>
            ))}
            {log.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">مفيش تصحيحات في الفترة دي</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
