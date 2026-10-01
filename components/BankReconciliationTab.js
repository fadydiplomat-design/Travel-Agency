"use client";

/**
 * BankReconciliationTab — مطابقة دفتر البنك مع كشف الحساب الفعلي.
 *
 * Workflow: pick an account → import the bank's statement file → run
 * auto-match (same signed amount, ±5 days) → resolve whatever's left by
 * hand in the two-pane list → type in the statement's ending balance and
 * read the Difference line. Difference = 0 means the books are actually
 * proven correct, not just assumed correct.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import toast from "react-hot-toast";
import {
  normalizeStatementRows,
  importStatementRows,
  autoMatch,
  applyMatches,
  matchOne,
  unmatch,
  reconciliationSummary,
} from "@/lib/bankReconciliation";
import { fmtMoney as fmt } from "@/lib/bookingNormalize";
import { Upload, Wand2, Link2, Unlink, CheckCircle2, AlertCircle } from "lucide-react";

const BANK_ACCOUNTS = [
  { code: "1010", name: "1010 Bank EGP" },
  { code: "1020", name: "1020 Bank USD" },
  { code: "1030", name: "1030 Bank EUR" },
];

export default function BankReconciliationTab({ bankLines, canWrite }) {
  const [account, setAccount] = useState("1010");
  const [statementLines, setStatementLines] = useState([]);
  const [statementEndingBalance, setStatementEndingBalance] = useState("");
  const [selectedStatementLine, setSelectedStatementLine] = useState(null);
  const [selectedBankLine, setSelectedBankLine] = useState(null);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState(null); // { rawRows, headers } awaiting column mapping
  const [columnMap, setColumnMap] = useState({ dateCol: "", descCol: "", amountCol: "", debitCol: "", creditCol: "" });
  const fileRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, "bankStatementLines"), where("account", "==", account));
    const unsub = onSnapshot(q, (snap) => setStatementLines(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [account]);

  const accountBankLines = useMemo(() => bankLines.filter((b) => b.account === account), [bankLines, account]);
  const unmatchedStatementLines = useMemo(() => statementLines.filter((s) => !s.matchedBankLineId).sort((a, b) => (b.date || "").localeCompare(a.date || "")), [statementLines]);
  const unmatchedBankLines = useMemo(() => accountBankLines.filter((b) => !b.cleared).sort((a, b) => (b.date || "").localeCompare(a.date || "")), [accountBankLines]);

  const summary = useMemo(
    () => reconciliationSummary(accountBankLines, parseFloat(statementEndingBalance) || 0),
    [accountBankLines, statementEndingBalance]
  );

  /* ── Import: pick file → read headers → let user map columns → write ── */
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const workbook = XLSX.read(buf, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (rawRows.length === 0) {
      toast.error("الملف فاضي أو الصيغة غير مدعومة");
      return;
    }
    const headers = Object.keys(rawRows[0]);
    // Best-effort auto-guess of common header names (English + Arabic
    // exports), so the mapping step is usually already correct and the
    // user just confirms rather than picking from scratch every time.
    const guess = (patterns) => headers.find((h) => patterns.some((p) => h.toLowerCase().includes(p))) || "";
    setColumnMap({
      dateCol: guess(["date", "تاريخ"]),
      descCol: guess(["description", "memo", "narrative", "بيان", "وصف"]),
      amountCol: guess(["amount", "مبلغ"]),
      debitCol: guess(["debit", "مدين", "withdrawal"]),
      creditCol: guess(["credit", "دائن", "deposit"]),
    });
    setPendingImport({ rawRows, headers });
    if (fileRef.current) fileRef.current.value = "";
  };

  const confirmImport = async () => {
    if (!columnMap.dateCol || (!columnMap.amountCol && !(columnMap.debitCol && columnMap.creditCol))) {
      toast.error("حدّد عمود التاريخ، وإما عمود المبلغ أو عمودي مدين/دائن");
      return;
    }
    setImporting(true);
    try {
      const rows = normalizeStatementRows(pendingImport.rawRows, columnMap);
      const n = await importStatementRows(rows, account);
      toast.success(`اتستورد ${n} حركة من كشف الحساب`);
      setPendingImport(null);
    } catch (e) {
      toast.error(e.message || "فشل الاستيراد");
    } finally {
      setImporting(false);
    }
  };

  /* ── Matching ─────────────────────────────────────────────────────── */
  const runAutoMatch = async () => {
    const matches = autoMatch(accountBankLines, statementLines);
    if (matches.length === 0) {
      toast("مفيش حركات اتطابقت تلقائيًا — كمّل باقي المطابقة يدوي تحت", { icon: "ℹ️" });
      return;
    }
    await applyMatches(matches);
    toast.success(`اتطابقت ${matches.length} حركة تلقائيًا`);
  };

  const confirmManualMatch = async () => {
    if (!selectedStatementLine || !selectedBankLine) return;
    try {
      await matchOne(selectedStatementLine, selectedBankLine);
      toast.success("تمت المطابقة");
      setSelectedStatementLine(null);
      setSelectedBankLine(null);
    } catch (e) {
      toast.error(e.message || "فشلت المطابقة");
    }
  };

  const handleUnmatch = async (statementLineId, bankLineId) => {
    try {
      await unmatch(statementLineId, bankLineId);
      toast.success("اتلغت المطابقة");
    } catch (e) {
      toast.error(e.message || "فشل الإلغاء");
    }
  };

  const matchedBankLineById = (id) => accountBankLines.find((b) => b.id === id);

  return (
    <div className="space-y-4">
      {/* Account + import */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select value={account} onChange={(e) => setAccount(e.target.value)} className="border rounded px-2 py-1.5 text-xs">
          {BANK_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
        </select>
        <label className={`inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs text-white cursor-pointer ${canWrite ? "bg-blue-600" : "bg-slate-300 cursor-not-allowed"}`}>
          <Upload size={13} /> استيراد كشف حساب (Excel/CSV)
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} disabled={!canWrite} className="hidden" />
        </label>
      </div>

      {/* Column mapping confirmation before writing anything */}
      {pendingImport && (
        <div className="bg-white border rounded-xl p-4 space-y-3">
          <div className="text-xs font-semibold">حدّد مطابقة الأعمدة قبل الاستيراد ({pendingImport.rawRows.length} صف)</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <label>
              <span className="text-slate-500">التاريخ</span>
              <select value={columnMap.dateCol} onChange={(e) => setColumnMap({ ...columnMap, dateCol: e.target.value })} className="w-full border rounded px-2 py-1 mt-0.5">
                <option value="">—</option>
                {pendingImport.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label>
              <span className="text-slate-500">البيان</span>
              <select value={columnMap.descCol} onChange={(e) => setColumnMap({ ...columnMap, descCol: e.target.value })} className="w-full border rounded px-2 py-1 mt-0.5">
                <option value="">—</option>
                {pendingImport.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label>
              <span className="text-slate-500">المبلغ (موجب/سالب)</span>
              <select value={columnMap.amountCol} onChange={(e) => setColumnMap({ ...columnMap, amountCol: e.target.value })} className="w-full border rounded px-2 py-1 mt-0.5">
                <option value="">— (أو استخدم مدين/دائن)</option>
                {pendingImport.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label>
              <span className="text-slate-500">مدين (خارج)</span>
              <select value={columnMap.debitCol} onChange={(e) => setColumnMap({ ...columnMap, debitCol: e.target.value })} className="w-full border rounded px-2 py-1 mt-0.5">
                <option value="">—</option>
                {pendingImport.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label>
              <span className="text-slate-500">دائن (داخل)</span>
              <select value={columnMap.creditCol} onChange={(e) => setColumnMap({ ...columnMap, creditCol: e.target.value })} className="w-full border rounded px-2 py-1 mt-0.5">
                <option value="">—</option>
                {pendingImport.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setPendingImport(null)} className="px-3 py-1.5 border rounded text-xs">إلغاء</button>
            <button onClick={confirmImport} disabled={importing} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs disabled:opacity-50">
              {importing ? "جارٍ الاستيراد..." : "تأكيد الاستيراد"}
            </button>
          </div>
        </div>
      )}

      {/* Auto-match */}
      <div className="flex justify-between items-center">
        <div className="text-[11px] text-slate-500">
          {unmatchedStatementLines.length} حركة من الكشف لسه مش متطابقة · {unmatchedBankLines.length} حركة في الدفتر لسه مش متأكدة
        </div>
        <button onClick={runAutoMatch} disabled={!canWrite} className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded text-xs disabled:opacity-50">
          <Wand2 size={13} /> مطابقة تلقائية
        </button>
      </div>

      {/* Manual matching: two panes */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-semibold border-b">كشف الحساب (غير متطابق)</div>
          <div className="max-h-64 overflow-auto">
            {unmatchedStatementLines.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedStatementLine(s.id === selectedStatementLine ? null : s.id)}
                className={`w-full text-left px-3 py-1.5 text-[11px] border-b flex justify-between ${selectedStatementLine === s.id ? "bg-blue-50" : "hover:bg-slate-50"}`}
              >
                <span>{s.date} — {s.description}</span>
                <span className={`font-semibold tabular-nums ${s.amount >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt(s.amount)}</span>
              </button>
            ))}
            {unmatchedStatementLines.length === 0 && <div className="px-3 py-6 text-center text-slate-400 text-xs">كل حركات الكشف متطابقة</div>}
          </div>
        </div>
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-semibold border-b">دفتر البنك (غير مؤكّد)</div>
          <div className="max-h-64 overflow-auto">
            {unmatchedBankLines.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedBankLine(b.id === selectedBankLine ? null : b.id)}
                className={`w-full text-left px-3 py-1.5 text-[11px] border-b flex justify-between ${selectedBankLine === b.id ? "bg-blue-50" : "hover:bg-slate-50"}`}
              >
                <span>{b.date} — {b.memo || "—"}</span>
                <span className={`font-semibold tabular-nums ${b.type === "in" ? "text-emerald-700" : "text-red-600"}`}>{fmt(b.type === "in" ? b.amount : -b.amount)}</span>
              </button>
            ))}
            {unmatchedBankLines.length === 0 && <div className="px-3 py-6 text-center text-slate-400 text-xs">كل حركات الدفتر متأكّدة</div>}
          </div>
        </div>
      </div>
      <div className="flex justify-center">
        <button
          onClick={confirmManualMatch}
          disabled={!selectedStatementLine || !selectedBankLine}
          className="inline-flex items-center gap-1 px-4 py-1.5 bg-blue-600 text-white rounded text-xs disabled:opacity-30"
        >
          <Link2 size={13} /> طابق الاتنين المختارين
        </button>
      </div>

      {/* Already matched (for undo) */}
      {statementLines.some((s) => s.matchedBankLineId) && (
        <details className="bg-white border rounded-xl p-3">
          <summary className="text-[11px] font-semibold cursor-pointer">الحركات المتطابقة ({statementLines.filter((s) => s.matchedBankLineId).length})</summary>
          <div className="mt-2 space-y-1">
            {statementLines.filter((s) => s.matchedBankLineId).map((s) => (
              <div key={s.id} className="flex justify-between items-center text-[11px] px-2 py-1 hover:bg-slate-50 rounded">
                <span>{s.date} — {s.description} — {fmt(s.amount)}</span>
                <button onClick={() => handleUnmatch(s.id, s.matchedBankLineId)} className="text-red-500 inline-flex items-center gap-1">
                  <Unlink size={11} /> إلغاء المطابقة
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Reconciliation summary */}
      <div className={`border rounded-xl p-4 ${summary.reconciled ? "bg-emerald-50 border-emerald-200" : "bg-white"}`}>
        <div className="flex items-center gap-2 mb-3">
          {summary.reconciled ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertCircle size={16} className="text-amber-500" />}
          <span className="text-xs font-semibold">ملخص التسوية</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[11px]">
          <div><div className="text-slate-500">رصيد الدفاتر</div><div className="font-semibold tabular-nums">{fmt(summary.bookBalance)}</div></div>
          <div><div className="text-slate-500">إيداعات لسه مش ظاهرة</div><div className="font-semibold tabular-nums text-amber-600">{fmt(summary.unclearedDeposits)}</div></div>
          <div><div className="text-slate-500">سحوبات لسه مش ظاهرة</div><div className="font-semibold tabular-nums text-amber-600">{fmt(summary.unclearedWithdrawals)}</div></div>
          <div><div className="text-slate-500">رصيد الدفاتر المعدّل</div><div className="font-semibold tabular-nums">{fmt(summary.adjustedBookBalance)}</div></div>
          <div>
            <div className="text-slate-500">رصيد كشف الحساب</div>
            <input
              type="number"
              value={statementEndingBalance}
              onChange={(e) => setStatementEndingBalance(e.target.value)}
              placeholder="من كشف البنك"
              className="w-full border rounded px-2 py-1 mt-0.5 text-xs"
            />
          </div>
        </div>
        <div className={`mt-3 pt-3 border-t flex justify-between items-center font-bold text-sm ${summary.reconciled ? "text-emerald-700" : "text-red-600"}`}>
          <span>الفرق</span>
          <span className="tabular-nums">{fmt(summary.difference)}</span>
        </div>
        {!statementEndingBalance && <p className="text-[10px] text-slate-400 mt-2">دخّل رصيد كشف الحساب فوق عشان تشوف هل الدفاتر متطابقة فعليًا.</p>}
      </div>
    </div>
  );
}
