"use client";

/**
 * InvoiceIssueModal — the document screen that opens when you press
 * "Invoice" inside Flights / Hotels / Visa / Transportation.
 *
 * It replaces the old one-click behaviour (which silently stamped a number
 * on the single selected booking) with a real invoice document:
 *
 *   • header  — document prefix + branch + date + client + salesman +
 *               payment / currency / rate / total debit
 *   • lines   — every NON-INVOICED service of the SAME client (or corporate)
 *               in the SAME section, each selectable, with Reg.Nr,
 *               description, pax, amount, tax, discount and payable
 *   • footer  — sum row + Issue / Print
 *
 * Consolidation rules (deliberate, do not loosen):
 *   1. ONE SECTION PER INVOICE. The picker only ever reads the collection it
 *      was opened from, so an air ticket can never end up on the same
 *      document as a hotel — each section keeps its own invoice series
 *      (INTE/INTF, IHSE/IHSF, IVSE/IVSF, ITSE/ITSF).
 *   2. Same client code (clients and corporates share the field, so a
 *      corporate's services consolidate exactly the same way).
 *   3. Same branch — invoice numbering counters are per branch.
 *   4. Same sell currency — EGP and foreign have different prefixes.
 *   5. Never already invoiced, never cancelled/void.
 *
 * All selected bookings receive the SAME invoice number plus a shared
 * invoiceGroupId, and one summary document is written to `invoiceGroups`
 * for printing/audit. Nothing is written to the `invoices` collection so
 * the Invoices page keeps counting each service exactly once.
 */

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  writeBatch,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { generateInvoiceNumber, openPrintWindow } from "@/lib/helpers";
import { useAuth } from "@/lib/auth";
import { useClosedFiscalYearKeys, isRowClosed } from "@/lib/fiscalYear";
import toast from "react-hot-toast";
import { FileText, X, Printer, Check, Loader2, AlertCircle, Search } from "lucide-react";

/* ────────────────────────────── utils ────────────────────────────── */

function num(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}
function fmt(v) {
  return Number(v || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function dmy(iso) {
  if (!iso) return "-";
  const p = String(iso).split("-");
  return p.length === 3 && p[0].length === 4
    ? `${p[2].padStart(2, "0")}/${p[1].padStart(2, "0")}/${p[0]}`
    : iso;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

/* ───────────────────── per-section behaviour ──────────────────────
 * Each section knows: which collection to read, which invoice type to
 * ask generateInvoiceNumber() for, which date is "the" service date,
 * how many pax a line carries, and how to describe itself on paper.
 * ----------------------------------------------------------------- */

const SECTIONS = {
  flights: {
    label: "Air Tickets",
    docLabel: "Invoice For Air Tickets",
    invoiceType: (row) => row.invoiceType || "ticket",
    prefixHint: (foreign) => (foreign ? "INTF" : "INTE"),
    dateOf: (r) => r.issueDate || r.refundDate || "",
    paxOf: (r) =>
      (Array.isArray(r.passengers) && r.passengers.length) ||
      (num(r.adt) || 1) + num(r.chd) + num(r.inf),
    describe: (r) => {
      const route = (r.segments || [])
        .map((s) => s.city)
        .filter(Boolean)
        .join(" - ");
      const tkt = (r.passengers || []).map((p) => p.ticketNr).filter(Boolean)[0];
      const name = (r.passengers || []).map((p) => p.name).filter(Boolean)[0];
      return [r.ticketType || "Ticket", tkt, name, route].filter(Boolean).join(" · ");
    },
  },
  hotels: {
    label: "Hotels",
    docLabel: "Invoice For Hotel Services",
    invoiceType: () => "hotel",
    prefixHint: (foreign) => (foreign ? "IHSF" : "IHSE"),
    dateOf: (r) => r.issueDate || r.checkIn || "",
    paxOf: (r) => (num(r.adt) || 1) + num(r.chd) + num(r.inf),
    describe: (r) =>
      [
        r.hotelName,
        [r.city, r.country].filter(Boolean).join(", "),
        `${num(r.rooms) || 1} room(s) × ${num(r.nights) || 1} night(s)`,
        r.checkIn ? `${dmy(r.checkIn)} → ${dmy(r.checkOut)}` : "",
        r.confirmationNr ? `Conf. ${r.confirmationNr}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
  },
  visa: {
    label: "Visa",
    docLabel: "Invoice For Visa Services",
    invoiceType: () => "visa",
    prefixHint: (foreign) => (foreign ? "IVSF" : "IVSE"),
    dateOf: (r) => r.applicationDate || r.issueDate || "",
    paxOf: (r) =>
      (Array.isArray(r.applicants) && r.applicants.length) ||
      (num(r.adt) || 1) + num(r.chd) + num(r.inf),
    describe: (r) =>
      [
        `${r.visaType || "Visa"} Visa`,
        r.destination || r.country,
        r.entryType ? `${r.entryType} entry` : "",
        r.processing && r.processing !== "Normal" ? r.processing : "",
        r.referenceNr ? `Ref. ${r.referenceNr}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
  },
  transportation: {
    label: "Transportation",
    docLabel: "Invoice For Transport Services",
    invoiceType: () => "transportation",
    prefixHint: (foreign) => (foreign ? "ITSF" : "ITSE"),
    dateOf: (r) => r.pickupDate || r.issueDate || "",
    paxOf: (r) =>
      (Array.isArray(r.passengers) && r.passengers.length) ||
      (num(r.adt) || 1) + num(r.chd) + num(r.inf),
    describe: (r) =>
      [
        r.serviceType,
        r.vehicleType,
        [r.pickupLocation, r.dropoffLocation].filter(Boolean).join(" → "),
        r.pickupDate ? dmy(r.pickupDate) : "",
        r.isRoundTrip ? "Round trip" : "",
      ]
        .filter(Boolean)
        .join(" · "),
  },
};

const FOREIGN = ["USD", "EUR", "GBP", "SAR", "AED", "FOREIGN"];
const isForeign = (c) => FOREIGN.includes(String(c || "").toUpperCase());

/** Gross sell of one booking, in the booking's OWN currency (never converted). */
function grossOf(section, r) {
  if (r.totalSell !== undefined && r.totalSell !== "") return Math.abs(num(r.totalSell));
  if (section === "hotels") {
    const units = Math.max(1, num(r.nights) || 1) * Math.max(1, num(r.rooms) || 1);
    return num(r.sellPrice) * units;
  }
  if (section === "visa") {
    const pax = Math.max(1, (num(r.adt) || 1) + num(r.chd) + num(r.inf));
    return num(r.sellPrice) * pax;
  }
  if (section === "flights") {
    const a = num(r.adt) || 1;
    return num(r.sellPrice) * a + num(r.sellPriceCHD) * num(r.chd) + num(r.sellPriceINF) * num(r.inf);
  }
  return num(r.sellPrice);
}

const isDead = (r) => {
  const st = String(r.status || "").toLowerCase();
  return st === "cancelled" || st.includes("void") || String(r.ticketType || "").startsWith("V");
};

/* ──────────────────────────── component ──────────────────────────── */

export default function InvoiceIssueModal({ open, section, record, onClose, onIssued }) {
  const cfg = SECTIONS[section] || SECTIONS.flights;
  const { userData, branchesList } = useAuth();
  const closedYearKeys = useClosedFiscalYearKeys();

  const [candidates, setCandidates] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [discounts, setDiscounts] = useState({}); // id -> discount amount
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(null); // { fullNumber, lines, ... }
  const [searched, setSearched] = useState(false); // has F10 / Select Cards been run yet

  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [payment, setPayment] = useState("CRE");
  const [taxRate, setTaxRate] = useState(0); // % included in the payable amount
  const [remarks, setRemarks] = useState("");

  const currency = record?.sellCurrency || record?.currency || "EGP";
  const foreign = isForeign(currency);
  const rate = num(record?.sellExchangeRate ?? record?.exchangeRate) || 1;
  const branch = record?.branch || "1";
  const branchName = branchesList?.find((b) => b.code === branch)?.name || branch;
  const clientCode = record?.clientCode || "";
  const clientName = record?.clientName || "";

  /* Opening the screen shows ONLY the booking you pressed "Invoice" on —
     nothing else is fetched yet. The rest of the client's non-invoiced
     services only load when the user runs Select Cards (F10), same as the
     legacy screen. This avoids pulling the whole collection on every open
     and matches the "search first" muscle memory from the old software. */
  useEffect(() => {
    if (!open || !record) return;
    setIssued(null);
    setRemarks("");
    setSearched(false);
    setCandidates([record]);
    setSelectedIds([record.id]);
    setDiscounts({});
  }, [open, record?.id]);

  /* Select Cards (F10) — fetch every non-invoiced service of the same
     client/section/branch/currency and merge it into the picker. Read once
     per press (not a live listener) so the document can't reshuffle under
     your hands mid-edit. Keeps whatever is already ticked/discounted. */
  const runCardSearch = async () => {
    if (!record || loading || issued) return;
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, section));
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => !r.invoiceIssued && !r.invoiceNumber)
        .filter((r) => !r.isRefundRow)
        .filter((r) => !isDead(r))
        // A booking whose fiscal year is closed is archived — it must not
        // be pulled back onto a new invoice.
        .filter((r) => !isRowClosed(r, closedYearKeys, "issueDate"))
        .filter((r) => (r.branch || "1") === branch)
        .filter((r) => {
          const c = r.sellCurrency || r.currency || "EGP";
          return String(c).toUpperCase() === String(currency).toUpperCase();
        })
        // Same invoiceType as the booking the screen was opened on (e.g.
        // Ticket vs Service for flights) — otherwise the generated number
        // (decided from `record` alone, see handleIssue) would silently
        // mislabel a mixed-type line under the wrong series.
        .filter((r) => cfg.invoiceType(r) === cfg.invoiceType(record))
        .filter((r) =>
          clientCode && clientCode !== "30.00.00.0000"
            ? r.clientCode === clientCode
            : (r.clientName || "") === clientName
        )
        .sort((a, b) => (cfg.dateOf(a) || "").localeCompare(cfg.dateOf(b) || ""));
      // Guarantee the booking the screen was opened on stays in the list
      // even in an edge case where it fell outside a filter above.
      if (!rows.some((r) => r.id === record.id)) rows.unshift(record);
      setCandidates(rows);
      setSelectedIds((prev) => Array.from(new Set([...prev, record.id])).filter((id) => rows.some((r) => r.id === id)));
      setSearched(true);
    } catch (e) {
      toast.error("Could not load the client's open services");
    } finally {
      setLoading(false);
    }
  };

  /* F10 shortcut, same as "Select Cards (F10)" button — only while this
     screen is open, and only before the invoice is issued. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "F10") {
        e.preventDefault();
        runCardSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, section, record?.id, loading, issued]);

  const lines = useMemo(() => {
    return candidates
      .filter((r) => selectedIds.includes(r.id))
      .map((r) => {
        const payableBeforeDisc = grossOf(section, r);
        const disc = Math.min(num(discounts[r.id]), payableBeforeDisc);
        const payable = payableBeforeDisc - disc;
        const net = taxRate > 0 ? payable / (1 + taxRate / 100) : payable;
        return {
          id: r.id,
          regNr: r.regNr || "",
          description: cfg.describe(r) || "-",
          date: cfg.dateOf(r),
          pax: cfg.paxOf(r) || 1,
          amount: net,
          tax: payable - net,
          discount: disc,
          payable,
          raw: r,
        };
      });
  }, [candidates, selectedIds, discounts, taxRate, section]); // eslint-disable-line react-hooks/exhaustive-deps

  const sum = useMemo(
    () =>
      lines.reduce(
        (a, l) => ({
          pax: a.pax + l.pax,
          amount: a.amount + l.amount,
          tax: a.tax + l.tax,
          discount: a.discount + l.discount,
          payable: a.payable + l.payable,
        }),
        { pax: 0, amount: 0, tax: 0, discount: 0, payable: 0 }
      ),
    [lines]
  );

  const toggle = (id) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () =>
    setSelectedIds((prev) => (prev.length === candidates.length ? [] : candidates.map((r) => r.id)));

  /* ── Issue ── */
  const handleIssue = async () => {
    if (!lines.length) {
      toast.error("Select at least one service");
      return;
    }
    setIssuing(true);
    try {
      // Fiscal year of the invoice follows the EARLIEST service on it, so a
      // booking dated in an older year keeps that year's series.
      const serviceDate =
        lines.map((l) => l.date).filter(Boolean).sort()[0] || invoiceDate;

      const inv = await generateInvoiceNumber(
        cfg.invoiceType(record),
        foreign ? currency : "EGP",
        branch,
        serviceDate
      );

      const groupId = `${inv.numberPrefix}_${inv.sequentialNumber}_${branch}`;
      const batch = writeBatch(db);
      lines.forEach((l) => {
        batch.update(doc(db, section, l.id), {
          invoiceNumber: inv.fullNumber,
          numberPrefix: inv.numberPrefix,
          sequentialNumber: inv.sequentialNumber,
          invoiceIssued: true,
          invoicePaid: false,
          invoiceDate,
          invoiceGroupId: groupId,
          invoiceLineCount: lines.length,
          invoiceDiscount: l.discount,
          invoiceTaxAmount: l.tax,
          invoicePayable: l.payable,
          invoicePaymentTerm: payment,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();

      // Summary doc — for reprinting and audit only. Deliberately NOT in the
      // `invoices` collection, which the Invoices page reads as real rows.
      await setDoc(doc(db, "invoiceGroups", groupId), {
        invoiceNumber: inv.fullNumber,
        numberPrefix: inv.numberPrefix,
        sequentialNumber: inv.sequentialNumber,
        section,
        sectionLabel: cfg.label,
        branch,
        invoiceDate,
        currency,
        exchangeRate: rate,
        payment,
        taxRate,
        remarks,
        clientCode,
        clientName,
        salesman: record?.salesmanName || record?.salesman || "",
        totals: sum,
        lines: lines.map(({ raw, ...l }) => l),
        docIds: lines.map((l) => l.id),
        issuedBy: userData?.name || userData?.username || "",
        createdAt: serverTimestamp(),
      });

      setIssued({ ...inv, lines, totals: sum });
      toast.success(
        lines.length > 1
          ? `Invoice ${inv.fullNumber} issued for ${lines.length} services`
          : `Invoice issued: ${inv.fullNumber}`
      );
      onIssued?.({ ...inv, docIds: lines.map((l) => l.id), groupId });
    } catch (e) {
      toast.error("Could not issue the invoice: " + (e.message || ""));
    } finally {
      setIssuing(false);
    }
  };

  /* ── Print ── */
  const handlePrint = () => {
    const number = issued?.fullNumber || "(not issued yet)";
    const rowsHtml = lines
      .map(
        (l, i) => `<tr>
          <td>${i + 1}</td>
          <td>${esc(l.regNr)}</td>
          <td>${esc(l.description)}</td>
          <td>${dmy(l.date)}</td>
          <td style="text-align:center">${l.pax}</td>
          <td style="text-align:right">${fmt(l.amount)}</td>
          <td style="text-align:right">${fmt(l.tax)}</td>
          <td style="text-align:right">${fmt(l.discount)}</td>
          <td style="text-align:right"><b>${fmt(l.payable)}</b></td>
        </tr>`
      )
      .join("");

    openPrintWindow(
      `${number} — ${clientName || clientCode}`,
      `
      <h2>${esc(cfg.docLabel)}</h2>
      <div class="sub">${esc(number)} · ${dmy(invoiceDate)} · Branch ${esc(branchName)}</div>
      <div class="grid2">
        <div><span class="lbl">Issue To</span><br/>${esc(clientName || "-")}<br/><small>${esc(clientCode)}</small></div>
        <div><span class="lbl">Salesman</span><br/>${esc(record?.salesmanName || record?.salesman || "-")}</div>
        <div><span class="lbl">Payment</span><br/>${esc(payment)}</div>
        <div><span class="lbl">Currency</span><br/>${esc(currency)}${foreign ? ` · rate ${fmt(rate)}` : ""}</div>
      </div>
      <table>
        <thead><tr>
          <th>#</th><th>Reg.Nr</th><th>Description</th><th>Date</th><th>Pax</th>
          <th style="text-align:right">Amount</th><th style="text-align:right">Tax</th>
          <th style="text-align:right">Discount</th><th style="text-align:right">Payable</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="4"><b>Sum</b></td>
          <td style="text-align:center"><b>${sum.pax}</b></td>
          <td style="text-align:right"><b>${fmt(sum.amount)}</b></td>
          <td style="text-align:right"><b>${fmt(sum.tax)}</b></td>
          <td style="text-align:right"><b>${fmt(sum.discount)}</b></td>
          <td style="text-align:right"><b>${fmt(sum.payable)} ${esc(currency)}</b></td>
        </tr></tfoot>
      </table>
      ${remarks ? `<p style="font-size:12px;margin-top:12px">${esc(remarks)}</p>` : ""}
    `
    );
  };

  if (!open || !record) return null;

  const cell = "px-2 py-1 border border-emerald-900/10";
  const fieldCls =
    "px-2 py-1 bg-amber-50 border border-slate-400/60 rounded-sm text-xs outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500";
  const labelCls = "text-[11px] font-semibold text-slate-700 italic";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
      <div className="bg-white rounded-xl w-full max-w-6xl shadow-xl max-h-[92vh] flex flex-col animate-modal-panel">
        {/* title bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FileText size={16} className="text-blue-600" />
            {cfg.docLabel}
            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
              {issued?.fullNumber || `${cfg.prefixHint(foreign)}… — not issued yet`}
            </span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-auto flex-1">
          {/* ── document header, laid out like the legacy screen ── */}
          <div className="bg-emerald-50/70 border-b border-emerald-900/10 px-4 py-3 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className={labelCls}>Document</span>
              <span className="font-mono font-bold text-blue-800">{cfg.prefixHint(foreign)}</span>
              <span className="font-mono text-slate-500">{issued?.sequentialNumber || ""}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={labelCls}>Branch</span>
              <span className="font-medium">{branchName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={labelCls}>Date</span>
              <input
                type="date"
                value={invoiceDate}
                disabled={!!issued}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className={fieldCls}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className={labelCls}>Salesman</span>
              <span className="font-medium">
                {record.salesmanName || record.salesman || "-"}
              </span>
            </div>

            <div className="flex items-center gap-2 col-span-2">
              <span className={labelCls}>Issue To</span>
              <span className="font-mono">{clientCode}</span>
              <span className="font-medium truncate">{clientName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={labelCls}>Payment</span>
              <select
                value={payment}
                disabled={!!issued}
                onChange={(e) => setPayment(e.target.value)}
                className={fieldCls}
              >
                <option value="CRE">CRE — Credit</option>
                <option value="CSH">CSH — Cash</option>
                <option value="CC">CC — Card</option>
                <option value="BNK">BNK — Bank</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className={labelCls}>Currency</span>
              <span className="font-mono font-bold">{currency}</span>
              {foreign && <span className="text-slate-500">rate {fmt(rate)}</span>}
            </div>

            <div className="flex items-center gap-2">
              <span className={labelCls}>Tax %</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={taxRate}
                disabled={!!issued}
                onChange={(e) => setTaxRate(num(e.target.value))}
                className={`${fieldCls} w-20 text-right`}
                title="Tax already included in the sell price — splits each line into net amount + tax"
              />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <span className={labelCls}>Remarks</span>
              <input
                value={remarks}
                disabled={!!issued}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Printed under the invoice lines"
                className={`${fieldCls} flex-1`}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <span className={labelCls}>Total Debit</span>
              <span className="px-3 py-1 bg-amber-50 border border-slate-400/60 rounded-sm font-mono font-bold text-sm">
                {fmt(sum.payable)}
              </span>
            </div>
          </div>

          {/* ── Select Cards (F10) bar ── */}
          <div className="px-4 py-2 text-[11px] text-slate-600 bg-slate-50 border-b flex items-center gap-2">
            <button
              onClick={runCardSearch}
              disabled={loading || !!issued}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-blue-50 hover:border-blue-300 text-slate-700 font-medium disabled:opacity-50 disabled:hover:bg-white"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
              Select Cards (F10)
            </button>
            {searched ? (
              <span>
                Showing open {cfg.label} services for this client in branch {branchName} and{" "}
                {currency}. Each section is invoiced on its own document — hotels, visa and
                transport never merge onto an air-ticket invoice.
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <AlertCircle size={13} className="text-amber-600 shrink-0" />
                Only the booking you opened is listed. Press F10 or Select Cards to pull in this
                client's other open {cfg.label.toLowerCase()} services.
              </span>
            )}
          </div>

          {/* ── lines ── */}
          <div className="p-3">
            {loading ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="animate-spin text-blue-600" size={22} />
              </div>
            ) : candidates.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">
                No open services found for this client.
              </div>
            ) : (
              <table className="w-full text-[11px] border-collapse">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className={`${cell} w-8`}>
                      <input
                        type="checkbox"
                        checked={selectedIds.length === candidates.length}
                        onChange={toggleAll}
                        disabled={!!issued}
                      />
                    </th>
                    <th className={`${cell} w-8 text-right`}>#</th>
                    <th className={`${cell} w-24 text-left`}>Reg.Nr</th>
                    <th className={`${cell} text-left`}>Description</th>
                    <th className={`${cell} w-24`}>Date</th>
                    <th className={`${cell} w-12`}>Pax</th>
                    <th className={`${cell} w-28 text-right`}>Amount</th>
                    <th className={`${cell} w-24 text-right`}>Tax</th>
                    <th className={`${cell} w-24 text-right`}>Discount</th>
                    <th className={`${cell} w-28 text-right`}>Payable</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((r, i) => {
                    const on = selectedIds.includes(r.id);
                    const line = lines.find((l) => l.id === r.id);
                    const gross = grossOf(section, r);
                    return (
                      <tr
                        key={r.id}
                        onClick={() => !issued && toggle(r.id)}
                        className={`cursor-pointer ${
                          on ? "bg-blue-50" : "hover:bg-slate-50"
                        } ${r.id === record.id ? "font-medium" : ""}`}
                      >
                        <td className={`${cell} text-center`} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!!issued}
                            onChange={() => toggle(r.id)}
                          />
                        </td>
                        <td className={`${cell} text-right text-slate-400`}>{i + 1}</td>
                        <td className={`${cell} font-mono`}>{r.regNr || "-"}</td>
                        <td className={cell}>{cfg.describe(r) || "-"}</td>
                        <td className={`${cell} text-center`}>{dmy(cfg.dateOf(r))}</td>
                        <td className={`${cell} text-center`}>{cfg.paxOf(r) || 1}</td>
                        <td className={`${cell} text-right tabular-nums`}>
                          {fmt(line ? line.amount : gross)}
                        </td>
                        <td className={`${cell} text-right tabular-nums text-slate-500`}>
                          {fmt(line ? line.tax : 0)}
                        </td>
                        <td className={`${cell} text-right`} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={discounts[r.id] ?? ""}
                            placeholder="0.00"
                            disabled={!on || !!issued}
                            onChange={(e) =>
                              setDiscounts((p) => ({ ...p, [r.id]: e.target.value }))
                            }
                            className="w-20 px-1 py-0.5 text-right bg-amber-50 border border-slate-300 rounded-sm outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-transparent disabled:border-transparent"
                          />
                        </td>
                        <td className={`${cell} text-right tabular-nums font-semibold`}>
                          {fmt(line ? line.payable : gross)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-100 font-semibold">
                  <tr>
                    <td className={cell} colSpan={5}>
                      Sum — {lines.length} of {candidates.length} selected
                    </td>
                    <td className={`${cell} text-center`}>{sum.pax}</td>
                    <td className={`${cell} text-right tabular-nums`}>{fmt(sum.amount)}</td>
                    <td className={`${cell} text-right tabular-nums`}>{fmt(sum.tax)}</td>
                    <td className={`${cell} text-right tabular-nums`}>{fmt(sum.discount)}</td>
                    <td className={`${cell} text-right tabular-nums`}>
                      {fmt(sum.payable)} {currency}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        {/* ── actions ── */}
        <div className="border-t px-4 py-3 flex items-center gap-2">
          {issued ? (
            <span className="text-xs text-emerald-700 flex items-center gap-1.5">
              <Check size={14} /> Issued as {issued.fullNumber} on {lines.length} service
              {lines.length > 1 ? "s" : ""}
            </span>
          ) : (
            <span className="text-xs text-slate-500">
              {lines.length} service{lines.length === 1 ? "" : "s"} · {fmt(sum.payable)} {currency}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">
              {issued ? "Close" : "Cancel"}
            </button>
            <button
              onClick={handlePrint}
              disabled={!lines.length}
              className="px-4 py-2 text-sm border rounded-lg flex items-center gap-2 disabled:opacity-50"
            >
              <Printer size={14} /> Print
            </button>
            {!issued && (
              <button
                onClick={handleIssue}
                disabled={!lines.length || issuing}
                className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 disabled:opacity-50"
              >
                {issuing ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                Issue invoice
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
