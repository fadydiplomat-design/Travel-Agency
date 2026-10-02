"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/lib/auth";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isBranchVisible, bookingQuery } from "@/lib/helpers";
import ExportButtons from "@/components/ExportButtons";
import CodeFilterPicker from "@/components/CodeFilterPicker";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import {
  Printer, Users, UserCheck, Building2, Filter, Landmark, Globe2,
  CreditCard, TrendingUp, TrendingDown, Wallet, Receipt, SlidersHorizontal,
} from "lucide-react";
// parseNum/fmt/palette/toEGP/normalizeForAnalysis used to be defined
// locally here — the exact same functions (and the exact same currency-
// conversion and cancelled-booking bugs, found and fixed independently)
// also existed in Accounts and Reports. Shared now via
// lib/bookingNormalize.js; see that file's header comment for why.
import {
  parseNum,
  fmtMoney as fmt,
  chartColor as palette,
  normalizeBookingRow as normalizeForAnalysis,
} from "@/lib/bookingNormalize";

/* ═══════════════════════════════════════════════════════════
   Data Analysis — integrated multi-dimensional BI dashboard.
   One shared pipeline (normalizeForAnalysis → rows) feeds:
     - KPI summary (Sales / Cost / Gross Profit / Margin / Docs)
     - a Sales·Cost·Profit trend chart over the selected period
     - a switchable breakdown (pie + ranked table) by Salesman,
       Client, Supplier, Product, Branch, Currency or Payment —
       all sharing one grouping engine so every dimension behaves
       identically (same ranking metric, same % of total, same
       "Cost Card" toggle)
   Filterable by code (Client / Corporate / Supplier / Employee)
   the same way Reports and Accounts are, for a consistent feel
   across the app's analytics screens.
═══════════════════════════════════════════════════════════ */


/** One grouping engine reused by every breakdown dimension so they all
 *  behave identically (same ranking metric, same "% of total"). */
function groupRows(rows, keyFn, metric) {
  const map = {};
  for (const r of rows) {
    const key = keyFn(r) || "Unknown";
    if (!map[key]) map[key] = { name: key, count: 0, sell: 0, buy: 0, profit: 0 };
    map[key].count += 1;
    map[key].sell += r.sell;
    map[key].buy += r.buy;
    map[key].profit += r.profit;
  }
  const list = Object.values(map)
    .filter((s) => Math.abs(s[metric]) > 0.004)
    .sort((a, b) => b[metric] - a[metric]);
  const total = list.reduce((sum, s) => sum + s[metric], 0);
  return list.map((s, i) => ({
    ...s,
    value: s[metric],
    pct: total !== 0 ? (s[metric] / total) * 100 : 0,
    color: palette(i),
  }));
}

const SECTIONS = ["Flight", "Hotel", "Visa", "Transport"];

function StatCard({ label, value, color, sub, icon: Icon }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        {Icon && (
          <span className="p-1 rounded-lg bg-gray-50">
            <Icon size={12} className={color} />
          </span>
        )}
      </div>
      <div className={`text-base font-bold tabular-nums ${color}`}>{fmt(value)}</div>
      {sub && <div className="text-[9px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

const inputCls = "px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm";

export default function AnalysisPage() {
  const { userData, hasPermission, activeBranch, myBranches, branchesList, user } = useAuth();
  const isAdmin = hasPermission ? hasPermission(["Admin"]) : userData?.role === "Admin";

  const [flights, setFlights] = useState([]);
  const [hotels, setHotels] = useState([]);
  const [visaList, setVisaList] = useState([]);
  const [transportation, setTransportation] = useState([]);
  const [loading, setLoading] = useState(true);

  // Master lists for the code-based filters — same pattern as Reports.
  const [clients, setClients] = useState([]);
  const [corporates, setCorporates] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(todayStr);
  const [section, setSection] = useState("all");
  const [branch, setBranch] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [clientCode, setClientCode] = useState("all");
  const [corpCode, setCorpCode] = useState("all");
  const [supplierCode, setSupplierCode] = useState("all");
  const [employeeCode, setEmployeeCode] = useState("all");
  const [costCard, setCostCard] = useState(false); // False = rank by Sales, True = rank by Gross Profit
  const [dimension, setDimension] = useState("salesman");
  const [printedAt, setPrintedAt] = useState(null);

  const tableRef = useRef(null);

  useEffect(() => {
    setPrintedAt(new Date());
    const subs = [
      onSnapshot(bookingQuery("flights", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (s) => setFlights(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(bookingQuery("hotels", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (s) => setHotels(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(bookingQuery("visa", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (s) => setVisaList(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(bookingQuery("transportation", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (s) => setTransportation(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
    ];
    setLoading(false);
    return () => subs.forEach((u) => u && u());
    // These listeners are narrowed by branch / own-work (bookingQuery), so
    // they have to be torn down and re-opened when that context changes —
    // notably on first load, when userData arrives after the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, JSON.stringify(myBranches), userData?.onlyOwnData, user?.uid]);

  // Master data for the code pickers — not date/branch filtered, same as
  // the Reports screen's own client/corporate/supplier pickers.
  useEffect(() => {
    const subs = [
      onSnapshot(collection(db, "clients"), (s) => setClients(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, "corporates"), (s) => setCorporates(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, "suppliers"), (s) => setSuppliers(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
    ];
    return () => subs.forEach((u) => u && u());
  }, []);

  const branchName = (code) => branchesList?.find((b) => b.code === code)?.name || code;

  const clientOptions = useMemo(
    () => clients.map((c) => ({ code: c.code || "", name: c.name || "" })).filter((c) => c.code).sort((a, b) => a.code.localeCompare(b.code)),
    [clients]
  );
  const corpOptions = useMemo(
    () => corporates.map((c) => ({ code: c.code || "", name: c.name || "" })).filter((c) => c.code).sort((a, b) => a.code.localeCompare(b.code)),
    [corporates]
  );
  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({ code: s.code || "", name: s.name || s.symbol || "" })).filter((s) => s.code).sort((a, b) => a.code.localeCompare(b.code)),
    [suppliers]
  );

  // Every filter except the employee one — this is what the Employee
  // picker's own code list is built from (see Reports for the same
  // pattern), so it only ever offers codes that actually appear here.
  const baseRows = useMemo(() => {
    const ctx = { isAdmin, activeBranch, myBranches };
    return [
      ...flights.map((r) => normalizeForAnalysis(r, "Flight")),
      ...hotels.map((r) => normalizeForAnalysis(r, "Hotel")),
      ...visaList.map((r) => normalizeForAnalysis(r, "Visa")),
      ...transportation.map((r) => normalizeForAnalysis(r, "Transport")),
    ]
      .filter((r) => isBranchVisible(r.branch, ctx))
      .filter((r) => !r.isVoid)
      .filter((r) => (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo))
      .filter((r) => section === "all" || r.section === section)
      .filter((r) => branch === "all" || r.branch === branch)
      .filter((r) => currencyFilter === "all" || r.currency === currencyFilter)
      .filter((r) => clientCode === "all" || r.clientCode === clientCode)
      .filter((r) => corpCode === "all" || r.clientCode === corpCode)
      .filter((r) => supplierCode === "all" || r.supplierCode === supplierCode);
  }, [flights, hotels, visaList, transportation, isAdmin, activeBranch, myBranches, dateFrom, dateTo, section, branch, currencyFilter, clientCode, corpCode, supplierCode]);

  const employeeOptions = useMemo(() => {
    const map = {};
    for (const r of baseRows) {
      const code = r.salesmanCode || "—";
      if (!map[code]) map[code] = { code, name: r.salesman || "Unassigned" };
    }
    return Object.values(map).sort((a, b) => a.code.localeCompare(b.code));
  }, [baseRows]);

  const rows = useMemo(
    () => baseRows.filter((r) => employeeCode === "all" || r.salesmanCode === employeeCode),
    [baseRows, employeeCode]
  );

  const metric = costCard ? "profit" : "sell";
  const metricLabel = costCard ? "Gross Profit" : "Sales";

  const kpis = useMemo(() => {
    let sales = 0, cost = 0, profit = 0;
    rows.forEach((r) => { sales += r.sell; cost += r.buy; profit += r.profit; });
    const marginPct = sales !== 0 ? (profit / Math.abs(sales)) * 100 : 0;
    const avgDeal = rows.length ? sales / rows.length : 0;
    return { sales, cost, profit, marginPct, count: rows.length, avgDeal };
  }, [rows]);

  // Trend — bucketed by day when the window is short enough to read one,
  // otherwise by month so a full-year view doesn't render 365 bars.
  const trend = useMemo(() => {
    const byDay =
      dateFrom && dateTo
        ? (new Date(dateTo) - new Date(dateFrom)) / 86400000 <= 62
        : true;
    const map = {};
    rows.forEach((r) => {
      if (!r.date) return;
      const key = byDay ? r.date : r.date.slice(0, 7);
      if (!map[key]) map[key] = { key, sales: 0, cost: 0, profit: 0 };
      map[key].sales += r.sell;
      map[key].cost += r.buy;
      map[key].profit += r.profit;
    });
    return { byDay, data: Object.values(map).sort((a, b) => a.key.localeCompare(b.key)) };
  }, [rows, dateFrom, dateTo]);

  const DIMENSIONS = useMemo(
    () => [
      { id: "salesman", label: "Salesman", icon: UserCheck, keyFn: (r) => r.salesman || "Unassigned" },
      { id: "client", label: "Client", icon: Users, keyFn: (r) => (r.clientCode ? `${r.clientCode} — ${r.clientName}` : r.clientName) },
      { id: "supplier", label: "Supplier", icon: Building2, keyFn: (r) => (r.supplierCode ? `${r.supplierCode} — ${r.supplierName}` : r.supplierName) },
      { id: "section", label: "Product", icon: Filter, keyFn: (r) => (r.section === "Flight" ? "Air Tickets" : r.section) },
      { id: "branch", label: "Branch", icon: Landmark, keyFn: (r) => branchName(r.branch) },
      { id: "currency", label: "Currency", icon: Globe2, keyFn: (r) => r.currency },
      { id: "payment", label: "Payment", icon: CreditCard, keyFn: (r) => (r.isCC ? "Card" : "Cash") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branchesList]
  );
  const activeDimension = DIMENSIONS.find((d) => d.id === dimension) || DIMENSIONS[0];

  const breakdown = useMemo(
    () => groupRows(rows, activeDimension.keyFn, metric),
    [rows, activeDimension, metric]
  );
  const breakdownTotal = breakdown.reduce((sum, s) => sum + s.value, 0);

  const handlePrint = () => window.print();

  return (
    <div>
      <Navbar title={"Data Analysis"} />

      <div className="p-6 space-y-4">
        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 print:hidden">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Period From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Period To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Product</label>
              <select value={section} onChange={(e) => setSection(e.target.value)} className={inputCls}>
                <option value="all">All Products</option>
                {SECTIONS.map((s) => <option key={s} value={s}>{s === "Flight" ? "Air Tickets" : s}</option>)}
              </select>
            </div>
            {isAdmin && branchesList?.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Branch</label>
                <select value={branch} onChange={(e) => setBranch(e.target.value)} className={inputCls}>
                  <option value="all">All Branches</option>
                  {branchesList.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Currency</label>
              <select value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)} className={inputCls}>
                <option value="all">All Currencies</option>
                <option value="EGP">EGP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 pb-2 cursor-pointer">
              <input type="checkbox" checked={costCard} onChange={(e) => setCostCard(e.target.checked)} />
              Cost Card (rank by Gross Profit instead of Sales)
            </label>
            <div className="ml-auto flex items-center gap-2">
              <ExportButtons targetRef={tableRef} filename={`Analysis_${activeDimension.label}_${dateFrom}_to_${dateTo}`} title={`Data Analysis — By ${activeDimension.label} (${dateFrom} to ${dateTo})`} />
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                <Printer size={16} /> Print
              </button>
            </div>
          </div>

          {/* Code-based filtering — same direct-code pickers as Reports. */}
          <div className="pt-3 border-t border-dashed border-gray-200">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 mb-2">
              <SlidersHorizontal size={13} />
              Filter by Code
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <CodeFilterPicker label="Client" options={clientOptions} value={clientCode} onChange={setClientCode} placeholder="All Clients" />
              <CodeFilterPicker label="Corporate" options={corpOptions} value={corpCode} onChange={setCorpCode} placeholder="All Corporates" />
              <CodeFilterPicker label="Supplier" options={supplierOptions} value={supplierCode} onChange={setSupplierCode} placeholder="All Suppliers" />
              <CodeFilterPicker label="Employee" options={employeeOptions} value={employeeCode} onChange={setEmployeeCode} placeholder="All Employees" />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-16 text-sm">Loading…</div>
        ) : (
          <>
            {/* KPI summary */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 print:hidden">
              <StatCard label="Sales" value={kpis.sales} color="text-emerald-600" sub={`${kpis.count} bookings`} icon={TrendingUp} />
              <StatCard label="Cost" value={kpis.cost} color="text-slate-700" icon={TrendingDown} />
              <StatCard label="Gross Profit" value={kpis.profit} color={kpis.profit >= 0 ? "text-teal-600" : "text-red-600"} sub={`${kpis.marginPct.toFixed(1)}% margin`} icon={Wallet} />
              <StatCard label="Margin %" value={kpis.marginPct} color="text-purple-600" icon={Wallet} />
              <StatCard label="Avg Deal" value={kpis.avgDeal} color="text-blue-600" icon={Receipt} />
              <StatCard label="Docs" value={kpis.count} color="text-slate-500" icon={Receipt} />
            </div>

            {/* Trend */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 print:hidden">
              <div className="text-sm font-semibold text-gray-700 mb-2">
                Sales · Cost · Profit Trend {trend.byDay ? "(daily)" : "(monthly)"}
              </div>
              {trend.data.length === 0 ? (
                <div className="text-center text-gray-400 py-10 text-sm">No data in this period.</div>
              ) : (
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trend.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="key" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v) => fmt(v)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="sales" name="Sales" fill="#10b981" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="cost" name="Cost" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                      <Line type="monotone" dataKey="profit" name="Profit" stroke="#2563eb" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Breakdown */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-6 pt-5 print:block">
                <h2 className="font-bold text-gray-800">Travel Agency Management</h2>
                <div className="text-right text-xs text-gray-500 print:hidden">
                  {printedAt && (
                    <>
                      <div>{printedAt.toLocaleDateString()} {printedAt.toLocaleTimeString()}</div>
                      <div>Page 1</div>
                    </>
                  )}
                </div>
              </div>

              <div className="mx-6 mt-3 bg-slate-100 border border-slate-300 rounded text-center py-2">
                <span className="font-bold text-slate-800 text-base">Best {activeDimension.label}</span>
              </div>

              <div className="text-center text-sm text-gray-600 mt-2">
                Period From : {dateFrom || "…"} To : {dateTo || "…"}
              </div>

              <div className="px-6 mt-3 flex items-center justify-between text-sm">
                <span className="text-gray-500">Cost Card : {costCard ? "True" : "False"}</span>
                <span className="font-bold text-gray-800">
                  Total ({metricLabel}) : {fmt(breakdownTotal)}
                </span>
              </div>

              {/* Dimension tabs */}
              <div className="flex gap-1 px-6 mt-4 text-xs overflow-x-auto print:hidden">
                {DIMENSIONS.map((d) => {
                  const Icon = d.icon;
                  return (
                    <button
                      key={d.id}
                      onClick={() => setDimension(d.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full whitespace-nowrap font-medium border ${
                        dimension === d.id
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "border-gray-200 text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      <Icon size={12} /> By {d.label}
                    </button>
                  );
                })}
              </div>

              {breakdown.length === 0 ? (
                <div className="text-center text-gray-400 py-16 text-sm flex flex-col items-center gap-2">
                  <Users size={28} className="text-gray-300" />
                  No data in this period.
                </div>
              ) : (
                <div className="flex flex-wrap items-start gap-6 px-6 py-6">
                  <div className="w-full lg:w-[420px] h-[360px] flex-shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={breakdown}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={135}
                          label={({ name, pct }) => (pct >= 1.5 ? `${name} ${pct.toFixed(2)}%` : "")}
                          labelLine={{ stroke: "#94a3b8" }}
                          isAnimationActive={false}
                        >
                          {breakdown.map((s) => (
                            <Cell key={s.name} fill={s.color} stroke="#fff" strokeWidth={1} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v, n, p) => [`${fmt(v)} (${p.payload.pct.toFixed(2)}%)`, p.payload.name]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div ref={tableRef} className="flex-1 min-w-[300px] overflow-auto max-h-[400px]">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-1.5">{activeDimension.label}</th>
                          <th className="text-right px-3 py-1.5">Docs</th>
                          <th className="text-right px-3 py-1.5">Sales</th>
                          <th className="text-right px-3 py-1.5">Cost</th>
                          <th className="text-right px-3 py-1.5">Profit</th>
                          <th className="text-right px-3 py-1.5">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdown.map((s) => (
                          <tr key={s.name} className="border-t border-gray-100">
                            <td className="px-3 py-1.5">
                              <span className="w-2 h-2 rounded-sm inline-block mr-1.5 align-middle" style={{ backgroundColor: s.color }} />
                              {s.name}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{s.count}</td>
                            <td className="px-3 py-1.5 text-right text-emerald-700 tabular-nums">{fmt(s.sell)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmt(s.buy)}</td>
                            <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${s.profit >= 0 ? "text-teal-600" : "text-red-600"}`}>{fmt(s.profit)}</td>
                            <td className="px-3 py-1.5 text-right text-gray-400 tabular-nums">{s.pct.toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
