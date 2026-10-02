"use client";

/**
 * TreasuryTab — وحدة الخزينة، تُعرض كتاب داخل صفحة Accounts (/accounts).
 *
 * Built in the order the module was specced:
 *   1. أوامر التوريد  — TreasuryOrderForm(type="receipt")
 *   2. أوامر الصرف    — TreasuryOrderForm(type="payment")
 *   3. سندات التوريد  — a posted/"receipt" row, printable
 *   4. سندات الصرف    — a posted/"payment" row, printable
 * Plus: أرصدة الخزائن — live per-account/per-currency balances
 * (treasuryBalances), and a combined orders+vouchers ledger with
 * post / print / void actions.
 */

import { useEffect, useState, useMemo } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth, logActivity } from "@/lib/auth";
import toast from "react-hot-toast";
import {
  TREASURY_ACCOUNTS,
  CONTRA_ACCOUNTS,
  createTreasuryOrder,
  postTreasuryVoucher,
  voidTreasuryVoucher,
  deleteTreasuryOrder,
} from "@/lib/treasury";
import { openPrintWindow } from "@/lib/helpers";
import { rateOn } from "@/lib/fx";
import TreasuryDayClosePanel from "@/components/TreasuryDayClosePanel";
import { todayISO, isPeriodClosed } from "@/lib/period";
import { useClosedFiscalYearKeys } from "@/lib/fiscalYear";
import { findLegacyTreasuryVouchers, modernTreasuryCode } from "@/lib/chartOfAccounts";
import { fmtMoney as fmt, fmtTimestamp as fmtTs, parseNum } from "@/lib/bookingNormalize";
import {
  Plus,
  Printer,
  Check,
  Trash2,
  Ban,
  ArrowDownCircle,
  ArrowUpCircle,
  Wallet,
  X,
} from "lucide-react";

const EMPTY_ORDER = {
  date: new Date().toISOString().slice(0, 10),
  amount: "",
  currency: "EGP",
  exchangeRate: "",
  treasuryAccount: "1000",
  contraAccount: "1100",
  partyType: "client",
  partyCode: "",
  partyName: "",
  method: "cash",
  reference: "",
  memo: "",
};

// canWrite   – may create / post orders (Cashier, Controller)
// canApprove – may post ABOVE the approval limit (Controller; never the creator)
// canVoid    – may void a posted voucher (Controller only, by default)
export default function TreasuryTab({ canWrite, canApprove = false, canVoid = false, journals = [] }) {
  const { userData, activeBranch } = useAuth();
  const closedYearKeys = useClosedFiscalYearKeys();
  const [rates, setRates] = useState([]);
  const branch = activeBranch || "1";
  const userName = userData?.name || userData?.username || "";

  const [vouchers, setVouchers] = useState([]);
  const [balances, setBalances] = useState([]);
  const [showForm, setShowForm] = useState(null); // "receipt" | "payment" | null
  const [form, setForm] = useState(EMPTY_ORDER);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all"); // all|draft|posted|void
  const [typeFilter, setTypeFilter] = useState("all"); // all|receipt|payment

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, "treasuryVouchers"), (snap) =>
      setVouchers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    const unsub2 = onSnapshot(collection(db, "treasuryBalances"), (snap) =>
      setBalances(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    // Exchange-rate table (immutable rows; see lib/fx.js). Errors are
    // swallowed: a user without the rule's read access just has to type a rate.
    const unsub3 = onSnapshot(
      collection(db, "exchangeRates"),
      (snap) => setRates(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {}
    );
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, []);

  const filteredVouchers = useMemo(() => {
    return vouchers
      .filter((v) => statusFilter === "all" || v.status === statusFilter)
      .filter((v) => typeFilter === "all" || v.type === typeFilter)
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.voucherNumber || "").localeCompare(a.voucherNumber || ""));
  }, [vouchers, statusFilter, typeFilter]);

  // Vouchers/balances recorded before USD/EUR got their own cash & bank
  // accounts sit under the EGP codes — flag them so a Controller can migrate
  // them deliberately instead of the numbers silently disappearing.
  const legacyVouchers = useMemo(() => findLegacyTreasuryVouchers(vouchers), [vouchers]);
  const legacyBalances = useMemo(
    () => balances.filter((b) => b.account && modernTreasuryCode(b.account, b.currency) !== b.account && Number(b.balance) !== 0),
    [balances]
  );

  // Suggested rate for the form: latest table rate on/before the voucher date.
  const suggestedRate = form.currency !== "EGP" ? rateOn(rates, form.currency, form.date) : 1;

  /* ── 1 & 2: أمر توريد / أمر صرف ───────────────────────────────────── */
  const openForm = (type) => {
    setForm({ ...EMPTY_ORDER, date: todayISO(), treasuryAccount: TREASURY_ACCOUNTS[0].code, currency: "EGP" });
    setShowForm(type);
  };

  const submitOrder = async () => {
    if (!canWrite) return;
    if (!parseNum(form.amount)) return toast.error("المبلغ مطلوب");
    if (!form.partyName.trim()) return toast.error("اسم الطرف (العميل/المورد) مطلوب");
    if (form.currency !== "EGP" && !(parseNum(form.exchangeRate) > 0 || suggestedRate)) {
      return toast.error("سعر الصرف مطلوب للعملات الأجنبية");
    }
    if (isPeriodClosed(closedYearKeys, form.date, branch)) {
      return toast.error("الفترة المحاسبية لهذا التاريخ مقفلة — اختر تاريخًا في فترة مفتوحة");
    }
    setSaving(true);
    try {
      const { voucherNumber } = await createTreasuryOrder({
        type: showForm,
        ...form,
        exchangeRate: form.currency === "EGP" ? 1 : parseNum(form.exchangeRate) || suggestedRate,
        branch,
        createdBy: userName,
        createdByUid: userData?.uid || "",
      });
      toast.success(`تم إنشاء ${showForm === "receipt" ? "أمر التوريد" : "أمر الصرف"} ${voucherNumber}`);
      setShowForm(null);
    } catch (e) {
      toast.error(e.message || "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  };

  /* ── 3 & 4: ترحيل الأمر → سند رسمي قابل للطباعة ──────────────────── */
  // Audit trail: logActivity() already existed (lib/auth.js) and was wired
  // into Settings only — no financial action anywhere in the app called
  // it, so posting/voiding a treasury voucher (which moves a real balance)
  // left no trace on the Activity Log screen. These three calls are the
  // fix, one per action that actually changes money or reverses it;
  // creating a draft order is intentionally NOT logged here since nothing
  // financial has happened yet at that point (see lib/treasury.js).
  const logVoucherActivity = (action, v, extra = {}) =>
    logActivity({
      userId: userData?.uid,
      username: userData?.username,
      name: userData?.name,
      action,
      meta: { voucherId: v.id, voucherNumber: v.voucherNumber, type: v.type, amount: v.amount, currency: v.currency, ...extra },
    });

  const postOrder = async (v) => {
    if (!canWrite) return;
    if (!confirm(`ترحيل ${v.voucherNumber}؟ سيتم تحديث رصيد الخزينة وتسجيل القيد المحاسبي فورًا.`)) return;
    try {
      const { journalEntryId } = await postTreasuryVoucher(v.id, { userName, userUid: userData?.uid, canApprove });
      logVoucherActivity("treasury_voucher_posted", v, { journalEntryId });
      toast.success("تم الترحيل وإصدار السند");
    } catch (e) {
      toast.error(e.message || "فشل الترحيل");
    }
  };

  const voidVoucher = async (v) => {
    if (!canVoid) return;
    // The reason is mandatory and stored on the voucher + its reversing entry.
    const reason = window.prompt(`سبب إلغاء السند ${v.voucherNumber} (إجباري) — سيتم عمل قيد عكسي بتاريخ اليوم وإرجاع الرصيد:`);
    if (reason === null) return;
    if (reason.trim().length < 3) return toast.error("سبب الإلغاء مطلوب");
    try {
      await voidTreasuryVoucher(v.id, { userName, userUid: userData?.uid, reason });
      logVoucherActivity("treasury_voucher_voided", v, { reason: reason.trim() });
      toast.success("تم إلغاء السند");
    } catch (e) {
      toast.error(e.message || "فشل الإلغاء");
    }
  };

  const removeDraft = async (v) => {
    if (!canWrite) return;
    if (!confirm(`حذف أمر ${v.voucherNumber} (لم يُرحَّل بعد)؟`)) return;
    try {
      await deleteTreasuryOrder(v.id);
      toast.success("تم الحذف");
    } catch (e) {
      toast.error(e.message || "فشل الحذف");
    }
  };

  const printVoucher = (v) => {
    const isReceipt = v.type === "receipt";
    const acct = TREASURY_ACCOUNTS.find((a) => a.code === v.treasuryAccount && a.currency === v.currency);
    const html = `
      <h2>${isReceipt ? "سند توريد (قبض)" : "سند صرف"} — ${v.voucherNumber}</h2>
      <div class="sub">${v.status === "posted" ? "مُرحَّل" : v.status === "void" ? "مُلغى" : "مسودة"}</div>
      <div class="grid2">
        <div><span class="lbl">التاريخ</span><br/>${v.date}</div>
        <div><span class="lbl">الفرع</span><br/>${v.branch}</div>
        <div><span class="lbl">${isReceipt ? "استلمنا من" : "صرفنا إلى"}</span><br/>${v.partyName || "—"} (${v.partyCode || "—"})</div>
        <div><span class="lbl">طريقة الدفع</span><br/>${v.method}${v.reference ? " — " + v.reference : ""}</div>
        <div><span class="lbl">الخزينة</span><br/>${acct?.name || v.treasuryAccount} (${v.currency})</div>
        <div><span class="lbl">الحساب المقابل</span><br/>${v.contraAccount}</div>
      </div>
      <table>
        <tr><th>البيان</th><th style="text-align:right">المبلغ</th></tr>
        <tr><td>${v.memo || (isReceipt ? "توريد نقدي" : "صرف نقدي")}</td><td style="text-align:right">${fmt(v.amount)} ${v.currency}</td></tr>
      </table>
      <div class="grid2" style="margin-top:16px">
        <div><span class="lbl">توقيع المُحرِّر</span><br/><br/>______________</div>
        <div><span class="lbl">توقيع ${isReceipt ? "المستلم" : "المستفيد"}</span><br/><br/>______________</div>
      </div>
    `;
    openPrintWindow(v.voucherNumber, html);
  };

  return (
    <div className="space-y-4">
      <TreasuryDayClosePanel balances={balances} vouchers={vouchers} journals={journals} canWrite={canWrite} branch={branch} userData={userData} />

      {(legacyVouchers.length > 0 || legacyBalances.length > 0) && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-3 text-xs">
          <b>بيانات خزينة بأكواد قديمة:</b> {legacyVouchers.length} سند و{legacyBalances.length} رصيد بعملة أجنبية مسجّلة على حسابات الجنيه
          (1000 / 1010). العملات الأجنبية بقت لها حسابات مستقلة (1001 دولار، 1002 يورو، 1020 بنك دولار، 1030 بنك يورو) —
          الأرصدة القديمة مش هتظهر في الكروت تحت لحد ما المدير المالي يرحّلها.
        </div>
      )}

      {/* أرصدة الخزائن — لكل حساب وعملة على حدة، بدون أي تجميع بينهم */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {TREASURY_ACCOUNTS.map((a) => {
          const bal = balances.find((b) => b.id === `${a.code}_${a.currency}`);
          return (
            <div key={`${a.code}_${a.currency}`} className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase">
                <Wallet size={12} /> {a.name}
              </div>
              <div className="text-lg font-bold tabular-nums mt-1">
                {fmt(bal?.balance || 0)} <span className="text-xs text-slate-400">{a.currency}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* أزرار الإنشاء: أمر توريد ثم أمر صرف */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => openForm("receipt")}
            disabled={!canWrite}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded text-xs disabled:opacity-50"
          >
            <ArrowDownCircle size={14} /> أمر توريد جديد
          </button>
          <button
            onClick={() => openForm("payment")}
            disabled={!canWrite}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded text-xs disabled:opacity-50"
          >
            <ArrowUpCircle size={14} /> أمر صرف جديد
          </button>
        </div>
        <div className="flex gap-2 text-xs">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="border rounded px-2 py-1">
            <option value="all">كل الأنواع</option>
            <option value="receipt">توريد</option>
            <option value="payment">صرف</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border rounded px-2 py-1">
            <option value="all">كل الحالات</option>
            <option value="draft">أوامر (مسودة)</option>
            <option value="posted">سندات (مُرحَّلة)</option>
            <option value="void">ملغاة</option>
          </select>
        </div>
      </div>

      {/* سجل الأوامر والسندات */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-1.5">الرقم</th>
              <th className="text-left px-3 py-1.5">التاريخ</th>
              <th className="text-left px-3 py-1.5">النوع</th>
              <th className="text-left px-3 py-1.5">الطرف</th>
              <th className="text-left px-3 py-1.5">الخزينة</th>
              <th className="text-right px-3 py-1.5">المبلغ</th>
              <th className="text-center px-3 py-1.5">الحالة</th>
              <th className="w-32"></th>
            </tr>
          </thead>
          <tbody>
            {filteredVouchers.map((v) => (
              <tr key={v.id} className="border-t hover:bg-slate-50">
                <td className="px-3 py-1.5 font-mono">{v.voucherNumber}</td>
                <td className="px-3 py-1.5">{v.date}</td>
                <td className="px-3 py-1.5">
                  <span className={v.type === "receipt" ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                    {v.type === "receipt" ? "توريد" : "صرف"}
                  </span>
                </td>
                <td className="px-3 py-1.5">{v.partyName}</td>
                <td className="px-3 py-1.5">{v.treasuryAccount} / {v.currency}</td>
                <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${v.type === "receipt" ? "text-emerald-700" : "text-red-600"}`}>
                  {fmt(v.amount)}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {v.status === "draft" && <span className="text-amber-600">مسودة</span>}
                  {v.status === "posted" && <span className="text-emerald-600">مُرحَّل</span>}
                  {v.status === "void" && <span className="text-slate-400">ملغى</span>}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1 justify-end">
                    {v.status === "draft" && canWrite && (
                      <button onClick={() => postOrder(v)} title="ترحيل" className="text-emerald-600 p-1"><Check size={13} /></button>
                    )}
                    {v.status === "draft" && canWrite && (
                      <button onClick={() => removeDraft(v)} title="حذف" className="text-slate-400 p-1"><Trash2 size={13} /></button>
                    )}
                    {v.status === "posted" && (
                      <button onClick={() => printVoucher(v)} title="طباعة السند" className="text-blue-600 p-1"><Printer size={13} /></button>
                    )}
                    {v.status === "posted" && canVoid && (
                      <button onClick={() => voidVoucher(v)} title="إلغاء (قيد عكسي)" className="text-red-500 p-1"><Ban size={13} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filteredVouchers.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">لا توجد سندات</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* نموذج أمر التوريد / أمر الصرف */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">
                {showForm === "receipt" ? "أمر توريد جديد (سند قبض)" : "أمر صرف جديد (سند صرف)"}
              </h3>
              <button onClick={() => setShowForm(null)}><X size={16} /></button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="col-span-1">
                <span className="text-slate-500">التاريخ</span>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>
              <label className="col-span-1">
                <span className="text-slate-500">المبلغ</span>
                <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>

              {form.currency !== "EGP" && (
                <label className="col-span-2">
                  <span className="text-slate-500">
                    سعر الصرف (جنيه لكل 1 {form.currency})
                    {suggestedRate ? <span className="text-slate-400"> — آخر سعر في الجدول: {suggestedRate}</span> : <span className="text-amber-600"> — مفيش سعر في الجدول، اكتبه يدويًا</span>}
                  </span>
                  <input
                    type="number"
                    step="0.0001"
                    value={form.exchangeRate}
                    placeholder={suggestedRate ? String(suggestedRate) : ""}
                    onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })}
                    className="w-full border rounded px-2 py-1.5 mt-0.5"
                  />
                  <span className="text-[10px] text-slate-400">
                    المعادل بالجنيه: {fmt((parseNum(form.amount) || 0) * (parseNum(form.exchangeRate) || suggestedRate || 0))} EGP
                  </span>
                </label>
              )}

              <label className="col-span-1">
                <span className="text-slate-500">حساب الخزينة</span>
                <select
                  value={`${form.treasuryAccount}_${form.currency}`}
                  onChange={(e) => {
                    const acc = TREASURY_ACCOUNTS.find((a) => `${a.code}_${a.currency}` === e.target.value);
                    setForm({ ...form, treasuryAccount: acc.code, currency: acc.currency, exchangeRate: "" });
                  }}
                  className="w-full border rounded px-2 py-1.5 mt-0.5"
                >
                  {TREASURY_ACCOUNTS.map((a) => (
                    <option key={`${a.code}_${a.currency}`} value={`${a.code}_${a.currency}`}>{a.name} ({a.currency})</option>
                  ))}
                </select>
              </label>
              <label className="col-span-1">
                <span className="text-slate-500">الحساب المقابل</span>
                <select value={form.contraAccount} onChange={(e) => setForm({ ...form, contraAccount: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5">
                  {CONTRA_ACCOUNTS.map((a) => (
                    <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="text-slate-500">نوع الطرف</span>
                <select value={form.partyType} onChange={(e) => setForm({ ...form, partyType: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5">
                  <option value="client">عميل</option>
                  <option value="supplier">مورد</option>
                  <option value="employee">موظف</option>
                  <option value="other">أخرى</option>
                </select>
              </label>
              <label className="col-span-1">
                <span className="text-slate-500">كود الطرف</span>
                <input value={form.partyCode} onChange={(e) => setForm({ ...form, partyCode: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>

              <label className="col-span-2">
                <span className="text-slate-500">{showForm === "receipt" ? "استلمنا من" : "صرفنا إلى"}</span>
                <input value={form.partyName} onChange={(e) => setForm({ ...form, partyName: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>

              <label className="col-span-1">
                <span className="text-slate-500">طريقة الدفع</span>
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5">
                  <option value="cash">نقدي</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                  <option value="cheque">شيك</option>
                  <option value="card">بطاقة</option>
                </select>
              </label>
              <label className="col-span-1">
                <span className="text-slate-500">رقم مرجعي (شيك/حوالة)</span>
                <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>

              <label className="col-span-2">
                <span className="text-slate-500">البيان</span>
                <input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowForm(null)} className="px-3 py-1.5 border rounded text-xs">إلغاء</button>
              <button
                onClick={submitOrder}
                disabled={saving}
                className={`px-3 py-1.5 rounded text-xs text-white disabled:opacity-50 ${showForm === "receipt" ? "bg-emerald-600" : "bg-red-600"}`}
              >
                <Plus size={12} className="inline -mt-0.5" /> {saving ? "جارٍ الحفظ..." : "حفظ كأمر (مسودة)"}
              </button>
            </div>
            <p className="text-[10px] text-slate-400">
              الحفظ هنا بينشئ "أمر" فقط (مسودة) — لسه محدّش رصيد الخزينة ولا اتكتب قيد. الترحيل (زرار ✓ في الجدول) هو اللي بيحوّله لـ"سند" رسمي ويقفل الأثر المحاسبي.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
