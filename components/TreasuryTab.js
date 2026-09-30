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
 *
 * `t` (from useLanguage() in lib/i18n.js) is passed down from
 * accounts/page.js rather than called here directly, so this stays a
 * plain presentational component the parent controls — every label in
 * this file now goes through accounts.treasury.* / common.* translation
 * keys (see locales/ar.json, locales/en.json) instead of being
 * hardcoded, so it follows the app's language switch like every other
 * translated page.
 */

import { useEffect, useState, useMemo } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
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
  treasuryAccount: "1000",
  contraAccount: "1100",
  partyType: "client",
  partyCode: "",
  partyName: "",
  method: "cash",
  reference: "",
  memo: "",
};

export default function TreasuryTab({ canWrite, t }) {
  const { userData, activeBranch } = useAuth();
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
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  const filteredVouchers = useMemo(() => {
    return vouchers
      .filter((v) => statusFilter === "all" || v.status === statusFilter)
      .filter((v) => typeFilter === "all" || v.type === typeFilter)
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.voucherNumber || "").localeCompare(a.voucherNumber || ""));
  }, [vouchers, statusFilter, typeFilter]);

  /* ── 1 & 2: أمر توريد / أمر صرف ───────────────────────────────────── */
  const openForm = (type) => {
    setForm({ ...EMPTY_ORDER, treasuryAccount: TREASURY_ACCOUNTS[0].code, currency: "EGP" });
    setShowForm(type);
  };

  const submitOrder = async () => {
    if (!canWrite) return;
    if (!parseNum(form.amount)) return toast.error(t("common.amount"));
    if (!form.partyName.trim()) return toast.error(t("accounts.treasury.partyCode"));
    setSaving(true);
    try {
      const { voucherNumber } = await createTreasuryOrder({
        type: showForm,
        ...form,
        branch,
        createdBy: userName,
      });
      toast.success(`${t(showForm === "receipt" ? "accounts.treasury.receiptOrder" : "accounts.treasury.paymentOrder")} ${voucherNumber}`);
      setShowForm(null);
    } catch (e) {
      toast.error(e.message || t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  /* ── 3 & 4: ترحيل الأمر → سند رسمي قابل للطباعة ──────────────────── */
  const postOrder = async (v) => {
    if (!canWrite) return;
    if (!confirm(`${t("accounts.treasury.post")} ${v.voucherNumber}?`)) return;
    try {
      await postTreasuryVoucher(v.id, { userName });
      toast.success(t("common.success"));
    } catch (e) {
      toast.error(e.message || t("common.error"));
    }
  };

  const voidVoucher = async (v) => {
    if (!canWrite) return;
    if (!confirm(`${t("accounts.treasury.void")} ${v.voucherNumber}?`)) return;
    try {
      await voidTreasuryVoucher(v.id, { userName });
      toast.success(t("common.success"));
    } catch (e) {
      toast.error(e.message || t("common.error"));
    }
  };

  const removeDraft = async (v) => {
    if (!canWrite) return;
    if (!confirm(`${t("common.delete")} ${v.voucherNumber}?`)) return;
    try {
      await deleteTreasuryOrder(v.id);
      toast.success(t("common.success"));
    } catch (e) {
      toast.error(e.message || t("common.error"));
    }
  };

  const printVoucher = (v) => {
    const isReceipt = v.type === "receipt";
    const acct = TREASURY_ACCOUNTS.find((a) => a.code === v.treasuryAccount && a.currency === v.currency);
    const statusLabel = v.status === "posted" ? t("accounts.treasury.statusPosted") : v.status === "void" ? t("accounts.treasury.statusVoid") : t("accounts.treasury.statusDraft");
    const html = `
      <h2>${isReceipt ? t("accounts.treasury.receiptVoucher") : t("accounts.treasury.paymentVoucher")} — ${v.voucherNumber}</h2>
      <div class="sub">${statusLabel}</div>
      <div class="grid2">
        <div><span class="lbl">${t("common.status")}</span><br/>${v.date}</div>
        <div><span class="lbl">${t("accounts.treasury.partyCode")}</span><br/>${v.branch}</div>
        <div><span class="lbl">${isReceipt ? t("accounts.treasury.receivedFrom") : t("accounts.treasury.paidTo")}</span><br/>${v.partyName || "—"} (${v.partyCode || "—"})</div>
        <div><span class="lbl">${t("accounts.treasury.paymentMethod")}</span><br/>${v.method}${v.reference ? " — " + v.reference : ""}</div>
        <div><span class="lbl">${t("accounts.treasury.treasuryAccount")}</span><br/>${acct?.name || v.treasuryAccount} (${v.currency})</div>
        <div><span class="lbl">${t("accounts.treasury.contraAccount")}</span><br/>${v.contraAccount}</div>
      </div>
      <table>
        <tr><th>${t("accounts.treasury.memo")}</th><th style="text-align:right">${t("common.amount")}</th></tr>
        <tr><td>${v.memo || (isReceipt ? t("accounts.treasury.receipt") : t("accounts.treasury.payment"))}</td><td style="text-align:right">${fmt(v.amount)} ${v.currency}</td></tr>
      </table>
      <div class="grid2" style="margin-top:16px">
        <div><span class="lbl">______________</span><br/><br/>______________</div>
        <div><span class="lbl">______________</span><br/><br/>______________</div>
      </div>
    `;
    openPrintWindow(v.voucherNumber, html);
  };

  return (
    <div className="space-y-4">
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
            <ArrowDownCircle size={14} /> {t("accounts.treasury.newReceiptOrder")}
          </button>
          <button
            onClick={() => openForm("payment")}
            disabled={!canWrite}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded text-xs disabled:opacity-50"
          >
            <ArrowUpCircle size={14} /> {t("accounts.treasury.newPaymentOrder")}
          </button>
        </div>
        <div className="flex gap-2 text-xs">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="border rounded px-2 py-1">
            <option value="all">{t("accounts.treasury.allTypes")}</option>
            <option value="receipt">{t("accounts.treasury.receipt")}</option>
            <option value="payment">{t("accounts.treasury.payment")}</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border rounded px-2 py-1">
            <option value="all">{t("accounts.treasury.allStatuses")}</option>
            <option value="draft">{t("accounts.treasury.statusDraft")}</option>
            <option value="posted">{t("accounts.treasury.statusPosted")}</option>
            <option value="void">{t("accounts.treasury.statusVoid")}</option>
          </select>
        </div>
      </div>

      {/* سجل الأوامر والسندات */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-1.5">#</th>
              <th className="text-left px-3 py-1.5">{t("common.date")}</th>
              <th className="text-left px-3 py-1.5">{t("accounts.treasury.receipt")}/{t("accounts.treasury.payment")}</th>
              <th className="text-left px-3 py-1.5">{t("accounts.treasury.partyCode")}</th>
              <th className="text-left px-3 py-1.5">{t("accounts.treasury.treasuryAccount")}</th>
              <th className="text-right px-3 py-1.5">{t("common.amount")}</th>
              <th className="text-center px-3 py-1.5">{t("common.status")}</th>
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
                    {v.type === "receipt" ? t("accounts.treasury.receipt") : t("accounts.treasury.payment")}
                  </span>
                </td>
                <td className="px-3 py-1.5">{v.partyName}</td>
                <td className="px-3 py-1.5">{v.treasuryAccount} / {v.currency}</td>
                <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${v.type === "receipt" ? "text-emerald-700" : "text-red-600"}`}>
                  {fmt(v.amount)}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {v.status === "draft" && <span className="text-amber-600">{t("accounts.treasury.statusDraft")}</span>}
                  {v.status === "posted" && <span className="text-emerald-600">{t("accounts.treasury.statusPosted")}</span>}
                  {v.status === "void" && <span className="text-slate-400">{t("accounts.treasury.statusVoid")}</span>}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1 justify-end">
                    {v.status === "draft" && canWrite && (
                      <button onClick={() => postOrder(v)} title={t("accounts.treasury.post")} className="text-emerald-600 p-1"><Check size={13} /></button>
                    )}
                    {v.status === "draft" && canWrite && (
                      <button onClick={() => removeDraft(v)} title={t("common.delete")} className="text-slate-400 p-1"><Trash2 size={13} /></button>
                    )}
                    {v.status === "posted" && (
                      <button onClick={() => printVoucher(v)} title={t("accounts.treasury.print")} className="text-blue-600 p-1"><Printer size={13} /></button>
                    )}
                    {v.status === "posted" && canWrite && (
                      <button onClick={() => voidVoucher(v)} title={t("accounts.treasury.void")} className="text-red-500 p-1"><Ban size={13} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filteredVouchers.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">{t("accounts.treasury.noVouchers")}</td></tr>
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
                {t(showForm === "receipt" ? "accounts.treasury.newReceiptOrder" : "accounts.treasury.newPaymentOrder")}
              </h3>
              <button onClick={() => setShowForm(null)}><X size={16} /></button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="col-span-1">
                <span className="text-slate-500">{t("common.date")}</span>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>
              <label className="col-span-1">
                <span className="text-slate-500">{t("common.amount")}</span>
                <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>

              <label className="col-span-1">
                <span className="text-slate-500">{t("accounts.treasury.treasuryAccount")}</span>
                <select
                  value={`${form.treasuryAccount}_${form.currency}`}
                  onChange={(e) => {
                    const acc = TREASURY_ACCOUNTS.find((a) => `${a.code}_${a.currency}` === e.target.value);
                    setForm({ ...form, treasuryAccount: acc.code, currency: acc.currency });
                  }}
                  className="w-full border rounded px-2 py-1.5 mt-0.5"
                >
                  {TREASURY_ACCOUNTS.map((a) => (
                    <option key={`${a.code}_${a.currency}`} value={`${a.code}_${a.currency}`}>{a.name} ({a.currency})</option>
                  ))}
                </select>
              </label>
              <label className="col-span-1">
                <span className="text-slate-500">{t("accounts.treasury.contraAccount")}</span>
                <select value={form.contraAccount} onChange={(e) => setForm({ ...form, contraAccount: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5">
                  {CONTRA_ACCOUNTS.map((a) => (
                    <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="text-slate-500">{t("accounts.treasury.partyType")}</span>
                <select value={form.partyType} onChange={(e) => setForm({ ...form, partyType: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5">
                  <option value="client">{t("accounts.treasury.client")}</option>
                  <option value="supplier">{t("accounts.treasury.supplier")}</option>
                  <option value="employee">{t("accounts.treasury.employee")}</option>
                  <option value="other">{t("accounts.treasury.other")}</option>
                </select>
              </label>
              <label className="col-span-1">
                <span className="text-slate-500">{t("accounts.treasury.partyCode")}</span>
                <input value={form.partyCode} onChange={(e) => setForm({ ...form, partyCode: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>

              <label className="col-span-2">
                <span className="text-slate-500">{t(showForm === "receipt" ? "accounts.treasury.receivedFrom" : "accounts.treasury.paidTo")}</span>
                <input value={form.partyName} onChange={(e) => setForm({ ...form, partyName: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>

              <label className="col-span-1">
                <span className="text-slate-500">{t("accounts.treasury.paymentMethod")}</span>
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5">
                  <option value="cash">{t("accounts.treasury.cash")}</option>
                  <option value="bank_transfer">{t("accounts.treasury.bankTransfer")}</option>
                  <option value="cheque">{t("accounts.treasury.cheque")}</option>
                  <option value="card">{t("accounts.treasury.card")}</option>
                </select>
              </label>
              <label className="col-span-1">
                <span className="text-slate-500">{t("accounts.treasury.reference")}</span>
                <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>

              <label className="col-span-2">
                <span className="text-slate-500">{t("accounts.treasury.memo")}</span>
                <input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowForm(null)} className="px-3 py-1.5 border rounded text-xs">{t("common.cancel")}</button>
              <button
                onClick={submitOrder}
                disabled={saving}
                className={`px-3 py-1.5 rounded text-xs text-white disabled:opacity-50 ${showForm === "receipt" ? "bg-emerald-600" : "bg-red-600"}`}
              >
                <Plus size={12} className="inline -mt-0.5" /> {saving ? t("common.loading") : t("accounts.treasury.saveAsDraft")}
              </button>
            </div>
            <p className="text-[10px] text-slate-400">
              {t("accounts.treasury.draftHint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
