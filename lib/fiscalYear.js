"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase";

/**
 * Fiscal Year close/open system.
 *
 * A fiscal year is identified by (branch, 2-digit year) and lives in the
 * `fiscalYears` collection as one doc per branch+year, id `${branch}_${year}`.
 * Absence of a doc (or status !== "closed") means the year is OPEN.
 *
 * Closing a year does NOT delete or move any data — every flight/hotel/
 * visa/transportation record keeps living in its normal collection. It only
 * gets hidden from the regular module tables (see isRowClosed / the
 * per-page filters that use it) once its own issueDate falls inside a
 * closed (branch, year). The data stays fully visible in the Fiscal Year
 * archive page. Re-opening the year makes it reappear everywhere instantly
 * — nothing was ever touched or renumbered.
 *
 * Registration numbers (generateRegNumber in helpers.js) are completely
 * independent of the fiscal year — their sequence is per section+branch
 * only and is never reset or affected by closing/opening a year, so a
 * Reg Nr keeps counting up across year boundaries exactly as before.
 */

// Roles allowed to close AND (re)open a fiscal year.
export const FISCAL_YEAR_ROLES = ["Admin", "General Manager", "Accountant"];

// The service modules whose records get hidden from their tables once
// their fiscal year is closed, and that the archive page reads from.
export const FISCAL_YEAR_COLLECTIONS = [
  { key: "flights", label: "Air Ticket" },
  { key: "hotels", label: "Hotels" },
  { key: "visa", label: "Visa" },
  { key: "transportation", label: "Transportation" },
];

export function normalizeYear(year) {
  const s = String(year ?? "").trim();
  if (!s) return new Date().getFullYear().toString().slice(-2);
  return s.length > 2 ? s.slice(-2) : s.padStart(2, "0");
}

/** Given a record's own date (issueDate, etc.), return its 2-digit fiscal year. */
export function yearFromDate(dateStr) {
  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.getFullYear().toString().slice(-2);
  }
  return new Date().getFullYear().toString().slice(-2);
}

export function fiscalYearDocId(branch, year) {
  return `${branch || "1"}_${normalizeYear(year)}`;
}

export function fiscalYearKey(branch, year) {
  return `${branch || "1"}_${normalizeYear(year)}`;
}

export async function closeFiscalYear(branch, year, actor) {
  const y = normalizeYear(year);
  const ref = doc(db, "fiscalYears", fiscalYearDocId(branch, y));
  await setDoc(
    ref,
    {
      branch: branch || "1",
      year: y,
      status: "closed",
      closedAt: new Date().toISOString(),
      closedBy: actor?.name || actor?.username || "",
    },
    { merge: true }
  );
}

export async function openFiscalYear(branch, year, actor) {
  const y = normalizeYear(year);
  const ref = doc(db, "fiscalYears", fiscalYearDocId(branch, y));
  await setDoc(
    ref,
    {
      branch: branch || "1",
      year: y,
      status: "open",
      openedAt: new Date().toISOString(),
      openedBy: actor?.name || actor?.username || "",
    },
    { merge: true }
  );
}

/** Live list of every fiscalYears doc, across all branches. */
export function useFiscalYears() {
  const [years, setYears] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "fiscalYears"),
      (snap) => setYears(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {}
    );
    return () => unsub();
  }, []);
  return years;
}

/**
 * Live Set of "branch_year" keys that are currently closed. Use with
 * isRowClosed() to filter a module's records, and include
 * `[...closedYearKeys].sort().join(",")` in a useEffect's dependency array
 * if the filtering happens inside an onSnapshot callback (so the listener
 * re-filters as soon as a year gets closed/opened, without having to wait
 * for the underlying data to change too).
 */
export function useClosedFiscalYearKeys() {
  const years = useFiscalYears();
  return useMemo(() => {
    const s = new Set();
    years.forEach((y) => {
      if (y.status === "closed") s.add(fiscalYearKey(y.branch, y.year));
    });
    return s;
  }, [years]);
}

/** True if `row` (with .branch and a date field) falls inside a closed fiscal year. */
export function isRowClosed(row, closedYearKeys, dateField = "issueDate") {
  if (!closedYearKeys || closedYearKeys.size === 0) return false;
  const branch = row?.branch || "1";
  const year = yearFromDate(row?.[dateField]);
  return closedYearKeys.has(fiscalYearKey(branch, year));
}
