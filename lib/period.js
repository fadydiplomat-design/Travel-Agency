/**
 * Period stamping for accounting documents.
 *
 * Every new journal entry, bank-book line and treasury voucher carries
 * { date, branch, fiscalYear: "YY" }. firestore.rules re-derives the year
 * from `date` and rejects the write when that branch+year is closed in the
 * `fiscalYears` collection (see periodOpen() there) — so a closed period is
 * genuinely locked on the server, not merely hidden in the UI.
 *
 * Kept free of firebase imports so it can be used (and tested) anywhere.
 */

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function isISODate(s) {
  return typeof s === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(s);
}

/** { date, branch, fiscalYear } for a document dated `date` in `branch`. */
export function periodStamp(date, branch) {
  const d = isISODate(date) ? date : todayISO();
  return { date: d, branch: String(branch || "1"), fiscalYear: d.slice(2, 4) };
}

/** True if `date` falls in a closed period. `closedKeys` is the Set from
 *  useClosedFiscalYearKeys() ("branch_YY"). UI-side convenience only —
 *  the rules are the real enforcement. */
export function isPeriodClosed(closedKeys, date, branch) {
  if (!closedKeys || closedKeys.size === 0) return false;
  const { branch: b, fiscalYear } = periodStamp(date, branch);
  return closedKeys.has(`${b}_${fiscalYear}`);
}
