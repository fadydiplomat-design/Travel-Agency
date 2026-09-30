"use client";

import { useState, useEffect } from "react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/lib/auth";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Users,
  Building2,
  FileText,
  Plane,
  Hotel,
  FileCheck,
  Car,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  Store,
  Briefcase,
} from "lucide-react";
import { getFlightTotals, getHotelTotals, getVisaTotals, getTransportationTotals, isBranchVisible, bookingQuery } from "@/lib/helpers";

function formatCurrency(value) {
  const num = Number(value) || 0;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNumber(value) {
  return (Number(value) || 0).toLocaleString("en-US");
}

const MODULE_META = {
  flight: { label: "Flight", icon: Plane, color: "text-orange-500", badge: "bg-orange-100 text-orange-700" },
  hotel: { label: "Hotel", icon: Hotel, color: "text-sky-500", badge: "bg-sky-100 text-sky-700" },
  visa: { label: "Visa", icon: FileCheck, color: "text-purple-500", badge: "bg-purple-100 text-purple-700" },
  transportation: { label: "Transport", icon: Car, color: "text-teal-500", badge: "bg-teal-100 text-teal-700" },
};

function getRowTime(x) {
  if (x.createdAt?.toDate) return x.createdAt.toDate().getTime();
  if (x.createdAt instanceof Date) return x.createdAt.getTime();
  if (typeof x.createdAt === "string") {
    const parsed = Date.parse(x.createdAt);
    if (!isNaN(parsed)) return parsed;
  }
  if (x.issueDate) {
    const parsed = Date.parse(x.issueDate);
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
}

function describeRow(type, row) {
  switch (type) {
    case "flight": {
      if (row.from && row.to) return `${row.from} → ${row.to}`;
      if (row.segments?.[0]?.city) return `${row.segments[0].city} → ${row.segments[row.segments.length - 1]?.city || "-"}`;
      return row.supplierSymbol || row.hotelName || "-";
    }
    case "hotel":
      return [row.hotelName, row.city].filter(Boolean).join(" — ") || "-";
    case "visa":
      return [row.destination, row.country].filter(Boolean).join(", ") || "-";
    case "transportation":
      return [row.serviceType, row.pickupLocation && row.dropoffLocation ? `${row.pickupLocation} → ${row.dropoffLocation}` : null]
        .filter(Boolean)
        .join(" — ") || "-";
    default:
      return "-";
  }
}

export default function DashboardPage() {
  const { isAdmin, activeBranch, myBranches, user, userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({
    clients: 0,
    corporates: 0,
    suppliers: 0,
    bookings: 0,
    invoicesIssued: 0,
    invoicesNotIssued: 0,
    pending: 0,
    totalSales: 0,
    totalBuy: 0,
    totalProfit: 0,
  });
  const [recentActivity, setRecentActivity] = useState([]);

  useEffect(() => {
    setLoading(true);

    // Shared state for all collections — recompute dashboard when any collection changes
    let clientsCount = 0;
    let corporatesCount = 0;
    let suppliersCount = 0;
    let flightsData = [];
    let hotelsData = [];
    let visaData = [];
    let transportationData = [];

    const MODULES = [
      { key: "flight", getData: () => flightsData, getTotals: getFlightTotals },
      { key: "hotel", getData: () => hotelsData, getTotals: getHotelTotals },
      { key: "visa", getData: () => visaData, getTotals: getVisaTotals },
      { key: "transportation", getData: () => transportationData, getTotals: getTransportationTotals },
    ];

    const recompute = () => {
      let bookingsCount = 0;
      let totalSales = 0;
      let totalBuy = 0;
      let totalProfit = 0;
      let invoicesIssued = 0;
      let pending = 0;
      const allRows = [];

      MODULES.forEach(({ key, getData, getTotals }) => {
        const rows = getData();
        bookingsCount += rows.length;
        rows.forEach((row) => {
          const totals = getTotals(row);
          totalSales += totals.totalSell;
          totalBuy += totals.totalBuy;
          totalProfit += totals.totalProfit;
          if (row.invoiceIssued === true) invoicesIssued += 1;
          const status = String(row.status || "").toLowerCase();
          if (status.includes("pending")) pending += 1;
          allRows.push({ type: key, row, totals });
        });
      });

      const invoicesNotIssued = bookingsCount - invoicesIssued;
      const sortedActivity = allRows
        .sort((a, b) => getRowTime(b.row) - getRowTime(a.row))
        .slice(0, 6);

      setCounts({
        clients: clientsCount,
        corporates: corporatesCount,
        suppliers: suppliersCount,
        bookings: bookingsCount,
        invoicesIssued,
        invoicesNotIssued,
        pending,
        totalSales,
        totalBuy,
        totalProfit,
      });
      setRecentActivity(sortedActivity);
      setLoading(false);
    };

    // Real-time listeners — no polling, updates instantly when any user adds/edits data
    const unsubClients = onSnapshot(
      collection(db, "clients"),
      (snap) => { clientsCount = snap.size; recompute(); },
      () => recompute()
    );
    const unsubCorporates = onSnapshot(
      collection(db, "corporates"),
      (snap) => { corporatesCount = snap.size; recompute(); },
      () => recompute()
    );
    const unsubSuppliers = onSnapshot(
      collection(db, "suppliers"),
      (snap) => { suppliersCount = snap.size; recompute(); },
      () => recompute()
    );
    const unsubFlights = onSnapshot(
      bookingQuery("flights", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }),
      (snap) => { flightsData = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => isBranchVisible(r.branch, { isAdmin, activeBranch, myBranches })); recompute(); },
      (err) => { console.error("Dashboard flights listener error:", err); setLoading(false); }
    );
    const unsubHotels = onSnapshot(
      bookingQuery("hotels", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }),
      (snap) => { hotelsData = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => isBranchVisible(r.branch, { isAdmin, activeBranch, myBranches })); recompute(); },
      (err) => { console.error("Dashboard hotels listener error:", err); setLoading(false); }
    );
    const unsubVisa = onSnapshot(
      bookingQuery("visa", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }),
      (snap) => { visaData = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => isBranchVisible(r.branch, { isAdmin, activeBranch, myBranches })); recompute(); },
      (err) => { console.error("Dashboard visa listener error:", err); setLoading(false); }
    );
    const unsubTransportation = onSnapshot(
      bookingQuery("transportation", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }),
      (snap) => { transportationData = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => isBranchVisible(r.branch, { isAdmin, activeBranch, myBranches })); recompute(); },
      (err) => { console.error("Dashboard transportation listener error:", err); setLoading(false); }
    );

    return () => {
      unsubClients();
      unsubCorporates();
      unsubSuppliers();
      unsubFlights();
      unsubHotels();
      unsubVisa();
      unsubTransportation();
    };
  }, [isAdmin, activeBranch, JSON.stringify(myBranches)]);

  // Primary KPIs — the numbers that answer "how is the business doing" —
  // shown first and biggest. Entity/record counts are secondary context.
  const kpis = [
    { label: "Total Sales", value: formatCurrency(counts.totalSales), suffix: " EGP", icon: DollarSign, color: "bg-emerald-600" },
    { label: "Total Cost", value: formatCurrency(counts.totalBuy), suffix: " EGP", icon: FileText, color: "bg-slate-500" },
    {
      label: "Net Profit",
      value: formatCurrency(counts.totalProfit),
      suffix: " EGP",
      icon: counts.totalProfit >= 0 ? TrendingUp : TrendingDown,
      color: counts.totalProfit >= 0 ? "bg-teal-600" : "bg-red-500",
      valueClass: counts.totalProfit >= 0 ? "text-teal-700" : "text-red-600",
    },
    { label: "Total Bookings", value: formatNumber(counts.bookings), icon: Briefcase, color: "bg-indigo-500" },
  ];

  const entityStats = [
    { label: "Clients", value: formatNumber(counts.clients), icon: Users, color: "bg-blue-500" },
    { label: "Corporates", value: formatNumber(counts.corporates), icon: Building2, color: "bg-purple-500" },
    { label: "Suppliers", value: formatNumber(counts.suppliers), icon: Store, color: "bg-indigo-500" },
    {
      label: "Invoices",
      value: formatNumber(counts.invoicesIssued),
      sub: `${formatNumber(counts.invoicesNotIssued)} pending`,
      icon: FileText,
      color: "bg-green-500",
    },
    { label: "Pending Bookings", value: formatNumber(counts.pending), icon: Clock, color: "bg-amber-500" },
  ];

  return (
    <div>
      <Navbar title={"Dashboard"} />

      <div className="p-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
            <p className="text-sm text-gray-500">{"Loading..."}</p>
          </div>
        ) : (
          <>
            {/* Primary KPIs — sales, cost, profit, bookings across every module */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
              {kpis.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.label}
                    className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4 shadow-sm"
                  >
                    <div className={`w-12 h-12 ${stat.color} rounded-lg flex items-center justify-center flex-shrink-0`}>
                      <Icon className="text-white" size={22} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-500 truncate">{stat.label}</p>
                      <p className={`text-2xl font-bold truncate ${stat.valueClass || "text-gray-900"}`}>
                        {stat.value}
                        {stat.suffix || ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Secondary — entity counts & operational status, smaller and less prominent */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
              {entityStats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.label}
                    className="bg-white rounded-lg border border-gray-200 p-3.5 flex items-center gap-3"
                  >
                    <div className={`w-9 h-9 ${stat.color} rounded-md flex items-center justify-center flex-shrink-0`}>
                      <Icon className="text-white" size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-500 truncate">{stat.label}</p>
                      <p className="text-base font-semibold text-gray-900 truncate">{stat.value}</p>
                      {stat.sub && <p className="text-[10px] text-gray-400">{stat.sub}</p>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Recent Activity + Sales Overview */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {/* Recent Activity Table — merged across flights, hotels, visa, transportation */}
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    <Briefcase size={18} className="text-indigo-500" /> Recent Activity
                  </h3>
                  <span className="text-xs text-gray-500">Last 6 bookings, all modules</span>
                </div>

                {recentActivity.length === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <Briefcase className="mx-auto text-gray-300 mb-3" size={36} />
                    <p className="text-sm text-gray-500">No bookings yet</p>
                    <p className="text-xs text-gray-400 mt-1">Bookings will appear here once created</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium">Type</th>
                          <th className="text-left px-4 py-3 font-medium">Client</th>
                          <th className="text-left px-4 py-3 font-medium">Details</th>
                          <th className="text-left px-4 py-3 font-medium">Date</th>
                          <th className="text-right px-4 py-3 font-medium">Sell (EGP)</th>
                          <th className="text-center px-4 py-3 font-medium">Status</th>
                          <th className="text-center px-4 py-3 font-medium">Invoice</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {recentActivity.map(({ type, row, totals }) => {
                          const meta = MODULE_META[type];
                          const ModIcon = meta.icon;
                          const client = row.clientName || row.clientCode || "-";
                          const status = row.status || "Pending";
                          const statusLower = String(status).toLowerCase();
                          const statusColor =
                            statusLower === "confirmed"
                              ? "bg-green-100 text-green-700"
                              : statusLower === "pending"
                                ? "bg-amber-100 text-amber-700"
                                : statusLower === "cancelled"
                                  ? "bg-red-100 text-red-500"
                                  : "bg-gray-100 text-gray-700";
                          const dateVal =
                            row.issueDate || (row.createdAt?.toDate ? row.createdAt.toDate().toISOString().slice(0, 10) : "-");
                          return (
                            <tr key={`${type}-${row.id}`} className="hover:bg-gray-50">
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${meta.badge}`}>
                                  <ModIcon size={12} /> {meta.label}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium text-gray-900 truncate max-w-[130px]" title={client}>
                                  {client}
                                </div>
                                <div className="text-xs text-gray-500 truncate max-w-[130px]">{row.invoiceNumber || ""}</div>
                              </td>
                              <td className="px-4 py-3 text-gray-700">
                                <div className="font-medium truncate max-w-[180px]">{describeRow(type, row)}</div>
                              </td>
                              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{dateVal}</td>
                              <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${totals.totalSell < 0 ? "text-red-600" : "text-gray-900"}`}>
                                {formatCurrency(totals.totalSell)}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${statusColor}`}>
                                  {status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span
                                  className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${row.invoiceIssued ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}
                                >
                                  {row.invoiceIssued ? "Yes" : "No"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Summary Card */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <TrendingUp size={18} className="text-blue-600" /> Sales Overview
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
                    <div>
                      <p className="text-xs text-gray-500">Total Sales</p>
                      <p className="text-lg font-bold text-emerald-700">{formatCurrency(counts.totalSales)} EGP</p>
                    </div>
                    <DollarSign className="text-emerald-600" size={20} />
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-xs text-gray-500">Total Cost (Buy)</p>
                      <p className="text-lg font-bold text-gray-800">{formatCurrency(counts.totalBuy)} EGP</p>
                    </div>
                    <FileText className="text-gray-600" size={20} />
                  </div>
                  <div className={`flex items-center justify-between p-3 rounded-lg ${counts.totalProfit >= 0 ? "bg-teal-50" : "bg-red-50"}`}>
                    <div>
                      <p className="text-xs text-gray-500">Total Profit</p>
                      <p className={`text-lg font-bold ${counts.totalProfit >= 0 ? "text-teal-700" : "text-red-600"}`}>
                        {formatCurrency(counts.totalProfit)} EGP
                      </p>
                    </div>
                    <TrendingUp className={counts.totalProfit >= 0 ? "text-teal-600" : "text-red-600"} size={20} />
                  </div>
                  <div className="pt-2 grid grid-cols-2 gap-3 text-center">
                    <div className="p-3 border rounded-lg">
                      <p className="text-2xl font-bold text-gray-900">{formatNumber(counts.invoicesIssued)}</p>
                      <p className="text-xs text-gray-500">Invoices Issued</p>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <p className="text-2xl font-bold text-amber-600">{formatNumber(counts.pending)}</p>
                      <p className="text-xs text-gray-500">Pending</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Welcome Message - keep but only show if empty-ish, else compact */}
            {counts.bookings === 0 && counts.clients === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <TrendingUp className="mx-auto text-blue-600 mb-4" size={48} />
                <h3 className="text-xl font-semibold text-gray-800 mb-2">Welcome to Travel Agency Management</h3>
                <p className="text-gray-500 max-w-lg mx-auto">
                  Manage your clients, bookings, invoices, accounting and more from one place. Start by adding clients or creating your
                  first booking.
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
