"use client";

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import Navbar from "@/components/Navbar";
import AssignToFileButton from "@/components/AssignToFileButton";
import InvoiceIssueModal from "@/components/InvoiceIssueModal";
import SectionStats from "@/components/SectionStats";
import { useAuth } from "@/lib/auth";
import { canWriteModule } from "@/lib/permissions";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { fetchExchangeRateToEGP, getTransportationTotals, generateRegNumber, peekNextRegNumber, isBranchVisible, isRecordVisible, openPrintWindow, bookingQuery } from "@/lib/helpers";
import { useClosedFiscalYearKeys, isRowClosed } from "@/lib/fiscalYear";
import toast from "react-hot-toast";
import {
  Plus, Pencil, Trash2, Search, ChevronFirst, ChevronLast,
  ChevronLeft, ChevronRight, Save, X, FileText, RefreshCw, DollarSign, TrendingUp, TrendingDown, Briefcase, Printer, LogOut,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

const EMPTY_PASSENGER = { name: "", type: "ADT", phone: "" };

const EMPTY_FORM = {
  clientCode: "30.00.00.0000",
  clientName: "",
  supplierCode: "50.00.00.0000",
  supplierName: "",
  serviceType: "Airport Transfer",
  vehicleType: "Sedan",
  vehicleNr: "",
  driverName: "",
  driverPhone: "",
  pickupLocation: "",
  dropoffLocation: "",
  pickupDate: "",
  pickupTime: "",
  returnDate: "",
  returnTime: "",
  isRoundTrip: false,
  flightNr: "",
  confirmationNr: "",
  referenceNr: "",
  adt: 1,
  chd: 0,
  inf: 0,
  pax: 1,
  passengers: [{ ...EMPTY_PASSENGER }],
  buyCurrency: "EGP",
  sellCurrency: "EGP",
  currency: "EGP",
  // EGP value of 1 unit of each side's currency, captured independently
  // (buy and sell can be in different foreign currencies) once at booking
  // time and locked forever after the first save (see `rateLocked` logic).
  // `exchangeRate` is kept in sync with sellExchangeRate for backward
  // compatibility with older code/data that only knew one shared rate.
  buyExchangeRate: 1,
  sellExchangeRate: 1,
  exchangeRate: 1,
  buyPrice: "",
  sellPrice: "",
  serviceFee: "",
  status: "Confirmed",
  branch: "1",
  salesman: "",
  salesmanName: "",
  issueDate: new Date().toISOString().slice(0, 10),
  remarks: "",
  paymentMethod: "Cash",
  isCash: true,
  isCC: false,
  invoiceNumber: "",
  numberPrefix: "",
  sequentialNumber: 0,
  invoiceIssued: false,
  invoicePaid: false,
};

const SERVICE_TYPES = [
  "Airport Transfer",
  "Private Transfer",
  "Group Transfer",
  "Intercity",
  "City Tour",
  "Hourly Hire",
  "Meet & Greet",
  "Other",
];
const VEHICLE_TYPES = [
  "Sedan",
  "SUV",
  "Van",
  "Minibus",
  "Bus",
  "Luxury",
  "Economy",
  "Coach",
];
const STATUSES = ["Confirmed", "Cancelled"];

function parseNum(v) {
  if (v === "" || v === null || v === undefined) return 0;
  return parseFloat(String(v).replace(/,/g, "")) || 0;
}
function fmt(v) {
  return Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TransportationPage() {
  const { user, userData, hasPermission, activeBranch, myBranches, branchesList, appFeatures } = useAuth();
  const isAdmin = hasPermission ? hasPermission(["Admin"]) : userData?.role === "Admin";
  const canWrite = canWriteModule(userData, "transportation", isAdmin, appFeatures);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [items, setItems] = useState([]);
  const [clients, setClients] = useState([]);
  const [corporates, setCorporates] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState("list");
  const [mode, setMode] = useState("view");
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [showSupplierPicker, setShowSupplierPicker] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const listRef = useRef(null);

  // Auto-scroll to the bottom (newest record) once the list has loaded, or
  // whenever we come back to the list tab — not on every keystroke of a
  // search, so it doesn't yank the view away while filtering.
  useLayoutEffect(() => {
    if (!loading && activeTab === "list" && listRef.current) {
      // Set synchronously before the browser paints — lands already at the
      // bottom with no visible scroll motion.
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [loading, activeTab]);

  const isEditing = mode === "add" || mode === "edit";

  const closedYearKeys = useClosedFiscalYearKeys();
  const closedYearKeysToken = useMemo(() => [...closedYearKeys].sort().join(","), [closedYearKeys]);

  useEffect(() => {
    const unsubT = onSnapshot(bookingQuery("transportation", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (snap) => {
      let data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      data = data.filter((row) => isRecordVisible(row, { isAdmin, activeBranch, myBranches, restrictOwn: !!userData?.onlyOwnData, userName: userData?.name, userUid: user?.uid }));
      data = data.filter((row) => !isRowClosed(row, closedYearKeys, "issueDate"));
      data.sort((a, b) => {
        const ta = a.createdAt?.toDate?.() || a.createdAt || 0;
        const tb = b.createdAt?.toDate?.() || b.createdAt || 0;
        return new Date(ta) - new Date(tb); // oldest first, most recent record last
      });
      setItems(data);
      setLoading(false);
    }, () => setLoading(false));

    const unsubC = onSnapshot(collection(db, "clients"), (snap) => {
      setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubCorp = onSnapshot(collection(db, "corporates"), (snap) => {
      setCorporates(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubS = onSnapshot(collection(db, "suppliers"), (snap) => {
      setSuppliers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubT(); unsubC(); unsubCorp(); unsubS(); };
  }, [isAdmin, activeBranch, JSON.stringify(myBranches), closedYearKeysToken]);

  const hydrateForm = useCallback((row) => {
    setForm({
      ...EMPTY_FORM,
      ...row,
      passengers: row.passengers?.length
        ? row.passengers.map((p) => ({ ...EMPTY_PASSENGER, ...p }))
        : [{ ...EMPTY_PASSENGER }],
      buyPrice: row.buyPrice !== undefined && row.buyPrice !== "" ? String(row.buyPrice) : "",
      sellPrice: row.sellPrice !== undefined && row.sellPrice !== "" ? String(row.sellPrice) : "",
      serviceFee: row.serviceFee !== undefined && row.serviceFee !== "" ? String(row.serviceFee) : "",
      isRoundTrip: !!row.isRoundTrip,
      // Never re-fetched — whatever rate was saved on this booking stays.
      buyExchangeRate: row.buyExchangeRate || row.exchangeRate || 1,
      sellExchangeRate: row.sellExchangeRate || row.exchangeRate || 1,
      exchangeRate: row.exchangeRate || 1,
    });
  }, []);

  // Auto-fill the exchange rate from a live rate ONLY while creating a brand
  // new booking (mode === "add"). Once saved once, hydrateForm always
  // reloads the rate that was actually stored on the document instead, so a
  // booking's rate never silently changes later.
  const [fetchingBuyRate, setFetchingBuyRate] = useState(false);
  const [fetchingSellRate, setFetchingSellRate] = useState(false);
  useEffect(() => {
    if (mode !== "add" || form.buyCurrency === "EGP") return;
    let cancelled = false;
    setFetchingBuyRate(true);
    fetchExchangeRateToEGP(form.buyCurrency).then((rate) => {
      if (cancelled || rate === null) return;
      setForm((f) => (f.buyCurrency === form.buyCurrency ? { ...f, buyExchangeRate: rate } : f));
    }).finally(() => !cancelled && setFetchingBuyRate(false));
    return () => { cancelled = true; };
  }, [mode, form.buyCurrency]);
  useEffect(() => {
    if (mode !== "add" || form.sellCurrency === "EGP") return;
    let cancelled = false;
    setFetchingSellRate(true);
    fetchExchangeRateToEGP(form.sellCurrency).then((rate) => {
      if (cancelled || rate === null) return;
      setForm((f) => (f.sellCurrency === form.sellCurrency ? { ...f, sellExchangeRate: rate, exchangeRate: rate } : f));
    }).finally(() => !cancelled && setFetchingSellRate(false));
    return () => { cancelled = true; };
  }, [mode, form.sellCurrency]);
  const fetchingRate = fetchingBuyRate || fetchingSellRate;

  // Only editable while the booking is still being created — permanently
  // read-only once it exists in the database (mode === "edit").
  const rateLocked = mode === "edit";

  useEffect(() => {
    if (items.length && currentIndex < 0 && mode === "view" && activeTab === "list") {
      setCurrentIndex(0);
      setSelected(items[0]);
    }
  }, [items, currentIndex, mode, activeTab]);

  // Open specific booking from ?open= id (from Invoices → Unlock)
  useEffect(() => {
    const openId = searchParams?.get("open");
    if (!openId || items.length === 0) return;
    const found = items.find((t) => t.id === openId);
    if (found) {
      const idx = items.findIndex((t) => t.id === openId);
      setSelected(found);
      setCurrentIndex(idx >= 0 ? idx : 0);
      hydrateForm(found);
      setActiveTab("details");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [items, searchParams, hydrateForm]);

  const filtered = items.filter((h) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (h.clientName || "").toLowerCase().includes(s) ||
      (h.clientCode || "").toLowerCase().includes(s) ||
      (h.pickupLocation || "").toLowerCase().includes(s) ||
      (h.dropoffLocation || "").toLowerCase().includes(s) ||
      (h.serviceType || "").toLowerCase().includes(s) ||
      (h.vehicleType || "").toLowerCase().includes(s) ||
      (h.confirmationNr || "").toLowerCase().includes(s) ||
      (h.invoiceNumber || "").toLowerCase().includes(s) ||
      (h.supplierName || "").toLowerCase().includes(s) ||
      (h.driverName || "").toLowerCase().includes(s) ||
      (h.passengers || []).some((p) => (p.name || "").toLowerCase().includes(s))
    );
  });

  const openDetails = (row, index) => {
    setSelected(row);
    setCurrentIndex(index);
    hydrateForm(row);
    setMode("view");
    setActiveTab("details");
  };

  const goFirst = () => { if (filtered.length) openDetails(filtered[0], 0); };
  const goPrev = () => { if (currentIndex > 0) openDetails(filtered[currentIndex - 1], currentIndex - 1); };
  const goNext = () => { if (currentIndex < filtered.length - 1) openDetails(filtered[currentIndex + 1], currentIndex + 1); };
  const goLast = () => { if (filtered.length) openDetails(filtered[filtered.length - 1], filtered.length - 1); };

  const startAdd = async () => {
    const salesmanCode = userData?.name?.split(" ").map((w) => w[0]).join("").toUpperCase() || "";
    const defaultBranch = activeBranch && activeBranch !== "ALL" ? activeBranch : (myBranches[0] || branchesList[0]?.code || "1");
    setMode("add");
    setSelected(null);
    setForm({
      ...EMPTY_FORM,
      branch: defaultBranch,
      salesman: salesmanCode,
      salesmanName: userData?.name || "",
      issueDate: new Date().toISOString().slice(0, 10),
      passengers: [{ ...EMPTY_PASSENGER }],
    });
    setActiveTab("details");
    // Show a PREVIEW of the next Reg Nr immediately, without reserving it —
    // the real number is only assigned (and the sequence advanced) when the
    // booking is actually saved, so cancelling never leaves a gap.
    try {
      const regNr = await peekNextRegNumber("transportation", "T", defaultBranch);
      setForm((prev) => (prev.regNr ? prev : { ...prev, regNr }));
    } catch {}
  };

  // Refresh the Reg Nr preview when the branch changes while adding, since
  // Reg Nr sequences are scoped per branch (still just a preview — nothing
  // is reserved until save).
  const handleAddBranchChange = async (newBranch) => {
    setForm((prev) => ({ ...prev, branch: newBranch, regNr: "" }));
    try {
      const regNr = await peekNextRegNumber("transportation", "T", newBranch);
      setForm((prev) => (prev.branch === newBranch ? { ...prev, regNr } : prev));
    } catch {}
  };

  const startEdit = () => {
    if (!selected) return;
    if (selected.invoiceIssued && !isAdmin && !selected.editUnlocked) {
      toast.error("Locked — invoice already issued");
      return;
    }
    setMode("edit");
    hydrateForm(selected);
    setActiveTab("details");
  };

  const cancelEdit = () => {
    setMode("view");
    if (selected) hydrateForm(selected);
    else setForm(EMPTY_FORM);
    setActiveTab("list");
  };

  const syncPassengers = (adt, chd, inf, prev = form.passengers) => {
    const total = Math.max(1, (parseInt(adt) || 0) + (parseInt(chd) || 0) + (parseInt(inf) || 0));
    return Array.from({ length: total }, (_, i) => {
      const type =
        i < (parseInt(adt) || 0)
          ? "ADT"
          : i < (parseInt(adt) || 0) + (parseInt(chd) || 0)
            ? "CHD"
            : "INF";
      if (prev[i]) return { ...prev[i], type };
      return { ...EMPTY_PASSENGER, type };
    });
  };

  const setPax = (field, n) => {
    n = Math.max(0, parseInt(n) || 0);
    if (field === "adt" && n < 1) n = 1;
    const adt = field === "adt" ? n : form.adt;
    const chd = field === "chd" ? n : form.chd;
    const inf = field === "inf" ? n : form.inf;
    setForm({
      ...form,
      adt,
      chd,
      inf,
      pax: adt + chd + inf,
      passengers: syncPassengers(adt, chd, inf),
    });
  };

  const profit = parseNum(form.sellPrice) - parseNum(form.buyPrice);
  const foreignCurrency = form.sellCurrency !== "EGP" ? form.sellCurrency : form.buyCurrency !== "EGP" ? form.buyCurrency : null;
  const buyRate = parseNum(form.buyExchangeRate) || 1;
  const sellRate = parseNum(form.sellExchangeRate) || 1;
  const sellEGP = form.sellCurrency !== "EGP" ? parseNum(form.sellPrice) * sellRate : null;
  const buyEGP = form.buyCurrency !== "EGP" ? parseNum(form.buyPrice) * buyRate : null;
  const profitEGP = (sellEGP ?? parseNum(form.sellPrice)) - (buyEGP ?? parseNum(form.buyPrice));

  const handleSave = async () => {
    try {
      if (!form.pickupLocation && !form.dropoffLocation) {
        toast.error("Pickup or dropoff location is required");
        return;
      }
      const payload = {
        ...form,
        adt: parseInt(form.adt) || 1,
        chd: parseInt(form.chd) || 0,
        inf: parseInt(form.inf) || 0,
        pax: (parseInt(form.adt) || 1) + (parseInt(form.chd) || 0) + (parseInt(form.inf) || 0),
        buyPrice: parseNum(form.buyPrice),
        sellPrice: parseNum(form.sellPrice),
        serviceFee: parseNum(form.serviceFee),
        totalBuy: parseNum(form.buyPrice),
        totalSell: parseNum(form.sellPrice),
        totalProfit: profit,
        passengers: form.passengers || [],
        isRoundTrip: !!form.isRoundTrip,
        updatedAt: serverTimestamp(),
      };
      delete payload.id;
      // Exchange rates are fixed the moment a booking is first created and
      // must never be touched again on subsequent edits.
      if (mode === "edit" && selected) {
        payload.buyExchangeRate = selected.buyExchangeRate || selected.exchangeRate || 1;
        payload.sellExchangeRate = selected.sellExchangeRate || selected.exchangeRate || 1;
        payload.exchangeRate = selected.exchangeRate || 1;
        // An admin unlock is a one-time grant, not a permanent state — clear
        // it on save so the booking re-locks, same as Flights.
        payload.editUnlocked = false;
        payload.editUnlockedBy = null;
        payload.editUnlockedAt = null;
      } else {
        payload.buyExchangeRate = parseNum(form.buyExchangeRate) || 1;
        payload.sellExchangeRate = parseNum(form.sellExchangeRate) || 1;
        payload.exchangeRate = parseNum(form.exchangeRate) || 1;
      }

      if (mode === "add") {
        payload.createdAt = serverTimestamp();
        payload.invoiceIssued = false;
        payload.invoiceNumber = "";
        // Immutable owner of this booking. Read by the "Only see own
        // work" permission both in the UI and in the Firestore rules,
        // which is why it is written once here on create and never
        // sent again on an update.
        payload.salesmanUid = user?.uid || "";
        payload.salesmanName = payload.salesmanName || userData?.name || "";
        payload.regNr = await generateRegNumber("transportation", "T", form.branch);
        const ref = await addDoc(collection(db, "transportation"), payload);
        toast.success("Transportation booking saved");
        setMode("view");
        setSelected({ id: ref.id, ...payload });
        setActiveTab("list");
      } else if (mode === "edit" && selected?.id) {
        await updateDoc(doc(db, "transportation", selected.id), payload);
        toast.success("Transportation booking updated");
        setMode("view");
        setSelected({ ...selected, ...payload });
        setActiveTab("list");
      }
    } catch (e) {
      console.error(e);
      toast.error("Save failed: " + (e.message || ""));
    }
  };

  const handleDelete = async () => {
    if (!selected?.id) return;
    if (selected.invoiceIssued) {
      toast.error("Cannot delete — invoice already issued");
      return;
    }
    if (!confirm("Delete this transportation booking?")) return;
    try {
      await deleteDoc(doc(db, "transportation", selected.id));
      toast.success("Deleted");
      setSelected(null);
      setCurrentIndex(-1);
      setForm(EMPTY_FORM);
      setActiveTab("list");
      setMode("view");
    } catch (e) {
      toast.error("Delete failed: " + (e.message || ""));
    }
  };

  const handlePrint = () => {
    if (!selected) return;
    const passengers = selected.passengers || [];
    const paxRows = passengers.length
      ? passengers.map((p, i) => `<tr><td>${i + 1}</td><td>${p.name || ""}</td><td>${p.type || ""}</td><td>${p.phone || ""}</td></tr>`).join("")
      : `<tr><td colspan="4" style="text-align:center;color:#94a3b8">-</td></tr>`;
    const body = `
      <h2>${selected.serviceType || "Transportation"}</h2>
      <div class="sub">Reg Nr ${selected.regNr || "-"} ${selected.invoiceNumber ? "· Invoice " + selected.invoiceNumber : ""}</div>
      <div class="grid2">
        <div><span class="lbl">Client</span><br/>${selected.clientName || "-"}</div>
        <div><span class="lbl">Supplier</span><br/>${selected.supplierName || "-"}</div>
        <div><span class="lbl">Pickup → Dropoff</span><br/>${selected.pickupLocation || "-"} → ${selected.dropoffLocation || "-"}</div>
        <div><span class="lbl">Date / Time</span><br/>${selected.pickupDate || "-"} ${selected.pickupTime || ""}</div>
        <div><span class="lbl">Vehicle</span><br/>${selected.vehicleType || "-"} ${selected.vehicleNr || ""}</div>
        <div><span class="lbl">Driver</span><br/>${selected.driverName || "-"} ${selected.driverPhone || ""}</div>
      </div>
      <table><thead><tr><th>#</th><th>Passenger Name</th><th>Type</th><th>Phone</th></tr></thead><tbody>${paxRows}</tbody></table>
    `;
    openPrintWindow(`${selected.serviceType || "Transportation"} - ${selected.regNr || ""}`, body);
  };

  // Opens the invoice document screen instead of stamping a number straight
  // onto this one booking — from there the user can add the client's other
  // open transportation services onto the SAME invoice (see InvoiceIssueModal).
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);

  const handleIssueInvoice = () => {
    if (!selected?.id) return;
    if (selected.invoiceIssued) {
      toast.error("Invoice already issued: " + (selected.invoiceNumber || ""));
      return;
    }
    setInvoiceModalOpen(true);
  };

  const handleInvoiceIssued = (inv) => {
    setSelected((prev) =>
      prev ? { ...prev, invoiceIssued: true, invoiceNumber: inv.fullNumber } : prev
    );
    setForm((prev) => ({ ...prev, invoiceIssued: true, invoiceNumber: inv.fullNumber }));
  };

  // Clients and Corporates share the "Client" field across bookings
  // (Corporates use the 30.01.00.XXXX sub-range), so the picker searches
  // both together.
  const clientAndCorporateOptions = useMemo(
    () => [
      ...clients.map((c) => ({ ...c, kind: "client" })),
      ...corporates.map((c) => ({ ...c, kind: "corporate" })),
    ],
    [clients, corporates]
  );

  const filteredClients = clientAndCorporateOptions.filter((c) => {
    if (!clientSearch) return true;
    const s = clientSearch.toLowerCase();
    return (c.code || "").toLowerCase().includes(s) || (c.name || "").toLowerCase().includes(s);
  });
  const filteredSuppliers = suppliers.filter((s) => {
    if (!supplierSearch) return true;
    const q = supplierSearch.toLowerCase();
    return (
      (s.code || "").toLowerCase().includes(q) ||
      (s.name || "").toLowerCase().includes(q) ||
      (s.symbol || "").toLowerCase().includes(q)
    );
  });

  const inputCls =
    "w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500";
  const labelCls = "text-[10px] font-semibold text-slate-500 uppercase tracking-wide";

  const statusColor = (status) => {
    const s = String(status || "").toLowerCase();
    if (s === "confirmed" || s === "completed" || s === "assigned")
      return "bg-green-50 text-green-700 border-green-200";
    if (s === "pending" || s === "in progress")
      return "bg-amber-50 text-amber-700 border-amber-200";
    if (s.includes("cancel") || s === "no-show")
      return "bg-red-50 text-red-600 border-red-200";
    return "bg-slate-50 text-slate-600 border-slate-200";
  };

  // Section header dashboard — Sales / Cost / Profit / Bookings across
  // every transportation booking currently loaded.
  const sectionStats = useMemo(() => {
    let totalSell = 0, totalBuy = 0, totalProfit = 0;
    items.forEach((row) => {
      const t = getTransportationTotals(row);
      totalSell += t.totalSell;
      totalBuy += t.totalBuy;
      totalProfit += t.totalProfit;
    });
    return [
      { label: "Total Sales", value: totalSell.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), suffix: " EGP", icon: DollarSign, color: "bg-emerald-600" },
      { label: "Total Cost", value: totalBuy.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), suffix: " EGP", icon: TrendingDown, color: "bg-slate-500" },
      {
        label: "Net Profit",
        value: totalProfit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        suffix: " EGP",
        icon: TrendingUp,
        color: totalProfit >= 0 ? "bg-teal-600" : "bg-red-500",
        valueClass: totalProfit >= 0 ? "text-teal-700" : "text-red-600",
      },
      { label: "Total Bookings", value: items.length.toLocaleString("en-US"), icon: Briefcase, color: "bg-indigo-500" },
    ];
  }, [items]);

  return (
    <div className="flex flex-col h-[calc(100vh-0px)]">
      <Navbar title={"Transportation" || "Transportation"} />
      <SectionStats stats={sectionStats} />

      <div className="bg-white border-b px-3 py-1.5 flex flex-wrap items-center gap-1.5 text-xs">
        <button onClick={goFirst} className="tb-btn" title="First"><ChevronFirst size={14} /></button>
        <button onClick={goPrev} className="tb-btn" title="Prior"><ChevronLeft size={14} /></button>
        <button onClick={goNext} className="tb-btn" title="Next"><ChevronRight size={14} /></button>
        <button onClick={goLast} className="tb-btn" title="Last"><ChevronLast size={14} /></button>
        <div className="w-px h-5 bg-slate-200 mx-1" />
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-6 pr-2 py-1 border border-slate-300 rounded text-xs w-40 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="w-px h-5 bg-slate-200 mx-1" />
        <button onClick={startAdd} disabled={!canWrite} className="tb-btn-blue" title={!canWrite ? "View only — you don't have write access to this page" : undefined}><Plus size={14} /> New</button>
        <button onClick={startEdit} disabled={!canWrite || !selected || isEditing} className="tb-btn" title={!canWrite ? "View only — you don't have write access to this page" : undefined}><Pencil size={14} /> Edit</button>
        <button onClick={handleDelete} disabled={!selected || isEditing || selected?.invoiceIssued || !isAdmin} className="tb-btn text-red-600" title={!isAdmin ? "Admin / General Manager only" : undefined}><Trash2 size={14} /> Delete</button>
        {isEditing && (
          <>
            <button onClick={handleSave} className="tb-btn-blue"><Save size={14} /> Save</button>
            <button onClick={cancelEdit} className="tb-btn"><X size={14} /> Cancel</button>
          </>
        )}
        <div className="ml-auto text-[11px] text-slate-500">
          {filtered.length ? `${Math.min(currentIndex + 1, filtered.length)} / ${filtered.length}` : "0 / 0"}
        </div>
        <div className="w-px h-5 bg-slate-200 mx-1" />
        <button onClick={cancelEdit} className="tb-btn" title="Exit — back to the list"><LogOut size={14} /> Exit</button>
      </div>

      {/* ACTION BAR */}
      {!isEditing && (
        <div className="bg-slate-50 border-b border-slate-200 px-3 py-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <AssignToFileButton type="transportation" row={selected} disabled={!selected} />
          {selected && (
            <button onClick={handlePrint} className="tb-btn" title="Print"><Printer size={14} /> Print</button>
          )}
          {selected && !selected.invoiceIssued && (
            <button onClick={handleIssueInvoice} className="tb-btn"><FileText size={14} /> Invoice</button>
          )}
        </div>
      )}

      <div className="bg-white border-b px-3 flex gap-0 text-xs">
        {["list", "details"].map((tab) => (
          <button
            key={tab}
            onClick={() => !isEditing && setActiveTab(tab)}
            className={`px-4 py-2 font-medium border-b-2 capitalize ${
              activeTab === tab || (isEditing && tab === "details")
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto bg-slate-50">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {activeTab === "list" && !isEditing && (
              <div className="p-2">
                <div ref={listRef} className="bg-white border border-slate-300 rounded overflow-auto" style={{ height: "calc(100vh - 200px)", minHeight: "260px" }}>
                  <table className="w-full text-[10px] border-collapse">
                    <thead className="bg-slate-100 sticky top-0 z-10">
                      <tr>
                        <th className="th border border-slate-300">Reg Nr</th>
                        <th className="th border border-slate-300">Invoice</th>
                        <th className="th border border-slate-300">Client</th>
                        <th className="th border border-slate-300">Service</th>
                        <th className="th border border-slate-300">Vehicle</th>
                        <th className="th border border-slate-300">Pickup</th>
                        <th className="th border border-slate-300">Dropoff</th>
                        <th className="th border border-slate-300">Date</th>
                        <th className="th border border-slate-300">Time</th>
                        <th className="th text-center border border-slate-300">Pax</th>
                        <th className="th border border-slate-300">Driver</th>
                        <th className="th text-right border border-slate-300">Buy</th>
                        <th className="th text-right border border-slate-300">Sell</th>
                        <th className="th text-right border border-slate-300">Profit</th>
                        <th className="th text-center border border-slate-300">Status</th>
                        <th className="th border border-slate-300">Supplier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={16} className="px-4 py-10 text-center text-gray-400">
                            No records. Click New to create.
                          </td>
                        </tr>
                      ) : (
                        filtered.map((h, idx) => {
                          const hTotals = getTransportationTotals(h);
                          const buy = hTotals.totalBuy;
                          const sell = hTotals.totalSell;
                          const prof = hTotals.totalProfit;
                          const isCancelled = String(h.status || "").toLowerCase() === "cancelled";
                          const isSel = selected?.id === h.id;
                          return (
                            <tr
                              key={h.id}
                              onClick={() => openDetails(h, idx)}
                              onDoubleClick={() => openDetails(h, idx)}
                              title={isCancelled ? "CANCELLED — ignored in all totals and reports" : undefined}
                              className={`cursor-pointer border-b border-slate-200 hover:bg-blue-50 ${isCancelled ? "opacity-40 grayscale text-slate-400" : ""} ${isSel ? "bg-blue-100" : ""}`}
                            >
                              <td className="td border border-slate-200 font-mono text-center">{h.regNr || "-"}</td>
                              <td className="td border border-slate-200 font-mono">{h.invoiceNumber || "-"}</td>
                              <td className="td border border-slate-200">
                                <div className="font-medium">{h.clientName || "-"}</div>
                                <div className="text-[9px] text-slate-400">{h.clientCode}</div>
                              </td>
                              <td className="td border border-slate-200">{h.serviceType || "-"}</td>
                              <td className="td border border-slate-200">{h.vehicleType || "-"}</td>
                              <td className="td border border-slate-200 max-w-[120px] truncate" title={h.pickupLocation}>{h.pickupLocation || "-"}</td>
                              <td className="td border border-slate-200 max-w-[120px] truncate" title={h.dropoffLocation}>{h.dropoffLocation || "-"}</td>
                              <td className="td border border-slate-200 whitespace-nowrap">{h.pickupDate || "-"}</td>
                              <td className="td border border-slate-200 whitespace-nowrap">{h.pickupTime || "-"}</td>
                              <td className="td border border-slate-200 text-center">
                                {(h.adt || 0) + (h.chd || 0) + (h.inf || 0) || h.pax || 1}
                              </td>
                              <td className="td border border-slate-200">{h.driverName || "-"}</td>
                              <td className="td border border-slate-200 text-right">{fmt(buy)}</td>
                              <td className="td border border-slate-200 text-right font-medium">{fmt(sell)}</td>
                              <td className={`td border border-slate-200 text-right font-medium ${prof >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {fmt(prof)}
                              </td>
                              <td className="td border border-slate-200 text-center">
                                <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold border ${statusColor(h.status)}`}>
                                  {h.status || "-"}
                                </span>
                              </td>
                              <td className="td border border-slate-200">{h.supplierName || h.supplierCode || "-"}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {selected && (
                  <div className="bg-blue-50 border border-blue-200 rounded overflow-hidden flex flex-col mt-2" style={{ height: "20vh", minHeight: "140px" }}>
                    <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-blue-200 flex-1 overflow-auto">
                      {/* LEFT - trip info */}
                      <div className="overflow-auto">
                        <table className="w-full text-[11px] border-collapse bg-blue-50">
                          <thead>
                            <tr className="bg-blue-100 border-b border-blue-200">
                              <th className="th border-r border-blue-200">Service</th>
                              <th className="th border-r border-blue-200">Vehicle</th>
                              <th className="th border-r border-blue-200">Pickup</th>
                              <th className="th border-r border-blue-200">Dropoff</th>
                              <th className="th border-r border-blue-200">Date</th>
                              <th className="th border-r border-blue-200">Time</th>
                              <th className="th">Driver</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-t border-slate-200">
                              <td className="td border-r border-slate-100">{selected.serviceType || ""}</td>
                              <td className="td border-r border-slate-100">{selected.vehicleType || ""}</td>
                              <td className="td border-r border-slate-100">{selected.pickupLocation || ""}</td>
                              <td className="td border-r border-slate-100">{selected.dropoffLocation || ""}</td>
                              <td className="td border-r border-slate-100">{selected.pickupDate || ""}</td>
                              <td className="td border-r border-slate-100">{selected.pickupTime || ""}</td>
                              <td className="td">{selected.driverName || ""}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      {/* RIGHT - passengers */}
                      <div className="overflow-auto">
                        <table className="w-full text-[11px] border-collapse bg-blue-50">
                          <thead>
                            <tr className="bg-blue-100 border-b border-blue-200">
                              <th className="th w-8 border-r border-blue-200 text-center"></th>
                              <th className="th border-r border-blue-200">Passenger Name</th>
                              <th className="th text-center">Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(selected.passengers || []).length === 0 ? (
                              <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400 text-[11px]">-</td></tr>
                            ) : (
                              selected.passengers.map((p, idx) => (
                                <tr key={idx} className="border-t border-slate-200">
                                  <td className="td text-center border-r border-slate-100 text-gray-600">{idx + 1}</td>
                                  <td className="td border-r border-slate-100">{p.name || ""}</td>
                                  <td className="td text-center">{p.type || ""}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {(activeTab === "details" || isEditing) && (
              <div className="p-3 max-w-6xl mx-auto space-y-3">
                <div className="bg-white border border-slate-300 rounded p-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  <div>
                    <div className={labelCls}>Issue Date</div>
                    <input type="date" disabled={!isEditing} value={form.issueDate || ""} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <div className={labelCls}>Status</div>
                    <select disabled={!isEditing} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className={labelCls}>Invoice No</div>
                    <input disabled value={form.invoiceNumber || ""} className={inputCls + " bg-slate-50"} placeholder="—" />
                  </div>
                  <div>
                    <div className={labelCls}>Reg Nr</div>
                    <input disabled value={form.regNr || ""} className={inputCls + " bg-slate-50"} placeholder="—" />
                  </div>
                  <div>
                    <div className={labelCls}>Confirmation Nr</div>
                    <input disabled={!isEditing} value={form.confirmationNr || ""} onChange={(e) => setForm({ ...form, confirmationNr: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <div className={labelCls}>Reference Nr</div>
                    <input disabled={!isEditing} value={form.referenceNr || ""} onChange={(e) => setForm({ ...form, referenceNr: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <div className={labelCls}>Salesman</div>
                    <input disabled={!isEditing} value={form.salesmanName || form.salesman || ""} onChange={(e) => setForm({ ...form, salesmanName: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <div className={labelCls}>Branch</div>
                    {mode === "add" && (isAdmin ? branchesList : branchesList.filter((b) => myBranches.includes(b.code))).length > 1 ? (
                      <select value={form.branch} onChange={(e) => handleAddBranchChange(e.target.value)} className={inputCls}>
                        {(isAdmin ? branchesList : branchesList.filter((b) => myBranches.includes(b.code))).map((b) => (
                          <option key={b.code} value={b.code}>{b.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input disabled value={branchesList.find((b) => b.code === form.branch)?.name || form.branch || ""} className={inputCls + " bg-slate-50"} />
                    )}
                  </div>
                </div>

                <div className="bg-white border border-slate-300 rounded p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <div className={labelCls}>Client Code</div>
                    <input disabled={!isEditing} value={form.clientCode || ""} onChange={(e) => setForm({ ...form, clientCode: e.target.value })} className={inputCls} />
                    <div className={labelCls}>Client Name (F5)</div>
                    <input
                      disabled={!isEditing}
                      value={form.clientName || ""}
                      onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "F5") { e.preventDefault(); setShowClientPicker(true); } }}
                      onDoubleClick={() => isEditing && setShowClientPicker(true)}
                      placeholder="Press F5 to select"
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className={labelCls}>Supplier Code</div>
                    <input disabled={!isEditing} value={form.supplierCode || ""} onChange={(e) => setForm({ ...form, supplierCode: e.target.value })} className={inputCls} />
                    <div className={labelCls}>Supplier Name (F5)</div>
                    <input
                      disabled={!isEditing}
                      value={form.supplierName || ""}
                      onChange={(e) => setForm({ ...form, supplierName: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "F5") { e.preventDefault(); setShowSupplierPicker(true); } }}
                      onDoubleClick={() => isEditing && setShowSupplierPicker(true)}
                      placeholder="Press F5 to select"
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className={labelCls}>Service Type</div>
                    <select disabled={!isEditing} value={form.serviceType || "Airport Transfer"} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} className={inputCls}>
                      {SERVICE_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <div className={labelCls}>Vehicle Type</div>
                    <select disabled={!isEditing} value={form.vehicleType || "Sedan"} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })} className={inputCls}>
                      {VEHICLE_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>

                <div className="bg-white border border-slate-300 rounded p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className={labelCls}>Pickup Location</div>
                    <input disabled={!isEditing} value={form.pickupLocation || ""} onChange={(e) => setForm({ ...form, pickupLocation: e.target.value })} className={inputCls} placeholder="Airport / Hotel / Address" />
                  </div>
                  <div>
                    <div className={labelCls}>Dropoff Location</div>
                    <input disabled={!isEditing} value={form.dropoffLocation || ""} onChange={(e) => setForm({ ...form, dropoffLocation: e.target.value })} className={inputCls} placeholder="Airport / Hotel / Address" />
                  </div>
                </div>

                <div className="bg-white border border-slate-300 rounded p-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
                  <div>
                    <div className={labelCls}>Pickup Date</div>
                    <input type="date" disabled={!isEditing} value={form.pickupDate || ""} onChange={(e) => setForm({ ...form, pickupDate: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <div className={labelCls}>Pickup Time</div>
                    <input type="time" disabled={!isEditing} value={form.pickupTime || ""} onChange={(e) => setForm({ ...form, pickupTime: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <div className={labelCls}>Round Trip</div>
                    <select disabled={!isEditing} value={form.isRoundTrip ? "yes" : "no"} onChange={(e) => setForm({ ...form, isRoundTrip: e.target.value === "yes" })} className={inputCls}>
                      <option value="no">One Way</option>
                      <option value="yes">Round Trip</option>
                    </select>
                  </div>
                  <div>
                    <div className={labelCls}>Return Date</div>
                    <input type="date" disabled={!isEditing || !form.isRoundTrip} value={form.returnDate || ""} onChange={(e) => setForm({ ...form, returnDate: e.target.value })} className={inputCls + (!form.isRoundTrip ? " bg-slate-50" : "")} />
                  </div>
                  <div>
                    <div className={labelCls}>Return Time</div>
                    <input type="time" disabled={!isEditing || !form.isRoundTrip} value={form.returnTime || ""} onChange={(e) => setForm({ ...form, returnTime: e.target.value })} className={inputCls + (!form.isRoundTrip ? " bg-slate-50" : "")} />
                  </div>
                  <div>
                    <div className={labelCls}>Flight Nr</div>
                    <input disabled={!isEditing} value={form.flightNr || ""} onChange={(e) => setForm({ ...form, flightNr: e.target.value })} className={inputCls} placeholder="Optional" />
                  </div>
                  <div>
                    <div className={labelCls}>ADT</div>
                    <input type="number" min={1} disabled={!isEditing} value={form.adt} onChange={(e) => setPax("adt", e.target.value)} className={inputCls} />
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <div>
                      <div className={labelCls}>CHD</div>
                      <input type="number" min={0} disabled={!isEditing} value={form.chd} onChange={(e) => setPax("chd", e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <div className={labelCls}>INF</div>
                      <input type="number" min={0} disabled={!isEditing} value={form.inf} onChange={(e) => setPax("inf", e.target.value)} className={inputCls} />
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-slate-300 rounded p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <div className={labelCls}>Driver Name</div>
                    <input disabled={!isEditing} value={form.driverName || ""} onChange={(e) => setForm({ ...form, driverName: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <div className={labelCls}>Driver Phone</div>
                    <input disabled={!isEditing} value={form.driverPhone || ""} onChange={(e) => setForm({ ...form, driverPhone: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <div className={labelCls}>Vehicle Nr / Plate</div>
                    <input disabled={!isEditing} value={form.vehicleNr || ""} onChange={(e) => setForm({ ...form, vehicleNr: e.target.value })} className={inputCls} />
                  </div>
                </div>

                <div className="bg-white border border-slate-300 rounded overflow-hidden">
                  <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-600">
                    Passengers ({form.passengers?.length || 0}) — ADT:{form.adt} CHD:{form.chd} INF:{form.inf}
                  </div>
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="bg-blue-50">
                      <tr>
                        <th className="th border-r border-blue-200 w-8 text-center">#</th>
                        <th className="th border-r border-blue-200">Passenger Name</th>
                        <th className="th border-r border-blue-200 w-24 text-center">Type</th>
                        <th className="th w-36">Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(form.passengers || []).map((p, idx) => (
                        <tr key={idx} className="border-t border-slate-200">
                          <td className="td text-center border-r border-slate-100 text-gray-500">{idx + 1}</td>
                          <td className="td border-r border-slate-100">
                            <input
                              disabled={!isEditing}
                              value={p.name || ""}
                              onChange={(e) => {
                                const passengers = [...form.passengers];
                                passengers[idx] = { ...passengers[idx], name: e.target.value };
                                setForm({ ...form, passengers });
                              }}
                              className={inputCls}
                              placeholder="Name"
                            />
                          </td>
                          <td className="td border-r border-slate-100 text-center">
                            <select
                              disabled={!isEditing}
                              value={p.type || "ADT"}
                              onChange={(e) => {
                                const passengers = [...form.passengers];
                                passengers[idx] = { ...passengers[idx], type: e.target.value };
                                setForm({ ...form, passengers });
                              }}
                              className={inputCls + " text-center"}
                            >
                              <option value="ADT">ADT</option>
                              <option value="CHD">CHD</option>
                              <option value="INF">INF</option>
                            </select>
                          </td>
                          <td className="td">
                            <input
                              disabled={!isEditing}
                              value={p.phone || ""}
                              onChange={(e) => {
                                const passengers = [...form.passengers];
                                passengers[idx] = { ...passengers[idx], phone: e.target.value };
                                setForm({ ...form, passengers });
                              }}
                              className={inputCls}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="bg-white border border-slate-300 rounded p-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  <div>
                    <div className={labelCls}>Buy Currency</div>
                    <select disabled={!isEditing} value={form.buyCurrency || "EGP"} onChange={(e) => setForm({ ...form, buyCurrency: e.target.value, currency: e.target.value })} className={inputCls}>
                      <option value="EGP">EGP</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                  <div>
                    <div className={labelCls}>Sell Currency</div>
                    <select disabled={!isEditing} value={form.sellCurrency || "EGP"} onChange={(e) => setForm({ ...form, sellCurrency: e.target.value })} className={inputCls}>
                      <option value="EGP">EGP</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                  <div>
                    <div className={labelCls}>Buy Price</div>
                    <input disabled={!isEditing} value={form.buyPrice} onChange={(e) => setForm({ ...form, buyPrice: e.target.value })} className={inputCls + " text-right"} />
                  </div>
                  <div>
                    <div className={labelCls}>Sell Price</div>
                    <input disabled={!isEditing} value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} className={inputCls + " text-right"} />
                  </div>
                  <div>
                    <div className={labelCls}>Net Profit</div>
                    <input disabled value={fmt(profit)} className={inputCls + ` text-right font-semibold ${profit >= 0 ? "text-emerald-600" : "text-red-600"} bg-slate-50`} />
                  </div>
                  {form.buyCurrency !== "EGP" && (
                    <div>
                      <div className={labelCls}>Buy Rate ({form.buyCurrency}→EGP)</div>
                      <div className={inputCls + " text-right bg-slate-50 flex items-center justify-end gap-2"}>
                        {fetchingBuyRate && mode === "add" ? (
                          <>
                            <RefreshCw size={13} className="animate-spin text-slate-400" />
                            <span className="text-slate-400">fetching…</span>
                          </>
                        ) : (
                          <span>{fmt(form.buyExchangeRate)}</span>
                        )}
                      </div>
                    </div>
                  )}
                  {form.sellCurrency !== "EGP" && (
                    <div>
                      <div className={labelCls}>Sell Rate ({form.sellCurrency}→EGP)</div>
                      <div className={inputCls + " text-right bg-slate-50 flex items-center justify-end gap-2"}>
                        {fetchingSellRate && mode === "add" ? (
                          <>
                            <RefreshCw size={13} className="animate-spin text-slate-400" />
                            <span className="text-slate-400">fetching…</span>
                          </>
                        ) : (
                          <span>{fmt(form.sellExchangeRate)}</span>
                        )}
                      </div>
                    </div>
                  )}
                  {foreignCurrency && (
                    <div className="col-span-2">
                      <div className={labelCls}>EGP Equivalent</div>
                      <div className="text-xs text-slate-600 flex flex-col justify-center h-[38px] leading-tight">
                        {buyEGP !== null && <span>Buy ≈ {fmt(buyEGP)} EGP</span>}
                        {sellEGP !== null && <span>Sell ≈ {fmt(sellEGP)} EGP</span>}
                        <span className={profitEGP >= 0 ? "text-emerald-700 font-semibold" : "text-red-600 font-semibold"}>
                          Profit ≈ {fmt(profitEGP)} EGP
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="col-span-2 md:col-span-4 lg:col-span-6">
                    <div className={labelCls}>Remarks</div>
                    <input disabled={!isEditing} value={form.remarks || ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className={inputCls} />
                  </div>
                </div>

                <div className="bg-slate-100 border border-slate-300 rounded px-3 py-2 text-[11px] flex flex-wrap gap-4">
                  <span>Route: <b>{form.pickupLocation || "—"} → {form.dropoffLocation || "—"}</b></span>
                  <span>Pax: <b>{form.pax || 1}</b></span>
                  <span>Buy: <b>{fmt(form.buyPrice)} {form.buyCurrency}</b></span>
                  <span>Sell: <b>{fmt(form.sellPrice)} {form.sellCurrency}</b></span>
                  <span className={profit >= 0 ? "text-emerald-700" : "text-red-600"}>
                    Profit: <b>{fmt(profit)}</b>
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showClientPicker && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-modal-backdrop" onClick={() => setShowClientPicker(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[70vh] flex flex-col animate-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-2 border-b font-semibold text-sm">Select Client</div>
            <div className="p-2">
              <input autoFocus value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder="Search code or name..." className={inputCls} />
            </div>
            <div className="overflow-auto flex-1">
              {filteredClients.map((c) => (
                <button
                  key={c.id}
                  className="w-full text-left px-4 py-2 text-xs hover:bg-blue-50 border-b border-slate-100"
                  onClick={() => {
                    setForm({ ...form, clientCode: c.code || "", clientName: c.name || "" });
                    setShowClientPicker(false);
                    setClientSearch("");
                  }}
                >
                  <span className="font-mono text-slate-500 mr-2">{c.code}</span>
                  {c.kind === "corporate" && <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 mr-1.5">Corp</span>}
                  {c.name}
                </button>
              ))}
            </div>
            <div className="p-2 border-t text-right">
              <button onClick={() => setShowClientPicker(false)} className="tb-btn">Close</button>
            </div>
          </div>
        </div>
      )}

      {showSupplierPicker && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-modal-backdrop" onClick={() => setShowSupplierPicker(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[70vh] flex flex-col animate-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-2 border-b font-semibold text-sm">Select Supplier</div>
            <div className="p-2">
              <input autoFocus value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} placeholder="Search code or name..." className={inputCls} />
            </div>
            <div className="overflow-auto flex-1">
              {filteredSuppliers.map((s) => (
                <button
                  key={s.id}
                  className="w-full text-left px-4 py-2 text-xs hover:bg-blue-50 border-b border-slate-100"
                  onClick={() => {
                    setForm({
                      ...form,
                      supplierCode: s.code || "",
                      supplierName: s.name || "",
                    });
                    setShowSupplierPicker(false);
                    setSupplierSearch("");
                  }}
                >
                  <span className="font-mono text-slate-500 mr-2">{s.code}</span>
                  {s.name} {s.symbol ? `(${s.symbol})` : ""}
                </button>
              ))}
            </div>
            <div className="p-2 border-t text-right">
              <button onClick={() => setShowSupplierPicker(false)} className="tb-btn">Close</button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .tb-btn {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 4px 10px; border: 1px solid #cbd5e1; border-radius: 6px;
          background: #fff; font-size: 12px; cursor: pointer;
        }
        .tb-btn:hover:not(:disabled) { background: #f1f5f9; }
        .tb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .tb-btn-blue {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 4px 10px; border-radius: 6px;
          background: #2563eb; color: #fff; font-size: 12px; border: none; cursor: pointer;
        }
        .tb-btn-blue:hover { background: #1d4ed8; }
        .th { padding: 6px 8px; font-weight: 600; text-align: left; white-space: nowrap; }
        .td { padding: 5px 8px; }
      `}</style>

      <InvoiceIssueModal
        open={invoiceModalOpen}
        section="transportation"
        record={selected}
        onClose={() => setInvoiceModalOpen(false)}
        onIssued={handleInvoiceIssued}
      />
    </div>
  );
}
