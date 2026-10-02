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
  postStatementLine,
} from "@/lib/bankReconciliation";
import { useAuth, logActivity } from "@/lib/auth";
import { CHART_OF_ACCOUNTS, ACCOUNT_BY_CODE } from "@/lib/chartOfAccounts";
import { reconciliationAsOf, buildCloseSnapshot, monthEndISO, monthOf, closeDocId } from "@/lib/reconMath";
import { prepareClose, signOffClose, reopenClose } from "@/lib/reconClose";
import { rateOn } from "@/lib/fx";
import { todayISO } from "@/lib/period";
import { fmtMoney as fmt } from "@/lib/bookingNormalize";
import { Upload, Wand2, Link2, Unlink, CheckCircle2, AlertCircle, Lock, FilePlus2 } from "lucide-react";

const BANK_ACCOUNTS = [
  { code: "1010", name: "1010 Bank EGP" },
  { code: "1020", name: "1020 Bank USD" },
  { code: "1030", name: "1030 Bank EUR" },
];

// canWrite   – prepare / match / import / post statement items (Accountant, Controller)
// canSignoff – sign or reopen a month (Controller; never the person who prepared it)
export default function BankReconciliationTab({ bankLines, canWrite, canSignoff = false, rates = [] }) {
  const { userData, activeBranch } = useAuth();
  const userName = userData?.name || userData?.username || "";
  const [month, setMonth] = useState(monthOf(todayISO()));
  const [closes, setCloses] = useState([]);
  const [postingLine, setPostingLine] = useState(null); // statement line being turned into a bank-book entry
  const [postForm, setPostForm] = useState({ contraAccount: "6200", memo: "", exchangeRate: "" });
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

  useEffect(() => {
    const q = query(collection(db, "reconciliationCloses"), where("account", "==", account));
    const unsub = onSnapshot(q, (snap) => setCloses(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
    return () => unsub();
  }, [account]);

  const accountBankLines = useMemo(() => bankLines.filter((b) => b.account === account), [bankLines, account]);
  const unmatchedStatementLines = useMemo(() => statementLines.filter((s) => !s.matchedBankLineId).sort((a, b) => (b.date || "").localeCompare(a.date || "")), [statementLines]);
  const unmatchedBankLines = useMemo(() => accountBankLines.filter((b) => !b.cleared).sort((a, b) => (b.date || "").localeCompare(a.date || "")), [accountBankLines]);

  // Position AS OF the end of the selected month (not "right now"), so a
  // sign-off freezes the same numbers the Controller reviewed.
  const asOf = monthEndISO(month);
  const summary = useMemo(
    () => reconciliationAsOf({ bankLines: accountBankLines, statementLines, asOf, statementEndingBalance: parseFloat(statementEndingBalance) || 0 }),
    [accountBankLines, statementLines, asOf, statementEndingBalance]
  );
  const closeDoc = closes.find((c) => c.id === closeDocId(account, month));
  const locked = closeDoc?.status === "signed";
  const canEdit = canWrite && !locked; // matching / importing / posting are frozen for a signed month
  const closeCheck = useMemo(
    () => buildCloseSnapshot({ account, month, bankLines: accountBankLines, statementLines, statementEndingBalance }),
    [account, month, accountBankLines, statementLines, statementEndingBalance]
  );
  const currencyOfAccount = ACCOUNT_BY_CODE[account]?.currency || "EGP";

  /* ── Month close: prepare → sign (different person) → reopen ── */
  const doPrepare = async () => {
    if (closeCheck.blockers.length) return toast.error(closeCheck.blockers[0]);
    try {
      await prepareClose(closeCheck.snapshot, { userName, userUid: userData?.uid });
      logActivity({ userId: userData?.uid, username: userData?.username, name: userData?.name, action: "reconciliation_prepared", meta: { account, month } });
      toast.success("تم إعداد التسوية — في انتظار توقيع المدير المالي");
    } catch (e) { toast.error(e.message || "فشل الإعداد"); }
  };
  const doSign = async () => {
    try {
      await signOffClose(closeDoc.id, { userName, userUid: userData?.uid });
      logActivity({ userId: userData?.uid, username: userData?.username, name: userData?.name, action: "reconciliation_signed", meta: { account, month } });
      toast.success("تم توقيع التسوية وقفل الشهر");
    } catch (e) { toast.error(e.message || "فشل التوقيع"); }
  };
  const doReopen = async () => {
    const reason = window.prompt(`سبب إعادة فتح تسوية ${month} (إجباري):`);
    if (reason === null) return;
    if (reason.trim().length < 3) return toast.error("السبب مطلوب");
    try {
      await reopenClose(closeDoc.id, { reason, userName, userUid: userData?.uid });
      logActivity({ userId: userData?.uid, username: userData?.username, name: userData?.name, action: "reconciliation_reopened", meta: { account, month, reason: reason.trim() } });
      toast.success("تمت إعادة فتح الشهر");
    } catch (e) { toast.error(e.message || "فشلت إعادة الفتح"); }
  };

  /* ── Unmatched statement line → real bank-book entry (fees, interest, unknown items) ── */
  const openPost = (sl) => {
    setPostingLine(sl);
    setPostForm({ contraAccount: sl.amount < 0 ? "6200" : "1900", memo: sl.description || "", exchangeRate: "" });
  };
  const suggestedRate = postingLine && currencyOfAccount !== "EGP" ? rateOn(rates, currencyOfAccount, postingLine.date) : 1;
  const confirmPost = async () => {
    try {
      await postStatementLine(postingLine.id, {
        contraAccount: postForm.contraAccount,
        memo: postForm.memo,
        exchangeRate: Number(postForm.exchangeRate) || suggestedRate,
        branch: activeBranch,
        userName,
        userUid: userData?.uid,
      });
      logActivity({ userId: userData?.uid, username: userData?.username, name: userData?.name, action: "statement_line_posted", meta: { statementLineId: postingLine.id, account, amount: postingLine.amount, contraAccount: postForm.contraAccount } });
      toast.success("اتسجّلت الحركة في دفتر البنك واتطابقت");
      setPostingLine(null);
    } catch (e) { toast.error(e.message || "فشل التسجيل (راجع إن الفترة المحاسبية مفتوحة)"); }
  };

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
        <label className={`inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs text-white cursor-pointer ${canEdit ? "bg-blue-600" : "bg-slate-300 cursor-not-allowed"}`}>
          <Upload size={13} /> استيراد كشف حساب (Excel/CSV)
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} disabled={!canEdit} className="hidden" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="inline-flex items-center gap-1">
          <span className="text-slate-500">الشهر</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value || monthOf(todayISO()))} className="border rounded px-2 py-1" />
        </label>
        <span className="text-slate-400">الأرصدة محسوبة لحد {asOf}</span>
        {closeDoc && (
          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${closeDoc.status === "signed" ? "bg-emerald-100 text-emerald-700" : closeDoc.status === "prepared" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
            {closeDoc.status === "signed" ? "موقَّع ومقفول" : closeDoc.status === "prepared" ? "مُعدّة — في انتظار التوقيع" : "أُعيد فتحها"}
          </span>
        )}
      </div>
      {locked && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl p-3 text-xs flex items-center gap-2">
          <Lock size={14} /> الشهر ده موقَّع بواسطة {closeDoc.signedBy} — الاستيراد والمطابقة وإضافة حركات بنك فيه متوقفة. لتعديل أي حاجة، المدير المالي يعيد فتحه بسبب مكتوب.
        </div>
      )}

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
        <button onClick={runAutoMatch} disabled={!canEdit} className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded text-xs disabled:opacity-50">
          <Wand2 size={13} /> مطابقة تلقائية
        </button>
      </div>

      {/* Manual matching: two panes */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-semibold border-b">كشف الحساب (غير متطابق)</div>
          <div className="max-h-64 overflow-auto">
            {unmatchedStatementLines.map((s) => (
              <div key={s.id} className={`flex items-center border-b ${selectedStatementLine === s.id ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                <button
                  onClick={() => setSelectedStatementLine(s.id === selectedStatementLine ? null : s.id)}
                  className="flex-1 text-left px-3 py-1.5 text-[11px] flex justify-between"
                >
                  <span>{s.date} — {s.description}</span>
                  <span className={`font-semibold tabular-nums ${s.amount >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt(s.amount)}</span>
                </button>
                {canEdit && (
                  <button onClick={() => openPost(s)} title="سجّلها كحركة في دفتر البنك (رسوم/فوائد/غير معروفة)" className="px-2 text-blue-600">
                    <FilePlus2 size={13} />
                  </button>
                )}
              </div>
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
                <button onClick={() => handleUnmatch(s.id, s.matchedBankLineId)} disabled={!canEdit} className="text-red-500 inline-flex items-center gap-1 disabled:opacity-30">
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
          <div><div className="text-slate-500">إيداعات لسه مش ظاهرة</div><div className="font-semibold tabular-nums text-amber-600">{fmt(summary.outstandingDeposits)}</div></div>
          <div><div className="text-slate-500">سحوبات لسه مش ظاهرة</div><div className="font-semibold tabular-nums text-amber-600">{fmt(summary.outstandingWithdrawals)}</div></div>
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
        {summary.unmatchedStatement.length > 0 && (
          <p className="text-[10px] text-amber-700 mt-2">{summary.unmatchedStatement.length} حركة من الكشف (لحد {asOf}) لسه مش متطابقة — لازم تتطابق أو تتسجّل قبل إعداد التسوية.</p>
        )}
      </div>

      {/* Month-end close: prepare → sign-off → (reopen) */}
      <div className="bg-white border rounded-xl p-4 space-y-2">
        <div className="text-xs font-semibold">إقفال تسوية شهر {month}</div>
        {closeCheck.blockers.length > 0 && !locked && (
          <ul className="text-[11px] text-amber-700 list-disc ms-4">
            {closeCheck.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        )}
        {closeDoc && (
          <p className="text-[11px] text-slate-500">
            أعدّها {closeDoc.preparedBy || "—"}
            {closeDoc.status === "signed" && <> · وقّعها {closeDoc.signedBy}</>}
            {closeDoc.reopenCount > 0 && <> · أُعيد فتحها {closeDoc.reopenCount} مرة (آخر سبب: {closeDoc.reopenReason})</>}
            {" "}· بنود معلّقة وقت الإعداد: {closeDoc.outstandingCount ?? 0}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!locked && (
            <button onClick={doPrepare} disabled={!canWrite || closeCheck.blockers.length > 0} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs disabled:opacity-40">
              {closeDoc?.status === "prepared" ? "إعادة إعداد التسوية" : "إعداد التسوية للتوقيع"}
            </button>
          )}
          {closeDoc?.status === "prepared" && canSignoff && (
            <button onClick={doSign} disabled={closeDoc.preparedByUid === userData?.uid} title={closeDoc.preparedByUid === userData?.uid ? "لا يمكن لمُعدّ التسوية توقيعها" : undefined} className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs disabled:opacity-40">
              توقيع وقفل الشهر
            </button>
          )}
          {locked && canSignoff && (
            <button onClick={doReopen} className="px-3 py-1.5 border border-red-300 text-red-600 rounded text-xs">إعادة فتح الشهر</button>
          )}
        </div>
      </div>

      {/* Post an unmatched statement line as a real entry */}
      {postingLine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-5 space-y-3 text-xs">
            <div className="font-semibold text-sm">تسجيل حركة من الكشف</div>
            <div className="bg-slate-50 rounded p-2">{postingLine.date} — {postingLine.description} — <b>{fmt(postingLine.amount)}</b> ({currencyOfAccount})</div>
            <label className="block">
              <span className="text-slate-500">الحساب المقابل</span>
              <select value={postForm.contraAccount} onChange={(e) => setPostForm({ ...postForm, contraAccount: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5">
                {CHART_OF_ACCOUNTS.filter((a) => !a.currency).map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
              </select>
              <span className="text-[10px] text-slate-400">رسوم/فوائد بنك → 6200 · مش عارف الحركة دي إيه → 1900 (Suspense) وتتسوّى بعدين من تبويب التسويات.</span>
            </label>
            {currencyOfAccount !== "EGP" && (
              <label className="block">
                <span className="text-slate-500">سعر الصرف (جنيه لكل 1 {currencyOfAccount}) {suggestedRate ? `— الجدول: ${suggestedRate}` : "— مفيش سعر في الجدول"}</span>
                <input type="number" step="0.0001" value={postForm.exchangeRate} placeholder={suggestedRate ? String(suggestedRate) : ""} onChange={(e) => setPostForm({ ...postForm, exchangeRate: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
              </label>
            )}
            <label className="block">
              <span className="text-slate-500">البيان</span>
              <input value={postForm.memo} onChange={(e) => setPostForm({ ...postForm, memo: e.target.value })} className="w-full border rounded px-2 py-1.5 mt-0.5" />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPostingLine(null)} className="px-3 py-1.5 border rounded">إلغاء</button>
              <button onClick={confirmPost} className="px-3 py-1.5 bg-blue-600 text-white rounded">تسجيل ومطابقة</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
