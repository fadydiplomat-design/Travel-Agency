/**
 * VAT structure (Phase 0).
 *
 * Replaces the single hard-coded 14% estimate with explicit tax codes that
 * every taxable posting references. Rates live here (not scattered through
 * the UI); changing a statutory rate = one reviewed edit + a dated entry
 * in the change log. Confirm codes with your tax advisor — air tickets are
 * often zero-rated or pass-through and this file does not decide that.
 *
 * Journal impact (by code):
 *   Sale with output VAT:   Dr AR (gross)  Cr Revenue (net)  Cr 2200 (vat)
 *   Cost with input VAT:    Dr COGS (net)  Dr 1300 (vat)     Cr AP (gross)
 *   Settlement:             Dr 2200  Cr 1300  Cr/Dr 2210 for the net
 */

import { SYSTEM_ACCOUNTS } from "@/lib/chartOfAccounts";
import { round2 } from "@/lib/fx";

export const TAX_CODES = [
  { code: "NONE", label: "Not subject to VAT", rate: 0, taxable: false },
  { code: "VAT14", label: "Standard VAT 14%", rate: 14, taxable: true },
  { code: "VAT0", label: "Zero-rated", rate: 0, taxable: true },
  { code: "EXEMPT", label: "Exempt", rate: 0, taxable: false },
];

export const TAX_CODE_BY_CODE = Object.fromEntries(TAX_CODES.map((t) => [t.code, t]));

/**
 * Split an amount into net + VAT.
 *   amount        – the figure the user typed
 *   inclusive     – true if `amount` already includes VAT (gross)
 */
export function splitVat(amount, taxCode, inclusive = false) {
  const t = TAX_CODE_BY_CODE[taxCode] || TAX_CODE_BY_CODE.NONE;
  const a = Number(amount) || 0;
  if (!t.taxable || !t.rate) return { net: round2(a), vat: 0, gross: round2(a), rate: t.rate, taxCode: t.code };
  const r = t.rate / 100;
  if (inclusive) {
    const net = round2(a / (1 + r));
    return { net, vat: round2(a - net), gross: round2(a), rate: t.rate, taxCode: t.code };
  }
  const vat = round2(a * r);
  return { net: round2(a), vat, gross: round2(a + vat), rate: t.rate, taxCode: t.code };
}

/** Accounts a tax code posts to, by direction. */
export function vatAccountFor(direction) {
  return direction === "input" ? SYSTEM_ACCOUNTS.vatInput : SYSTEM_ACCOUNTS.vatOutput;
}

/** Fields every taxable document must carry (used by data-standards checks). */
export const REQUIRED_TAX_FIELDS = ["taxCode", "netAmount", "vatAmount", "grossAmount"];
