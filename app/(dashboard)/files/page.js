"use client";

import React, { useState, useEffect, useMemo } from "react";
import Navbar from "@/components/Navbar";
import SectionStats from "@/components/SectionStats";
import Table from "@/components/Table";
import { useAuth } from "@/lib/auth";
import { canWriteModule } from "@/lib/permissions";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  generateRegNumber, isBranchVisible,
  getFlightTotals, getHotelTotals, getVisaTotals, getTransportationTotals,
  openPrintWindow,
  bookingQuery,
} from "@/lib/helpers";
import toast from "react-hot-toast";
import {
  Plus, X, FolderOpen, Unlink, Search, Plane, Hotel as HotelIcon,
  FileCheck2, Car, DollarSign, TrendingUp, TrendingDown, Layers, AlertTriangle, Printer,
} from "lucide-react";

/* -------------------------------------------------------------------------
 * A "File" is NOT a financial record on its own. It is a folder that
 * groups references to existing bookings (flights / hotels / visa /
 * transportation) that already belong to one client's trip.
 *
 * IMPORTANT — accounting design:
 * We only ever store a lightweight pointer { type, id, addedAt } inside the
 * file's `services` array — never a copy of the amounts. All Sell/Buy/Profit
 * numbers shown here are computed live from the original booking documents
 * (the exact same getXTotals() helpers used on the Flights/Hotels/Visa/
 * Transportation pages and on Accounts/Analysis). This guarantees:
 *   1) One single source of truth for money — no drift, no double entry.
 *   2) Accounts/Analysis totals are unaffected by Files existing at all,
 *      since a File never adds its own ledger line.
 *   3) Unassigning a service from a file only edits the FILE document
 *      (removes the pointer) — the original booking document is never
 *      touched, so its own invoice/accounting record stays 100% intact.
 * ---------------------------------------------------------------------- */

const EMPTY_FORM = {
  title: "",
  clientCode: "",
  clientName: "",
  branch: "1",
  status: "Open",
  remarks: "",
};

const STATUSES = ["Open", "Closed", "Cancelled"];

const SERVICE_TYPES = [
  { key: "flights", label: "Air Ticket", icon: Plane, color: "text-sky-600 bg-sky-50" },
  { key: "hotels", label: "Hotels", icon: HotelIcon, color: "text-purple-600 bg-purple-50" },
  { key: "visa", label: "Visa", icon: FileCheck2, color: "text-amber-600 bg-amber-50" },
  { key: "transportation", label: "Transportation", icon: Car, color: "text-emerald-600 bg-emerald-50" },
];

function getTotals(type, row) {
  if (!row) return { totalSell: 0, totalBuy: 0, totalProfit: 0 };
  if (type === "flights") return getFlightTotals(row);
  if (type === "hotels") return getHotelTotals(row);
  if (type === "visa") return getVisaTotals(row);
  if (type === "transportation") return getTransportationTotals(row);
  return { totalSell: 0, totalBuy: 0, totalProfit: 0 };
}

function getServiceLabel(type, row) {
  if (!row) return "—";
  if (type === "flights") {
    const pax = (row.passengers || [])[0];
    return [pax?.name, pax?.ticketNr || pax?.pnr].filter(Boolean).join(" · ") || row.ticketType || "Flight";
  }
  if (type === "hotels") {
    return [row.hotelName, row.city, row.checkIn].filter(Boolean).join(" · ") || "Hotel";
  }
  if (type === "visa") {
    return [row.country || row.destination, row.visaType, row.applicationDate].filter(Boolean).join(" · ") || "Visa";
  }
  if (type === "transportation") {
    return [row.serviceType, row.pickupLocation && row.dropoffLocation ? `${row.pickupLocation} → ${row.dropoffLocation}` : row.pickupLocation].filter(Boolean).join(" · ") || "Transportation";
  }
  return "Service";
}

function getServiceRegRef(row) {
  return row?.regNr || row?.invoiceNumber || row?.confirmationNr || row?.id?.slice(0, 6) || "";
}

// Returns an ordered list of { label, value } pairs describing the full
// details of a linked booking, used by the "view details" popup opened
// from the Files page (so a service's info can be checked without leaving
// the file).
function getServiceDetailFields(type, row) {
  if (!row) return [];
  if (type === "flights") {
    return [
      { label: "From → To", value: [row.from, row.to].filter(Boolean).join(" → ") },
      { label: "Flight Nr", value: row.flightNo },
      { label: "GDS", value: row.gds },
      { label: "Issue Date", value: row.issueDate },
      { label: "Client", value: row.clientName },
      { label: "Supplier", value: row.supplierName },
      { label: "Segments", value: (row.segments || []).map((s) => [s.city, s.carrier, s.flight, s.date].filter(Boolean).join(" ")).join(" | ") || "-" },
      { label: "Passengers", value: (row.passengers || []).map((p) => [p.name, p.ticketNr].filter(Boolean).join(" - ")).join(", ") || "-" },
    ];
  }
  if (type === "hotels") {
    return [
      { label: "Hotel", value: row.hotelName },
      { label: "City / Country", value: [row.city, row.country].filter(Boolean).join(", ") },
      { label: "Check-In / Out", value: [row.checkIn, row.checkOut].filter(Boolean).join(" → ") },
      { label: "Confirmation Nr", value: row.confirmationNr },
      { label: "Client", value: row.clientName },
      { label: "Supplier", value: row.supplierName },
      { label: "Rooms", value: (row.roomLines || []).map((r) => [r.roomType, r.roomNr, r.mealPlan].filter(Boolean).join(" ")).join(", ") || "-" },
      { label: "Guests", value: (row.roomLines || []).flatMap((r) => (r.guests || []).map((g) => g.name)).filter(Boolean).join(", ") || "-" },
    ];
  }
  if (type === "visa") {
    return [
      { label: "Destination", value: row.destination || row.country },
      { label: "Visa Type / Entry", value: [row.visaType, row.entryType].filter(Boolean).join(" / ") },
      { label: "Application / Expected", value: [row.applicationDate, row.expectedDate].filter(Boolean).join(" → ") },
      { label: "Client", value: row.clientName },
      { label: "Supplier", value: row.supplierName },
      { label: "Applicants", value: (row.applicants || []).map((a) => [a.name, a.passportNr].filter(Boolean).join(" - ")).join(", ") || "-" },
    ];
  }
  if (type === "transportation") {
    return [
      { label: "Service", value: row.serviceType },
      { label: "Vehicle", value: [row.vehicleType, row.vehicleNr].filter(Boolean).join(" ") },
      { label: "Pickup → Dropoff", value: [row.pickupLocation, row.dropoffLocation].filter(Boolean).join(" → ") },
      { label: "Date / Time", value: [row.pickupDate, row.pickupTime].filter(Boolean).join(" ") },
      { label: "Driver", value: [row.driverName, row.driverPhone].filter(Boolean).join(" - ") },
      { label: "Client", value: row.clientName },
      { label: "Supplier", value: row.supplierName },
      { label: "Passengers", value: (row.passengers || []).map((p) => p.name).filter(Boolean).join(", ") || "-" },
    ];
  }
  return [];
}

function fmt(v) {
  return Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const inputCls = "w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm";

export default function FilesPage() {
  const { userData, hasPermission, activeBranch, myBranches, branchesList, appFeatures, user } = useAuth();
  const isAdmin = hasPermission ? hasPermission(["Admin"]) : userData?.role === "Admin";
  // Read-only users can browse files but not add, edit or delete them.
  const canWrite = canWriteModule(userData, "files", isAdmin, appFeatures);

  const [files, setFiles] = useState([]);
  const [clients, setClients] = useState([]);
  const [flights, setFlights] = useState([]);
  const [hotels, setHotels] = useState([]);
  const [visaList, setVisaList] = useState([]);
  const [transportation, setTransportation] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [clientSearch, setClientSearch] = useState("");

  const [manageFile, setManageFile] = useState(null); // the file currently open in the "manage services" drawer
  const [viewingService, setViewingService] = useState(null); // { type, row } — full detail popup for a linked service
  const [search, setSearch] = useState("");

  useEffect(() => {
    const ctx = { isAdmin, activeBranch, myBranches };
    const unsubF = onSnapshot(collection(db, "files"), (snap) => {
      let data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      data = data.filter((row) => isBranchVisible(row.branch, ctx));
      data.sort((a, b) => {
        const ta = a.createdAt?.toDate?.() || a.createdAt || 0;
        const tb = b.createdAt?.toDate?.() || b.createdAt || 0;
        return new Date(tb) - new Date(ta);
      });
      setFiles(data);
      setLoading(false);
    }, () => setLoading(false));

    const unsubC = onSnapshot(collection(db, "clients"), (snap) => {
      setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubFl = onSnapshot(bookingQuery("flights", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (snap) => {
      setFlights(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubH = onSnapshot(bookingQuery("hotels", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (snap) => {
      setHotels(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubV = onSnapshot(bookingQuery("visa", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (snap) => {
      setVisaList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubT = onSnapshot(bookingQuery("transportation", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (snap) => {
      setTransportation(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubF(); unsubC(); unsubFl(); unsubH(); unsubV(); unsubT(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, activeBranch, myBranches]);

  // id -> doc lookup per collection, so a file's pointers resolve instantly
  const maps = useMemo(() => ({
    flights: Object.fromEntries(flights.map((r) => [r.id, r])),
    hotels: Object.fromEntries(hotels.map((r) => [r.id, r])),
    visa: Object.fromEntries(visaList.map((r) => [r.id, r])),
    transportation: Object.fromEntries(transportation.map((r) => [r.id, r])),
  }), [flights, hotels, visaList, transportation]);

  // Live financial rollup for one file — computed from the referenced
  // booking documents only, never stored on the file itself.
  function fileRollup(file) {
    let totalSell = 0, totalBuy = 0, broken = 0;
    for (const s of file.services || []) {
      const row = maps[s.type]?.[s.id];
      if (!row) { broken += 1; continue; }
      const tot = getTotals(s.type, row);
      totalSell += tot.totalSell;
      totalBuy += tot.totalBuy;
    }
    return { totalSell, totalBuy, totalProfit: totalSell - totalBuy, count: (file.services || []).length, broken };
  }

  const filteredClients = useMemo(() => {
    const s = clientSearch.toLowerCase();
    return clients.filter((c) => !s || (c.name || "").toLowerCase().includes(s) || (c.code || "").toLowerCase().includes(s)).slice(0, 50);
  }, [clients, clientSearch]);

  const filteredFiles = useMemo(() => {
    const s = search.toLowerCase();
    if (!s) return files;
    return files.filter((f) =>
      (f.regNr || "").toLowerCase().includes(s) ||
      (f.title || "").toLowerCase().includes(s) ||
      (f.clientName || "").toLowerCase().includes(s)
    );
  }, [files, search]);

  const openAdd = () => {
    if (!canWrite) return;
    setEditing(null);
    setForm({ ...EMPTY_FORM, branch: activeBranch && activeBranch !== "ALL" ? activeBranch : "1" });
    setShowModal(true);
  };

  const openEdit = (row) => {
    if (!canWrite) return;
    setEditing(row);
    setForm({
      title: row.title || "",
      clientCode: row.clientCode || "",
      clientName: row.clientName || "",
      branch: row.branch || "1",
      status: row.status || "Open",
      remarks: row.remarks || "",
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.clientCode) {
      toast.error("Please select a client");
      return;
    }
    try {
      if (editing) {
        await updateDoc(doc(db, "files", editing.id), { ...form, updatedAt: serverTimestamp() });
        toast.success("File updated");
      } else {
        const regNr = await generateRegNumber("files", "File", form.branch);
        await addDoc(collection(db, "files"), {
          ...form,
          regNr,
          services: [],
          createdAt: serverTimestamp(),
        });
        toast.success(`File ${regNr} created`);
      }
      setShowModal(false);
    } catch (error) {
      console.error(error);
      toast.error("Operation failed");
    }
  };

  const handleDelete = async (row) => {
    if (!canWrite) return;
    if (!confirm("Are you sure you want to delete this item?")) return;
    try {
      // Deleting a File only removes the folder itself — it never touches
      // the flights/hotels/visa/transportation documents it referenced.
      await deleteDoc(doc(db, "files", row.id));
      if (manageFile?.id === row.id) setManageFile(null);
      toast.success("File deleted");
    } catch (error) {
      console.error(error);
      toast.error("Delete failed");
    }
  };

  const openManage = (row) => {
    setManageFile(row);
  };

  // Print the entire File — its own info plus the full details of every
  // linked booking (flights/hotels/visa/transportation), each with its own
  // Sell/Buy/Profit, and a grand rollup at the top. Nothing is stored;
  // everything is read live from the same maps used on screen.
  const handlePrintFile = (file) => {
    if (!file) return;
    const rollup = fileRollup(file);
    const services = file.services || [];

    const serviceBlocks = services.length
      ? services
          .map((s) => {
            const meta = SERVICE_TYPES.find((x) => x.key === s.type);
            const row = maps[s.type]?.[s.id];
            if (!row) {
              return `<div style="margin-top:14px;padding:10px;border:1px solid #fecaca;border-radius:6px;color:#b91c1c;font-size:12px">
                ${meta?.label || s.type} — booking was deleted (Ref: ${s.id?.slice(0, 6) || ""})
              </div>`;
            }
            const tot = getTotals(s.type, row);
            const fields = getServiceDetailFields(s.type, row);
            const fieldRows = fields
              .map((f) => `<tr><td style="width:32%;color:#64748b;font-size:11px">${f.label}</td><td>${f.value || "-"}</td></tr>`)
              .join("");
            return `
              <div style="margin-top:16px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
                <div style="background:#f1f5f9;padding:6px 10px;font-weight:bold;font-size:13px">
                  ${meta?.label || s.type} — ${getServiceLabel(s.type, row)}
                </div>
                <table style="margin-top:0">
                  <tbody>${fieldRows}</tbody>
                </table>
                <div style="padding:6px 10px;font-size:12px;background:#fafafa;border-top:1px solid #e2e8f0">
                  <b>Sell</b> ${fmt(tot.totalSell)} &nbsp; <b>Buy</b> ${fmt(tot.totalBuy)} &nbsp; <b>Profit</b> ${fmt(tot.totalProfit)}
                </div>
              </div>
            `;
          })
          .join("")
      : `<p style="color:#94a3b8;font-size:12px;margin-top:14px">No services linked to this file.</p>`;

    const body = `
      <h2>${file.title || "File"} — ${file.regNr || ""}</h2>
      <div class="sub">Status: ${file.status || "-"}${file.remarks ? " · " + file.remarks : ""}</div>
      <div class="grid2">
        <div><span class="lbl">Client</span><br/>${file.clientName || "-"} ${file.clientCode ? "(" + file.clientCode + ")" : ""}</div>
        <div><span class="lbl">Branch</span><br/>${file.branch || "-"}</div>
      </div>
      <table>
        <thead><tr><th>Total Sell</th><th>Total Buy</th><th>Total Profit</th><th># Services</th></tr></thead>
        <tbody><tr>
          <td>${fmt(rollup.totalSell)}</td>
          <td>${fmt(rollup.totalBuy)}</td>
          <td>${fmt(rollup.totalProfit)}</td>
          <td>${rollup.count}</td>
        </tr></tbody>
      </table>
      ${serviceBlocks}
    `;
    openPrintWindow(`File ${file.regNr || ""} - ${file.title || ""}`, body);
  };

  // Keep the manage-drawer's file object in sync with live onSnapshot updates
  useEffect(() => {
    if (!manageFile) return;
    const fresh = files.find((f) => f.id === manageFile.id);
    if (fresh) setManageFile(fresh);
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unassign = edit the FILE's own pointer list only. The original booking
  // document in its own collection is never read-write touched here.
  const unassignService = async (type, id) => {
    if (!manageFile) return;
    if (!confirm("Remove this service from the file? The original booking will not be affected.")) return;
    const next = (manageFile.services || []).filter((s) => !(s.type === type && s.id === id));
    try {
      await updateDoc(doc(db, "files", manageFile.id), { services: next, updatedAt: serverTimestamp() });
      toast.success("Service removed from file (booking itself is untouched)");
    } catch (error) {
      console.error(error);
      toast.error("Failed to unassign service");
    }
  };

  const columns = [
    { key: "regNr", label: "Reg Nr" || "Reg Nr" },
    { key: "title", label: "File Title" || "Title" },
    { key: "clientName", label: "Client" || "Client" },
    {
      key: "services",
      label: "Services" || "Services",
      render: (_v, row) => {
        const r = fileRollup(row);
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium bg-slate-100 text-slate-700 px-2 py-1 rounded-full">
            <Layers size={12} /> {r.count}
            {r.broken > 0 && (
              <span title="Some linked bookings were deleted" className="text-red-500 ml-1 flex items-center gap-0.5">
                <AlertTriangle size={11} /> {r.broken}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "totalSell",
      label: "Total Sell" || "Total Sell",
      render: (_v, row) => <span className="font-medium text-emerald-700">{fmt(fileRollup(row).totalSell)}</span>,
    },
    {
      key: "totalProfit",
      label: "Profit" || "Profit",
      render: (_v, row) => {
        const p = fileRollup(row).totalProfit;
        return <span className={`font-semibold ${p >= 0 ? "text-blue-700" : "text-red-600"}`}>{fmt(p)}</span>;
      },
    },
    {
      key: "status",
      label: "Status",
      render: (val) => (
        <span className={`badge ${val === "Open" ? "badge-blue" : val === "Cancelled" ? "badge-red" : "badge-green"}`}>
          {val || "Open"}
        </span>
      ),
    },
    {
      key: "manage",
      label: "Manage" || "Services",
      render: (_v, row) => (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => openManage(row)}
            className="flex items-center gap-1.5 text-blue-600 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-blue-200"
          >
            <FolderOpen size={14} /> {"Manage" || "Manage"}
          </button>
          <button
            onClick={() => handlePrintFile(row)}
            title={"Print"}
            className="flex items-center gap-1.5 text-slate-600 hover:bg-slate-50 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200"
          >
            <Printer size={14} />
          </button>
        </div>
      ),
    },
  ];

  const sectionStats = useMemo(() => {
    let sell = 0, profit = 0, open = 0;
    for (const f of files) {
      const r = fileRollup(f);
      sell += r.totalSell;
      profit += r.totalProfit;
      if ((f.status || "Open") === "Open") open += 1;
    }
    return [
      { label: "Total Files", value: files.length.toLocaleString("en-US"), icon: FolderOpen, color: "bg-blue-500" },
      { label: "Open Files", value: open.toLocaleString("en-US"), icon: Layers, color: "bg-sky-500" },
      { label: "Total Sell (linked)", value: fmt(sell), icon: DollarSign, color: "bg-emerald-600" },
      { label: "Total Profit (linked)", value: fmt(profit), icon: TrendingUp, color: profit >= 0 ? "bg-indigo-500" : "bg-red-500" },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, maps]);

  const manageRollup = manageFile ? fileRollup(manageFile) : null;

  return (
    <div>
      <Navbar title={"Files"} />
      <SectionStats stats={sectionStats} />

      <div className="p-6">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div className="relative w-full max-w-xs">
            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={"Search..."}
              className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <button
            onClick={openAdd}
            disabled={!canWrite}
            title={!canWrite ? "View only — you don't have write access to this page" : undefined}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={18} />
            {"Add File" || "Add File"}
          </button>
        </div>

        <Table columns={columns} data={filteredFiles} loading={loading} onEdit={canWrite ? openEdit : undefined} onDelete={canWrite ? handleDelete : undefined} />
      </div>

      {/* Add / Edit basic file info */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl animate-modal-panel">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-semibold text-lg">{editing ? "Edit" : ("Add File" || "Add File")}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {editing && (
                <div className="text-xs font-mono text-gray-500 bg-gray-50 border rounded-lg px-3 py-2">
                  {"Reg Nr" || "Reg Nr"}: <span className="font-semibold text-gray-800">{editing.regNr}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">{"File Title" || "File Title"}</label>
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Family trip to Istanbul"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{"Client" || "Client"}</label>
                <button
                  type="button"
                  onClick={() => setShowClientPicker(true)}
                  className="w-full flex items-center justify-between px-3 py-2 border rounded-lg text-sm hover:bg-gray-50"
                >
                  <span className={form.clientName ? "text-gray-800" : "text-gray-400"}>
                    {form.clientName ? `${form.clientCode} — ${form.clientName}` : ("Select Client" || "Select client")}
                  </span>
                  <Search size={14} className="text-gray-400" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{"Status"}</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className={inputCls}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {isAdmin && branchesList?.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Branch</label>
                    <select
                      value={form.branch}
                      onChange={(e) => setForm({ ...form, branch: e.target.value })}
                      className={inputCls}
                    >
                      {branchesList.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{"Notes"}</label>
                <textarea
                  value={form.remarks}
                  onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                  rows={3}
                  className={inputCls}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
                  {"Cancel"}
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                  {"Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Client picker */}
      {showClientPicker && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4 animate-modal-backdrop" onClick={() => setShowClientPicker(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[70vh] flex flex-col animate-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-2 border-b font-semibold text-sm">{"Select Client" || "Select Client"}</div>
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
                  {c.name}
                </button>
              ))}
              {filteredClients.length === 0 && <div className="p-4 text-center text-xs text-gray-400">{"No data found"}</div>}
            </div>
            <div className="p-2 border-t text-right">
              <button onClick={() => setShowClientPicker(false)} className="px-3 py-1.5 border rounded-lg text-xs hover:bg-gray-50">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Manage services drawer */}
      {manageFile && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-modal-backdrop">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col animate-modal-panel">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <FolderOpen size={18} className="text-blue-600" /> {manageFile.regNr} — {manageFile.title}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">{manageFile.clientName}</p>
              </div>
              <button onClick={() => setManageFile(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="px-6 pt-4">
              <button
                onClick={() => handlePrintFile(manageFile)}
                className="flex items-center gap-1.5 text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300"
              >
                <Printer size={14} /> {"Print File"}
              </button>
            </div>

            {/* Rollup summary — computed live from linked bookings, never stored */}
            <div className="grid grid-cols-3 gap-3 px-6 pt-4">
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-center">
                <p className="text-[11px] text-emerald-700">{"Total Sell" || "Total Sell"}</p>
                <p className="text-base font-bold text-emerald-800">{fmt(manageRollup.totalSell)}</p>
              </div>
              <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-center">
                <p className="text-[11px] text-red-600">{"Total Buy" || "Total Buy"}</p>
                <p className="text-base font-bold text-red-700">{fmt(manageRollup.totalBuy)}</p>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-center">
                <p className="text-[11px] text-blue-700">{"Profit" || "Profit"}</p>
                <p className="text-base font-bold text-blue-800">{fmt(manageRollup.totalProfit)}</p>
              </div>
            </div>

            <div className="px-6 pt-4">
              <p className="text-sm font-medium text-gray-700">{"Assigned services" || "Assigned services"} ({manageRollup.count})</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {"To add a service, open it in Flights / Hotels / Visa / Transportation and use the \"Add to File\" button there." || "To add a service, open it in Flights / Hotels / Visa / Transportation and use the \"Add to File\" button there."}
              </p>
            </div>

            <div className="flex-1 overflow-auto px-6 py-3 space-y-2">
              {(manageFile.services || []).length === 0 && (
                <div className="text-center text-sm text-gray-400 py-8">{"No services linked yet." || "No services linked yet."}</div>
              )}
              {(manageFile.services || []).map((s) => {
                const meta = SERVICE_TYPES.find((x) => x.key === s.type);
                const Icon = meta?.icon || Layers;
                const row = maps[s.type]?.[s.id];
                const tot = row ? getTotals(s.type, row) : null;
                return (
                  <div
                    key={`${s.type}-${s.id}`}
                    onClick={() => row && setViewingService({ type: s.type, row })}
                    className={`flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 ${row ? "cursor-pointer hover:bg-blue-50" : ""}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${meta?.color || "bg-gray-100 text-gray-600"}`}>
                        <Icon size={15} />
                      </span>
                      <div className="min-w-0">
                        {row ? (
                          <>
                            <p className="text-sm font-medium text-gray-800 truncate">{getServiceLabel(s.type, row)}</p>
                            <p className="text-[11px] text-gray-400 truncate">
                              {meta?.label} · {getServiceRegRef(row)} {tot ? `· Sell ${fmt(tot.totalSell)}` : ""}
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-red-500 flex items-center gap-1">
                            <AlertTriangle size={13} /> This booking was deleted from {meta?.label}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); unassignService(s.type, s.id); }}
                      title={"Unassign" || "Unassign"}
                      className="flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-lg flex-shrink-0"
                    >
                      <Unlink size={13} /> {"Unassign" || "Unassign"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* View full service details — opened by clicking a linked service row */}
      {viewingService && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop" onClick={() => setViewingService(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl animate-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                {(() => {
                  const meta = SERVICE_TYPES.find((x) => x.key === viewingService.type);
                  const Icon = meta?.icon || Layers;
                  return (<><Icon size={16} /> {meta?.label} — {getServiceLabel(viewingService.type, viewingService.row)}</>);
                })()}
              </h3>
              <button onClick={() => setViewingService(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-2 max-h-[70vh] overflow-auto">
              {getServiceDetailFields(viewingService.type, viewingService.row).map((f) => (
                <div key={f.label} className="grid grid-cols-3 gap-2 text-sm border-b border-gray-100 pb-1.5">
                  <div className="text-gray-500 text-xs col-span-1 pt-0.5">{f.label}</div>
                  <div className="col-span-2 text-gray-800 break-words">{f.value || "-"}</div>
                </div>
              ))}
              {(() => {
                const tot = getTotals(viewingService.type, viewingService.row);
                return (
                  <div className="grid grid-cols-3 gap-2 text-sm pt-1">
                    <div className="text-gray-500 text-xs col-span-1">Sell / Buy / Profit</div>
                    <div className="col-span-2 font-medium text-gray-800">{fmt(tot.totalSell)} / {fmt(tot.totalBuy)} / {fmt(tot.totalProfit)}</div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
