/**
 * Chart of accounts — the single source of truth for every account code.
 *
 * Phase 0 of the accounting restructuring. This used to be an inline array
 * in app/(dashboard)/accounts/page.js; it now lives here so the Accounts
 * page, Treasury, Adjustments, the rules documentation and (later) FX
 * revaluation all read the SAME list.
 *
 * `type` drives normal-balance sign everywhere (lib/financialReports.js):
 *   Asset / COGS / Expense  -> debit-normal
 *   Liability / Equity / Revenue -> credit-normal
 *
 * Extra metadata (all optional, used by the new FX / tax / reversal code):
 *   currency  – the account holds this currency only (cash / bank accounts)
 *   fx        – "monetary" = revalued at month end; "none" = never revalued
 *   tax       – "input" | "output" | "payable": VAT accounts
 *   control   – true = control account fed by sub-ledgers (AR / AP /
 *               deposits). Manual journals to a control account should
 *               carry a party reference (enforced in a later phase).
 *   legacy    – kept for old data; hidden from pickers for new postings.
 */

export const BASE_CURRENCY = "EGP";
export const SUPPORTED_CURRENCIES = ["EGP", "USD", "EUR"];

export const CHART_OF_ACCOUNTS = [
  /* ── Assets ─────────────────────────────────────────────────────── */
  { code: "1000", name: "Cash on Hand – EGP", type: "Asset", currency: "EGP", fx: "none" },
  { code: "1001", name: "Cash on Hand – USD", type: "Asset", currency: "USD", fx: "monetary" },
  { code: "1002", name: "Cash on Hand – EUR", type: "Asset", currency: "EUR", fx: "monetary" },
  { code: "1010", name: "Bank – EGP", type: "Asset", currency: "EGP", fx: "none" },
  { code: "1020", name: "Bank – USD", type: "Asset", currency: "USD", fx: "monetary" },
  { code: "1030", name: "Bank – EUR", type: "Asset", currency: "EUR", fx: "monetary" },
  { code: "1100", name: "Accounts Receivable – Clients", type: "Asset", control: true, fx: "monetary" },
  { code: "1200", name: "Supplier Advances / Prepayments", type: "Asset", control: true, fx: "monetary" },
  { code: "1300", name: "VAT Input (Recoverable)", type: "Asset", tax: "input", fx: "none" },
  { code: "1900", name: "Suspense / Clearing (Pending Items)", type: "Asset", fx: "none" },

  /* ── Liabilities ────────────────────────────────────────────────── */
  { code: "2000", name: "Accounts Payable – Suppliers", type: "Liability", control: true, fx: "monetary" },
  { code: "2100", name: "Customer Deposits (Unearned Revenue)", type: "Liability", control: true, fx: "monetary" },
  { code: "2200", name: "VAT Output Payable", type: "Liability", tax: "output", fx: "none" },
  { code: "2210", name: "VAT Settlement (Net Due to Authority)", type: "Liability", tax: "payable", fx: "none" },
  { code: "2300", name: "Accrued Expenses", type: "Liability", fx: "none" },

  /* ── Equity ─────────────────────────────────────────────────────── */
  { code: "3000", name: "Capital / Owner's Equity", type: "Equity", fx: "none" },
  { code: "3100", name: "Retained Earnings", type: "Equity", fx: "none" },

  /* ── Revenue ────────────────────────────────────────────────────── */
  { code: "4000", name: "Sales – Flight", type: "Revenue", fx: "none" },
  { code: "4100", name: "Sales – Hotel", type: "Revenue", fx: "none" },
  { code: "4200", name: "Sales – Visa", type: "Revenue", fx: "none" },
  { code: "4300", name: "Sales – Transport", type: "Revenue", fx: "none" },
  { code: "4400", name: "Service Fees / Commission Income", type: "Revenue", fx: "none" },
  { code: "4900", name: "Sales Returns / Credit Notes", type: "Revenue", fx: "none" },

  /* ── Cost of sales ──────────────────────────────────────────────── */
  { code: "5000", name: "Cost of Sales – Flight", type: "COGS", fx: "none" },
  { code: "5100", name: "Cost of Sales – Hotel", type: "COGS", fx: "none" },
  { code: "5200", name: "Cost of Sales – Visa", type: "COGS", fx: "none" },
  { code: "5300", name: "Cost of Sales – Transport", type: "COGS", fx: "none" },

  /* ── Operating expenses ─────────────────────────────────────────── */
  { code: "6000", name: "Salaries & Wages", type: "Expense", fx: "none" },
  { code: "6100", name: "Other Operating Expenses", type: "Expense", fx: "none" },
  { code: "6200", name: "Bank Charges & Interest", type: "Expense", fx: "none" },
  // FX results are typed "Expense" on purpose: lib/financialReports.js only
  // knows Revenue / COGS / Expense, and a net GAIN must not inflate sales
  // revenue. A credit balance here simply means a net gain (negative expense).
  { code: "6800", name: "FX (Gain) / Loss – Realized", type: "Expense", fx: "none" },
  { code: "6810", name: "FX (Gain) / Loss – Unrealized (Revaluation)", type: "Expense", fx: "none" },
  { code: "6900", name: "General & Administrative", type: "Expense", fx: "none" },
];

export const ACCOUNT_BY_CODE = Object.fromEntries(CHART_OF_ACCOUNTS.map((a) => [a.code, a]));

// Fixed roles an account plays in automated postings. Keeping them here
// (instead of scattered string literals) is what lets FX / VAT code find
// the right account without hard-coding numbers.
export const SYSTEM_ACCOUNTS = {
  suspense: "1900",
  ar: "1100",
  ap: "2000",
  supplierAdvances: "1200",
  customerDeposits: "2100",
  vatInput: "1300",
  vatOutput: "2200",
  vatSettlement: "2210",
  bankCharges: "6200",
  fxRealized: "6800",
  fxUnrealized: "6810",
  retainedEarnings: "3100",
};

/** Cash / bank account for a currency, by kind. */
export function treasuryAccountCode(kind, currency) {
  const table = {
    cash: { EGP: "1000", USD: "1001", EUR: "1002" },
    bank: { EGP: "1010", USD: "1020", EUR: "1030" },
  };
  return table[kind]?.[currency] || null;
}

/** Accounts that hold a foreign currency and must be revalued at month end. */
export const MONETARY_FX_ACCOUNTS = CHART_OF_ACCOUNTS.filter((a) => a.fx === "monetary").map((a) => a.code);

/**
 * Treasury used to key USD/EUR cash on 1000 and USD bank on 1010 (the
 * EGP codes), so a USD receipt posted into the EGP cash account's ledger.
 * Old vouchers keep their legacy `treasuryAccount`; this maps them to the
 * correct code for the NEW structure so a Controller-supervised migration
 * (or a report) can tell them apart. Returns the same code when no
 * remapping applies.
 */
export function modernTreasuryCode(code, currency) {
  if (code === "1000" && currency === "USD") return "1001";
  if (code === "1000" && currency === "EUR") return "1002";
  if (code === "1010" && currency === "USD") return "1020";
  if (code === "1010" && currency === "EUR") return "1030";
  return code;
}

/** Read-only audit: vouchers whose stored account code differs from the
 *  modern one. Run before go-live to size the migration. */
export function findLegacyTreasuryVouchers(vouchers) {
  return (vouchers || []).filter(
    (v) => v.treasuryAccount && modernTreasuryCode(v.treasuryAccount, v.currency) !== v.treasuryAccount
  );
}

/** Accounts selectable for NEW postings (legacy ones excluded). */
export function postableAccounts() {
  return CHART_OF_ACCOUNTS.filter((a) => !a.legacy);
}
