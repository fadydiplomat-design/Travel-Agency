"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/lib/auth";
import { canWriteModule } from "@/lib/permissions";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  getFlightTotals,
  getHotelTotals,
  getVisaTotals,
  getTransportationTotals,
} from "@/lib/helpers";
import {
  FISCAL_YEAR_ROLES,
  FISCAL_YEAR_COLLECTIONS,
  useFiscalYears,
  closeFiscalYear,
  openFiscalYear,
  yearFromDate,
  fiscalYearKey,
  normalizeYear,
} from "@/lib/fiscalYear";
import toast from "react-hot-toast";
import { Lock, Unlock, Archive, Plane, Hotel, FileCheck, Car, ShieldAlert } from "lucide-react";

const MODULE_ICONS = { flights: Plane, hotels: Hotel, visa: FileCheck, transportation: Car };
const MODULE_TOTALS = {
  flights: getFlightTotals,
  hotels: getHotelTotals,
  visa: getVisaTotals,
  transportation: getTransportationTotals,
};

function fmt(v) {
  return Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FiscalYearPage() {
  const { userData, isAdmin, activeBranch, myBranches, branchesList, appFeatures } = useAuth();

  // Closing/reopening a year is a WRITE on the Fiscal Year module, so it
  // follows Settings > Permissions like everything else: the role list in
  // FISCAL_YEAR_ROLES is only the default for a user with no custom
  // permissions. Read-only access (Read on, Write off) still shows the
  // archive below, just without the close/open controls.
  const canManage = canWriteModule(userData, "fiscalYear", isAdmin, appFeatures);

  // Branches this user is allowed to close/open years for.
  const selectableBranches = useMemo(() => {
    if (isAdmin) return branchesList || [];
    return (branchesList || []).filter((b) => (myBranches || []).includes(b.code || b.id));
  }, [isAdmin, branchesList, myBranches]);

  const currentYear = normalizeYear(new Date().getFullYear());
  const [branch, setBranch] = useState("");
  const [year, setYear] = useState(currentYear);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!branch && selectableBranches.length > 0) {
      setBranch(selectableBranches[0].code || selectableBranches[0].id);
    }
  }, [selectableBranches, branch]);

  const fiscalYears = useFiscalYears();

  const statusFor = (b, y) => {
    const key = fiscalYearKey(b, y);
    const doc = fiscalYears.find((f) => fiscalYearKey(f.branch, f.year) === key);
    return doc?.status === "closed" ? doc : null;
  };

  const currentStatus = branch ? statusFor(branch, year) : null;

  const handleClose = async () => {
    if (!branch || !year) return;
    if (!confirm(`Close fiscal year 20${normalizeYear(year)} for branch ${branch}? Its bookings & invoices will disappear from the normal tables (still viewable in the archive below).`)) return;
    setBusy(true);
    try {
      await closeFiscalYear(branch, year, userData);
      toast.success(`Fiscal year 20${normalizeYear(year)} closed for branch ${branch}`);
    } catch (e) {
      toast.error("Failed to close: " + (e.message || ""));
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async () => {
    if (!branch || !year) return;
    if (!confirm(`Re-open fiscal year 20${normalizeYear(year)} for branch ${branch}? Its records will reappear in the normal tables.`)) return;
    setBusy(true);
    try {
      await openFiscalYear(branch, year, userData);
      toast.success(`Fiscal year 20${normalizeYear(year)} re-opened for branch ${branch}`);
    } catch (e) {
      toast.error("Failed to open: " + (e.message || ""));
    }
    setBusy(false);
  };

  const closedYears = fiscalYears.filter((f) => f.status === "closed");

  /* ── Archive viewer ── */
  const [archiveKey, setArchiveKey] = useState(""); // "branch_year"
  const [archiveModule, setArchiveModule] = useState("flights");
  const [rawData, setRawData] = useState({ flights: [], hotels: [], visa: [], transportation: [] });

  useEffect(() => {
    const unsubs = FISCAL_YEAR_COLLECTIONS.map(({ key }) =>
      onSnapshot(collection(db, key), (snap) => {
        setRawData((prev) => ({ ...prev, [key]: snap.docs.map((d) => ({ id: d.id, ...d.data() })) }));
      }, () => {})
    );
    return () => unsubs.forEach((u) => u && u());
  }, []);

  const [archiveBranch, archiveYear] = archiveKey ? archiveKey.split("_") : ["", ""];

  const archiveRows = useMemo(() => {
    if (!archiveKey) return [];
    const rows = rawData[archiveModule] || [];
    return rows.filter((r) => (r.branch || "1") === archiveBranch && yearFromDate(r.issueDate) === archiveYear);
  }, [archiveKey, archiveModule, rawData, archiveBranch, archiveYear]);

  const archiveTotals = useMemo(() => {
    const totalsFn = MODULE_TOTALS[archiveModule];
    return archiveRows.reduce(
      (acc, r) => {
        const t = totalsFn ? totalsFn(r) : { totalSell: 0, totalBuy: 0, totalProfit: 0 };
        acc.sell += t.totalSell || 0;
        acc.buy += t.totalBuy || 0;
        acc.profit += t.totalProfit || 0;
        return acc;
      },
      { sell: 0, buy: 0, profit: 0 }
    );
  }, [archiveRows, archiveModule]);

  if (!canManage && closedYears.length === 0) {
    return (
      <div>
        <Navbar title={"Fiscal Year"} />
        <div className="p-6">
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500">
            <ShieldAlert className="mx-auto mb-3 text-gray-300" size={40} />
            You don't have access to fiscal year management.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Navbar title={"Fiscal Year"} />
      <div className="p-4 space-y-6">
        {/* Close / Open panel */}
        {canManage && (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Close / Open Fiscal Year</h3>
            <p className="text-sm text-gray-500 mb-4">
              Closing a fiscal year hides that branch's bookings & invoices dated in that year from every module's
              tables — nothing is deleted, and it stays fully visible in the archive below. Registration numbers
              keep counting normally and are never affected. Only {FISCAL_YEAR_ROLES.join(", ")} can close or
              re-open a year.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Branch</label>
                <select
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[160px]"
                >
                  {selectableBranches.map((b) => (
                    <option key={b.id} value={b.code || b.id}>
                      {b.name || b.code || b.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Year</label>
                <input
                  value={year}
                  onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  placeholder="26"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-24"
                />
              </div>
              <div className="text-sm px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
                Status:{" "}
                {currentStatus ? (
                  <span className="text-red-600 font-medium">
                    Closed{currentStatus.closedBy ? ` · by ${currentStatus.closedBy}` : ""}
                  </span>
                ) : (
                  <span className="text-emerald-600 font-medium">Open</span>
                )}
              </div>
              {currentStatus ? (
                <button
                  onClick={handleOpen}
                  disabled={busy || !branch}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
                >
                  <Unlock size={16} /> Open Year
                </button>
              ) : (
                <button
                  onClick={handleClose}
                  disabled={busy || !branch}
                  className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
                >
                  <Lock size={16} /> Close Year
                </button>
              )}
            </div>

            {closedYears.length > 0 && (
              <div className="mt-5 border-t border-gray-100 pt-4">
                <p className="text-xs font-medium text-gray-500 mb-2">Currently closed years</p>
                <div className="flex flex-wrap gap-2">
                  {closedYears.map((f) => (
                    <span
                      key={f.id}
                      className="text-xs bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded-full"
                    >
                      Branch {f.branch} · 20{f.year}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Archive viewer */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <Archive size={18} className="text-gray-400" />
            <h3 className="font-semibold text-gray-900">Closed Year Archive</h3>
          </div>
          <p className="text-sm text-gray-500 mb-4">Read-only view of a closed year's bookings, by module.</p>

          {closedYears.length === 0 ? (
            <div className="text-center text-gray-400 py-8">No closed years yet.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Closed year</label>
                  <select
                    value={archiveKey}
                    onChange={(e) => setArchiveKey(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[220px]"
                  >
                    <option value="">Select a closed year…</option>
                    {closedYears.map((f) => (
                      <option key={f.id} value={fiscalYearKey(f.branch, f.year)}>
                        Branch {f.branch} · 20{f.year}
                      </option>
                    ))}
                  </select>
                </div>
                {archiveKey && (
                  <div className="flex gap-1.5">
                    {FISCAL_YEAR_COLLECTIONS.map(({ key, label }) => {
                      const Icon = MODULE_ICONS[key];
                      return (
                        <button
                          key={key}
                          onClick={() => setArchiveModule(key)}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition ${
                            archiveModule === key
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          <Icon size={14} /> {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {archiveKey && (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <div className="text-xs text-gray-500">Total Sell</div>
                      <div className="font-semibold text-gray-900">{fmt(archiveTotals.sell)}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <div className="text-xs text-gray-500">Total Buy</div>
                      <div className="font-semibold text-gray-900">{fmt(archiveTotals.buy)}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <div className="text-xs text-gray-500">Total Profit</div>
                      <div className="font-semibold text-emerald-600">{fmt(archiveTotals.profit)}</div>
                    </div>
                  </div>

                  <div className="overflow-auto border border-gray-200 rounded-lg" style={{ height: "68vh", minHeight: "260px" }}>
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Reg Nr</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Date</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Client</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Invoice Nr</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-500">Sell</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-500">Buy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {archiveRows.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="text-center text-gray-400 py-8">
                              No records for this module in this closed year.
                            </td>
                          </tr>
                        ) : (
                          archiveRows.map((r) => {
                            const totalsFn = MODULE_TOTALS[archiveModule];
                            const t2 = totalsFn ? totalsFn(r) : {};
                            return (
                              <tr key={r.id} className="border-t border-gray-100">
                                <td className="px-3 py-2 font-mono">{r.regNr || "-"}</td>
                                <td className="px-3 py-2">{r.issueDate || "-"}</td>
                                <td className="px-3 py-2">{r.clientName || "-"}</td>
                                <td className="px-3 py-2 font-mono">{r.invoiceNumber || "-"}</td>
                                <td className="px-3 py-2 text-right">{fmt(t2.totalSell)}</td>
                                <td className="px-3 py-2 text-right">{fmt(t2.totalBuy)}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
