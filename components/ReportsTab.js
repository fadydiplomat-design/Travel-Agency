"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isBranchVisible, bookingQuery } from "@/lib/helpers";
import { useAuth } from "@/lib/auth";
import ExportButtons from "@/components/ExportButtons";
import CodeFilterPicker from "@/components/CodeFilterPicker";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { FileBarChart, Users, SlidersHorizontal } from "lucide-react";
// parseNum/fmt/palette/normalize used to be defined locally here, WITHOUT
// currency conversion — a booking sold in USD or EUR was silently summed
// as if it were EGP. Now shared with Accounts and Data Analysis (which
// each had this same bug independently) via lib/bookingNormalize.js; see
// that file's header comment.
import {
  parseNum,
  fmtMoney as fmt,
  chartColor as palette,
  normalizeBookingRow as normalize,
} from "@/lib/bookingNormalize";

const REPORT_TYPES = [
  { id: "salesman", label: "Sales by Salesman" },
  { id: "section", label: "Sales by Section" },
  { id: "client", label: "Sales by Client" },
  { id: "branch", label: "Sales by Branch" },
  { id: "transactions", label: "Detailed Transactions" },
];

const SECTIONS = ["Flight", "Hotel", "Visa", "Transport"];

const inputCls = "px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm";

export default function ReportsTab() {
  const { userData, hasPermission, activeBranch, myBranches, branchesList, user } = useAuth();
  const isAdmin = hasPermission ? hasPermission(["Admin"]) : userData?.role === "Admin";

  const [flights, setFlights] = useState([]);
  const [hotels, setHotels] = useState([]);
  const [visaList, setVisaList] = useState([]);
  const [transportation, setTransportation] = useState([]);

  // Master lists — used to show real codes directly in the filter pickers
  // below, instead of a plain dropdown of names.
  const [clients, setClients] = useState([]);
  const [corporates, setCorporates] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  const [reportType, setReportType] = useState("salesman");
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(todayStr);
  const [section, setSection] = useState("all");
  const [branch, setBranch] = useState("all");

  // Code-based filters (Client / Corporate / Supplier / Employee).
  const [clientCode, setClientCode] = useState("all");
  const [corpCode, setCorpCode] = useState("all");
  const [supplierCode, setSupplierCode] = useState("all");
  const [employeeCode, setEmployeeCode] = useState("all");

  const tableRef = useRef(null);

  useEffect(() => {
    const subs = [
      onSnapshot(bookingQuery("flights", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (s) => setFlights(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(bookingQuery("hotels", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (s) => setHotels(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(bookingQuery("visa", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (s) => setVisaList(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(bookingQuery("transportation", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (s) => setTransportation(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
    ];
    return () => subs.forEach((u) => u && u());
    // Re-subscribe when the branch / own-work context changes — see the same
    // note in analysis/page.js.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, JSON.stringify(myBranches), userData?.onlyOwnData, user?.uid]);

  // Master data for the code pickers. Not branch-scoped by Firestore rules,
  // so these are read as-is (same pattern already used on the booking
  // pages' own Client/Supplier pickers).
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

  // Rows with every filter applied EXCEPT the employee one — this is what
  // the Employee picker's own code list is built from, and what the
  // Salesman-mode analysis view (pie + ranked list) is computed from.
  const baseRows = useMemo(() => {
    const ctx = { isAdmin, activeBranch, myBranches };
    return [
      ...flights.map((r) => normalize(r, "Flight")),
      ...hotels.map((r) => normalize(r, "Hotel")),
      ...visaList.map((r) => normalize(r, "Visa")),
      ...transportation.map((r) => normalize(r, "Transport")),
    ]
      .filter((r) => isBranchVisible(r.branch, ctx))
      .filter((r) => (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo))
      .filter((r) => section === "all" || r.section === section)
      .filter((r) => branch === "all" || r.branch === branch)
      .filter((r) => clientCode === "all" || r.clientCode === clientCode)
      .filter((r) => corpCode === "all" || r.clientCode === corpCode)
      .filter((r) => supplierCode === "all" || r.supplierCode === supplierCode);
  }, [flights, hotels, visaList, transportation, isAdmin, activeBranch, myBranches, dateFrom, dateTo, section, branch, clientCode, corpCode, supplierCode]);

  // Codes actually seen in the current selection — shown directly (not as
  // a name-only dropdown) so the Employee filter always reflects real data.
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

  // "Sales by Salesman" with no specific employee picked → same breakdown
  // (grouping, ranking, pie chart) as the Data Analysis page. Picking one
  // employee switches straight to the detailed/table view for that person.
  const showSalesmanAnalysis = reportType === "salesman" && employeeCode === "all";

  const bySalesman = useMemo(() => {
    if (!showSalesmanAnalysis) return [];
    const map = {};
    for (const r of baseRows) {
      const key = r.salesman || "Unassigned";
      if (!map[key]) map[key] = { name: key, count: 0, sell: 0, buy: 0, profit: 0 };
      map[key].count += 1;
      map[key].sell += r.sell;
      map[key].buy += r.buy;
      map[key].profit += r.profit;
    }
    const list = Object.values(map)
      .filter((s) => Math.abs(s.sell) > 0.004)
      .sort((a, b) => b.sell - a.sell);
    const total = list.reduce((sum, s) => sum + s.sell, 0);
    return list.map((s, i) => ({
      ...s,
      value: s.sell,
      pct: total !== 0 ? (s.sell / total) * 100 : 0,
      color: palette(i),
    }));
  }, [baseRows, showSalesmanAnalysis]);
  const salesmanTotal = bySalesman.reduce((sum, s) => sum + s.value, 0);

  const grouped = useMemo(() => {
    if (reportType === "transactions") {
      return rows
        .slice()
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        .map((r) => ({
          Date: r.date,
          Section: r.section,
          Client: r.clientCode ? `${r.clientCode} — ${r.clientName}` : r.clientName || "—",
          Salesman: r.salesmanCode ? `${r.salesmanCode} — ${r.salesman}` : r.salesman,
          Ref: r.ref,
          Sell: r.sell,
          Buy: r.buy,
          Profit: r.profit,
        }));
    }

    const keyFn =
      reportType === "salesman"
        ? (r) => (r.salesmanCode ? `${r.salesmanCode} — ${r.salesman}` : r.salesman)
        : reportType === "section"
        ? (r) => r.section
        : reportType === "branch"
        ? (r) => branchName(r.branch)
        : (r) => (r.clientCode ? `${r.clientCode} — ${r.clientName}` : r.clientName || "—");

    const map = {};
    for (const r of rows) {
      const k = keyFn(r) || "—";
      if (!map[k]) map[k] = { key: k, count: 0, sell: 0, buy: 0, profit: 0 };
      map[k].count += 1;
      map[k].sell += r.sell;
      map[k].buy += r.buy;
      map[k].profit += r.profit;
    }
    const label = reportType === "salesman" ? "Salesman" : reportType === "section" ? "Section" : reportType === "branch" ? "Branch" : "Client";
    return Object.values(map)
      .sort((a, b) => b.sell - a.sell)
      .map((s) => ({
        [label]: s.key,
        Docs: s.count,
        Sales: s.sell,
        Cost: s.buy,
        "Gross Profit": s.profit,
        "Margin %": s.sell !== 0 ? ((s.profit / Math.abs(s.sell)) * 100).toFixed(1) : "0.0",
      }));
  }, [rows, reportType]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = grouped.length > 0 ? Object.keys(grouped[0]) : [];
  const isMoneyCol = (c) => ["Sell", "Buy", "Profit", "Sales", "Cost", "Gross Profit"].includes(c);

  const reportLabel = REPORT_TYPES.find((r) => r.id === reportType)?.label || "Report";
  const filename = `${reportLabel.replace(/\s+/g, "_")}_${dateFrom}_to_${dateTo}`;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Report</label>
            <select value={reportType} onChange={(e) => setReportType(e.target.value)} className={inputCls}>
              {REPORT_TYPES.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Section</label>
            <select value={section} onChange={(e) => setSection(e.target.value)} className={inputCls}>
              <option value="all">All Sections</option>
              {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
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
          <div className="ml-auto">
            <ExportButtons targetRef={tableRef} filename={filename} title={`${reportLabel}  (${dateFrom} to ${dateTo})`} />
          </div>
        </div>

        {/* Code-based filtering — Client / Corporate / Supplier / Employee,
            shown as direct, searchable code lists instead of name dropdowns. */}
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

      {showSalesmanAnalysis ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50 flex items-center gap-2">
            <Users size={16} className="text-blue-600" />
            <span className="font-semibold text-sm text-gray-800">Best Salesman</span>
            <span className="text-xs text-gray-400">· {dateFrom} → {dateTo} · pick an Employee above to drill into one</span>
          </div>

          {bySalesman.length === 0 ? (
            <div className="text-center text-gray-400 py-16 text-sm flex flex-col items-center gap-2">
              <Users size={28} className="text-gray-300" />
              No data for this selection.
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-6 px-6 py-6">
              <div className="w-full lg:w-[420px] h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={bySalesman}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={135}
                      label={({ name, pct }) => (pct >= 1.5 ? `${name} ${pct.toFixed(2)}%` : "")}
                      labelLine={{ stroke: "#94a3b8" }}
                      isAnimationActive={false}
                    >
                      {bySalesman.map((s) => (
                        <Cell key={s.name} fill={s.color} stroke="#fff" strokeWidth={1} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, n, p) => [`${fmt(v)} (${p.payload.pct.toFixed(2)}%)`, p.payload.name]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="flex-1 min-w-[260px] border border-gray-200 rounded-lg max-h-[360px] overflow-y-auto">
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 border-b bg-slate-50 flex justify-between">
                  <span>Salesman</span>
                  <span>Sales (Total: {fmt(salesmanTotal)})</span>
                </div>
                {bySalesman.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-gray-100 last:border-0">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="tabular-nums text-gray-500 w-24 text-right flex-shrink-0">{fmt(s.value)}</span>
                    <span className="text-gray-800 truncate">{s.name}</span>
                    <span className="ml-auto text-gray-400 flex-shrink-0">{s.pct.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50 flex items-center gap-2">
            <FileBarChart size={16} className="text-blue-600" />
            <span className="font-semibold text-sm text-gray-800">{reportLabel}</span>
            <span className="text-xs text-gray-400">· {dateFrom} → {dateTo} · {grouped.length} rows</span>
          </div>

          <div ref={tableRef} className="overflow-auto max-h-[calc(100vh-360px)]">
            {grouped.length === 0 ? (
              <div className="text-center text-sm text-gray-400 py-12">No data for this selection.</div>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 text-slate-500 sticky top-0">
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className={`px-3 py-2 ${isMoneyCol(c) ? "text-right" : "text-left"}`}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((row, i) => (
                    <tr key={i} className="border-t border-gray-100 hover:bg-slate-50">
                      {columns.map((c) => (
                        <td key={c} className={`px-3 py-1.5 ${isMoneyCol(c) ? "text-right tabular-nums" : ""}`}>
                          {isMoneyCol(c) ? fmt(row[c]) : row[c]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
