/**
 * Foreign-currency handling for MANUAL journal lines (Phase 3) — pure.
 *
 * In the form, each line has an optional currency + rate. When a line's
 * currency is not EGP, the Debit/Credit the user types are in THAT currency;
 * we convert with the rate and store debit/credit in EGP (so the trial
 * balance never mixes currencies) plus { currency, originalAmount, rate } on
 * the line (so revaluation can work out the foreign balance later).
 *
 * Rules enforced here (the server rules can't see inside the lines array):
 *   - an account bound to a currency (1001 cash USD, 1020 bank USD ...)
 *     takes ONLY that currency;
 *   - accounts that aren't monetary (revenue, cost, expense, equity, VAT...)
 *     are EGP-only — a foreign amount there has nowhere to be revalued;
 *   - a foreign line needs a rate (typed, or the latest from the rate table).
 */

import { ACCOUNT_BY_CODE, BASE_CURRENCY } from "@/lib/chartOfAccounts";
import { rateOn, toBase, round2, stampFx } from "@/lib/fx";
import { parseNum } from "@/lib/bookingNormalize";

export function normalizeJournalLines(lines, { rates = [], date } = {}) {
  const errors = [];
  const out = [];
  let debit = 0;
  let credit = 0;

  (lines || []).forEach((l, i) => {
    const n = i + 1;
    const acc = ACCOUNT_BY_CODE[l.accountCode];
    const cur = l.currency || BASE_CURRENCY;
    const d = parseNum(l.debit);
    const c = parseNum(l.credit);
    if (!d && !c) return; // empty line — ignored

    if (acc?.currency && cur !== acc.currency) {
      errors.push(`سطر ${n}: الحساب ${l.accountCode} بعملة ${acc.currency} — اختر نفس العملة`);
    }
    if (cur !== BASE_CURRENCY && acc && acc.fx !== "monetary") {
      errors.push(`سطر ${n}: الحساب ${l.accountCode} بالجنيه فقط — العملة الأجنبية على حسابات النقدية/البنك/العملاء/الموردين بس`);
    }

    const rate = cur === BASE_CURRENCY ? 1 : Number(l.rate) > 0 ? Number(l.rate) : rateOn(rates, cur, date);
    if (!(rate > 0)) {
      errors.push(`سطر ${n}: سعر صرف ${cur} مطلوب (مفيش سعر في الجدول)`);
      return;
    }

    const entered = d || c;
    const base = toBase(entered, rate);
    debit += d ? base : 0;
    credit += c ? base : 0;
    out.push(
      stampFx(
        {
          accountCode: l.accountCode,
          accountName: acc?.name || l.accountName || "",
          debit: d ? base : 0,
          credit: c ? base : 0,
        },
        { currency: cur, originalAmount: entered, rate }
      )
    );
  });

  debit = round2(debit);
  credit = round2(credit);
  return { lines: out, errors, totals: { debit, credit, balanced: Math.abs(debit - credit) < 0.005 && debit > 0 } };
}
