import { collection, query, where, getDocs, doc, getDoc, deleteDoc, runTransaction } from "firebase/firestore";
import { db } from "./firebase";
import { letterheadHtml, letterheadFooterHtml } from "./companyProfile";

/**
 * Decide whether a record belonging to `docBranch` should be visible to the
 * current user, given their role and branch context. This is the single
 * rule used everywhere (Flights, Hotels, Visa, Transportation, Invoices,
 * Accounts, Dashboard) to keep branches fully separated:
 *
 * - Admins can see everything ("ALL") or narrow down to one branch.
 * - Everyone else only ever sees branches they've been explicitly assigned
 *   to, and — if assigned to more than one — only their currently active
 *   (selected) branch at a time.
 */
export function isBranchVisible(docBranch, { isAdmin, activeBranch, myBranches }) {
  const b = docBranch || "1";
  if (isAdmin) {
    return activeBranch === "ALL" || b === activeBranch;
  }
  const allowed = myBranches || [];
  if (!allowed.includes(b)) return false;
  if (allowed.length > 1) return b === activeBranch;
  return true;
}

/**
 * Same branch-scoping as isBranchVisible, plus an optional "only see my
 * own work" restriction for employees who have onlyOwnData enabled in
 * their permissions. When active, a booking is only visible to the
 * employee if they're the salesman on it — everyone else's records are
 * hidden, even within the same branch.
 */
export function isRecordVisible(row, ctx) {
  if (!isBranchVisible(row?.branch, ctx)) return false;
  if (ctx?.restrictOwn && !ctx?.isAdmin) {
    // Prefer the immutable owner uid stamped on every booking created from
    // now on. Matching on the display name alone broke as soon as two
    // employees shared a name or one was renamed, and it cannot be checked
    // from the Firestore rules at all. Records created before salesmanUid
    // existed carry no uid, so those still fall back to the name compare.
    const ownerUid = row?.salesmanUid || "";
    if (ownerUid) return !!ctx.userUid && ownerUid === ctx.userUid;
    const owner = row?.salesmanName || row?.salesman || "";
    if (!ctx.userName) return false;
    return owner === ctx.userName;
  }
  return true;
}

/**
 * Build the Firestore query to use for one of the four booking collections
 * (flights / hotels / visa / transportation).
 *
 * Why this exists: the Firestore rules check each booking's `branch` — and,
 * for employees with "Only see own work", its `salesmanUid` — against the
 * signed-in user. For a LIST/onSnapshot call, Firestore evaluates the rule
 * against every document the query returns and fails the WHOLE query if any
 * one of them is rejected. So an unconstrained `collection(db, "flights")`
 * listener returns permission-denied for every non-admin, instead of just
 * hiding the rows they can't see. The query has to be narrowed to what the
 * rules allow before it leaves the browser.
 *
 * Only ever ONE `where` clause is added, so no composite index is needed:
 *   - Admin-level  → no clause (rules let them read every branch).
 *   - "Only own"   → salesmanUid == me. Their own bookings are by definition
 *                    in branches they work in, so the branch rule passes too.
 *   - Everyone else→ branch in (my branches).
 * The existing client-side isRecordVisible()/isBranchVisible() filtering
 * still runs on top of this — that's what applies the active-branch picker.
 *
 * NOTE: bookings created before `salesmanUid` was stamped on them have no
 * uid, so an employee restricted to their own work won't see those older
 * rows. Backfill salesmanUid on old records to bring them back.
 */
export function bookingQuery(collName, ctx = {}) {
  const base = collection(db, collName);
  if (ctx.isAdmin) return base;
  if (ctx.restrictOwn) {
    return query(base, where("salesmanUid", "==", ctx.userUid || "__no_user__"));
  }
  const branches = (ctx.myBranches || []).slice(0, 30);
  return query(base, where("branch", "in", branches.length ? branches : ["__no_branch__"]));
}

/**
 * Generate next code for Clients / Corporates / Suppliers
 * Clients    → 30.00.00.0001
 * Corporates → 50.00.00.0001
 * Suppliers  → 50.00.00.0001
 */
export async function generateCode(type) {
  const prefixes = {
    clients: "30.00.00.",
    corporates: "30.01.00.",
    suppliers: "50.00.00.",
  };

  const prefix = prefixes[type];
  if (!prefix) throw new Error("Invalid type for code generation");

  const snapshot = await getDocs(collection(db, type));
  let maxNum = 0;

  snapshot.docs.forEach((d) => {
    const code = d.data().code || "";
    if (code.startsWith(prefix)) {
      const num = parseInt(code.split(".").pop(), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  });

  const nextNumber = maxNum + 1;
  const padded = String(nextNumber).padStart(4, "0");
  return `${prefix}${padded}`;
}

/**
 * Given a service's own date (its issueDate / booking date), return the
 * 2-digit fiscal year it belongs to ("26", "27", ...). Falls back to
 * today's year when no date is given or it can't be parsed, so every
 * existing call site that doesn't pass one keeps behaving exactly as
 * before.
 */
export function yearFromServiceDate(serviceDate) {
  if (serviceDate) {
    const d = new Date(serviceDate);
    if (!isNaN(d.getTime())) return d.getFullYear().toString().slice(-2);
  }
  return new Date().getFullYear().toString().slice(-2);
}

/**
 * Generate next invoice number
 * INTE26 1  → Ticket EGP
 * INTF26 1  → Ticket Foreign
 * INSE26 1  → Service EGP
 * INSF26 1  → Service Foreign
 * CNTE26 1  → Refund Ticket EGP  (credit note)
 * CNTF26 1  → Refund Ticket Foreign
 * CNSE26 1  → Refund Service EGP  (hotels/visa/cars/files)
 * CNSF26 1  → Refund Service Foreign
 * IHSE26 1  → Hotel EGP
 * IHSF26 1  → Hotel Foreign
 * IVSE26 1  → Visa EGP
 * IVSF26 1  → Visa Foreign
 * ITSE26 1  → Transportation EGP
 * ITSF26 1  → Transportation Foreign
 *
 * The "26" is the FISCAL year of the service itself (its issueDate), not
 * necessarily the calendar year the invoice happens to be issued in — pass
 * `serviceDate` so a booking dated in fiscal year 27 always gets a "27..."
 * invoice number even if the invoice is only issued today. Omitting
 * serviceDate falls back to today's year (unchanged legacy behavior).
 *
 * The sequential number is scoped to prefix+year+branch, so it automatically
 * restarts at 1 the moment a new fiscal year's prefix is first used — no
 * separate "reset" step is needed when closing/opening a fiscal year.
 *
 * Looks in the relevant collection(s) to keep numbering continuous with
 * existing data when the counter doc doesn't exist yet.
 */
export async function generateInvoiceNumber(invoiceType, currency, branch, serviceDate) {
  const year = yearFromServiceDate(serviceDate);
  const branchKey = branch || "1";

  let prefix = "";
  let scanCollections = ["flights", "invoices"];
  const isForeign = currency === "FOREIGN" || currency === "USD" || currency === "EUR";
  const t = String(invoiceType || "").toLowerCase();
  if (t === "ticket" && currency === "EGP") prefix = "INTE";
  else if (t === "ticket" && isForeign) prefix = "INTF";
  else if (t === "service" && currency === "EGP") prefix = "INSE";
  else if (t === "service" && isForeign) prefix = "INSF";
  else if ((t === "refund" || t === "refund_ticket" || t === "cnte" || t === "credit" || t === "cn") && currency === "EGP") prefix = "CNTE";
  else if ((t === "refund" || t === "refund_ticket" || t === "cnte" || t === "credit" || t === "cn") && isForeign) prefix = "CNTF";
  else if ((t === "refund_service" || t === "cnse" || t === "service_refund" || t === "service_credit") && currency === "EGP") prefix = "CNSE";
  else if ((t === "refund_service" || t === "cnse" || t === "service_refund" || t === "service_credit") && isForeign) prefix = "CNSF";
  else if (t === "hotel" && currency === "EGP") { prefix = "IHSE"; scanCollections = ["hotels"]; }
  else if (t === "hotel" && isForeign) { prefix = "IHSF"; scanCollections = ["hotels"]; }
  else if (t === "visa" && currency === "EGP") { prefix = "IVSE"; scanCollections = ["visa"]; }
  else if (t === "visa" && isForeign) { prefix = "IVSF"; scanCollections = ["visa"]; }
  else if ((t === "transportation" || t === "transport") && currency === "EGP") { prefix = "ITSE"; scanCollections = ["transportation"]; }
  else if ((t === "transportation" || t === "transport") && isForeign) { prefix = "ITSF"; scanCollections = ["transportation"]; }
  else throw new Error("Invalid invoice type or currency: " + invoiceType + "/" + currency);

  const fullPrefix = `${prefix}${year}`;

  // Sequential never repeats — atomic counter in counters/{fullPrefix}_{branch}.
  // Each branch gets its own fully independent sequence, so branch A and
  // branch B can both be issuing "INTE26 1" at the same time with no clash.
  // Uses transaction so concurrent users never get same number, and deletions never reuse.
  const counterRef = doc(db, "counters", `${fullPrefix}_${branchKey}`);

  const nextSeq = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(counterRef);
    if (snap.exists()) {
      const current = snap.data().seq || 0;
      const next = current + 1;
      transaction.update(counterRef, { seq: next, updatedAt: new Date().toISOString() });
      return next;
    } else {
      // First time for this prefix+branch — initialize from existing max
      // (within this branch only) to avoid collision with old data.
      let maxSeq = 0;
      try {
        for (const collName of scanCollections) {
          const snap2 = await getDocs(collection(db, collName));
          snap2.forEach((d) => {
            const data = d.data();
            if ((data.branch || "1") !== branchKey) return;
            if (data.numberPrefix === fullPrefix && data.sequentialNumber > maxSeq) maxSeq = data.sequentialNumber;
            if ((data.invoiceNumber || "").startsWith(fullPrefix)) {
              const n = parseInt((data.invoiceNumber || "").split(" ")[1], 10);
              if (!isNaN(n) && n > maxSeq) maxSeq = n;
            }
          });
        }
      } catch {}
      const next = maxSeq + 1;
      transaction.set(counterRef, { seq: next, prefix: fullPrefix, branch: branchKey, updatedAt: new Date().toISOString() });
      return next;
    }
  });

  return {
    fullNumber: `${fullPrefix} ${nextSeq}`,
    numberPrefix: fullPrefix,
    sequentialNumber: nextSeq,
  };
}

/**
 * Generate the next Registration Number ("Reg Nr") for a given section,
 * scoped to one branch. Each section+branch combination (e.g. "flights"
 * bookings in branch "cairo") has its OWN independent sequence starting at
 * 1 — branches never share or affect each other's numbering, and neither
 * do sections. Returned as a padded number prefixed with the section's
 * single-letter code (e.g. "F-0007") so a Reg Nr is unambiguous even
 * without saying which section it belongs to.
 *
 * Uses the same atomic counter pattern as generateInvoiceNumber (transaction
 * on a doc in the `counters` collection) so concurrent users never collide
 * and deleted records never get their number reused.
 */
export async function generateRegNumber(sectionKey, letter, branch) {
  if (!sectionKey) throw new Error("generateRegNumber requires a sectionKey");
  const branchKey = branch || "1";
  const counterRef = doc(db, "counters", `REGNR_${sectionKey}_${branchKey}`);

  const nextSeq = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(counterRef);
    if (snap.exists()) {
      const current = snap.data().seq || 0;
      const next = current + 1;
      transaction.update(counterRef, { seq: next, updatedAt: new Date().toISOString() });
      return next;
    } else {
      // First time ever for this section+branch — initialize from the
      // current max regNr found in that section's collection, within this
      // branch only, so we never collide with existing data. Handles both
      // legacy plain-number regNr values and the new "X-0007" prefixed
      // format.
      let maxSeq = 0;
      try {
        const snap = await getDocs(collection(db, sectionKey));
        snap.forEach((d) => {
          const data = d.data();
          if ((data.branch || "1") !== branchKey) return;
          const raw = String(data.regNr ?? "");
          const n = parseInt(raw.replace(/\D/g, ""), 10);
          if (!isNaN(n) && n > maxSeq) maxSeq = n;
        });
      } catch {}
      const next = maxSeq + 1;
      transaction.set(counterRef, { seq: next, branch: branchKey, updatedAt: new Date().toISOString() });
      return next;
    }
  });

  const padded = String(nextSeq).padStart(4, "0");
  return letter ? `${letter}-${padded}` : padded;
}

/**
 * Preview what generateRegNumber() would hand out next, WITHOUT reserving
 * it — i.e. it does not touch the counter, so opening an Add form and
 * cancelling never burns a number or leaves a gap in the sequence. Used to
 * show the upcoming Reg Nr in the form the moment it opens; the real,
 * gap-free number is only actually assigned by generateRegNumber() at
 * save time.
 *
 * Because this doesn't lock anything, if two users open Add for the same
 * section+branch at the same time they may briefly see the same preview —
 * whoever saves first gets it, and the other's form silently gets the next
 * one at their own save. Harmless: it's only ever a display value here.
 */
export async function peekNextRegNumber(sectionKey, letter, branch) {
  if (!sectionKey) throw new Error("peekNextRegNumber requires a sectionKey");
  const branchKey = branch || "1";
  const counterRef = doc(db, "counters", `REGNR_${sectionKey}_${branchKey}`);

  let nextSeq = 1;
  try {
    const snap = await getDoc(counterRef);
    if (snap.exists()) {
      nextSeq = (snap.data().seq || 0) + 1;
    } else {
      // No counter yet — mirror generateRegNumber's first-time scan so the
      // preview matches what it would actually assign.
      let maxSeq = 0;
      const snap2 = await getDocs(collection(db, sectionKey));
      snap2.forEach((d) => {
        const data = d.data();
        if ((data.branch || "1") !== branchKey) return;
        const raw = String(data.regNr ?? "");
        const n = parseInt(raw.replace(/\D/g, ""), 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      });
      nextSeq = maxSeq + 1;
    }
  } catch {
    return "";
  }

  const padded = String(nextSeq).padStart(4, "0");
  return letter ? `${letter}-${padded}` : padded;
}

/**
 * Reg numbers are never reused, even after a record is deleted — the
 * counter document keeps counting up on its own so a deleted "F-0007"
 * can never be silently handed out again to a different booking. This is
 * intentional (it's what keeps audit trails / old invoices unambiguous),
 * but sometimes an admin genuinely wants to start a fresh sequence — e.g.
 * after clearing out test data. getRegCounterInfo() + resetRegCounter()
 * below support that as an explicit, manual action.
 */
export async function getRegCounterInfo(sectionKey, branch) {
  const branchKey = branch || "1";
  const counterRef = doc(db, "counters", `REGNR_${sectionKey}_${branchKey}`);
  const snap = await getDoc(counterRef);
  const docsSnap = await getDocs(collection(db, sectionKey));
  let liveCount = 0;
  docsSnap.forEach((d) => {
    if ((d.data().branch || "1") === branchKey) liveCount += 1;
  });
  return {
    seq: snap.exists() ? snap.data().seq || 0 : 0,
    exists: snap.exists(),
    liveCount,
  };
}

/**
 * Deletes the counter document for a section+branch. The NEXT call to
 * generateRegNumber() for that section+branch will then re-initialize
 * itself from whatever's actually left in the collection (so if it's
 * genuinely empty, numbering restarts at 1 — but if any records remain,
 * it safely picks up after the highest existing Reg Nr instead of
 * colliding with them).
 */
export async function resetRegCounter(sectionKey, branch) {
  const branchKey = branch || "1";
  const counterRef = doc(db, "counters", `REGNR_${sectionKey}_${branchKey}`);
  await deleteDoc(counterRef);
}

/**
 * Live exchange rate helper (foreign currency -> EGP).
 *
 * Uses the same free, no-API-key service as the Currency Converter widget
 * (open.er-api.com), cached in localStorage for 1 hour so we don't spam the
 * API every time a form re-renders.
 *
 * IMPORTANT: this is only meant to be called to PRE-FILL the exchangeRate
 * field on a brand-new booking. Once a booking is saved, its exchangeRate
 * is stored on the document itself and must never be re-fetched/overwritten
 * — the page components are responsible for locking the field after the
 * first save so historical bookings always keep the rate that was actually
 * used at the time.
 */
const RATE_API_URL = "https://open.er-api.com/v6/latest/USD";
const RATE_CACHE_KEY = "xrate_cache_v1";
const RATE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function fetchExchangeRateToEGP(currency) {
  if (!currency || currency === "EGP") return 1;

  try {
    let rates = null;
    try {
      const raw = localStorage.getItem(RATE_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.fetchedAt < RATE_CACHE_TTL_MS) rates = parsed.rates;
      }
    } catch {}

    if (!rates) {
      const res = await fetch(RATE_API_URL);
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      if (!data?.rates) throw new Error("no rates");
      rates = data.rates;
      try {
        localStorage.setItem(RATE_CACHE_KEY, JSON.stringify({ rates, fetchedAt: Date.now() }));
      } catch {}
    }

    if (!rates.EGP || !rates[currency]) return null;
    // rates are relative to USD base -> EGP per 1 unit of `currency`
    return rates.EGP / rates[currency];
  } catch (err) {
    console.error("fetchExchangeRateToEGP failed:", err);
    return null;
  }
}

/**
 * Format currency
 */
export function formatCurrency(amount, currency = "EGP") {
  return new Intl.NumberFormat("en-EG", {
    style: "currency",
    currency: currency === "EGP" ? "EGP" : "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format date
 */
export function formatDate(date) {
  if (!date) return "-";
  const d = date?.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString("en-GB");
}

/* -------------------------------------------------------------------------
 * Per-section KPI totals (Sales / Cost / Profit), shared between the main
 * dashboard and each section's own header dashboard so the numbers always
 * agree. Extracted verbatim from the logic originally written for the main
 * dashboard page.
 * ---------------------------------------------------------------------- */

// Convert an amount to EGP using the rate that was actually locked on the
// booking at save time. Falls back to the legacy single `exchangeRate`
// field (older bookings only ever stored one shared rate), and to 1 for
// EGP or when no rate is available.
export function toEGP(amount, currency, row, side) {
  const n = Number(amount) || 0;
  if (!currency || currency === "EGP") return n;
  const specific = side === "buy" ? row.buyExchangeRate : row.sellExchangeRate;
  const rate = Number(specific ?? row.exchangeRate) || 1;
  return n * rate;
}

export function getFlightTotals(row) {
  const a = Math.max(0, parseInt(row.adt) || 0) || (row.isRefundRow ? 0 : 1);
  const c = Math.max(0, parseInt(row.chd) || 0);
  const ii = Math.max(0, parseInt(row.inf) || 0);
  let totalSell, totalBuy;
  if (row.totalSell !== undefined && row.totalBuy !== undefined) {
    totalSell = Math.abs(parseFloat(row.totalSell) || 0);
    totalBuy = Math.abs(parseFloat(row.totalBuy) || 0);
  } else {
    const sellADT = parseFloat(row.sellPrice) || 0;
    const sellCHD = parseFloat(row.sellPriceCHD) || 0;
    const sellINF = parseFloat(row.sellPriceINF) || 0;
    const buyADT = parseFloat(row.buyPrice) || 0;
    const buyCHD = parseFloat(row.buyPriceCHD) || 0;
    const buyINF = parseFloat(row.buyPriceINF) || 0;
    const paxA = a || 1;
    totalSell = sellADT * paxA + sellCHD * c + sellINF * ii;
    totalBuy = buyADT * paxA + buyCHD * c + buyINF * ii;
  }
  const sellCurrency = row.sellCurrency || row.currency || "EGP";
  const buyCurrency = row.buyCurrency || row.currency || "EGP";
  totalSell = toEGP(totalSell, sellCurrency, row, "sell");
  totalBuy = toEGP(totalBuy, buyCurrency, row, "buy");

  const status = String(row.status || "").toLowerCase();
  const ticketType = String(row.ticketType || "");
  const isVoid = status.includes("void") || ticketType.startsWith("V");
  if (isVoid) return { totalSell: 0, totalBuy: 0, totalProfit: 0, isCredit: false };
  // Cancelled bookings are excluded entirely from every total, report and
  // dashboard figure — as if they never existed.
  if (status === "cancelled") return { totalSell: 0, totalBuy: 0, totalProfit: 0 };

  if (row.isRefundRow) {
    return {
      totalSell: -totalSell,
      totalBuy: -totalBuy,
      totalProfit: -(totalSell - totalBuy),
      isCredit: true,
    };
  }

  const paxRefunded = (row.passengers || []).filter((p) => p.refunded);
  if (paxRefunded.length > 0) {
    for (const p of paxRefunded) {
      const hasPaxValues = p.refundAirlineAmount !== "" || p.refundCustomerAmount !== "";
      let air, cust;
      if (!hasPaxValues) {
        const isCHD = p.type === "CHD";
        const isINF = p.type === "INF";
        air = isINF ? parseFloat(row.buyPriceINF) || 0 : isCHD ? parseFloat(row.buyPriceCHD) || 0 : parseFloat(row.buyPrice) || 0;
        cust = isINF ? parseFloat(row.sellPriceINF) || 0 : isCHD ? parseFloat(row.sellPriceCHD) || 0 : parseFloat(row.sellPrice) || 0;
      } else {
        air = parseFloat(p.refundAirlineAmount) || 0;
        cust = parseFloat(p.refundCustomerAmount) || 0;
      }
      totalSell = Math.max(0, totalSell - Math.abs(toEGP(cust, sellCurrency, row, "sell")));
      totalBuy = Math.max(0, totalBuy - Math.abs(toEGP(air, buyCurrency, row, "buy")));
    }
  }

  return { totalSell, totalBuy, totalProfit: totalSell - totalBuy, isCredit: false };
}

// Ticket count for stats/reports: counts every real ticket that was
// actually issued.
//   - Void tickets → 0 (never issued/used)
//   - Refund credit-note rows → 0 (represents money back, not a ticket)
//   - A ticket that was later refunded (partially, per passenger, or the
//     whole booking marked "Refunded") still counts — it was issued, so it
//     stays in the total.
export function getFlightTicketCount(row) {
  const status = String(row.status || "").toLowerCase();
  const ticketType = String(row.ticketType || "");
  const isVoid = status.includes("void") || ticketType.startsWith("V");
  if (isVoid) return 0;
  if (status === "cancelled") return 0;
  if (row.isRefundRow) return 0;

  const a = Math.max(0, parseInt(row.adt) || 0) || 1;
  const c = Math.max(0, parseInt(row.chd) || 0);
  const ii = Math.max(0, parseInt(row.inf) || 0);
  const totalPax = a + c + ii;

  const passengers = Array.isArray(row.passengers) ? row.passengers : [];
  if (passengers.length > 0) return passengers.length;

  return totalPax;
}

// Hotels: Buy/Sell Price are entered PER NIGHT PER ROOM. Prefer the stored
// totalBuy/totalSell (computed correctly at save time); fall back to
// rate × nights × rooms for older records saved before that fix existed.
export function getHotelTotals(row) {
  // Cancelled bookings are excluded entirely from every total, report and
  // dashboard figure — as if they never existed.
  if (String(row.status || "").toLowerCase() === "cancelled") return { totalSell: 0, totalBuy: 0, totalProfit: 0 };
  const units = Math.max(1, parseInt(row.nights) || 1) * Math.max(1, parseInt(row.rooms) || 1);
  let totalSell, totalBuy;
  if (row.totalSell !== undefined && row.totalBuy !== undefined) {
    totalSell = Math.abs(parseFloat(row.totalSell) || 0);
    totalBuy = Math.abs(parseFloat(row.totalBuy) || 0);
  } else {
    totalSell = (parseFloat(row.sellPrice) || 0) * units;
    totalBuy = (parseFloat(row.buyPrice) || 0) * units;
  }
  const sellCurrency = row.sellCurrency || row.currency || "EGP";
  const buyCurrency = row.buyCurrency || row.currency || "EGP";
  totalSell = toEGP(totalSell, sellCurrency, row, "sell");
  totalBuy = toEGP(totalBuy, buyCurrency, row, "buy");
  return { totalSell, totalBuy, totalProfit: totalSell - totalBuy };
}

// Visa: Buy Price, Embassy Fee and Sell Price are entered PER APPLICANT.
// Prefer stored totals; fall back to rate × pax for older records.
export function getVisaTotals(row) {
  // Cancelled applications are excluded entirely from every total, report
  // and dashboard figure — as if they never existed.
  if (String(row.status || "").toLowerCase() === "cancelled") return { totalSell: 0, totalBuy: 0, totalProfit: 0 };
  const pax =
    Math.max(0, (parseInt(row.adt) || 0) + (parseInt(row.chd) || 0) + (parseInt(row.inf) || 0)) ||
    Math.max(1, parseInt(row.pax) || 1);
  const paxCount = Math.max(1, pax);
  let totalSell, totalBuy;
  if (row.totalSell !== undefined && row.totalBuy !== undefined) {
    totalSell = Math.abs(parseFloat(row.totalSell) || 0);
    totalBuy = Math.abs(parseFloat(row.totalBuy) || 0);
  } else {
    totalSell = (parseFloat(row.sellPrice) || 0) * paxCount;
    totalBuy = ((parseFloat(row.buyPrice) || 0) + (parseFloat(row.embassyFee) || 0)) * paxCount;
  }
  const sellCurrency = row.sellCurrency || row.currency || "EGP";
  const buyCurrency = row.buyCurrency || row.currency || "EGP";
  totalSell = toEGP(totalSell, sellCurrency, row, "sell");
  totalBuy = toEGP(totalBuy, buyCurrency, row, "buy");
  return { totalSell, totalBuy, totalProfit: totalSell - totalBuy };
}

export function getTransportationTotals(row) {
  // Cancelled bookings are excluded entirely from every total, report and
  // dashboard figure — as if they never existed.
  if (String(row.status || "").toLowerCase() === "cancelled") return { totalSell: 0, totalBuy: 0, totalProfit: 0 };
  let totalSell, totalBuy;
  if (row.totalSell !== undefined && row.totalBuy !== undefined) {
    totalSell = Math.abs(parseFloat(row.totalSell) || 0);
    totalBuy = Math.abs(parseFloat(row.totalBuy) || 0);
  } else {
    totalSell = parseFloat(row.sellPrice) || 0;
    totalBuy = parseFloat(row.buyPrice) || 0;
  }
  const sellCurrency = row.sellCurrency || row.currency || "EGP";
  const buyCurrency = row.buyCurrency || row.currency || "EGP";
  totalSell = toEGP(totalSell, sellCurrency, row, "sell");
  totalBuy = toEGP(totalBuy, buyCurrency, row, "buy");
  return { totalSell, totalBuy, totalProfit: totalSell - totalBuy };
}

// Opens a plain popup window and prints arbitrary HTML content.
// Used for the per-service "Print" button available on Flights, Hotels,
// Visa and Transportation (same spot as the "Add to File" button).
export function openPrintWindow(title, bodyHtml) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(`<html><head><title>${title || "Print"}</title><style>
    body{font-family:Arial,sans-serif;padding:24px;color:#1e293b}
    h2{margin:0 0 4px 0;font-size:18px}
    .sub{color:#64748b;font-size:12px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    th{background:#f1f5f9;text-align:left;padding:6px 8px;border:1px solid #e2e8f0;font-size:11px}
    td{padding:6px 8px;border:1px solid #e2e8f0;font-size:12px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:10px;font-size:12px}
    .lbl{color:#64748b;font-size:10px;text-transform:uppercase}
    .actions{margin-top:20px}
    .actions button{padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;margin-right:8px}
    @media print{.actions{display:none}}
  </style></head><body>${letterheadHtml()}${bodyHtml}${letterheadFooterHtml()}
    <div class="actions">
      <button onclick="window.print()" style="background:#2563eb;color:#fff;border:none">Print</button>
      <button onclick="window.close()" style="background:#fff;border:1px solid #cbd5e1">Close</button>
    </div>
  </body></html>`);
  w.document.close();
}
