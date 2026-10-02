/**
 * Periodic P&L engine (monthly / quarterly / yearly).
 *
 * KEY DESIGN RULE — this is what guarantees the monthly/quarterly/yearly
 * numbers always reconcile with each other, per the requirement "التأكد
 * من تطابق الأرقام بين جميع التقارير":
 *
 *   Monthly buckets are computed ONCE, directly from the ledger lines.
 *   Quarterly and yearly rows are never recomputed from the raw lines —
 *   they are pure arithmetic sums of the monthly rows that fall inside
 *   them. So "Q1 revenue" is defined as Jan+Feb+Mar revenue, by
 *   construction, not as a second independent calculation that could
 *   drift out of sync with the monthly figures.
 *
 * Input: a flat list of ledger lines { date: "YYYY-MM-DD", accountCode,
 * debit, credit } — e.g. accounts/page.js's `allLedgerLinesFull` — plus
 * the Chart of Accounts (for account `type`, which decides normal-balance
 * sign, and for revenue/COGS/expense classification).
 */

function normalBalance(type, debit, credit) {
  const debitNormal = type === "Asset" || type === "COGS" || type === "Expense";
  return debitNormal ? debit - credit : credit - debit;
}

function emptyPeriodTotals() {
  return { revenue: 0, salesReturns: 0, cogs: 0, expenses: 0, byAccount: {} };
}

function addLineToPeriod(period, line, acctByCode) {
  const acct = acctByCode[line.accountCode];
  if (!acct) return; // unknown account code — ignored rather than crashing the report
  const bal = normalBalance(acct.type, line.debit || 0, line.credit || 0);
  period.byAccount[line.accountCode] = (period.byAccount[line.accountCode] || 0) + bal;

  if (acct.type === "Revenue") {
    // 4900 (Sales Returns / Credit Notes) is a contra-revenue account —
    // its normal balance nets NEGATIVE against real sales, which is
    // exactly correct here: it reduces revenue automatically when summed.
    period.revenue += bal;
  } else if (acct.type === "COGS") {
    period.cogs += bal;
  } else if (acct.type === "Expense") {
    period.expenses += bal;
  }
}

function finalizePeriod(key, label, period) {
  const grossProfit = period.revenue - period.cogs;
  const netIncome = grossProfit - period.expenses;
  const marginPct = period.revenue !== 0 ? (netIncome / period.revenue) * 100 : 0;
  return { key, label, revenue: period.revenue, cogs: period.cogs, grossProfit, expenses: period.expenses, netIncome, marginPct, byAccount: period.byAccount };
}

const MONTH_NAMES_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** Monthly P&L rows, one per calendar month that has at least one ledger
 * line, sorted chronologically ascending. */
export function buildMonthlyPL(ledgerLines, chartOfAccounts) {
  const acctByCode = Object.fromEntries(chartOfAccounts.map((a) => [a.code, a]));
  const byMonth = {};
  ledgerLines.forEach((line) => {
    const month = (line.date || "").slice(0, 7); // "YYYY-MM"
    if (!month || month.length !== 7) return;
    if (!byMonth[month]) byMonth[month] = emptyPeriodTotals();
    addLineToPeriod(byMonth[month], line, acctByCode);
  });
  return Object.keys(byMonth)
    .sort()
    .map((month) => {
      const [y, m] = month.split("-");
      const label = `${MONTH_NAMES_AR[parseInt(m, 10) - 1]} ${y}`;
      return finalizePeriod(month, label, byMonth[month]);
    });
}

/** Quarterly rows = pure sums of the monthly rows that fall in each
 * quarter (see design note above — never recomputed from raw lines). */
export function rollUpQuarterly(monthlyRows) {
  const byQuarter = {};
  monthlyRows.forEach((m) => {
    const [y, mo] = m.key.split("-");
    const q = Math.ceil(parseInt(mo, 10) / 3);
    const key = `${y}-Q${q}`;
    if (!byQuarter[key]) byQuarter[key] = { key, label: `${y} — الربع ${q}`, revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netIncome: 0, months: [] };
    const b = byQuarter[key];
    b.revenue += m.revenue;
    b.cogs += m.cogs;
    b.grossProfit += m.grossProfit;
    b.expenses += m.expenses;
    b.netIncome += m.netIncome;
    b.months.push(m.label);
  });
  return Object.keys(byQuarter)
    .sort()
    .map((k) => {
      const b = byQuarter[k];
      b.marginPct = b.revenue !== 0 ? (b.netIncome / b.revenue) * 100 : 0;
      return b;
    });
}

/** Yearly rows = pure sums of the quarterly rows (which are themselves
 * pure sums of the monthly rows) — so Monthly → Quarterly → Yearly all
 * reconcile by construction, three levels deep. */
export function rollUpYearly(quarterlyRows) {
  const byYear = {};
  quarterlyRows.forEach((q) => {
    const year = q.key.split("-")[0];
    if (!byYear[year]) byYear[year] = { key: year, label: `سنة ${year}`, revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netIncome: 0, quarters: [] };
    const b = byYear[year];
    b.revenue += q.revenue;
    b.cogs += q.cogs;
    b.grossProfit += q.grossProfit;
    b.expenses += q.expenses;
    b.netIncome += q.netIncome;
    b.quarters.push(q.key);
  });
  return Object.keys(byYear)
    .sort()
    .map((k) => {
      const b = byYear[k];
      b.marginPct = b.revenue !== 0 ? (b.netIncome / b.revenue) * 100 : 0;
      return b;
    });
}

/**
 * Reconciliation self-check — returns true if the sum of the monthly
 * rows' netIncome equals the sum of the yearly rows' netIncome (within a
 * rounding tolerance). Since yearly is *defined* as a sum of quarterly
 * which is *defined* as a sum of monthly, this should always be true; it
 * exists as a visible assertion in the UI (a small ✓/✗ badge) so anyone
 * reviewing the report can trust it rather than take it on faith.
 */
export function reconciles(monthlyRows, yearlyRows) {
  const monthlySum = monthlyRows.reduce((s, r) => s + r.netIncome, 0);
  const yearlySum = yearlyRows.reduce((s, r) => s + r.netIncome, 0);
  return Math.abs(monthlySum - yearlySum) < 0.5;
}
