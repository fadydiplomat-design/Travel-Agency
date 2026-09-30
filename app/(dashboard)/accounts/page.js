"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Navbar from "@/components/Navbar";
import { useAuth, logActivity } from "@/lib/auth";
import { canWriteModule } from "@/lib/permissions";
import ExportButtons from "@/components/ExportButtons";
import TreasuryTab from "@/components/TreasuryTab";
import PeriodicPLTab from "@/components/PeriodicPLTab";
import AdjustmentsTab from "@/components/AdjustmentsTab";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isBranchVisible } from "@/lib/helpers";
import { useClosedFiscalYearKeys, isRowClosed } from "@/lib/fiscalYear";
import {
  parseNum,
  fmtMoney as fmt,
  fmtTimestamp as fmtTs,
  daysBetween,
  agingBucket,
  toEGP,
  normalizeBookingRow as normalizeRow,
} from "@/lib/bookingNormalize";
import toast from "react-hot-toast";
import {
  Search,
  Calculator,
  TrendingUp,
  TrendingDown,
  Wallet,
  Users,
  Building2,
  Plane,
  Hotel,
  FileCheck,
  Car,
  Receipt,
  Filter,
  Banknote,
  CreditCard,
  UserCheck,
  Globe2,
  AlertTriangle,
  PieChart,
  BookOpen,
  ArrowLeftRight,
  Plus,
  Trash2,
  Save,
  X,
  Landmark,
  Percent,
  ListTree,
  Ban,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════
   Full Travel Agency Accounting Suite
   Sales · AR aging · AP · Cash/Card · Credits · P&L
   Chart of Accounts · Journals · VAT · Bank book
═══════════════════════════════════════════════════════════ */


/* ═══════════════════════════════════════════════════════════
   Real double-entry accounting engine
   Every booking (from the moment it's created, invoiced or not)
   is turned into a balanced Dr/Cr journal entry automatically —
   no manual re-entry needed. This is computed live from the same
   transaction rows the rest of the page already uses (`filtered`),
   so it can never drift out of sync with an edited/deleted booking.
═══════════════════════════════════════════════════════════ */
const REV_ACCOUNT_BY_SECTION = { Flight: "4000", Hotel: "4100", Visa: "4200", Transport: "4300" };
const COGS_ACCOUNT_BY_SECTION = { Flight: "5000", Hotel: "5100", Visa: "5200", Transport: "5300" };
const AR_ACCOUNT = "1100"; // Accounts Receivable – Clients
const AP_ACCOUNT = "2000"; // Accounts Payable – Suppliers
const CASH_ACCOUNT = "1000"; // Cash on Hand
const BANK_ACCOUNT = "1010"; // Bank – EGP (card settlement default)
const SERVICE_FEE_ACCOUNT = "4400"; // Service Fees / Commission Income
const CREDIT_NOTE_ACCOUNT = "4900"; // Sales Returns / Credit Notes

/** One signed amount → a single balanced line, flipping sides automatically
 *  for negative amounts (refunds) so debit/credit columns never show a
 *  negative number. */
function acctLine(accountCode, amount, normallyDebit) {
  const amt = Math.round(Math.abs(amount) * 100) / 100;
  if (amt === 0) return null;
  const debitSide = amount >= 0 ? normallyDebit : !normallyDebit;
  return { accountCode, debit: debitSide ? amt : 0, credit: debitSide ? 0 : amt };
}

/**
 * Build the balanced double-entry lines for one operational transaction
 * (a flight/hotel/visa/transport row from `normalizeRow`). Posted the
 * moment the booking exists — invoiced or not — per how the agency wants
 * its books kept:
 *   Dr  Client-side account (AR if unpaid, Cash/Bank if paid)   sell + fee
 *   Cr  Sales – <section>                                       sell
 *   Cr  Service Fee Income                                      fee
 *   Dr  Cost of Sales – <section>                               buy
 *   Cr  Accounts Payable – Suppliers                             buy
 * Refund rows (negative buy/sell) automatically flip to the correct side
 * via acctLine(). Void rows contribute nothing (already zeroed upstream).
 */
function buildTransactionJournalLines(row) {
  const clientAccount = row.invoicePaid ? (row.isCC ? BANK_ACCOUNT : CASH_ACCOUNT) : AR_ACCOUNT;
  const revenueAccount = row.isRefund ? CREDIT_NOTE_ACCOUNT : (REV_ACCOUNT_BY_SECTION[row.section] || "4000");
  const cogsAccount = COGS_ACCOUNT_BY_SECTION[row.section] || "5000";
  const lines = [
    acctLine(clientAccount, row.sell + (row.serviceFee || 0), true),
    acctLine(revenueAccount, row.sell, false),
    acctLine(SERVICE_FEE_ACCOUNT, row.serviceFee || 0, false),
    acctLine(cogsAccount, row.buy, true),
    acctLine(AP_ACCOUNT, row.buy, false),
  ].filter(Boolean);
  return lines;
}

/* ═══════════════════════════════════════════════════════════
   Chart of Accounts — single source of truth for every account code
   referenced anywhere in this file (journal lines, bank book, treasury
   contra accounts, Trial Balance, Balance Sheet, General Ledger).
   `type` drives normal-balance sign in trialBalance/balanceSheet below:
   Asset/COGS/Expense are debit-normal, Liability/Equity/Revenue are
   credit-normal.
═══════════════════════════════════════════════════════════ */
// Default output-VAT rate used to pre-fill the VAT tab's editable rate
// field (Egypt's standard VAT rate). Was referenced here but never
// defined anywhere in the project — another render-crashing bug, same
// class as the missing CHART_OF_ACCOUNTS above.
const VAT_RATE_DEFAULT = 14;

const CHART_OF_ACCOUNTS = [
  { code: "1000", name: "Cash on Hand", type: "Asset" },
  { code: "1010", name: "Bank – EGP", type: "Asset" },
  { code: "1020", name: "Bank – USD", type: "Asset" },
  { code: "1030", name: "Bank – EUR", type: "Asset" },
  { code: "1100", name: "Accounts Receivable – Clients", type: "Asset" },
  { code: "1900", name: "Suspense / Clearing (Pending Items)", type: "Asset" },
  { code: "2000", name: "Accounts Payable – Suppliers", type: "Liability" },
  { code: "3000", name: "Capital / Owner's Equity", type: "Equity" },
  { code: "4000", name: "Sales – Flight", type: "Revenue" },
  { code: "4100", name: "Sales – Hotel", type: "Revenue" },
  { code: "4200", name: "Sales – Visa", type: "Revenue" },
  { code: "4300", name: "Sales – Transport", type: "Revenue" },
  { code: "4400", name: "Service Fees / Commission Income", type: "Revenue" },
  { code: "4900", name: "Sales Returns / Credit Notes", type: "Revenue" },
  { code: "5000", name: "Cost of Sales – Flight", type: "COGS" },
  { code: "5100", name: "Cost of Sales – Hotel", type: "COGS" },
  { code: "5200", name: "Cost of Sales – Visa", type: "COGS" },
  { code: "5300", name: "Cost of Sales – Transport", type: "COGS" },
  { code: "6000", name: "Salaries & Wages", type: "Expense" },
  { code: "6100", name: "Other Operating Expenses", type: "Expense" },
  { code: "6900", name: "General & Administrative", type: "Expense" },
];

const TABS = [
  { id: "overview", label: "Dashboard", icon: PieChart },
  { id: "pl", label: "P&L", icon: BookOpen },
  { id: "plPeriods", label: "P&L الدوري (شهري/ربعي/سنوي)", icon: BookOpen },
  { id: "adjustments", label: "التسويات", icon: AlertTriangle },
  { id: "trialBalance", label: "Trial Balance", icon: Calculator },
  { id: "gl", label: "General Ledger", icon: BookOpen },
  { id: "balanceSheet", label: "Balance Sheet", icon: Landmark },
  { id: "clients", label: "Clients AR", icon: Users },
  { id: "suppliers", label: "Suppliers AP", icon: Building2 },
  { id: "cash", label: "Cash & Card", icon: Banknote },
  { id: "treasury", label: "الخزينة", icon: Wallet },
  { id: "bank", label: "Bank Book", icon: Landmark },
  { id: "credits", label: "Credit Notes", icon: ArrowLeftRight },
  { id: "cancelled", label: "Cancelled Invoices", icon: Ban },
  { id: "vat", label: "VAT", icon: Percent },
  { id: "coa", label: "Chart of Accounts", icon: ListTree },
  { id: "journal", label: "Journals", icon: BookOpen },
  { id: "salesman", label: "Sales Team", icon: UserCheck },
  { id: "currency", label: "Currency", icon: Globe2 },
  { id: "sections", label: "Products", icon: Filter },
  { id: "ledger", label: "Sales Ledger", icon: Receipt },
];

function StatCard({ label, value, color, sub, icon: Icon, suffix = "EGP" }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
          {label}
        </span>
        {Icon && (
          <span className="p-1 rounded-lg bg-slate-50">
            <Icon size={12} className={color} />
          </span>
        )}
      </div>
      <div className={`text-base font-bold tabular-nums ${color}`}>
        {fmt(value)}{" "}
        <span className="text-[9px] font-normal text-slate-400">{suffix}</span>
      </div>
      {sub && <div className="text-[9px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

const EMPTY_JOURNAL = {
  date: new Date().toISOString().slice(0, 10),
  memo: "",
  lines: [
    { accountCode: "6000", accountName: "Salaries & Wages", debit: "", credit: "" },
    { accountCode: "1000", accountName: "Cash on Hand", debit: "", credit: "" },
  ],
};

export default function AccountsPage() {
  const { userData, activeBranch, myBranches, isAdmin: authIsAdmin, canAccessModule, appFeatures } = useAuth();
  const closedYearKeys = useClosedFiscalYearKeys();
  // Was a hard-coded role list, which quietly ignored Settings > Employees >
  // Permissions: an employee explicitly granted Accounts saw the sidebar
  // link, got past the layout route guard, and then hit this screen's own
  // "Permission required" wall. Go through the same permission check as
  // everything else instead.
  const canView = canAccessModule("accounts");
  // Read-only (Read on, Write off) users can open Accounts and look, but
  // can't post journals or bank lines. Firestore rules enforce this too —
  // this just stops the UI offering buttons that would fail server-side.
  const canWrite = canWriteModule(userData, "accounts", authIsAdmin, appFeatures);

  const [flights, setFlights] = useState([]);
  const [hotels, setHotels] = useState([]);
  const [visa, setVisa] = useState([]);
  const [transport, setTransport] = useState([]);
  const [journals, setJournals] = useState([]);
  const [bankLines, setBankLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [paidFilter, setPaidFilter] = useState("all");
  const [vatRate, setVatRate] = useState(VAT_RATE_DEFAULT);
  const [glAccount, setGlAccount] = useState("1100");

  // Client/Supplier statement drill-down (AR/AP tabs → click a row).
  const [statementFor, setStatementFor] = useState(null); // { kind: "client"|"supplier", key, code, name }

  // Wraps whichever tab's content is currently rendered — ExportButtons
  // grabs whatever <table> is inside it, so one export toolbar covers
  // every tabular tab (Trial Balance, GL, Clients, Suppliers, Bank,
  // Credits, Cancelled, COA, Journal, Salesman, Currency, Ledger) without
  // needing a ref/instance per tab. Tabs with no table (Dashboard, P&L,
  // Balance Sheet, VAT, Products) just report "nothing to export".
  const tabContentRef = useRef(null);

  // Journal form
  const [showJournal, setShowJournal] = useState(false);
  const [journalForm, setJournalForm] = useState(EMPTY_JOURNAL);
  const [journalSaving, setJournalSaving] = useState(false);

  // Bank form
  const [showBank, setShowBank] = useState(false);
  const [bankForm, setBankForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    type: "in",
    amount: "",
    currency: "EGP",
    account: "1010",
    contraAccount: "1100",
    memo: "",
    supplierCode: "",
    supplierName: "",
  });

  useEffect(() => {
    const unsubs = [];
    const listen = (name, setter) => {
      try {
        unsubs.push(
          onSnapshot(
            collection(db, name),
            (snap) => setter(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
            () => {}
          )
        );
      } catch {
        /* ignore */
      }
    };
    listen("flights", setFlights);
    listen("hotels", setHotels);
    listen("visa", setVisa);
    listen("transportation", setTransport);
    listen("journalEntries", setJournals);
    listen("bankBook", setBankLines);
    setLoading(false);
    return () => unsubs.forEach((u) => u && u());
  }, []);

  const allTx = useMemo(() => {
    const closedYearKeysLocal = closedYearKeys;
    const rows = [
      ...flights.map((r) => normalizeRow(r, "Flight")),
      ...hotels.map((r) => normalizeRow(r, "Hotel")),
      ...visa.map((r) => normalizeRow(r, "Visa")),
      ...transport.map((r) => normalizeRow(r, "Transport")),
    ]
      .filter((r) => isBranchVisible(r.branch, { isAdmin: authIsAdmin, activeBranch, myBranches }))
      .filter((r) => !isRowClosed(r, closedYearKeysLocal, "date"));
    rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return rows;
  }, [flights, hotels, visa, transport, authIsAdmin, activeBranch, myBranches, closedYearKeys]);

  // Audit trail of invoices cancelled via Invoices → Cancel Invoice. These
  // never feed into any total (the booking already counts as un-invoiced
  // again the moment it's cancelled) — this is purely a historical record
  // of what number used to be issued, by whom, when, and why. Deliberately
  // NOT filtered by closed fiscal year — a closed year shouldn't hide the
  // fact that a cancellation happened.
  const cancelledInvoices = useMemo(() => {
    const src = [
      ...flights.map((r) => ({ ...r, __section: "Flight" })),
      ...hotels.map((r) => ({ ...r, __section: "Hotel" })),
      ...visa.map((r) => ({ ...r, __section: "Visa" })),
      ...transport.map((r) => ({ ...r, __section: "Transport" })),
    ];
    return src
      .filter((r) => !!r.cancelledInvoiceNumber)
      .filter((r) => isBranchVisible(r.branch, { isAdmin: authIsAdmin, activeBranch, myBranches }))
      .map((r) => ({
        id: `${r.__section}-${r.id}`,
        section: r.__section,
        branch: r.branch || "",
        clientName: r.clientName || r.customerName || r.corporate || r.customer || "",
        clientCode: r.clientCode || "",
        cancelledInvoiceNumber: r.cancelledInvoiceNumber,
        invoiceCancelledAt: r.invoiceCancelledAt,
        invoiceCancelledBy: r.invoiceCancelledBy || "",
        invoiceCancelReason: r.invoiceCancelReason || "",
        currentlyInvoiced: !!r.invoiceIssued,
        currentInvoiceNumber: r.invoiceNumber || "",
      }))
      .sort((a, b) => (b.invoiceCancelledAt?.seconds || 0) - (a.invoiceCancelledAt?.seconds || 0));
  }, [flights, hotels, visa, transport, authIsAdmin, activeBranch, myBranches]);

  const filtered = useMemo(() => {
    return allTx.filter((r) => {
      if (sectionFilter !== "all" && r.section !== sectionFilter) return false;
      if (currencyFilter !== "all" && r.currency !== currencyFilter) return false;
      if (dateFrom && r.date && r.date < dateFrom) return false;
      if (dateTo && r.date && r.date > dateTo) return false;
      if (paidFilter === "paid" && !r.invoicePaid) return false;
      if (paidFilter === "unpaid" && (!r.invoiceIssued || r.invoicePaid || r.isRefund))
        return false;
      if (paidFilter === "not_invoiced" && r.invoiceIssued) return false;
      if (search) {
        const s = search.toLowerCase();
        const hit =
          (r.clientName || "").toLowerCase().includes(s) ||
          (r.clientCode || "").toLowerCase().includes(s) ||
          (r.supplierName || "").toLowerCase().includes(s) ||
          (r.salesman || "").toLowerCase().includes(s) ||
          (r.ref || "").toLowerCase().includes(s) ||
          (r.description || "").toLowerCase().includes(s);
        if (!hit) return false;
      }
      return true;
    });
  }, [allTx, search, dateFrom, dateTo, sectionFilter, currencyFilter, paidFilter]);

  const totals = useMemo(() => {
    let sales = 0,
      cost = 0,
      profit = 0,
      serviceFees = 0;
    let invoiced = 0,
      paid = 0,
      unpaid = 0,
      credit = 0,
      notInvoiced = 0;
    let cashSales = 0,
      cardSales = 0,
      cashCost = 0,
      cardCost = 0;
    let refundCount = 0;
    const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
    const salesBySection = { Flight: 0, Hotel: 0, Visa: 0, Transport: 0 };
    const costBySection = { Flight: 0, Hotel: 0, Visa: 0, Transport: 0 };

    filtered.forEach((r) => {
      if (r.isVoid) return;
      sales += r.sell;
      cost += r.buy;
      profit += r.profit;
      serviceFees += r.serviceFee || 0;
      salesBySection[r.section] = (salesBySection[r.section] || 0) + r.sell;
      costBySection[r.section] = (costBySection[r.section] || 0) + r.buy;

      if (r.isCash) {
        cashSales += r.sell;
        cashCost += r.buy;
      } else {
        cardSales += r.sell;
        cardCost += r.buy;
      }

      if (r.isRefund) {
        credit += Math.abs(r.sell);
        refundCount += 1;
        // A credit note that's actually been paid back to the client (cash
        // physically refunded) reduces what was really collected — this is
        // the same rule the Invoices page already applies ("Total Paid =
        // paid sales − paid credits") and that byClient below already
        // follows; this aggregate was the one place still missing it, so
        // it silently overstated "Collected" whenever a paid invoice was
        // later partly refunded.
        if (r.invoicePaid) paid -= Math.abs(r.sell);
      } else if (r.invoiceIssued) {
        invoiced += Math.max(0, r.sell);
        if (r.invoicePaid) paid += Math.max(0, r.sell);
        else {
          unpaid += Math.max(0, r.sell);
          aging[agingBucket(r.ageDays)] += Math.max(0, r.sell);
        }
      } else {
        notInvoiced += Math.max(0, r.sell);
      }
    });

    const marginPct = sales !== 0 ? (profit / Math.abs(sales)) * 100 : 0;
    return {
      sales,
      cost,
      profit,
      serviceFees,
      marginPct,
      invoiced,
      paid,
      unpaid,
      credit,
      notInvoiced,
      cashSales,
      cardSales,
      cashCost,
      cardCost,
      refundCount,
      aging,
      salesBySection,
      costBySection,
      count: filtered.filter((r) => !r.isVoid).length,
    };
  }, [filtered]);

  const byClient = useMemo(() => {
    const map = {};
    filtered.forEach((r) => {
      if (r.isVoid) return;
      const key = r.clientCode || r.clientName || "Unknown";
      if (!map[key]) {
        map[key] = {
          code: r.clientCode,
          name: r.clientName || key,
          sales: 0,
          cost: 0,
          profit: 0,
          paid: 0,
          unpaid: 0,
          credit: 0,
          count: 0,
          aging: { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 },
        };
      }
      const c = map[key];
      c.sales += r.sell;
      c.cost += r.buy;
      c.profit += r.profit;
      c.count += 1;
      if (r.isRefund) {
        c.credit += Math.abs(r.sell);
        if (r.invoicePaid) c.paid -= Math.abs(r.sell);
      } else if (r.invoiceIssued) {
        if (r.invoicePaid) c.paid += Math.max(0, r.sell);
        else {
          c.unpaid += Math.max(0, r.sell);
          c.aging[agingBucket(r.ageDays)] += Math.max(0, r.sell);
        }
      }
    });
    return Object.values(map).sort((a, b) => b.unpaid - a.unpaid || b.sales - a.sales);
  }, [filtered]);

  // Payments actually made to each supplier — this was completely missing
  // before: the AP tab only ever showed gross purchase cost, with no way
  // to tell what's actually still owed vs. already settled. Sourced from
  // Bank Book lines tagged with a supplier (an "out" payment against the
  // Accounts Payable account, see the Bank modal's Supplier field).
  const apPaymentsBySupplier = useMemo(() => {
    const map = {};
    bankLines.forEach((b) => {
      if (b.type !== "out" || b.contraAccount !== AP_ACCOUNT) return;
      if (dateFrom && b.date && b.date < dateFrom) return;
      if (dateTo && b.date && b.date > dateTo) return;
      const key = b.supplierCode || b.supplierName;
      if (!key) return; // untagged AP payment — can't attribute to one supplier
      map[key] = (map[key] || 0) + parseNum(b.amount);
    });
    return map;
  }, [bankLines, dateFrom, dateTo]);

  const bySupplier = useMemo(() => {
    const map = {};
    filtered.forEach((r) => {
      if (r.isVoid) return;
      const key = r.supplierCode || r.supplierName || "Unknown";
      if (!map[key]) {
        map[key] = {
          code: r.supplierCode,
          name: r.supplierName || key,
          buy: 0,
          sell: 0,
          count: 0,
          refundBuy: 0,
          // Per-transaction cost + age, kept only to compute the aging
          // buckets below — not rendered directly.
          txns: [],
        };
      }
      map[key].buy += r.buy;
      map[key].sell += r.sell;
      map[key].count += 1;
      if (r.isRefund) map[key].refundBuy += Math.abs(r.buy);
      else map[key].txns.push({ buy: Math.max(0, r.buy), ageDays: r.ageDays });
    });
    Object.values(map).forEach((s) => {
      const key = s.code || s.name;
      s.paid = apPaymentsBySupplier[key] || 0;
      s.outstanding = s.buy - s.paid;

      // Aging for AP — same buckets/colors as the Clients/AR tab, which
      // already had this. Supplier payments (from Bank Book) are tracked
      // per-supplier only, not matched to one specific bill, so there's
      // no "this payment settled that exact transaction" data to read.
      // Standard AP-aging practice in that situation: allocate the total
      // paid amount against the OLDEST transactions first (a supplier
      // pays down what they've owed longest before newer bills), then
      // whatever's left unpaid on each transaction lands in its own age
      // bucket. This is an allocation approximation, not a ledger of
      // which payment cleared which bill — worth knowing if a supplier
      // ever asks "which specific invoice was this payment for".
      s.aging = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
      const oldestFirst = [...s.txns].sort((a, b) => b.ageDays - a.ageDays);
      let remainingPayment = s.paid;
      oldestFirst.forEach((t) => {
        let owed = t.buy;
        if (remainingPayment > 0) {
          const applied = Math.min(remainingPayment, owed);
          owed -= applied;
          remainingPayment -= applied;
        }
        if (owed > 0.01) s.aging[agingBucket(t.ageDays)] += owed;
      });
    });
    return Object.values(map).sort((a, b) => b.outstanding - a.outstanding);
  }, [filtered, apPaymentsBySupplier]);

  const totalOutstandingAP = useMemo(
    () => bySupplier.reduce((s, x) => s + x.outstanding, 0),
    [bySupplier]
  );

  // Full supplier list (not date-filtered) for the Bank modal's supplier
  // picker — a payment being recorded today shouldn't be hidden just
  // because the supplier's bookings fall outside the current date filter.
  const allSuppliersList = useMemo(() => {
    const map = {};
    allTx.forEach((r) => {
      const key = r.supplierCode || r.supplierName;
      if (!key || map[key]) return;
      map[key] = { code: r.supplierCode, name: r.supplierName || key };
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [allTx]);

  const bySalesman = useMemo(() => {
    const map = {};
    filtered.forEach((r) => {
      if (r.isVoid) return;
      const key = r.salesman || "Unassigned";
      if (!map[key])
        map[key] = { name: key, sales: 0, cost: 0, profit: 0, count: 0, unpaid: 0 };
      map[key].sales += r.sell;
      map[key].cost += r.buy;
      map[key].profit += r.profit;
      map[key].count += 1;
      if (r.invoiceIssued && !r.invoicePaid && !r.isRefund)
        map[key].unpaid += Math.max(0, r.sell);
    });
    return Object.values(map).sort((a, b) => b.sales - a.sales);
  }, [filtered]);

  /* Per-currency breakdown — this is the ONE place figures are shown in
     their ORIGINAL booking currency (origSell/origBuy) rather than the
     EGP-converted buy/sell used everywhere else on this page. Sales are
     grouped by sellCurrency and cost by buyCurrency separately, since a
     single booking can legitimately have both (buy USD / sell EGP), and
     lumping them under one "currency" would mix figures again. */
  const byCurrency = useMemo(() => {
    const map = {};
    const bucket = (k) => {
      if (!map[k])
        map[k] = { currency: k, sales: 0, cost: 0, profit: 0, count: 0, unpaid: 0, salesEGP: 0, costEGP: 0 };
      return map[k];
    };
    filtered.forEach((r) => {
      if (r.isVoid) return;
      const sellBucket = bucket(r.sellCurrency || "EGP");
      sellBucket.sales += r.origSell;
      sellBucket.salesEGP += r.sell;
      sellBucket.count += 1;
      if (r.invoiceIssued && !r.invoicePaid && !r.isRefund)
        sellBucket.unpaid += Math.max(0, r.origSell);

      const buyBucket = bucket(r.buyCurrency || "EGP");
      buyBucket.cost += r.origBuy;
      buyBucket.costEGP += r.buy;
    });
    Object.values(map).forEach((b) => {
      b.profit = b.salesEGP - b.costEGP; // profit only ever meaningful in one common currency (EGP)
    });
    return Object.values(map).sort((a, b) => Math.abs(b.sales) - Math.abs(a.sales));
  }, [filtered]);

  const bySection = useMemo(() => {
    return ["Flight", "Hotel", "Visa", "Transport"].map((sec) => {
      const rows = filtered.filter((r) => r.section === sec && !r.isVoid);
      let sales = 0,
        cost = 0,
        profit = 0,
        unpaid = 0,
        credit = 0;
      rows.forEach((r) => {
        sales += r.sell;
        cost += r.buy;
        profit += r.profit;
        if (r.isRefund) credit += Math.abs(r.sell);
        else if (r.invoiceIssued && !r.invoicePaid) unpaid += Math.max(0, r.sell);
      });
      return { section: sec, sales, cost, profit, unpaid, credit, count: rows.length };
    });
  }, [filtered]);

  const credits = useMemo(
    () => filtered.filter((r) => r.isRefund && !r.isVoid),
    [filtered]
  );

  /* VAT: treat service fee portion as VATable agency income; sales may be pass-through */
  const vatSummary = useMemo(() => {
    const rate = vatRate / 100;
    // Agency taxable base ≈ service fees + gross profit on local services (simplified)
    // Output VAT on service fees (agency commission/fee)
    let taxableFees = 0;
    filtered.forEach((r) => {
      if (r.isVoid || r.isRefund) return;
      taxableFees += Math.max(0, r.serviceFee || 0);
    });
    // Also approximate output on margin if no explicit service fee (common in tickets)
    const impliedCommission = Math.max(0, totals.profit - taxableFees);
    const outputBase = taxableFees + Math.max(0, impliedCommission * 0.5); // conservative
    const outputVAT = outputBase * rate;
    // Input VAT estimate on operating costs is unknown without bills — show 0 placeholder
    const inputVAT = 0;
    const netVAT = outputVAT - inputVAT;
    return { rate: vatRate, taxableFees, outputBase, outputVAT, inputVAT, netVAT };
  }, [filtered, vatRate, totals.profit]);

  /* ── Real General Ledger: every balanced Dr/Cr line, from every source ──
     - Auto-posted from each visible transaction (respects the same date/
       search/section filters as the rest of the page — a Trial Balance
       is always "as of" a period, so this is the correct behavior)
     - Manual journal entries (respecting the same date range)
     - Bank book movements (now double-entry via their contra account)     */
  const allLedgerLines = useMemo(() => {
    const lines = [];

    filtered.forEach((r) => {
      buildTransactionJournalLines(r).forEach((l) => {
        lines.push({
          ...l,
          date: r.date,
          memo: r.description,
          ref: r.ref,
          section: r.section,
          source: "auto",
          docId: r.docId,
        });
      });
    });

    journals.forEach((j) => {
      if (dateFrom && j.date && j.date < dateFrom) return;
      if (dateTo && j.date && j.date > dateTo) return;
      (j.lines || []).forEach((line) => {
        const d = parseNum(line.debit);
        const c = parseNum(line.credit);
        if (!d && !c) return;
        lines.push({
          accountCode: line.accountCode,
          debit: d,
          credit: c,
          date: j.date,
          memo: j.memo || "Journal entry",
          ref: "",
          section: "Journal",
          source: "manual",
          docId: j.id,
        });
      });
    });

    bankLines.forEach((b) => {
      if (dateFrom && b.date && b.date < dateFrom) return;
      if (dateTo && b.date && b.date > dateTo) return;
      const amt = parseNum(b.amount);
      if (!amt) return;
      const contra = b.contraAccount || (b.type === "in" ? AR_ACCOUNT : AP_ACCOUNT);
      // "in": Dr the bank/cash account, Cr the contra. "out": reversed.
      lines.push({
        accountCode: b.account || BANK_ACCOUNT,
        debit: b.type === "in" ? amt : 0,
        credit: b.type === "in" ? 0 : amt,
        date: b.date,
        memo: b.memo || "Bank movement",
        ref: "",
        section: "Bank",
        source: "bank",
        docId: b.id,
      });
      lines.push({
        accountCode: contra,
        debit: b.type === "in" ? 0 : amt,
        credit: b.type === "in" ? amt : 0,
        date: b.date,
        memo: b.memo || "Bank movement",
        ref: "",
        section: "Bank",
        source: "bank",
        docId: b.id,
      });
    });

    return lines;
  }, [filtered, journals, bankLines, dateFrom, dateTo]);

  /* Full-history ledger lines (branch/fiscal-year filtered, but NOT
     dateFrom/dateTo filtered) — the raw material for the periodic P&L
     reports (monthly/quarterly/yearly) below. Kept separate from
     allLedgerLines above (which IS date-filtered, for Trial Balance/GL)
     because a periodic report needs every month, not just whatever range
     happens to be selected in the page's toolbar. Sourced from allTx
     (unfiltered by date) instead of `filtered`. */
  const allLedgerLinesFull = useMemo(() => {
    const lines = [];
    allTx.forEach((r) => {
      buildTransactionJournalLines(r).forEach((l) => {
        lines.push({ ...l, date: r.date, memo: r.description, section: r.section, source: "auto" });
      });
    });
    journals.forEach((j) => {
      (j.lines || []).forEach((line) => {
        const d = parseNum(line.debit);
        const c = parseNum(line.credit);
        if (!d && !c) return;
        lines.push({
          accountCode: line.accountCode,
          debit: d,
          credit: c,
          date: j.date,
          memo: j.memo || "Journal entry",
          source: j.sourceType || "manual",
        });
      });
    });
    bankLines.forEach((b) => {
      const amt = parseNum(b.amount);
      if (!amt) return;
      const contra = b.contraAccount || (b.type === "in" ? AR_ACCOUNT : AP_ACCOUNT);
      lines.push({ accountCode: b.account || BANK_ACCOUNT, debit: b.type === "in" ? amt : 0, credit: b.type === "in" ? 0 : amt, date: b.date, memo: b.memo || "Bank movement", source: "bank" });
      lines.push({ accountCode: contra, debit: b.type === "in" ? 0 : amt, credit: b.type === "in" ? amt : 0, date: b.date, memo: b.memo || "Bank movement", source: "bank" });
    });
    return lines;
  }, [allTx, journals, bankLines]);

  /* Trial Balance — every account, total debit / total credit / net
     balance. Sum of all debits always equals sum of all credits because
     every line above was posted as part of a balanced pair. */
  const trialBalance = useMemo(() => {
    const map = {};
    CHART_OF_ACCOUNTS.forEach((a) => { map[a.code] = { debit: 0, credit: 0 }; });
    allLedgerLines.forEach((l) => {
      if (!map[l.accountCode]) map[l.accountCode] = { debit: 0, credit: 0 };
      map[l.accountCode].debit += l.debit || 0;
      map[l.accountCode].credit += l.credit || 0;
    });
    const rows = CHART_OF_ACCOUNTS.map((a) => {
      const m = map[a.code] || { debit: 0, credit: 0 };
      const normallyDebit = a.type === "Asset" || a.type === "COGS" || a.type === "Expense";
      const balance = normallyDebit ? m.debit - m.credit : m.credit - m.debit;
      return { ...a, totalDebit: m.debit, totalCredit: m.credit, balance };
    });
    const totalDebit = rows.reduce((s, r) => s + r.totalDebit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.totalCredit, 0);
    return { rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
  }, [allLedgerLines]);

  /* Chart of accounts balances — kept for the existing COA tab, now
     derived from the same real ledger instead of separate approximations. */
  const coaBalances = useMemo(() => {
    return trialBalance.rows.map((r) => ({ ...r, balance: r.balance }));
  }, [trialBalance]);

  /* Balance Sheet — group by account type, plus current-period net income
     (Revenue − COGS − Expenses) rolled into Equity as Retained Earnings,
     since day-to-day entries aren't formally "closed" to 3100 each period. */
  const balanceSheet = useMemo(() => {
    const byType = { Asset: [], Liability: [], Equity: [] };
    let revenue = 0, cogs = 0, expense = 0;
    trialBalance.rows.forEach((r) => {
      if (r.type === "Asset") byType.Asset.push(r);
      else if (r.type === "Liability") byType.Liability.push(r);
      else if (r.type === "Equity") byType.Equity.push(r);
      else if (r.type === "Revenue") revenue += r.balance;
      else if (r.type === "COGS") cogs += r.balance;
      else if (r.type === "Expense") expense += r.balance;
    });
    const netIncome = revenue - cogs - expense;
    const totalAssets = byType.Asset.reduce((s, r) => s + r.balance, 0);
    const totalLiabilities = byType.Liability.reduce((s, r) => s + r.balance, 0);
    const totalEquityBooked = byType.Equity.reduce((s, r) => s + r.balance, 0);
    const totalEquity = totalEquityBooked + netIncome;
    return {
      assets: byType.Asset,
      liabilities: byType.Liability,
      equity: byType.Equity,
      netIncome,
      totalAssets,
      totalLiabilities,
      totalEquity,
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    };
  }, [trialBalance]);

  /* General Ledger for one selected account — every line that hit it,
     in date order, with a running balance. */
  const generalLedgerRows = useMemo(() => {
    const acct = CHART_OF_ACCOUNTS.find((a) => a.code === glAccount);
    const normallyDebit = acct ? (acct.type === "Asset" || acct.type === "COGS" || acct.type === "Expense") : true;
    const rows = allLedgerLines
      .filter((l) => l.accountCode === glAccount)
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    let running = 0;
    return rows.map((l) => {
      running += normallyDebit ? (l.debit - l.credit) : (l.credit - l.debit);
      return { ...l, running };
    });
  }, [allLedgerLines, glAccount]);

  const sectionIcon = (s) =>
    s === "Flight" ? Plane : s === "Hotel" ? Hotel : s === "Visa" ? FileCheck : Car;

  /* Journal handlers */
  const journalTotals = useMemo(() => {
    let d = 0,
      c = 0;
    (journalForm.lines || []).forEach((l) => {
      d += parseNum(l.debit);
      c += parseNum(l.credit);
    });
    return { debit: d, credit: c, balanced: Math.abs(d - c) < 0.005 };
  }, [journalForm]);

  const saveJournal = async () => {
    if (!canWrite) return;
    if (!journalForm.memo.trim()) {
      toast.error("Memo / description required");
      return;
    }
    if (!journalTotals.balanced) {
      toast.error("Journal must balance (Debit = Credit)");
      return;
    }
    if (journalTotals.debit === 0) {
      toast.error("Enter amounts");
      return;
    }
    setJournalSaving(true);
    try {
      const journalDoc = await addDoc(collection(db, "journalEntries"), {
        date: journalForm.date,
        memo: journalForm.memo.trim(),
        lines: journalForm.lines.map((l) => ({
          accountCode: l.accountCode,
          accountName:
            CHART_OF_ACCOUNTS.find((a) => a.code === l.accountCode)?.name ||
            l.accountName ||
            "",
          debit: parseNum(l.debit),
          credit: parseNum(l.credit),
        })),
        totalDebit: journalTotals.debit,
        totalCredit: journalTotals.credit,
        createdBy: userData?.name || userData?.username || "",
        createdAt: serverTimestamp(),
      });
      // Audit trail: logActivity() already exists (see lib/auth.js) and is
      // wired into Settings (employee edits, force-logout...) but wasn't
      // called from a single financial action anywhere in the app — a
      // manually-posted journal entry left no trace of who posted it
      // beyond the journalEntries doc itself, which isn't visible from the
      // Activity Log screen. This makes it show up there too.
      logActivity({
        userId: userData?.uid,
        username: userData?.username,
        name: userData?.name,
        action: "journal_entry_posted",
        meta: { journalId: journalDoc.id, date: journalForm.date, memo: journalForm.memo.trim(), totalDebit: journalTotals.debit },
      });
      toast.success("Journal entry posted");
      setShowJournal(false);
      setJournalForm(EMPTY_JOURNAL);
    } catch (e) {
      toast.error("Failed: " + (e.message || ""));
    } finally {
      setJournalSaving(false);
    }
  };

  const deleteJournal = async (id) => {
    if (!canWrite) return;
    if (!confirm("Delete this journal entry?")) return;
    try {
      // Capture what's being deleted BEFORE it's gone, so the audit trail
      // entry actually says something useful (amount, memo) rather than
      // just an opaque doc id nobody can look up anymore.
      const existing = journals.find((j) => j.id === id);
      await deleteDoc(doc(db, "journalEntries", id));
      logActivity({
        userId: userData?.uid,
        username: userData?.username,
        name: userData?.name,
        action: "journal_entry_deleted",
        meta: { journalId: id, date: existing?.date, memo: existing?.memo, totalDebit: existing?.totalDebit },
      });
      toast.success("Deleted");
    } catch (e) {
      toast.error(e.message || "Delete failed");
    }
  };

  const saveBankLine = async () => {
    if (!canWrite) return;
    if (!parseNum(bankForm.amount)) {
      toast.error("Amount required");
      return;
    }
    try {
      await addDoc(collection(db, "bankBook"), {
        ...bankForm,
        amount: parseNum(bankForm.amount),
        createdBy: userData?.name || "",
        createdAt: serverTimestamp(),
      });
      toast.success("Bank line saved");
      setShowBank(false);
      setBankForm({
        date: new Date().toISOString().slice(0, 10),
        type: "in",
        amount: "",
        currency: "EGP",
        account: "1010",
        contraAccount: "1100",
        memo: "",
        supplierCode: "",
        supplierName: "",
      });
    } catch (e) {
      toast.error(e.message || "Failed");
    }
  };

  const deleteBankLine = async (id) => {
    if (!canWrite) return;
    if (!confirm("Delete bank line?")) return;
    try {
      await deleteDoc(doc(db, "bankBook", id));
      toast.success("Deleted");
    } catch (e) {
      toast.error(e.message || "Failed");
    }
  };

  /* Client / Supplier statement — the itemized detail behind an AR/AP
     row. A client's Total AR figure or a supplier's Outstanding figure is
     only as trustworthy as the transactions an accountant can actually
     open and check it against, so every aggregate row is clickable
     through to this. Running balance uses the exact same rules as the
     aggregates above (byClient's AR rule / bySupplier's AP rule) so it
     always reconciles back to the number that was clicked. */
  const statementRows = useMemo(() => {
    if (!statementFor) return [];
    if (statementFor.kind === "client") {
      const rows = filtered.filter(
        (r) => !r.isVoid && (r.clientCode || r.clientName || "Unknown") === statementFor.key
      );
      rows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      let running = 0;
      return rows.map((r) => {
        // Same rule as byClient above: a sale invoice increases AR until
        // paid; a credit note (refund) that's been physically paid back
        // reduces what was collected but — like the Invoices page — never
        // reduces Outstanding itself (a credit note doesn't increase what
        // the client owes, so it can't "pay off" AR either).
        let debit = 0, credit = 0;
        if (r.isRefund) {
          credit = Math.abs(r.sell);
          if (r.invoicePaid) running -= Math.abs(r.sell);
        } else if (r.invoiceIssued) {
          if (r.invoicePaid) {
            credit = r.sell;
          } else {
            debit = r.sell;
            running += r.sell;
          }
        }
        return { ...r, debit, credit, running, statementLabel: r.isRefund ? "Credit Note" : !r.invoiceIssued ? "Not Invoiced" : r.invoicePaid ? "Paid" : "Invoiced" };
      });
    }
    // supplier
    const bookingRows = filtered
      .filter((r) => !r.isVoid && (r.supplierCode || r.supplierName || "Unknown") === statementFor.key)
      .map((r) => ({
        date: r.date,
        kind: "booking",
        description: r.description,
        ref: r.ref,
        debit: 0,
        credit: r.buy, // a purchase increases what we owe the supplier (can be negative for a refund, correctly reducing it)
        statementLabel: r.isRefund ? "Supplier Credit" : "Purchase",
      }));
    const paymentRows = bankLines
      .filter((b) => b.type === "out" && b.contraAccount === AP_ACCOUNT && (b.supplierCode || b.supplierName) === statementFor.key)
      .map((b) => ({
        date: b.date,
        kind: "payment",
        description: b.memo || "Bank payment",
        ref: "",
        debit: parseNum(b.amount), // a payment reduces what we owe
        credit: 0,
        statementLabel: "Payment",
      }));
    const rows = [...bookingRows, ...paymentRows].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    let running = 0;
    return rows.map((r) => {
      running += (r.credit || 0) - (r.debit || 0);
      return { ...r, running };
    });
  }, [statementFor, filtered, bankLines]);

  if (!canView && !loading) {
    return (
      <div>
        <Navbar title={"Accounts" || "Accounts"} />
        <div className="p-6 text-center text-slate-500">
          You don&apos;t have access to Accounts. Ask an admin to grant it in Settings &gt; Permissions.
        </div>
      </div>
    );
  }

  const inputCls =
    "border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="flex flex-col min-h-[calc(100vh-0px)]">
      <Navbar title={"Accounts" || "Accounts"} />

      <div className="bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Client, supplier, salesman, invoice..."
            className="pl-6 pr-2 py-1.5 border border-slate-300 rounded w-52 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        <span className="text-slate-400">→</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
        <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} className={inputCls}>
          <option value="all">All Products</option>
          <option value="Flight">Air Tickets</option>
          <option value="Hotel">Hotels</option>
          <option value="Visa">Visa</option>
          <option value="Transport">Transport</option>
        </select>
        <select value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)} className={inputCls}>
          <option value="all">All Currencies</option>
          <option value="EGP">EGP</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </select>
        <select value={paidFilter} onChange={(e) => setPaidFilter(e.target.value)} className={inputCls}>
          <option value="all">All Payment Status</option>
          <option value="paid">Collected</option>
          <option value="unpaid">Outstanding AR</option>
          <option value="not_invoiced">Not Invoiced</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-slate-500 tabular-nums">
            {totals.count} docs · Margin {totals.marginPct.toFixed(1)}%
          </span>
          <ExportButtons
            targetRef={tabContentRef}
            filename={`Accounts_${TABS.find((t) => t.id === tab)?.label.replace(/\s+/g, "_") || tab}`}
            title={`${TABS.find((t) => t.id === tab)?.label || "Accounts"}${dateFrom || dateTo ? `  (${dateFrom || "…"} → ${dateTo || "…"})` : ""}`}
          />
        </div>
      </div>

      <div className="bg-white border-b px-1 flex gap-0 text-[10px] overflow-x-auto">
        {TABS.map((tb) => {
          const Icon = tb.icon;
          return (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`px-2.5 py-2 font-medium border-b-2 flex items-center gap-1 whitespace-nowrap ${
                tab === tb.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon size={11} />
              {tb.label}
            </button>
          );
        })}
      </div>

      <div ref={tabContentRef} className="flex-1 overflow-auto bg-slate-50 p-3 space-y-3">
        {loading ? (
          <div className="flex justify-center h-40 items-center">
            <div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-2">
              <StatCard label="Gross Sales" value={totals.sales} color="text-emerald-600" sub={`${totals.count} bookings`} icon={TrendingUp} />
              <StatCard label="Cost of Sales" value={totals.cost} color="text-slate-700" sub="Supplier cost" icon={TrendingDown} />
              <StatCard label="Gross Profit" value={totals.profit} color={totals.profit >= 0 ? "text-teal-600" : "text-red-600"} sub={`${totals.marginPct.toFixed(1)}% margin`} icon={Wallet} />
              <StatCard label="Invoiced" value={totals.invoiced} color="text-blue-600" icon={Receipt} />
              <StatCard label="Collected" value={totals.paid} color="text-emerald-700" icon={Banknote} />
              <StatCard label="Outstanding AR" value={totals.unpaid} color="text-amber-600" icon={AlertTriangle} />
              <StatCard label="Outstanding AP" value={totalOutstandingAP} color="text-orange-600" sub="Owed to suppliers" icon={Building2} />
              <StatCard label="Credit Notes" value={totals.credit} color="text-red-600" sub={`${totals.refundCount} refunds`} icon={ArrowLeftRight} />
              <StatCard label="VAT Net" value={vatSummary.netVAT} color="text-purple-600" sub={`Rate ${vatRate}%`} icon={Percent} />
            </div>

            {/* DASHBOARD */}
            {tab === "overview" && (
              <div className="space-y-3">
                <div
                  className={`rounded-xl border p-3 flex items-center justify-between cursor-pointer hover:opacity-90 ${trialBalance.balanced ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}
                  onClick={() => setTab("trialBalance")}
                >
                  <div className="flex items-center gap-2 text-[12px] font-semibold">
                    <Calculator size={16} className={trialBalance.balanced ? "text-emerald-600" : "text-red-600"} />
                    <span className={trialBalance.balanced ? "text-emerald-700" : "text-red-700"}>
                      Books {trialBalance.balanced ? "balanced" : "out of balance"} — every booking auto-posts a double-entry the moment it's created
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 flex gap-3">
                    <span>Dr {fmt(trialBalance.totalDebit)}</span>
                    <span>Cr {fmt(trialBalance.totalCredit)}</span>
                    <span className="underline">View Trial Balance →</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2 bg-white border rounded-xl overflow-hidden">
                  <div className="px-3 py-2 border-b bg-slate-50 text-[11px] font-semibold">Product Mix</div>
                  <table className="w-full text-[11px]">
                    <thead className="text-slate-500 bg-slate-50">
                      <tr>
                        <th className="text-left px-3 py-1.5">Product</th>
                        <th className="text-right px-3 py-1.5">Docs</th>
                        <th className="text-right px-3 py-1.5">Sales</th>
                        <th className="text-right px-3 py-1.5">COS</th>
                        <th className="text-right px-3 py-1.5">GP</th>
                        <th className="text-right px-3 py-1.5">AR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bySection.map((s) => {
                        const Icon = sectionIcon(s.section);
                        return (
                          <tr key={s.section} className="border-t hover:bg-slate-50">
                            <td className="px-3 py-2 font-medium flex items-center gap-1.5">
                              <Icon size={13} className="text-slate-400" />
                              {s.section === "Flight" ? "Air Tickets" : s.section}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{s.count}</td>
                            <td className="px-3 py-2 text-right text-emerald-700 tabular-nums">{fmt(s.sales)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmt(s.cost)}</td>
                            <td className={`px-3 py-2 text-right font-semibold tabular-nums ${s.profit >= 0 ? "text-teal-600" : "text-red-600"}`}>{fmt(s.profit)}</td>
                            <td className="px-3 py-2 text-right text-amber-600 tabular-nums">{fmt(s.unpaid)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-3">
                  <div className="bg-white border rounded-xl p-3">
                    <div className="text-[11px] font-semibold mb-2">AR Aging</div>
                    {[
                      ["Current", totals.aging.current, "text-slate-700"],
                      ["1–30 days", totals.aging.d30, "text-amber-600"],
                      ["31–60 days", totals.aging.d60, "text-orange-600"],
                      ["61–90 days", totals.aging.d90, "text-red-500"],
                      ["90+ days", totals.aging.d90p, "text-red-700"],
                    ].map(([label, val, col]) => (
                      <div key={label} className="flex justify-between text-[11px] py-1 border-b border-slate-50">
                        <span className="text-slate-500">{label}</span>
                        <span className={`font-semibold tabular-nums ${col}`}>{fmt(val)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="bg-white border rounded-xl p-3 grid grid-cols-2 gap-2 text-center">
                    <div className="bg-emerald-50 rounded-lg p-2">
                      <div className="text-[9px] text-emerald-600">CASH SALES</div>
                      <div className="font-bold text-emerald-700 text-sm tabular-nums">{fmt(totals.cashSales)}</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-2">
                      <div className="text-[9px] text-blue-600">CARD SALES</div>
                      <div className="font-bold text-blue-700 text-sm tabular-nums">{fmt(totals.cardSales)}</div>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            )}

            {/* P&L */}
            {tab === "pl" && (
              <div className="bg-white border rounded-xl max-w-xl overflow-hidden">
                <div className="px-4 py-2 border-b bg-slate-50 text-[11px] font-semibold">Management Profit & Loss</div>
                <div className="p-4 space-y-1 text-[12px]">
                  {[
                    ["Gross Sales", totals.sales, "text-emerald-700 font-semibold"],
                    ["Less: Credit Notes", -totals.credit, "text-red-600"],
                    ["Net Sales", totals.sales, "font-bold border-t pt-1"],
                    ["Cost of Sales", -Math.abs(totals.cost), ""],
                    ["Gross Profit", totals.profit, `font-bold border-t pt-1 ${totals.profit >= 0 ? "text-teal-700" : "text-red-600"}`],
                    ["Service Fee Income", totals.serviceFees, "text-slate-600"],
                    ["Estimated VAT on Agency Income", -vatSummary.outputVAT, "text-purple-600"],
                  ].map(([label, val, cls], i) => (
                    <div key={i} className={`flex justify-between py-1 ${cls}`}>
                      <span>{label}</span>
                      <span className="tabular-nums">{fmt(val)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1 text-slate-500">
                    <span>Gross Margin %</span>
                    <span className="font-semibold tabular-nums">{totals.marginPct.toFixed(2)}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* P&L PERIODIC — monthly/quarterly/yearly, guaranteed to reconcile */}
            {tab === "plPeriods" && (
              <PeriodicPLTab ledgerLines={allLedgerLinesFull} chartOfAccounts={CHART_OF_ACCOUNTS} />
            )}

            {/* ADJUSTMENTS — suspense account + accrual/prepayment/reclass entries */}
            {tab === "adjustments" && (
              <AdjustmentsTab
                ledgerLines={allLedgerLinesFull}
                journals={journals}
                chartOfAccounts={CHART_OF_ACCOUNTS}
                canWrite={canWrite}
                userName={userData?.name || userData?.username || ""}
              />
            )}

            {/* TRIAL BALANCE */}
            {tab === "trialBalance" && (
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b bg-slate-50 text-[11px] font-semibold flex justify-between items-center">
                  <span>Trial Balance {dateFrom || dateTo ? `(${dateFrom || "…"} → ${dateTo || "…"})` : "(all time)"}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${trialBalance.balanced ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                    {trialBalance.balanced ? "Balanced ✓" : "Out of balance"}
                  </span>
                </div>
                <div className="overflow-auto max-h-[calc(100vh-320px)]">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 text-slate-500 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-1.5">Code</th>
                        <th className="text-left px-3 py-1.5">Account</th>
                        <th className="text-left px-3 py-1.5">Type</th>
                        <th className="text-right px-3 py-1.5">Debit</th>
                        <th className="text-right px-3 py-1.5">Credit</th>
                        <th className="text-right px-3 py-1.5">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trialBalance.rows.filter((r) => r.totalDebit || r.totalCredit).map((r) => (
                        <tr key={r.code} className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => { setGlAccount(r.code); setTab("gl"); }}>
                          <td className="px-3 py-1.5 font-mono font-semibold text-slate-600">{r.code}</td>
                          <td className="px-3 py-1.5 font-medium">{r.name}</td>
                          <td className="px-3 py-1.5"><span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100">{r.type}</span></td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{r.totalDebit ? fmt(r.totalDebit) : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{r.totalCredit ? fmt(r.totalCredit) : "—"}</td>
                          <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${r.balance >= 0 ? "text-slate-800" : "text-red-600"}`}>{fmt(r.balance)}</td>
                        </tr>
                      ))}
                      {trialBalance.rows.every((r) => !r.totalDebit && !r.totalCredit) && (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No activity in this period yet</td></tr>
                      )}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t-2 font-bold text-[11px] sticky bottom-0">
                      <tr>
                        <td className="px-3 py-2" colSpan={3}>Total</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(trialBalance.totalDebit)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(trialBalance.totalCredit)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="px-3 py-2 text-[10px] text-slate-400 border-t">Click any account to open its General Ledger.</p>
              </div>
            )}

            {/* GENERAL LEDGER (per account) */}
            {tab === "gl" && (
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b bg-slate-50 flex items-center gap-2">
                  <span className="text-[11px] font-semibold">General Ledger —</span>
                  <select value={glAccount} onChange={(e) => setGlAccount(e.target.value)} className="text-[11px] border rounded px-2 py-1 font-mono">
                    {CHART_OF_ACCOUNTS.map((a) => (
                      <option key={a.code} value={a.code}>{a.code} {a.name}</option>
                    ))}
                  </select>
                  <span className="ml-auto text-[10px] text-slate-400">{generalLedgerRows.length} lines</span>
                </div>
                <div className="overflow-auto max-h-[calc(100vh-320px)]">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 text-slate-500 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-1.5">Date</th>
                        <th className="text-left px-3 py-1.5">Source</th>
                        <th className="text-left px-3 py-1.5">Memo</th>
                        <th className="text-left px-3 py-1.5">Ref</th>
                        <th className="text-right px-3 py-1.5">Debit</th>
                        <th className="text-right px-3 py-1.5">Credit</th>
                        <th className="text-right px-3 py-1.5">Running Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generalLedgerRows.map((l, i) => (
                        <tr key={i} className="border-t hover:bg-slate-50">
                          <td className="px-3 py-1.5 whitespace-nowrap">{l.date || "—"}</td>
                          <td className="px-3 py-1.5">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${l.source === "auto" ? "bg-blue-50 text-blue-700" : l.source === "manual" ? "bg-purple-50 text-purple-700" : "bg-amber-50 text-amber-700"}`}>
                              {l.source === "auto" ? l.section : l.source === "manual" ? "Journal" : "Bank"}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 truncate max-w-[240px]">{l.memo}</td>
                          <td className="px-3 py-1.5 font-mono">{l.ref || "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{l.debit ? fmt(l.debit) : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{l.credit ? fmt(l.credit) : "—"}</td>
                          <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${l.running >= 0 ? "text-slate-800" : "text-red-600"}`}>{fmt(l.running)}</td>
                        </tr>
                      ))}
                      {generalLedgerRows.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No entries posted to this account in this period</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* BALANCE SHEET */}
            {tab === "balanceSheet" && (
              <div className="max-w-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-slate-500">As of {dateTo || "today"} {dateFrom && `(activity from ${dateFrom})`}</div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${balanceSheet.balanced ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                    {balanceSheet.balanced ? "Assets = Liabilities + Equity ✓" : "Out of balance"}
                  </span>
                </div>
                <div className="bg-white border rounded-xl overflow-hidden">
                  <div className="px-4 py-2 border-b bg-slate-50 text-[11px] font-semibold">Assets</div>
                  <div className="p-4 space-y-1 text-[12px]">
                    {balanceSheet.assets.filter((a) => a.balance !== 0).map((a) => (
                      <div key={a.code} className="flex justify-between py-0.5">
                        <span className="text-slate-600">{a.name}</span>
                        <span className="tabular-nums">{fmt(a.balance)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-1 font-bold border-t mt-1 pt-1">
                      <span>Total Assets</span>
                      <span className="tabular-nums">{fmt(balanceSheet.totalAssets)}</span>
                    </div>
                  </div>
                </div>
                <div className="bg-white border rounded-xl overflow-hidden">
                  <div className="px-4 py-2 border-b bg-slate-50 text-[11px] font-semibold">Liabilities</div>
                  <div className="p-4 space-y-1 text-[12px]">
                    {balanceSheet.liabilities.filter((a) => a.balance !== 0).map((a) => (
                      <div key={a.code} className="flex justify-between py-0.5">
                        <span className="text-slate-600">{a.name}</span>
                        <span className="tabular-nums">{fmt(a.balance)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-1 font-bold border-t mt-1 pt-1">
                      <span>Total Liabilities</span>
                      <span className="tabular-nums">{fmt(balanceSheet.totalLiabilities)}</span>
                    </div>
                  </div>
                </div>
                <div className="bg-white border rounded-xl overflow-hidden">
                  <div className="px-4 py-2 border-b bg-slate-50 text-[11px] font-semibold">Equity</div>
                  <div className="p-4 space-y-1 text-[12px]">
                    {balanceSheet.equity.filter((a) => a.balance !== 0).map((a) => (
                      <div key={a.code} className="flex justify-between py-0.5">
                        <span className="text-slate-600">{a.name}</span>
                        <span className="tabular-nums">{fmt(a.balance)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-0.5">
                      <span className="text-slate-600">Retained Earnings (current period net income)</span>
                      <span className="tabular-nums">{fmt(balanceSheet.netIncome)}</span>
                    </div>
                    <div className="flex justify-between py-1 font-bold border-t mt-1 pt-1">
                      <span>Total Equity</span>
                      <span className="tabular-nums">{fmt(balanceSheet.totalEquity)}</span>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400">
                  Net income is rolled into Equity as unposted Retained Earnings since the books haven't been formally closed for a period yet — use Journals to book a formal year-end closing entry if you need one.
                </p>
              </div>
            )}


            {tab === "clients" && (
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b bg-slate-50 text-[11px] font-semibold flex justify-between">
                  <span>Accounts Receivable</span>
                  <span className="font-normal text-slate-400">AR {fmt(totals.unpaid)}</span>
                </div>
                <div className="overflow-auto max-h-[calc(100vh-300px)]">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 text-slate-500 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1.5">Client</th>
                        <th className="text-right px-2 py-1.5">Sales</th>
                        <th className="text-right px-2 py-1.5">GP</th>
                        <th className="text-right px-2 py-1.5">Paid</th>
                        <th className="text-right px-2 py-1.5">Credits</th>
                        <th className="text-right px-2 py-1.5">Current</th>
                        <th className="text-right px-2 py-1.5">1–30</th>
                        <th className="text-right px-2 py-1.5">31–60</th>
                        <th className="text-right px-2 py-1.5">61–90</th>
                        <th className="text-right px-2 py-1.5">90+</th>
                        <th className="text-right px-2 py-1.5">Total AR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byClient.map((c) => (
                        <tr
                          key={c.code + c.name}
                          className="border-t hover:bg-slate-50 cursor-pointer"
                          onClick={() => setStatementFor({ kind: "client", key: c.code || c.name, code: c.code, name: c.name })}
                        >
                          <td className="px-2 py-1.5">
                            <div className="font-medium">{c.name}</div>
                            <div className="text-[9px] text-slate-400 font-mono">{c.code}</div>
                          </td>
                          <td className="px-2 py-1.5 text-right text-emerald-700 tabular-nums">{fmt(c.sales)}</td>
                          <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${c.profit >= 0 ? "text-teal-600" : "text-red-600"}`}>{fmt(c.profit)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmt(c.paid)}</td>
                          <td className="px-2 py-1.5 text-right text-red-500 tabular-nums">{fmt(c.credit)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmt(c.aging.current)}</td>
                          <td className="px-2 py-1.5 text-right text-amber-600 tabular-nums">{fmt(c.aging.d30)}</td>
                          <td className="px-2 py-1.5 text-right text-orange-600 tabular-nums">{fmt(c.aging.d60)}</td>
                          <td className="px-2 py-1.5 text-right text-red-500 tabular-nums">{fmt(c.aging.d90)}</td>
                          <td className="px-2 py-1.5 text-right text-red-700 tabular-nums">{fmt(c.aging.d90p)}</td>
                          <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${c.unpaid > 0 ? "text-amber-600" : "text-slate-400"}`}>{fmt(c.unpaid)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-3 py-2 text-[10px] text-slate-400 border-t">Click a client for their full statement of account.</p>
              </div>
            )}

            {/* SUPPLIERS */}
            {tab === "suppliers" && (
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b bg-slate-50 text-[11px] font-semibold flex justify-between">
                  <span>Accounts Payable — Suppliers</span>
                  <span className="font-normal text-slate-400">Outstanding AP {fmt(totalOutstandingAP)}</span>
                </div>
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-1.5">Supplier</th>
                      <th className="text-right px-3 py-1.5">Docs</th>
                      <th className="text-right px-3 py-1.5">Cost (AP)</th>
                      <th className="text-right px-3 py-1.5">Paid</th>
                      <th className="text-right px-3 py-1.5">Current</th>
                      <th className="text-right px-3 py-1.5">1–30</th>
                      <th className="text-right px-3 py-1.5">31–60</th>
                      <th className="text-right px-3 py-1.5">61–90</th>
                      <th className="text-right px-3 py-1.5">90+</th>
                      <th className="text-right px-3 py-1.5">Outstanding</th>
                      <th className="text-right px-3 py-1.5">Sales</th>
                      <th className="text-right px-3 py-1.5">Margin</th>
                      <th className="text-right px-3 py-1.5">Supplier Refunds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bySupplier.map((s) => (
                      <tr
                        key={s.code + s.name}
                        className="border-t hover:bg-slate-50 cursor-pointer"
                        onClick={() => setStatementFor({ kind: "supplier", key: s.code || s.name, code: s.code, name: s.name })}
                      >
                        <td className="px-3 py-1.5 font-medium">{s.name}<div className="text-[9px] text-slate-400 font-mono">{s.code}</div></td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{s.count}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmt(s.buy)}</td>
                        <td className="px-3 py-1.5 text-right text-emerald-600 tabular-nums">{fmt(s.paid)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmt(s.aging.current)}</td>
                        <td className="px-3 py-1.5 text-right text-amber-600 tabular-nums">{fmt(s.aging.d30)}</td>
                        <td className="px-3 py-1.5 text-right text-orange-600 tabular-nums">{fmt(s.aging.d60)}</td>
                        <td className="px-3 py-1.5 text-right text-red-500 tabular-nums">{fmt(s.aging.d90)}</td>
                        <td className="px-3 py-1.5 text-right text-red-700 tabular-nums">{fmt(s.aging.d90p)}</td>
                        <td className={`px-3 py-1.5 text-right font-bold tabular-nums ${s.outstanding > 0 ? "text-amber-600" : "text-slate-400"}`}>{fmt(s.outstanding)}</td>
                        <td className="px-3 py-1.5 text-right text-emerald-700 tabular-nums">{fmt(s.sell)}</td>
                        <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${(s.sell - s.buy) >= 0 ? "text-teal-600" : "text-red-600"}`}>{fmt(s.sell - s.buy)}</td>
                        <td className="px-3 py-1.5 text-right text-emerald-600 tabular-nums">{fmt(s.refundBuy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-3 py-2 text-[10px] text-slate-400 border-t">
                  &quot;Paid&quot; comes from Bank Book payments tagged to this supplier (Bank Book → Add Line → Contra Account: Accounts Payable), allocated oldest-bill-first across aging buckets. Click a row for the full statement.
                </p>
              </div>
            )}

            {/* CASH */}
            {tab === "cash" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-white border rounded-xl p-4 space-y-2 text-[12px]">
                  <div className="font-semibold flex items-center gap-2"><Banknote size={16} className="text-emerald-600" /> Cash Desk</div>
                  <div className="flex justify-between"><span className="text-slate-500">Cash Sales</span><span className="font-semibold text-emerald-700 tabular-nums">{fmt(totals.cashSales)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Cash COS</span><span className="tabular-nums">{fmt(totals.cashCost)}</span></div>
                  <div className="flex justify-between border-t pt-2 font-bold"><span>Cash GP</span><span className="text-teal-600 tabular-nums">{fmt(totals.cashSales - totals.cashCost)}</span></div>
                </div>
                <div className="bg-white border rounded-xl p-4 space-y-2 text-[12px]">
                  <div className="font-semibold flex items-center gap-2"><CreditCard size={16} className="text-blue-600" /> Card / CC</div>
                  <div className="flex justify-between"><span className="text-slate-500">Card Sales</span><span className="font-semibold text-blue-700 tabular-nums">{fmt(totals.cardSales)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Card COS</span><span className="tabular-nums">{fmt(totals.cardCost)}</span></div>
                  <div className="flex justify-between border-t pt-2 font-bold"><span>Card GP</span><span className="text-teal-600 tabular-nums">{fmt(totals.cardSales - totals.cardCost)}</span></div>
                </div>
              </div>
            )}

            {/* TREASURY — أوامر/سندات التوريد والصرف + أرصدة الخزائن بكل عملة */}
            {tab === "treasury" && <TreasuryTab canWrite={canWrite} />}

            {/* BANK BOOK */}
            {tab === "bank" && (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <div className="text-[11px] text-slate-500">Manual bank movements (deposits, transfers, charges)</div>
                  <button onClick={() => setShowBank(true)} disabled={!canWrite} title={!canWrite ? "View only — you don't have write access to this page" : undefined} className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed">
                    <Plus size={12} /> Add Line
                  </button>
                </div>
                <div className="bg-white border rounded-xl overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-1.5">Date</th>
                        <th className="text-left px-3 py-1.5">Account</th>
                        <th className="text-left px-3 py-1.5">Contra</th>
                        <th className="text-left px-3 py-1.5">Supplier</th>
                        <th className="text-left px-3 py-1.5">Type</th>
                        <th className="text-left px-3 py-1.5">Memo</th>
                        <th className="text-right px-3 py-1.5">Amount</th>
                        <th className="text-center px-3 py-1.5">Curr</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankLines
                        .slice()
                        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                        .map((b) => (
                          <tr key={b.id} className="border-t hover:bg-slate-50">
                            <td className="px-3 py-1.5">{b.date}</td>
                            <td className="px-3 py-1.5 font-mono">{b.account}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-400">{b.contraAccount || "—"}</td>
                            <td className="px-3 py-1.5">{b.supplierName || <span className="text-slate-300">—</span>}</td>
                            <td className="px-3 py-1.5">
                              <span className={b.type === "in" ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                                {b.type === "in" ? "IN" : "OUT"}
                              </span>
                            </td>
                            <td className="px-3 py-1.5">{b.memo}</td>
                            <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${b.type === "in" ? "text-emerald-700" : "text-red-600"}`}>
                              {fmt(b.amount)}
                            </td>
                            <td className="px-3 py-1.5 text-center">{b.currency}</td>
                            <td className="px-2">
                              {canWrite && (
                                <button onClick={() => deleteBankLine(b.id)} className="text-red-500 p-1"><Trash2 size={12} /></button>
                              )}
                            </td>
                          </tr>
                        ))}
                      {bankLines.length === 0 && (
                        <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">No bank lines yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* CREDITS */}
            {tab === "credits" && (
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b bg-slate-50 text-[11px] font-semibold">Credit Notes & Refunds — {fmt(totals.credit)}</div>
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-1.5">Date</th>
                      <th className="text-left px-3 py-1.5">Product</th>
                      <th className="text-left px-3 py-1.5">Client</th>
                      <th className="text-left px-3 py-1.5">Ref</th>
                      <th className="text-right px-3 py-1.5">Client Credit</th>
                      <th className="text-right px-3 py-1.5">Supplier Recoverable</th>
                      <th className="text-right px-3 py-1.5">Net Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {credits.map((r) => (
                      <tr key={r.id} className="border-t bg-amber-50/30">
                        <td className="px-3 py-1.5">{r.date || "—"}</td>
                        <td className="px-3 py-1.5">{r.section}</td>
                        <td className="px-3 py-1.5 font-medium">{r.clientName}</td>
                        <td className="px-3 py-1.5 font-mono text-[10px]">{r.ref}</td>
                        <td className="px-3 py-1.5 text-right text-red-600 font-semibold tabular-nums">{fmt(Math.abs(r.sell))}</td>
                        <td className="px-3 py-1.5 text-right text-emerald-600 tabular-nums">{fmt(Math.abs(r.buy))}</td>
                        <td className={`px-3 py-1.5 text-right font-bold tabular-nums ${r.profit >= 0 ? "text-teal-600" : "text-red-600"}`}>{fmt(r.profit)}</td>
                      </tr>
                    ))}
                    {credits.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No credit notes</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Cancelled Invoices — audit trail only, not a totals source */}
            {tab === "cancelled" && (
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b bg-slate-50 text-[11px] font-semibold flex items-center gap-2">
                  <Ban size={14} className="text-orange-600" /> Cancelled Invoices — {cancelledInvoices.length} record(s)
                </div>
                <div className="px-3 py-2 text-[11px] text-slate-500 border-b bg-orange-50/50">
                  Historical record only. A cancelled invoice's booking counts as un-invoiced again everywhere else (Dashboard, this page's other tabs) — it does not appear as revenue anywhere. The burned number is never reused.
                </div>
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-1.5">Cancelled At</th>
                      <th className="text-left px-3 py-1.5">Product</th>
                      <th className="text-left px-3 py-1.5">Client</th>
                      <th className="text-left px-3 py-1.5">Old Invoice #</th>
                      <th className="text-left px-3 py-1.5">Cancelled By</th>
                      <th className="text-left px-3 py-1.5">Reason</th>
                      <th className="text-left px-3 py-1.5">Status Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cancelledInvoices.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-1.5 whitespace-nowrap">{fmtTs(r.invoiceCancelledAt)}</td>
                        <td className="px-3 py-1.5">{r.section}</td>
                        <td className="px-3 py-1.5 font-medium">{r.clientName || "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-orange-700">{r.cancelledInvoiceNumber}</td>
                        <td className="px-3 py-1.5">{r.invoiceCancelledBy || "—"}</td>
                        <td className="px-3 py-1.5">{r.invoiceCancelReason || "—"}</td>
                        <td className="px-3 py-1.5">
                          {r.currentlyInvoiced ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px]">Re-invoiced ({r.currentInvoiceNumber})</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px]">Not yet re-invoiced</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {cancelledInvoices.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No cancelled invoices</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* VAT */}
            {tab === "vat" && (
              <div className="max-w-lg space-y-3">
                <div className="bg-white border rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm flex items-center gap-2"><Percent size={16} className="text-purple-600" /> VAT Summary (Egypt)</div>
                    <div className="flex items-center gap-1 text-xs">
                      <span>Rate %</span>
                      <input
                        type="number"
                        value={vatRate}
                        onChange={(e) => setVatRate(parseFloat(e.target.value) || 0)}
                        className="w-14 border rounded px-1 py-0.5 text-right"
                      />
                    </div>
                  </div>
                  <div className="text-[12px] space-y-2">
                    <div className="flex justify-between"><span className="text-slate-500">Explicit service fees</span><span className="tabular-nums">{fmt(vatSummary.taxableFees)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Estimated taxable base</span><span className="tabular-nums">{fmt(vatSummary.outputBase)}</span></div>
                    <div className="flex justify-between font-semibold text-purple-700"><span>Output VAT</span><span className="tabular-nums">{fmt(vatSummary.outputVAT)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Input VAT (from supplier bills)</span><span className="tabular-nums">{fmt(vatSummary.inputVAT)}</span></div>
                    <div className="flex justify-between border-t pt-2 font-bold"><span>Net VAT Payable</span><span className="tabular-nums text-purple-700">{fmt(vatSummary.netVAT)}</span></div>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Estimate only: many air tickets are zero-rated or pass-through. Adjust rate and post final VAT via Journal Entries (2200 / 1300).
                  </p>
                </div>
              </div>
            )}

            {/* CHART OF ACCOUNTS */}
            {tab === "coa" && (
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b bg-slate-50 text-[11px] font-semibold">Chart of Accounts — Travel Agency</div>
                <div className="overflow-auto max-h-[calc(100vh-280px)]">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 text-slate-500 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-1.5">Code</th>
                        <th className="text-left px-3 py-1.5">Account</th>
                        <th className="text-left px-3 py-1.5">Type</th>
                        <th className="text-left px-3 py-1.5">Group</th>
                        <th className="text-right px-3 py-1.5">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coaBalances.map((a) => (
                        <tr key={a.code} className="border-t hover:bg-slate-50">
                          <td className="px-3 py-1.5 font-mono font-semibold text-slate-600">{a.code}</td>
                          <td className="px-3 py-1.5 font-medium">{a.name}</td>
                          <td className="px-3 py-1.5">
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100">{a.type}</span>
                          </td>
                          <td className="px-3 py-1.5 text-slate-500">{a.group}</td>
                          <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${a.balance >= 0 ? "text-slate-800" : "text-red-600"}`}>
                            {fmt(a.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* JOURNALS */}
            {tab === "journal" && (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <div className="text-[11px] text-slate-500">Manual double-entry journals (salaries, rent, adjustments…)</div>
                  <button
                    onClick={() => {
                      setJournalForm({
                        ...EMPTY_JOURNAL,
                        date: new Date().toISOString().slice(0, 10),
                        lines: [
                          { accountCode: "6000", accountName: "Salaries & Wages", debit: "", credit: "" },
                          { accountCode: "1000", accountName: "Cash on Hand", debit: "", credit: "" },
                        ],
                      });
                      setShowJournal(true);
                    }}
                    disabled={!canWrite}
                    title={!canWrite ? "View only — you don't have write access to this page" : undefined}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus size={12} /> New Journal
                  </button>
                </div>
                <div className="bg-white border rounded-xl overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-1.5">Date</th>
                        <th className="text-left px-3 py-1.5">Memo</th>
                        <th className="text-left px-3 py-1.5">Lines</th>
                        <th className="text-right px-3 py-1.5">Debit</th>
                        <th className="text-right px-3 py-1.5">Credit</th>
                        <th className="text-left px-3 py-1.5">By</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {journals
                        .slice()
                        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                        .map((j) => (
                          <tr key={j.id} className="border-t hover:bg-slate-50">
                            <td className="px-3 py-1.5 whitespace-nowrap">{j.date}</td>
                            <td className="px-3 py-1.5 font-medium">{j.memo}</td>
                            <td className="px-3 py-1.5 text-slate-500">
                              {(j.lines || []).map((l) => l.accountCode).join(", ")}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmt(j.totalDebit)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmt(j.totalCredit)}</td>
                            <td className="px-3 py-1.5 text-slate-400">{j.createdBy}</td>
                            <td className="px-2">
                              {canWrite && (
                                <button onClick={() => deleteJournal(j.id)} className="text-red-500 p-1"><Trash2 size={12} /></button>
                              )}
                            </td>
                          </tr>
                        ))}
                      {journals.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No journal entries</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SALESMAN */}
            {tab === "salesman" && (
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b bg-slate-50 text-[11px] font-semibold">Sales Team Performance</div>
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-1.5">Salesman</th>
                      <th className="text-right px-3 py-1.5">Docs</th>
                      <th className="text-right px-3 py-1.5">Sales</th>
                      <th className="text-right px-3 py-1.5">GP</th>
                      <th className="text-right px-3 py-1.5">Margin %</th>
                      <th className="text-right px-3 py-1.5">AR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bySalesman.map((s) => (
                      <tr key={s.name} className="border-t hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium">{s.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.count}</td>
                        <td className="px-3 py-2 text-right text-emerald-700 tabular-nums">{fmt(s.sales)}</td>
                        <td className={`px-3 py-2 text-right font-semibold tabular-nums ${s.profit >= 0 ? "text-teal-600" : "text-red-600"}`}>{fmt(s.profit)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.sales !== 0 ? ((s.profit / Math.abs(s.sales)) * 100).toFixed(1) : "0.0"}%</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${s.unpaid > 0 ? "text-amber-600 font-semibold" : "text-slate-400"}`}>{fmt(s.unpaid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* CURRENCY */}
            {tab === "currency" && (
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b bg-slate-50 text-[11px] font-semibold">
                  Multi-Currency (as booked)
                  <span className="font-normal text-slate-400"> — Sales/COS/AR in original currency; GP converted to EGP for comparability</span>
                </div>
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-1.5">Currency</th>
                      <th className="text-right px-3 py-1.5">Docs</th>
                      <th className="text-right px-3 py-1.5">Sales</th>
                      <th className="text-right px-3 py-1.5">COS</th>
                      <th className="text-right px-3 py-1.5">GP (EGP)</th>
                      <th className="text-right px-3 py-1.5">AR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCurrency.map((c) => (
                      <tr key={c.currency} className="border-t">
                        <td className="px-3 py-2 font-bold">{c.currency}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.count}</td>
                        <td className="px-3 py-2 text-right text-emerald-700 tabular-nums">{fmt(c.sales)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(c.cost)}</td>
                        <td className={`px-3 py-2 text-right font-semibold tabular-nums ${c.profit >= 0 ? "text-teal-600" : "text-red-600"}`}>{fmt(c.profit)}</td>
                        <td className="px-3 py-2 text-right text-amber-600 tabular-nums">{fmt(c.unpaid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* PRODUCTS */}
            {tab === "sections" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {bySection.map((s) => {
                  const Icon = sectionIcon(s.section);
                  const margin = s.sales !== 0 ? (s.profit / Math.abs(s.sales)) * 100 : 0;
                  return (
                    <div key={s.section} className="bg-white border rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="p-2 rounded-lg bg-blue-50"><Icon size={16} className="text-blue-600" /></span>
                        <div>
                          <div className="font-semibold text-sm">{s.section === "Flight" ? "Air Tickets" : s.section}</div>
                          <div className="text-[10px] text-slate-400">{s.count} docs · {margin.toFixed(1)}% margin</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-emerald-50 rounded-lg p-2 text-center">
                          <div className="text-[9px] text-emerald-600">SALES</div>
                          <div className="font-bold text-emerald-700 tabular-nums">{fmt(s.sales)}</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 text-center">
                          <div className="text-[9px] text-slate-500">COS</div>
                          <div className="font-bold tabular-nums">{fmt(s.cost)}</div>
                        </div>
                        <div className={`rounded-lg p-2 text-center ${s.profit >= 0 ? "bg-teal-50" : "bg-red-50"}`}>
                          <div className={`text-[9px] ${s.profit >= 0 ? "text-teal-600" : "text-red-600"}`}>GP</div>
                          <div className={`font-bold tabular-nums ${s.profit >= 0 ? "text-teal-700" : "text-red-600"}`}>{fmt(s.profit)}</div>
                        </div>
                        <div className="bg-amber-50 rounded-lg p-2 text-center">
                          <div className="text-[9px] text-amber-600">AR</div>
                          <div className="font-bold text-amber-700 tabular-nums">{fmt(s.unpaid)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* LEDGER */}
            {tab === "ledger" && (
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b bg-slate-50 text-[11px] font-semibold flex justify-between">
                  <span>Full Sales & Cost Ledger</span>
                  <span className="font-normal text-slate-400">{filtered.length} lines</span>
                </div>
                <div className="overflow-auto max-h-[calc(100vh-300px)]">
                  <table className="w-full text-[10px]">
                    <thead className="bg-slate-50 text-slate-500 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1.5">Date</th>
                        <th className="text-left px-2 py-1.5">Product</th>
                        <th className="text-left px-2 py-1.5">Client</th>
                        <th className="text-left px-2 py-1.5">Supplier</th>
                        <th className="text-left px-2 py-1.5">Salesman</th>
                        <th className="text-left px-2 py-1.5">Description</th>
                        <th className="text-left px-2 py-1.5">Invoice</th>
                        <th className="text-center px-2 py-1.5">Pay</th>
                        <th className="text-right px-2 py-1.5">COS</th>
                        <th className="text-right px-2 py-1.5">Sales</th>
                        <th className="text-right px-2 py-1.5">GP</th>
                        <th className="text-center px-2 py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.id} className={`border-t hover:bg-slate-50 ${r.isRefund ? "bg-amber-50/40" : r.isVoid ? "opacity-40" : ""}`}>
                          <td className="px-2 py-1 whitespace-nowrap">{r.date || "—"}</td>
                          <td className="px-2 py-1"><span className="px-1 py-0.5 rounded bg-slate-100 text-[9px] font-semibold">{r.section}</span></td>
                          <td className="px-2 py-1 truncate max-w-[80px]">{r.clientName || "—"}</td>
                          <td className="px-2 py-1 truncate max-w-[70px]">{r.supplierName || "—"}</td>
                          <td className="px-2 py-1 truncate max-w-[60px]">{r.salesman || "—"}</td>
                          <td className="px-2 py-1 truncate max-w-[110px]">{r.description}{r.isRefund && <span className="ml-1 text-amber-600 font-bold">CN</span>}</td>
                          <td className="px-2 py-1 font-mono">{r.ref || "—"}</td>
                          <td className="px-2 py-1 text-center text-[9px]">{r.isCC ? "CC" : "Cash"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmt(r.buy)}</td>
                          <td className={`px-2 py-1 text-right font-medium tabular-nums ${r.sell < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmt(r.sell)}</td>
                          <td className={`px-2 py-1 text-right font-semibold tabular-nums ${r.profit >= 0 ? "text-teal-600" : "text-red-600"}`}>{fmt(r.profit)}</td>
                          <td className="px-2 py-1 text-center text-[9px]">
                            {r.isVoid ? "Void" : !r.invoiceIssued ? "Open" : r.invoicePaid ? <span className="text-emerald-600 font-semibold">Paid</span> : <span className="text-amber-600 font-semibold">AR</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {filtered.length > 0 && (
                      <tfoot className="bg-slate-50 border-t-2 font-semibold text-[11px] sticky bottom-0">
                        <tr>
                          <td className="px-2 py-2" colSpan={8}>Total ({totals.count})</td>
                          <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.cost)}</td>
                          <td className="px-2 py-2 text-right text-emerald-700 tabular-nums">{fmt(totals.sales)}</td>
                          <td className={`px-2 py-2 text-right tabular-nums ${totals.profit >= 0 ? "text-teal-600" : "text-red-600"}`}>{fmt(totals.profit)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Journal modal */}
      {showJournal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-modal-backdrop" onClick={() => setShowJournal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-auto animate-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b font-semibold text-sm flex justify-between items-center">
              New Journal Entry
              <button onClick={() => setShowJournal(false)}><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-0.5">Date</div>
                  <input type="date" value={journalForm.date} onChange={(e) => setJournalForm({ ...journalForm, date: e.target.value })} className="w-full border rounded px-2 py-1" />
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 mb-0.5">Memo</div>
                  <input value={journalForm.memo} onChange={(e) => setJournalForm({ ...journalForm, memo: e.target.value })} className="w-full border rounded px-2 py-1" placeholder="e.g. Monthly rent" />
                </div>
              </div>
              <table className="w-full text-[11px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-1">Account</th>
                    <th className="text-right p-1 w-28">Debit</th>
                    <th className="text-right p-1 w-28">Credit</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {journalForm.lines.map((line, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-1">
                        <select
                          value={line.accountCode}
                          onChange={(e) => {
                            const lines = [...journalForm.lines];
                            const acc = CHART_OF_ACCOUNTS.find((a) => a.code === e.target.value);
                            lines[idx] = { ...lines[idx], accountCode: e.target.value, accountName: acc?.name || "" };
                            setJournalForm({ ...journalForm, lines });
                          }}
                          className="w-full border rounded px-1 py-1"
                        >
                          {CHART_OF_ACCOUNTS.map((a) => (
                            <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-1">
                        <input
                          value={line.debit}
                          onChange={(e) => {
                            const lines = [...journalForm.lines];
                            lines[idx] = { ...lines[idx], debit: e.target.value, credit: e.target.value ? "" : lines[idx].credit };
                            setJournalForm({ ...journalForm, lines });
                          }}
                          className="w-full border rounded px-1 py-1 text-right"
                        />
                      </td>
                      <td className="p-1">
                        <input
                          value={line.credit}
                          onChange={(e) => {
                            const lines = [...journalForm.lines];
                            lines[idx] = { ...lines[idx], credit: e.target.value, debit: e.target.value ? "" : lines[idx].debit };
                            setJournalForm({ ...journalForm, lines });
                          }}
                          className="w-full border rounded px-1 py-1 text-right"
                        />
                      </td>
                      <td className="p-1">
                        {journalForm.lines.length > 2 && (
                          <button
                            onClick={() =>
                              setJournalForm({
                                ...journalForm,
                                lines: journalForm.lines.filter((_, i) => i !== idx),
                              })
                            }
                            className="text-red-500"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold">
                    <td className="p-1">
                      <button
                        onClick={() =>
                          setJournalForm({
                            ...journalForm,
                            lines: [
                              ...journalForm.lines,
                              { accountCode: "6900", accountName: "General & Administrative", debit: "", credit: "" },
                            ],
                          })
                        }
                        className="text-blue-600 text-[10px]"
                      >
                        + Add line
                      </button>
                    </td>
                    <td className={`p-1 text-right tabular-nums ${journalTotals.balanced ? "text-emerald-600" : "text-red-600"}`}>
                      {fmt(journalTotals.debit)}
                    </td>
                    <td className={`p-1 text-right tabular-nums ${journalTotals.balanced ? "text-emerald-600" : "text-red-600"}`}>
                      {fmt(journalTotals.credit)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
              {!journalTotals.balanced && (
                <div className="text-red-600 text-[10px]">Debit and Credit must be equal before posting.</div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowJournal(false)} className="px-3 py-1.5 border rounded">Cancel</button>
                <button
                  onClick={saveJournal}
                  disabled={!canWrite || journalSaving || !journalTotals.balanced}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-50 inline-flex items-center gap-1"
                >
                  <Save size={12} /> {journalSaving ? "Saving…" : "Post Entry"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bank modal */}
      {showBank && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-modal-backdrop" onClick={() => setShowBank(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b font-semibold text-sm flex justify-between">
              Bank Movement
              <button onClick={() => setShowBank(false)}><X size={16} /></button>
            </div>
            <div className="p-4 space-y-2 text-xs">
              <div>
                <div className="text-[10px] font-semibold text-slate-500">Date</div>
                <input type="date" value={bankForm.date} onChange={(e) => setBankForm({ ...bankForm, date: e.target.value })} className="w-full border rounded px-2 py-1" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500">Type</div>
                  <select value={bankForm.type} onChange={(e) => setBankForm({ ...bankForm, type: e.target.value })} className="w-full border rounded px-2 py-1">
                    <option value="in">Deposit / In</option>
                    <option value="out">Payment / Out</option>
                  </select>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500">Account</div>
                  <select value={bankForm.account} onChange={(e) => setBankForm({ ...bankForm, account: e.target.value })} className="w-full border rounded px-2 py-1">
                    <option value="1000">1000 Cash</option>
                    <option value="1010">1010 Bank EGP</option>
                    <option value="1020">1020 Bank USD</option>
                    <option value="1030">1030 Bank EUR</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500">Amount</div>
                  <input value={bankForm.amount} onChange={(e) => setBankForm({ ...bankForm, amount: e.target.value })} className="w-full border rounded px-2 py-1 text-right" />
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500">Currency</div>
                  <select value={bankForm.currency} onChange={(e) => setBankForm({ ...bankForm, currency: e.target.value })} className="w-full border rounded px-2 py-1">
                    <option value="EGP">EGP</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-500">Contra Account (other side of the entry)</div>
                <select value={bankForm.contraAccount} onChange={(e) => setBankForm({ ...bankForm, contraAccount: e.target.value })} className="w-full border rounded px-2 py-1">
                  {CHART_OF_ACCOUNTS.filter((a) => a.code !== bankForm.account).map((a) => (
                    <option key={a.code} value={a.code}>{a.code} {a.name}</option>
                  ))}
                </select>
                <p className="text-[9px] text-slate-400 mt-0.5">
                  What this movement is for — e.g. client payment received ({bankForm.type === "in" ? "Accounts Receivable" : "Accounts Payable"} is usually right), a bank charge, a transfer, etc.
                </p>
              </div>
              {bankForm.contraAccount === AP_ACCOUNT && (
                <div>
                  <div className="text-[10px] font-semibold text-slate-500">Supplier (so this payment counts toward their AP balance)</div>
                  <select
                    value={bankForm.supplierCode || bankForm.supplierName || ""}
                    onChange={(e) => {
                      const sup = allSuppliersList.find((s) => (s.code || s.name) === e.target.value);
                      setBankForm({ ...bankForm, supplierCode: sup?.code || "", supplierName: sup?.name || "" });
                    }}
                    className="w-full border rounded px-2 py-1"
                  >
                    <option value="">— Not tagged (won&apos;t reduce a specific supplier&apos;s Outstanding) —</option>
                    {allSuppliersList.map((s) => (
                      <option key={s.code || s.name} value={s.code || s.name}>{s.code ? `${s.code} — ${s.name}` : s.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <div className="text-[10px] font-semibold text-slate-500">Memo</div>
                <input value={bankForm.memo} onChange={(e) => setBankForm({ ...bankForm, memo: e.target.value })} className="w-full border rounded px-2 py-1" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowBank(false)} className="px-3 py-1.5 border rounded">Cancel</button>
                <button onClick={saveBankLine} disabled={!canWrite} className="px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-50">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Client / Supplier statement */}
      {statementFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-modal-backdrop" onClick={() => setStatementFor(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col animate-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b font-semibold text-sm flex justify-between items-center flex-shrink-0">
              <span className="flex items-center gap-2">
                {statementFor.kind === "client" ? <Users size={16} className="text-blue-600" /> : <Building2 size={16} className="text-blue-600" />}
                {statementFor.name}
                <span className="text-[10px] font-mono text-slate-400">{statementFor.code}</span>
              </span>
              <button onClick={() => setStatementFor(null)}><X size={16} /></button>
            </div>
            <div className="px-4 py-2 border-b bg-slate-50 flex justify-between items-center text-[11px] flex-shrink-0">
              <span className="text-slate-500">
                {statementFor.kind === "client" ? "Statement of Account — Outstanding AR" : "Statement of Account — Outstanding AP"}
                {(dateFrom || dateTo) && ` · ${dateFrom || "…"} → ${dateTo || "…"}`}
              </span>
              <span className={`font-bold tabular-nums ${statementRows.length && statementRows[statementRows.length - 1].running !== 0 ? (statementFor.kind === "client" ? "text-amber-600" : "text-orange-600") : "text-slate-400"}`}>
                Balance: {fmt(statementRows.length ? statementRows[statementRows.length - 1].running : 0)}
              </span>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-[11px]">
                <thead className="bg-slate-50 text-slate-500 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-1.5">Date</th>
                    <th className="text-left px-3 py-1.5">Description</th>
                    <th className="text-left px-3 py-1.5">Ref</th>
                    <th className="text-left px-3 py-1.5">Status</th>
                    <th className="text-right px-3 py-1.5">Debit</th>
                    <th className="text-right px-3 py-1.5">Credit</th>
                    <th className="text-right px-3 py-1.5">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statementRows.map((r, i) => (
                    <tr key={i} className="border-t hover:bg-slate-50">
                      <td className="px-3 py-1.5 whitespace-nowrap">{r.date || "—"}</td>
                      <td className="px-3 py-1.5 truncate max-w-[220px]">{r.description}</td>
                      <td className="px-3 py-1.5 font-mono text-[10px]">{r.ref || "—"}</td>
                      <td className="px-3 py-1.5">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                          r.statementLabel === "Payment" || r.statementLabel === "Paid"
                            ? "bg-emerald-50 text-emerald-700"
                            : r.statementLabel === "Credit Note" || r.statementLabel === "Supplier Credit"
                              ? "bg-amber-50 text-amber-700"
                              : r.statementLabel === "Not Invoiced"
                                ? "bg-slate-100 text-slate-500"
                                : "bg-blue-50 text-blue-700"
                        }`}>
                          {r.statementLabel}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.debit ? fmt(r.debit) : "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.credit ? fmt(r.credit) : "—"}</td>
                      <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${r.running >= 0 ? "text-slate-800" : "text-red-600"}`}>{fmt(r.running)}</td>
                    </tr>
                  ))}
                  {statementRows.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No transactions in this period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t text-[10px] text-slate-400 flex-shrink-0">
              {statementFor.kind === "client"
                ? "Balance = amounts invoiced and still unpaid. A credit note reduces what was collected once paid back, but — same as the Invoices page — never reduces this balance itself, since it doesn't increase what the client owes either."
                : "Balance = purchases not yet matched by a tagged Bank Book payment. Untagged bank payments (no supplier selected) don't appear here even though they do reduce the account's real cash balance."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
