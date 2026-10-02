"use client";

/**
 * ExchangeRatesTab — جدول أسعار الصرف (Phase 2).
 *
 * One row per (currency, date). Rows are IMMUTABLE (firestore.rules): a wrong
 * rate is fixed by entering a new row for the same date — the latest-entered
 * row wins in rateOn() (lib/fx.js) — so every old posting stays explainable.
 * Rate = EGP per 1 unit of the foreign currency.
 */

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth, logActivity } from "@/lib/auth";
import toast from "react-hot-toast";
import { todayISO } from "@/lib/period";
import { rateOn } from "@/lib/fx";
import { Plus } from "lucide-react";

const CURRENCIES = ["USD", "EUR"];
const JUMP_WARN_PCT = 5; // ask for confirmation when a new rate moves more than this vs the previous one

export default function ExchangeRatesTab({ canWrite }) {
  const { userData } = useAuth();
  const [rates, setRates] = useState([]);
  const [form, setForm] = useState({ currency: "USD", date: todayISO(), rate: "", source: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "exchangeRates"),
      (snap) => setRates(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {}
    );
    return () => unsub();
  }, []);

  const sorted = useMemo(
    () => [...rates].sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.enteredAt || "").localeCompare(String(a.enteredAt || ""))),
    [rates]
  );
  const today = todayISO();
  const latest = CURRENCIES.map((c) => {
    const row = sorted.find((r) => r.currency === c && r.date <= today);
    return { currency: c, row, stale: !row || row.date < today };
  });

  const submit = async () => {
    if (!canWrite) return;
    const rate = Number(form.rate);
    if (!(rate > 0)) return toast.error("اكتب سعر صحيح أكبر من صفر");
    if (!form.source.trim()) return toast.error("مصدر السعر مطلوب (مثلاً: البنك المركزي / بنك كذا)");
    const prev = rateOn(rates, form.currency, form.date);
    if (prev && Math.abs(rate - prev) / prev * 100 > JUMP_WARN_PCT) {
      if (!confirm(`السعر الجديد ${rate} بيختلف أكتر من ${JUMP_WARN_PCT}% عن آخر سعر (${prev}). متأكد؟`)) return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, "exchangeRates"), {
        currency: form.currency,
        date: form.date,
        rate,
        source: form.source.trim(),
        enteredBy: userData?.name || userData?.username || "",
        enteredByUid: userData?.uid || "",
        enteredAt: new Date().toISOString(),
        createdAt: serverTimestamp(),
      });
      logActivity({
        userId: userData?.uid,
        username: userData?.username,
        name: userData?.name,
        action: "exchange_rate_entered",
        meta: { currency: form.currency, date: form.date, rate, source: form.source.trim(), previous: prev || null },
      });
      toast.success("تم حفظ السعر");
      setForm({ ...form, rate: "" });
    } catch (e) {
      toast.error(e.message || "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {latest.map(({ currency, row, stale }) => (
          <div key={currency} className={`rounded-xl border p-3 ${stale ? "bg-amber-50 border-amber-300" : "bg-white"}`}>
            <div className="text-[10px] font-semibold text-slate-500">{currency} → EGP</div>
            <div className="text-xl font-bold tabular-nums">{row ? row.rate : "—"}</div>
            <div className="text-[10px] text-slate-500">
              {row ? `بتاريخ ${row.date} · ${row.source || ""}` : "مفيش سعر مسجّل"}
              {stale && <span className="text-amber-700 font-semibold"> — مفيش سعر لليوم</span>}
            </div>
          </div>
        ))}
      </div>

      {canWrite ? (
        <div className="bg-white border rounded-xl p-3">
          <div className="text-xs font-semibold mb-2">إدخال سعر جديد</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs items-end">
            <label>
              <span className="text-slate-500">العملة</span>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="w-full border rounded px-2 py-1.5">
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>
              <span className="text-slate-500">التاريخ</span>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full border rounded px-2 py-1.5" />
            </label>
            <label>
              <span className="text-slate-500">جنيه لكل 1 {form.currency}</span>
              <input type="number" step="0.0001" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} className="w-full border rounded px-2 py-1.5" />
            </label>
            <label>
              <span className="text-slate-500">المصدر</span>
              <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full border rounded px-2 py-1.5" />
            </label>
            <button onClick={submit} disabled={saving} className="inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-50">
              <Plus size={13} /> حفظ
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-2">الأسعار ما بتتعدلش ولا بتتمسح. لو فيه غلط، أدخل سعر جديد لنفس اليوم — الأحدث إدخالًا هو اللي بيتطبّق.</p>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">عرض فقط — إدخال الأسعار للمدير المالي.</p>
      )}

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] text-slate-500">
            <tr><th className="px-3 py-1.5 text-left">التاريخ</th><th className="px-3 py-1.5 text-left">العملة</th><th className="px-3 py-1.5 text-right">السعر</th><th className="px-3 py-1.5 text-left">المصدر</th><th className="px-3 py-1.5 text-left">أُدخل بواسطة</th></tr>
          </thead>
          <tbody>
            {sorted.slice(0, 200).map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-1.5">{r.date}</td>
                <td className="px-3 py-1.5">{r.currency}</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{r.rate}</td>
                <td className="px-3 py-1.5">{r.source}</td>
                <td className="px-3 py-1.5">{r.enteredBy}</td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">لسه مفيش أسعار مسجّلة</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
