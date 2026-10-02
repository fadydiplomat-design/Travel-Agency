/**
 * Accounting health KPIs (Phase 4) — pure functions.
 *
 * These are the "how do we know it's working" measures from the plan:
 *   - cash tie-out differences are zero
 *   - no reconciling items older than 30 days
 *   - the suspense balance trends to zero (and doesn't age)
 *   - bank reconciliations signed up to the previous month
 *   - setup complete (approval limits, today's rates, no legacy treasury data)
 *   - every correction visible, with who and why (nothing is ever deleted)
 */

import { round2 } from "@/lib/fx";
import { SYSTEM_ACCOUNTS } from "@/lib/chartOfAccounts";

const DAY = 86400000;
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / DAY);

/**
 * Suspense (1900) ageing by FIFO: credits clear the OLDEST debits first, and
 * what's left is bucketed by the debit's age. Suspense is debit-normal.
 */
export function suspenseAgeing(ledgerLines, asOf) {
  const lines = (ledgerLines || [])
    .filter((l) => l.accountCode === SYSTEM_ACCOUNTS.suspense && l.date && l.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date));
  const open = []; // { date, amount } of still-uncleared debits
  let creditsWithoutDebit = 0;
  lines.forEach((l) => {
    let d = Number(l.debit) || 0;
    let c = Number(l.credit) || 0;
    if (d) open.push({ date: l.date, amount: d });
    while (c > 0.0001 && open.length) {
      const take = Math.min(c, open[0].amount);
      open[0].amount -= take;
      c -= take;
      if (open[0].amount < 0.005) open.shift();
    }
    if (c > 0.0001) creditsWithoutDebit += c;
  });
  const buckets = { "0-30": 0, "31-60": 0, "61+": 0 };
  open.forEach((o) => {
    const age = daysBetween(o.date, asOf);
    buckets[age <= 30 ? "0-30" : age <= 60 ? "31-60" : "61+"] += o.amount;
  });
  Object.keys(buckets).forEach((k) => (buckets[k] = round2(buckets[k])));
  const balance = round2(open.reduce((s, o) => s + o.amount, 0) - creditsWithoutDebit);
  return { balance, buckets, oldestDate: open[0]?.date || null, creditsWithoutDebit: round2(creditsWithoutDebit) };
}

/** Bank-book items still outstanding (not cleared, still active) older than `days`. */
export function staleOutstanding(bankLines, asOf, days = 30) {
  return (bankLines || []).filter(
    (b) => (b.status || "active") === "active" && !b.cleared && b.date && daysBetween(b.date, asOf) > days
  );
}

const prevMonth = (asOf) => {
  const d = new Date(asOf + "T00:00:00Z");
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

/** For each bank account: newest signed month and how many months are missing
 *  up to the previous full month. `since` (YYYY-MM) = go-live month; nothing
 *  before it counts as missing. */
export function reconciliationCoverage(closes, accounts, asOf, since) {
  const target = prevMonth(asOf);
  return accounts.map((a) => {
    const signed = (closes || [])
      .filter((c) => c.account === a && c.status === "signed")
      .map((c) => c.month)
      .sort();
    const last = signed[signed.length - 1] || null;
    let behind = 0;
    if (since && target >= since) {
      const [ty, tm] = target.split("-").map(Number);
      const [sy, sm] = since.split("-").map(Number);
      const have = new Set(signed);
      for (let y = sy, m = sm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, (m = 1)) : m++) {
        if (!have.has(`${y}-${String(m).padStart(2, "0")}`)) behind++;
      }
    }
    return { account: a, lastSigned: last, behind };
  });
}

/** One chronological list of every correction in the books. Nothing in the
 *  system is deleted, so this is the complete audit trail of "what changed". */
export function correctionsLog({ journals, bankLines, vouchers, closes, sinceDate }) {
  const ts = (x) => (x?.toDate ? x.toDate().toISOString() : typeof x === "string" ? x : "");
  const rows = [];
  (journals || []).forEach((j) => {
    if (j.status === "reversed") rows.push({ at: ts(j.reversedAt), kind: "قيد معكوس", ref: j.memo || j.id, by: j.reversedBy, reason: j.reversalReason });
  });
  (bankLines || []).forEach((b) => {
    if (b.status === "voided") rows.push({ at: ts(b.voidedAt), kind: "سطر بنك ملغي", ref: `${b.amount} ${b.currency || "EGP"} — ${b.memo || ""}`, by: b.voidedBy, reason: b.voidReason });
  });
  (vouchers || []).forEach((v) => {
    if (v.status === "void") rows.push({ at: ts(v.voidedAt), kind: "سند خزينة ملغي", ref: v.voucherNumber, by: v.voidedBy, reason: v.voidReason });
  });
  (closes || []).forEach((c) => {
    if (c.reopenCount > 0) rows.push({ at: ts(c.reopenedAt), kind: "إعادة فتح تسوية", ref: `${c.account} ${c.month}`, by: c.reopenedBy, reason: c.reopenReason });
  });
  return rows.filter((r) => !sinceDate || !r.at || r.at.slice(0, 10) >= sinceDate).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}

/** Go-live readiness: everything the rollout steps said must exist. */
export function readiness({ policy, rates, today, legacyCount, unstampedForeign, hasController }) {
  const limits = policy?.approvalLimits || {};
  const rateFor = (c) => (rates || []).some((r) => r.currency === c && r.date === today);
  return [
    { key: "limits", ok: ["EGP", "USD", "EUR"].every((c) => Number(limits[c]) > 0), label: "حدود الاعتماد محددة للجنيه والدولار واليورو" },
    { key: "rates", ok: rateFor("USD") && rateFor("EUR"), label: "أسعار صرف اليوم مدخلة (دولار ويورو)" },
    { key: "legacy", ok: legacyCount === 0, label: legacyCount ? `${legacyCount} سند خزينة بعملة أجنبية على كود قديم — يترحّل` : "مفيش سندات خزينة بأكواد قديمة" },
    { key: "unstamped", ok: unstampedForeign === 0, label: unstampedForeign ? `${unstampedForeign} حركة على حسابات أجنبية بدون عملة/سعر` : "كل حركات الحسابات الأجنبية مختومة بعملة" },
    ...(hasController === undefined
      ? []
      : [{ key: "controller", ok: !!hasController, label: "فيه مستخدم بدور المدير المالي (لقفل الفترات والتوقيع)" }]),
  ];
}
