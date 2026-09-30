"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Navbar from "@/components/Navbar";
import { collection, onSnapshot, doc, updateDoc, deleteDoc, getDocs, writeBatch, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { generateInvoiceNumber, isBranchVisible, bookingQuery } from "@/lib/helpers";
import { useClosedFiscalYearKeys, isRowClosed } from "@/lib/fiscalYear";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { canWriteModule } from "@/lib/permissions";
import { companyProfile, letterheadFooterHtml } from "@/lib/companyProfile";
import { FileText, Search, Printer, DollarSign, Check, Clock, X, Plus, AlertCircle, Receipt, Eye, Pencil, Trash2, Unlock } from "lucide-react";

function fmt(v) {
  return Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDateDMY(iso) {
  if (!iso) return "-";
  const p = String(iso).split("-");
  if (p.length === 3 && p[0].length === 4) return `${p[2].padStart(2,"0")}/${p[1].padStart(2,"0")}/${p[0]}`;
  return iso;
}

export default function InvoicesPage() {
  const router = useRouter();
  const { userData, hasPermission, activeBranch, myBranches, branchesList, appFeatures, user } = useAuth();
  const isAdmin = hasPermission ? hasPermission(["Admin"]) : userData?.role === "Admin";
  // Read-only users can open Invoices and print, but not issue one or
  // change payment status. Firestore rules enforce the same thing.
  const canWrite = canWriteModule(userData, "invoices", isAdmin, appFeatures);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all"); // all | flights | hotels | visa | transport | credit | pending
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showNewModal, setShowNewModal] = useState(false);
  const [pendingFlights, setPendingFlights] = useState([]);
  const [selectedPending, setSelectedPending] = useState("");
  const [viewInvoice, setViewInvoice] = useState(null);
  const [printPreview, setPrintPreview] = useState(null);
  const printRef = useRef(null);

  const closedYearKeys = useClosedFiscalYearKeys();
  const closedYearKeysToken = useMemo(() => [...closedYearKeys].sort().join(","), [closedYearKeys]);

  // Real-time aggregation - include ALL flights (invoiced + pending)
  useEffect(() => {
    setLoading(true);
    const unsubs = [];

    const handleFlightsSnap = (snap) => {
      const flights = snap.docs.map((d) => ({ id: d.id, _collection: "flights", ...d.data() }));
      const mapped = flights.map((f) => {
        // Only dedicated refund rows are credit notes — NOT the original ticket
        // (original is marked status=Refunded / ticketType=R but must stay a normal invoice)
        const isCredit = !!f.isRefundRow;
        const isVoid = String(f.status || "").toLowerCase().includes("void") || String(f.ticketType || "").startsWith("V");
        // Amount always positive; sign is applied in UI/stats for credits
        const amount = isVoid ? 0 : Math.abs(parseFloat(f.totalSell ?? f.sellPrice) || 0);
        const isInvoiced = !!f.invoiceIssued && !!f.invoiceNumber;
        return {
          _id: `flights-${f.id}`,
          docId: f.id,
          collection: "flights",
          branch: f.branch || "1",
          invoiceNumber: f.invoiceNumber || "",
          numberPrefix: f.numberPrefix || "",
          sequentialNumber: f.sequentialNumber || 0,
          issueDate: f.issueDate || f.refundDate || f.createdAt?.toDate?.().toISOString().slice(0,10) || "",
          section: isCredit ? "Flight Refund" : "Flight",
          isCredit,
          isVoid,
          isPending: !isInvoiced,
          clientCode: f.clientCode || "",
          clientName: f.clientName || "",
          supplier: f.supplierSymbol || f.supplierName || f.supplierCode || "",
          amount,
          currency: f.sellCurrency || f.currency || "EGP",
          invoicePaid: !!f.invoicePaid,
          paidDate: f.paidDate || "",
          raw: f,
        };
      }).filter((row) => isBranchVisible(row.branch, { isAdmin, activeBranch, myBranches }))
        .filter((row) => !isRowClosed(row, closedYearKeys, "issueDate"));
      setInvoices((prev) => {
        const others = prev.filter((x) => x.collection !== "flights");
        const merged = [...others, ...mapped].sort((a,b) => (b.issueDate||"").localeCompare(a.issueDate||""));
        return merged;
      });
      setLoading(false);
    };

    const unsubFlights = onSnapshot(bookingQuery("flights", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), handleFlightsSnap, () => setLoading(false));
    unsubs.push(unsubFlights);

    const unsubInvoices = onSnapshot(collection(db, "invoices"), (snap) => {
      const mans = snap.docs.map((d) => ({ id: d.id, _collection: "invoices", ...d.data() }));
      const mapped = mans.map((f) => ({
        _id: `invoices-${f.id}`,
        docId: f.id,
        collection: "invoices",
        branch: f.branch || "1",
        invoiceNumber: f.invoiceNumber || "",
        numberPrefix: f.numberPrefix || "",
        sequentialNumber: f.sequentialNumber || 0,
        issueDate: f.issueDate || f.createdAt?.toDate?.().toISOString().slice(0,10) || "",
        section: f.section || "Manual",
        isCredit: !!f.isRefundRow || String(f.invoiceType || "").toLowerCase() === "refund" || String(f.section || "").toLowerCase().includes("refund"),
        isVoid: false,
        isPending: !f.invoiceNumber,
        clientCode: f.clientCode || "",
        clientName: f.clientName || "",
        supplier: f.supplier || "",
        amount: Math.abs(parseFloat(f.totalSell ?? f.amount) || 0),
        currency: f.currency || "EGP",
        invoicePaid: !!f.invoicePaid,
        paidDate: f.paidDate || "",
        raw: f,
      })).filter((row) => isBranchVisible(row.branch, { isAdmin, activeBranch, myBranches }))
         .filter((row) => !isRowClosed(row, closedYearKeys, "issueDate"));
      setInvoices((prev) => {
        const others = prev.filter((x) => x.collection !== "invoices");
        const merged = [...others, ...mapped].sort((a,b) => (b.issueDate||"").localeCompare(a.issueDate||""));
        return merged;
      });
    }, () => {});
    unsubs.push(unsubInvoices);

    const tryListen = (collName, section) => {
      try {
        const u = onSnapshot(collection(db, collName), (snap) => {
          const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const mapped = docs.map((f) => {
            const isCredit = !!f.isRefundRow || String(f.invoiceType || "").toLowerCase() === "refund";
            const isVoid = String(f.status||"").toLowerCase().includes("void");
            return {
              _id: `${collName}-${f.id}`,
              docId: f.id,
              collection: collName,
              branch: f.branch || "1",
              invoiceNumber: f.invoiceNumber || "",
              numberPrefix: f.numberPrefix || "",
              sequentialNumber: f.sequentialNumber || 0,
              issueDate: f.issueDate || "",
              section: isCredit ? `${section} Refund` : section,
              isCredit,
              isVoid,
              isPending: !f.invoiceIssued,
              clientCode: f.clientCode || "",
              clientName: f.clientName || "",
              supplier: f.supplierName || f.hotel || f.supplier || "",
              amount: Math.abs(parseFloat(f.totalSell ?? f.netPrice) || 0),
              currency: f.currency || f.sellCurrency || "EGP",
              invoicePaid: !!f.invoicePaid,
              paidDate: f.paidDate || "",
              raw: f,
            };
          }).filter((row) => isBranchVisible(row.branch, { isAdmin, activeBranch, myBranches }))
            .filter((row) => !isRowClosed(row, closedYearKeys, "issueDate"));
          setInvoices((prev) => {
            const others = prev.filter((x) => x.collection !== collName);
            const merged = [...others, ...mapped].sort((a,b) => (b.issueDate||"").localeCompare(a.issueDate||""));
            return merged;
          });
        }, () => {});
        unsubs.push(u);
      } catch {}
    };
    // NOTE: corrected from the previous "visas"/"cars" (those collections
    // don't exist — the real ones are "visa" and "transportation" — so
    // those rows were silently never loading on this page before).
    tryListen("hotels", "Hotel");
    tryListen("visa", "Visa");
    tryListen("transportation", "Transport");

    return () => unsubs.forEach((u) => u && u());
  }, [isAdmin, activeBranch, JSON.stringify(myBranches), closedYearKeysToken, userData?.onlyOwnData, user?.uid]);

  useEffect(() => {
    if (!showNewModal) return;
    const unsub = onSnapshot(bookingQuery("flights", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const pend = all.filter((f) => !f.invoiceIssued).slice(0, 100);
      setPendingFlights(pend);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewModal, isAdmin, JSON.stringify(myBranches), userData?.onlyOwnData, user?.uid]);

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (sectionFilter === "flights" && !inv.section.toLowerCase().includes("flight")) return false;
      if (sectionFilter === "hotels" && inv.section !== "Hotel") return false;
      if (sectionFilter === "visa" && inv.section !== "Visa") return false;
      if (sectionFilter === "transport" && inv.section !== "Transport") return false;
      if (sectionFilter === "credit" && !inv.isCredit) return false;
      if (sectionFilter === "credit" && inv.isVoid) return false;
      if (sectionFilter === "pending" && !inv.isPending) return false;
      if (sectionFilter === "invoiced" && inv.isPending) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !(inv.invoiceNumber || "").toLowerCase().includes(q) &&
          !(inv.clientCode || "").toLowerCase().includes(q) &&
          !(inv.clientName || "").toLowerCase().includes(q) &&
          !(inv.supplier || "").toLowerCase().includes(q)
        ) return false;
      }
      if (dateFrom && (inv.issueDate || "") < dateFrom) return false;
      if (dateTo && (inv.issueDate || "") > dateTo) return false;
      return true;
    });
  }, [invoices, search, sectionFilter, dateFrom, dateTo]);

  const stats = useMemo(() => {
    // Logical accounting:
    // - Total Invoiced = sales invoices only (positive)
    // - Credit Notes   = sum of credit-note amounts (positive magnitude)
    // - Net            = sales - credits (can be shown in footer)
    // - Total Paid     = paid sales − paid credits (refunds already paid out)
    // - Outstanding    = unpaid sales (credits don't increase what client owes)
    let totalInvoiced = 0, totalPaid = 0, totalUnpaid = 0, creditTotal = 0;
    filtered.forEach((inv) => {
      if (inv.isPending || inv.isVoid) return;
      const amt = Math.abs(parseFloat(inv.amount) || 0);
      if (inv.isCredit) {
        creditTotal += amt;
        if (inv.invoicePaid) totalPaid -= amt;
      } else {
        totalInvoiced += amt;
        if (inv.invoicePaid) totalPaid += amt;
        else totalUnpaid += amt;
      }
    });
    return { totalInvoiced, totalPaid, totalUnpaid, creditTotal, netInvoiced: totalInvoiced - creditTotal, count: filtered.length };
  }, [filtered]);

  const globalStats = useMemo(() => {
    let ti = 0, tp = 0, tu = 0, ct = 0;
    invoices.forEach((inv) => {
      if (inv.isPending || inv.isVoid) return;
      const amt = Math.abs(parseFloat(inv.amount) || 0);
      if (inv.isCredit) {
        ct += amt;
        if (inv.invoicePaid) tp -= amt;
      } else {
        ti += amt;
        if (inv.invoicePaid) tp += amt;
        else tu += amt;
      }
    });
    const pendingCount = invoices.filter((x) => x.isPending).length;
    return { ti, tp, tu, ct, totalCount: invoices.filter((x) => !x.isPending).length, pendingCount };
  }, [invoices]);

  const togglePaid = async (inv) => {
    if (!canWrite) return;
    if (inv.isPending) { toast.error("Cannot mark pending booking as paid — issue invoice first"); return; }
    try {
      const coll = inv.collection || "flights";
      const ref = doc(db, coll, inv.docId);
      const newPaid = !inv.invoicePaid;
      await updateDoc(ref, {
        invoicePaid: newPaid,
        paidDate: newPaid ? new Date().toISOString().slice(0,10) : "",
        updatedAt: serverTimestamp(),
      });
      toast.success(newPaid ? "Marked as Paid" : "Marked as Unpaid");
    } catch (e) {
      toast.error("Failed to update payment status");
    }
  };

  const openInvoice = (inv) => setViewInvoice(inv);
  const openPrintPreview = (inv) => setPrintPreview(inv);

  const UNLOCKABLE_COLLECTIONS = ["flights", "hotels", "visa", "transportation"];
  const handleUnlock = async (inv) => {
    if (!isAdmin) return;
    if (!UNLOCKABLE_COLLECTIONS.includes(inv.collection)) {
      toast("Edit in original section: " + inv.collection);
      setViewInvoice(null);
      return;
    }
    try {
      await updateDoc(doc(db, inv.collection, inv.docId), {
        editUnlocked: true,
        editUnlockedBy: userData?.username || "admin",
        editUnlockedAt: serverTimestamp(),
      });
      toast.success("Booking unlocked for editing");
    } catch (e) {
      toast.error("Failed to unlock");
    }
    setViewInvoice(null);
    router.push(`/${inv.collection}?open=${inv.docId}`);
  };

  /**
   * Cancel an already-issued invoice — the correct alternative to deleting
   * one. It never deletes the underlying booking(s):
   *   - invoiceIssued is cleared so the booking reopens for editing (no
   *     separate "unlock" needed) and becomes eligible to be invoiced again
   *     from scratch, correctly, later.
   *   - The old invoice number/prefix/sequence move to
   *     cancelledInvoiceNumber/... so there's a permanent audit trail of
   *     what number this booking used to carry, who cancelled it, when,
   *     and why.
   *   - The serial number itself is never reused — generateInvoiceNumber's
   *     counter (in the `counters` collection) only ever increments, so the
   *     next invoice issued just skips over the cancelled number, same as
   *     Reg Nr already works.
   *   - If the invoice covered several bookings (invoiceGroupId), every
   *     booking in the group is cancelled together so the group never ends
   *     up half-cancelled, and the invoiceGroups summary doc is marked
   *     cancelled rather than deleted (kept for print/audit history).
   */
  const handleCancelInvoice = async (inv) => {
    if (!isAdmin) return;
    if (inv.isPending) {
      toast.error("This booking isn't invoiced yet — nothing to cancel");
      return;
    }
    const reason = window.prompt(
      `Cancel invoice ${inv.invoiceNumber}? This reopens the underlying booking(s) for editing instead of deleting anything.\n\nReason (kept in the audit trail):`
    );
    if (reason === null) return; // user pressed Cancel on the prompt itself
    try {
      const groupId = inv.raw?.invoiceGroupId || null;
      let targetIds = [inv.docId];
      if (groupId && ["flights", "hotels", "visa", "transportation"].includes(inv.collection)) {
        const snap = await getDocs(collection(db, inv.collection));
        const grouped = snap.docs.filter((d) => d.data().invoiceGroupId === groupId).map((d) => d.id);
        if (grouped.length) targetIds = grouped;
      }
      const batch = writeBatch(db);
      targetIds.forEach((id) => {
        batch.update(doc(db, inv.collection, id), {
          invoiceIssued: false,
          invoicePaid: false,
          paidDate: "",
          cancelledInvoiceNumber: inv.invoiceNumber,
          cancelledNumberPrefix: inv.numberPrefix,
          cancelledSequentialNumber: inv.sequentialNumber,
          invoiceCancelledAt: serverTimestamp(),
          invoiceCancelledBy: userData?.username || userData?.name || "admin",
          invoiceCancelReason: reason || "",
          invoiceNumber: "",
          numberPrefix: "",
          sequentialNumber: 0,
          invoiceGroupId: null,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      if (groupId) {
        await updateDoc(doc(db, "invoiceGroups", groupId), {
          status: "cancelled",
          cancelledAt: serverTimestamp(),
          cancelledBy: userData?.username || userData?.name || "admin",
          cancelReason: reason || "",
        }).catch(() => {});
      }
      toast.success(`Invoice ${inv.invoiceNumber} cancelled — booking(s) reopened, not deleted`);
      setViewInvoice(null);
    } catch (e) {
      toast.error("Failed to cancel invoice");
    }
  };

  const handleDeleteInvoice = async (inv) => {
    if (!isAdmin) return;
    if (!inv.isPending) {
      toast.error("Cannot delete an issued invoice — use Cancel Invoice instead, which reopens the booking without destroying the record.");
      return;
    }
    const label = inv.invoiceNumber || `${inv.section} — ${inv.clientName || inv.clientCode || "record"}`;
    if (!confirm(`Delete ${label}? This permanently removes the underlying record and cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, inv.collection, inv.docId));
      toast.success("Deleted");
      if (viewInvoice && viewInvoice._id === inv._id) setViewInvoice(null);
    } catch (e) {
      toast.error("Failed to delete");
    }
  };

  const doPrint = () => {
    const el = printRef.current;
    if (!el) return;
    const w = window.open("", "_blank");
    if (!w) { toast.error("Pop-up blocked"); return; }
    w.document.write(`<html><head><title>${printPreview.invoiceNumber || "Invoice"}</title><style>body{font-family:Arial;padding:20px;color:#222} .hdr{display:flex;justify-content:space-between;border-bottom:2px solid #1e40af;padding-bottom:10px} .badge{padding:4px 8px;border-radius:4px;font-size:11px;border:1px solid #ddd} table{width:100%;border-collapse:collapse;margin-top:16px} th{bg:#f1f5f9;text-align:left;padding:8px;border:1px solid #e2e8f0;font-size:12px} td{padding:8px;border:1px solid #e2e8f0;font-size:12px} .tot{text-align:right;font-weight:bold} @media print{button{display:none}}</style></head><body>${el.innerHTML}<br/><button onclick="window.print()" style="padding:8px 16px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer">Print</button> <button onclick="window.close()" style="padding:8px 16px;border:1px solid #ddd;border-radius:6px;cursor:pointer">Close</button></body></html>`);
    w.document.close();
  };

  const handleCreateInvoice = async () => {
    if (!canWrite) return;
    if (!selectedPending) { toast.error("Select a booking"); return; }
    const flight = pendingFlights.find((f) => f.id === selectedPending);
    if (!flight) return;
    const curr = flight.sellCurrency || flight.currency || "EGP";
    const invType = flight.isRefundRow ? "refund" : "ticket";
    try {
      const inv = await generateInvoiceNumber(invType, curr, flight.branch, flight.issueDate);
      await updateDoc(doc(db, "flights", flight.id), {
        invoiceNumber: inv.fullNumber,
        numberPrefix: inv.numberPrefix,
        sequentialNumber: inv.sequentialNumber,
        invoiceIssued: true,
        invoicePaid: false,
        updatedAt: serverTimestamp(),
      });
      toast.success(`Invoice issued: ${inv.fullNumber}`);
      setShowNewModal(false);
      setSelectedPending("");
    } catch (e) {
      toast.error("Failed to issue invoice: " + (e.message||""));
    }
  };

  return (
    <div>
      <Navbar title="Invoices" />
      <div className="p-4 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="bg-white border rounded-xl p-3">
            <div className="flex items-center gap-2 text-slate-500 text-xs"><Receipt size={14} /> Total Invoiced</div>
            <div className="text-lg font-bold">{fmt(globalStats.ti)} EGP</div>
            <div className="text-[11px] text-slate-400">{globalStats.totalCount} invoiced • {globalStats.pendingCount} pending</div>
          </div>
          <div className="bg-white border rounded-xl p-3">
            <div className="flex items-center gap-2 text-emerald-600 text-xs"><Check size={14} /> Total Paid</div>
            <div className="text-lg font-bold text-emerald-600">{fmt(globalStats.tp)} EGP</div>
          </div>
          <div className="bg-white border rounded-xl p-3">
            <div className="flex items-center gap-2 text-amber-600 text-xs"><Clock size={14} /> Outstanding</div>
            <div className="text-lg font-bold text-amber-600">{fmt(globalStats.tu)} EGP</div>
          </div>
          <div className="bg-white border rounded-xl p-3">
            <div className="flex items-center gap-2 text-red-600 text-xs"><AlertCircle size={14} /> Credit Notes</div>
            <div className="text-lg font-bold text-red-600">{fmt(globalStats.ct)} EGP</div>
            <div className="text-[11px] text-slate-400">refunds issued</div>
          </div>
          <div className="bg-white border rounded-xl p-3 flex flex-col justify-center">
            <button onClick={() => setShowNewModal(true)} disabled={!canWrite} title={!canWrite ? "View only — you don't have write access to this page" : undefined} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"><Plus size={16} /> New Invoice</button>
            <div className="text-[11px] text-slate-400 text-center mt-1">Issue from pending bookings</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border rounded-xl p-3 flex flex-wrap gap-2 items-center">
          <div className="flex gap-1 flex-wrap">
            {[
              ["all","All"],
              ["invoiced","Invoiced"],
              ["pending","Pending (Non-Invoiced)"],
              ["flights","Flights"],
              ["hotels","Hotels"],
              ["visa","Visa"],
              ["transport","Transport"],
              ["credit","Credit Notes"],
            ].map(([val,label]) => (
              <button key={val} onClick={() => setSectionFilter(val)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${sectionFilter===val ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{label}</button>
            ))}
          </div>
          <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block" />
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice / client / supplier" className="pl-8 pr-3 py-1.5 text-sm border rounded-lg w-64 focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-2 py-1.5 text-sm border rounded-lg" />
          <span className="text-slate-400 text-sm">to</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-2 py-1.5 text-sm border rounded-lg" />
          {(dateFrom || dateTo || search || sectionFilter!=="all") && (
            <button onClick={() => {setSearch(""); setDateFrom(""); setDateTo(""); setSectionFilter("all");}} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><X size={12} /> Clear</button>
          )}
          <div className="ml-auto text-xs text-slate-500">{filtered.length} / {invoices.length} invoices</div>
        </div>

        {/* Table */}
        <div className="bg-white border rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-12 flex justify-center"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">No invoices found</div>
          ) : (
            <div className="overflow-auto h-[68vh] min-h-[260px]">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Invoice</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Date</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Section</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Client</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Supplier</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Amount</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Curr</th>
                    <th className="text-center px-3 py-2 font-semibold text-slate-600">Status</th>
                    <th className="text-center px-3 py-2 font-semibold text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((inv) => (
                    <tr key={inv._id} onClick={() => setViewInvoice(inv)} className={`hover:bg-slate-50 cursor-pointer ${inv.isVoid ? "bg-red-50 opacity-60" : inv.isCredit ? "bg-amber-50" : inv.isPending ? "bg-slate-50 opacity-80" : ""}`}>
                      <td className="px-3 py-2 font-mono font-bold" onClick={(e) => e.stopPropagation()}>
                        {inv.isPending ? (
                          <span className="px-2 py-1 rounded text-[11px] border bg-slate-100 text-slate-500 border-slate-200">Pending — No Invoice</span>
                        ) : (
                          <button onClick={() => setViewInvoice(inv)} className={`px-2 py-1 rounded text-[11px] border hover:opacity-80 ${inv.invoiceNumber?.startsWith("CN") ? "bg-red-50 text-red-700 border-red-200" : inv.invoiceNumber?.startsWith("INTE") || inv.invoiceNumber?.startsWith("INSE") ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-purple-50 text-purple-700 border-purple-200"}`}>
                            {inv.invoiceNumber}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2">{formatDateDMY(inv.issueDate)}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] border ${inv.isPending ? "bg-slate-100 text-slate-500 border-slate-200" : inv.section.includes("Refund") ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-slate-100 text-slate-600"}`}>{inv.section} {inv.isPending ? "(Pending)" : ""}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{inv.clientName || "-"}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{inv.clientCode || ""}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px]">{inv.supplier || "-"}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${inv.isCredit ? "text-red-600" : inv.isPending ? "text-slate-400" : "text-slate-800"}`}>{inv.isCredit ? "-" : ""}{fmt(inv.amount)}</td>
                      <td className="px-3 py-2">{inv.currency}</td>
                      <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        {inv.isPending ? <span className="px-2 py-1 rounded-full bg-slate-200 text-slate-600 text-[11px]">Non-Invoiced</span> :
                         inv.isVoid ? <span className="px-2 py-1 rounded-full bg-red-100 text-red-700 text-[11px]">Void</span> :
                         inv.isCredit ? <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-[11px]">Credit</span> :
                         inv.invoicePaid ? <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[11px] flex items-center gap-1 justify-center"><Check size={12} /> Paid</span> :
                         <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-[11px] flex items-center gap-1 justify-center"><Clock size={12} /> Unpaid</span>}
                      </td>
                      <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setViewInvoice(inv)} className="p-1.5 hover:bg-slate-100 rounded" title="Open"><Eye size={14} /></button>
                          {!inv.isPending && <button onClick={() => openPrintPreview(inv)} className="p-1.5 hover:bg-slate-100 rounded" title="Print Preview"><Printer size={14} /></button>}
                          {!inv.isPending && <button onClick={() => togglePaid(inv)} className={`p-1.5 rounded text-xs ${inv.invoicePaid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`} title={inv.invoicePaid ? "Mark Unpaid" : "Mark Paid"}>
                            <DollarSign size={14} />
                          </button>}
                          {isAdmin && !inv.isPending && (
                            <button onClick={() => handleUnlock(inv)} className="p-1.5 hover:bg-blue-50 text-blue-600 rounded" title="Unlock for employee editing">
                              <Unlock size={14} />
                            </button>
                          )}
                          {isAdmin && !inv.isPending && (
                            <button onClick={() => handleCancelInvoice(inv)} className="p-1.5 hover:bg-orange-50 text-orange-600 rounded" title="Cancel Invoice (reopens booking, doesn't delete it)">
                              <X size={14} />
                            </button>
                          )}
                          {isAdmin && inv.isPending && (
                            <button onClick={() => handleDeleteInvoice(inv)} className="p-1.5 hover:bg-red-50 text-red-600 rounded" title="Delete">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t bg-slate-50 px-3 py-2 flex flex-wrap gap-4 text-xs">
            <span>Sales: <span className="font-bold">{fmt(stats.totalInvoiced)} EGP</span></span>
            <span className="text-red-600">Credits: {fmt(stats.creditTotal)} EGP</span>
            <span className="font-semibold">Net: {fmt(stats.netInvoiced)} EGP</span>
            <span className="text-emerald-600">Paid: {fmt(stats.totalPaid)}</span>
            <span className="text-amber-600">Unpaid: {fmt(stats.totalUnpaid)}</span>
            <span className="text-slate-400">({stats.count} rows)</span>
          </div>
        </div>
      </div>

      {/* View Invoice Modal */}
      {viewInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-xl max-h-[80vh] overflow-auto animate-modal-panel">
            <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white">
              <h3 className="font-semibold text-sm flex items-center gap-2"><FileText size={16} /> {viewInvoice.isPending ? "Booking Details (Non-Invoiced)" : `Invoice ${viewInvoice.invoiceNumber}`}</h3>
              <button onClick={() => setViewInvoice(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-slate-500">Invoice</div><div className="font-mono font-bold">{viewInvoice.invoiceNumber || "— Pending —"}</div></div>
                <div><div className="text-xs text-slate-500">Date</div><div>{formatDateDMY(viewInvoice.issueDate)}</div></div>
                <div><div className="text-xs text-slate-500">Client</div><div className="font-medium">{viewInvoice.clientName} <span className="text-slate-400 font-mono text-xs">{viewInvoice.clientCode}</span></div></div>
                <div><div className="text-xs text-slate-500">Supplier</div><div className="font-mono">{viewInvoice.supplier || "-"}</div></div>
                <div><div className="text-xs text-slate-500">Section</div><div>{viewInvoice.section}</div></div>
                <div><div className="text-xs text-slate-500">Amount</div><div className="font-bold">{fmt(viewInvoice.amount)} {viewInvoice.currency}</div></div>
                <div><div className="text-xs text-slate-500">Status</div><div>{viewInvoice.isPending ? "Non-Invoiced" : viewInvoice.isCredit ? "Credit Note" : viewInvoice.invoicePaid ? "Paid" : "Unpaid"}</div></div>
                <div><div className="text-xs text-slate-500">Currency</div><div>{viewInvoice.currency}</div></div>
              </div>
              {viewInvoice.raw?.passengers && (
                <div>
                  <div className="text-xs font-semibold mt-3 mb-1">Passengers</div>
                  <table className="w-full text-xs border rounded">
                    <thead className="bg-slate-50"><tr><th className="text-left p-2 border">Ticket</th><th className="text-left p-2 border">Name</th><th className="p-2 border">Type</th></tr></thead>
                    <tbody>{viewInvoice.raw.passengers.map((p,i) => <tr key={i} className="border-t"><td className="p-2 font-mono">{p.ticketNr||"-"}</td><td className="p-2">{p.name||"-"}</td><td className="p-2 text-center">{p.type||"-"}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-3">
                {isAdmin && viewInvoice.isPending && (
                  <button onClick={() => handleDeleteInvoice(viewInvoice)} className="px-4 py-2 text-sm bg-red-50 text-red-600 border border-red-200 rounded-lg flex items-center gap-2"><Trash2 size={14} /> Delete</button>
                )}
                {isAdmin && !viewInvoice.isPending && (
                  <button onClick={() => handleCancelInvoice(viewInvoice)} className="px-4 py-2 text-sm bg-orange-50 text-orange-600 border border-orange-200 rounded-lg flex items-center gap-2"><X size={14} /> Cancel Invoice</button>
                )}
                {isAdmin && !viewInvoice.isPending && (
                  <button onClick={() => handleUnlock(viewInvoice)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg flex items-center gap-2"><Pencil size={14} /> Edit Booking (Unlock for employee)</button>
                )}
                {!viewInvoice.isPending && <button onClick={() => { setViewInvoice(null); setTimeout(()=> openPrintPreview(viewInvoice),100); }} className="px-4 py-2 text-sm bg-slate-800 text-white rounded-lg flex items-center gap-2"><Printer size={14} /> Print Preview</button>}
                <button onClick={() => setViewInvoice(null)} className="px-4 py-2 text-sm border rounded-lg">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print Preview Modal */}
      {printPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
          <div className="bg-white rounded-xl w-full max-w-3xl shadow-xl max-h-[90vh] flex flex-col animate-modal-panel">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h3 className="font-semibold text-sm">Print Preview — {printPreview.invoiceNumber}</h3>
              <button onClick={() => setPrintPreview(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div ref={printRef} className="p-6 space-y-4 overflow-auto">
              <div className="flex justify-between border-b-2 border-blue-800 pb-3">
                <div>
                  <div className="text-lg font-bold text-blue-800">INVOICE</div>
                  <div className="font-mono text-sm">{printPreview.invoiceNumber}</div>
                  <div className="text-xs text-slate-500">Date: {formatDateDMY(printPreview.issueDate)}</div>
                </div>
                <div className="text-right text-sm flex items-center gap-2 justify-end">
                  {companyProfile.logoUrl && (
                    <img src={companyProfile.logoUrl} alt="" className="h-10 max-w-[120px] object-contain" />
                  )}
                  <div>
                    <div className="font-semibold">{companyProfile.name || "Travel Agency"}</div>
                    {companyProfile.nameAr && <div className="text-xs" dir="rtl">{companyProfile.nameAr}</div>}
                    <div className="text-xs text-slate-500">{printPreview.section}</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="border rounded p-3">
                  <div className="text-xs text-slate-500">Bill To</div>
                  <div className="font-semibold">{printPreview.clientName || "-"}</div>
                  <div className="font-mono text-xs text-slate-500">{printPreview.clientCode || ""}</div>
                </div>
                <div className="border rounded p-3 text-right">
                  <div className="text-xs text-slate-500">Supplier</div>
                  <div className="font-mono">{printPreview.supplier || "-"}</div>
                  <div className="text-xs">{printPreview.currency}</div>
                </div>
              </div>
              <table className="w-full text-sm border rounded">
                <thead className="bg-slate-100"><tr><th className="text-left p-2 border">Description</th><th className="text-right p-2 border">Amount</th></tr></thead>
                <tbody>
                  <tr><td className="p-2 border">{printPreview.section} — {printPreview.clientName}</td><td className="p-2 border text-right font-bold">{fmt(printPreview.amount)} {printPreview.currency}</td></tr>
                </tbody>
                <tfoot><tr className="bg-slate-50"><td className="p-2 border text-right font-bold">Total</td><td className="p-2 border text-right font-bold">{fmt(printPreview.amount)} {printPreview.currency}</td></tr></tfoot>
              </table>
              <div className="text-xs text-slate-500">Status: {printPreview.isCredit ? "Credit Note" : printPreview.invoicePaid ? "Paid" : "Unpaid"} • Generated from flights system</div>
              <div dangerouslySetInnerHTML={{ __html: letterheadFooterHtml() }} />
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
              <button onClick={() => setPrintPreview(null)} className="px-4 py-2 text-sm border rounded-lg">Close</button>
              <button onClick={doPrint} className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg flex items-center gap-2"><Printer size={16} /> Print</button>
            </div>
          </div>
        </div>
      )}

      {/* New Invoice Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl animate-modal-panel">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h3 className="font-semibold text-sm flex items-center gap-2"><Plus size={16} /> Issue New Invoice</h3>
              <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-500">Select a pending booking without invoice. Will generate INTE/INTF/CNTE based on currency.</p>
              <div className="max-h-64 overflow-auto border rounded-lg divide-y">
                {pendingFlights.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-sm">No pending flights without invoice</div>
                ) : pendingFlights.map((f) => (
                  <label key={f.id} className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-blue-50 ${selectedPending===f.id ? "bg-blue-50" : ""}`}>
                    <input type="radio" name="pending" checked={selectedPending===f.id} onChange={() => setSelectedPending(f.id)} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{f.clientName || f.clientCode} — {f.from} → {f.to}</div>
                      <div className="text-xs text-slate-500 font-mono truncate">{f.passengers?.[0]?.ticketNr || ""} | {f.sellCurrency || f.currency || "EGP"} {fmt(f.totalSell ?? f.sellPrice)}</div>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-slate-100">{f.issueDate || ""}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowNewModal(false)} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
                <button onClick={handleCreateInvoice} disabled={!selectedPending} className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50">Issue Invoice</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
