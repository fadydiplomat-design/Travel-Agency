/**
 * Daily treasury tie-out (Phase 2) — pure functions.
 *
 * treasuryBalances holds a STORED running total per account+currency. Nothing
 * in the database forces it to equal what the vouchers and the ledger say,
 * so we recompute it two independent ways and compare:
 *
 *   stored   – treasuryBalances/{account}_{currency}.balance
 *   vouchers – posted receipts minus posted payments (voided ones net out)
 *   ledger   – debit-credit on that account from treasury-sourced journal
 *              lines, in the account's OWN currency (foreign lines carry
 *              originalAmount; EGP lines are debit-credit)
 *
 * leg 1  stored − vouchers  : did a balance write drift from the vouchers?
 * leg 2  vouchers − ledger  : does every voucher have its journal?
 *
 * Leg 2 needs ledger access; roles without it (the Cashier) get null.
 * Only modern per-currency account codes are checked; USD/EUR recorded under
 * the old EGP codes (1000/1010) are reported as `legacy` — see
 * findLegacyTreasuryVouchers() in lib/chartOfAccounts.js.
 */

import { round2 } from "@/lib/fx";
import { modernTreasuryCode } from "@/lib/chartOfAccounts";

const EPS = 0.005;

function ledgerUnits(line) {
  const sign = (Number(line.debit) || 0) > 0 ? 1 : -1;
  if (line.originalAmount != null && Number(line.originalAmount) > 0) return sign * Number(line.originalAmount);
  return (Number(line.debit) || 0) - (Number(line.credit) || 0);
}

export function tieOut({ accounts, balances, vouchers, journals }) {
  const ledgerAvailable = Array.isArray(journals) && journals.length > 0;
  const rows = accounts.map((a) => {
    const stored = round2((balances || []).find((b) => b.id === `${a.code}_${a.currency}`)?.balance || 0);
    const voucherBalance = round2(
      (vouchers || [])
        .filter((v) => v.status === "posted" && v.treasuryAccount === a.code && v.currency === a.currency)
        .reduce((s, v) => s + (v.type === "receipt" ? v.amount : -v.amount), 0)
    );
    let ledger = null;
    if (ledgerAvailable) {
      ledger = round2(
        journals
          .filter((j) => j.sourceType === "treasury" || j.sourceType === "treasury-void")
          .flatMap((j) => j.lines || [])
          .filter((l) => l.accountCode === a.code)
          .reduce((s, l) => s + ledgerUnits(l), 0)
      );
    }
    const leg1 = round2(stored - voucherBalance);
    const leg2 = ledger == null ? null : round2(voucherBalance - ledger);
    return {
      code: a.code, currency: a.currency, name: a.name, kind: a.kind,
      stored, voucherBalance, ledger, leg1, leg2,
      ok: Math.abs(leg1) < EPS && (leg2 == null || Math.abs(leg2) < EPS),
    };
  });
  const legacy = (vouchers || []).filter(
    (v) => v.status === "posted" && v.treasuryAccount && modernTreasuryCode(v.treasuryAccount, v.currency) !== v.treasuryAccount
  ).length;
  return { rows, legacy, ledgerAvailable };
}

/** Cash count vs expected: difference > 0 = surplus, < 0 = shortage. */
export function countDifference(expected, counted) {
  return round2((Number(counted) || 0) - (Number(expected) || 0));
}

export const dayCloseDocId = (branch, account, date) => `${branch || "1"}_${account}_${date}`;
