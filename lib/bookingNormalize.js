/**
 * Shared parsing/formatting/normalization for every "read all bookings and
 * summarize them" screen: Accounts, Reports, and Data Analysis. These three
 * pages used to each keep their own independent copy of this logic, and it
 * already caused real, hard-to-spot bugs in this app: the exact same
 * missing-EGP-conversion bug (raw amounts summed across currencies with no
 * conversion) and the exact same missing "Cancelled" exclusion were each
 * found and fixed THREE separate times, once per file, because there was
 * no single place to fix them once and have every screen agree.
 *
 * Import from here instead of redefining any of this locally. If a screen
 * needs one more derived field, add it to normalizeBookingRow() below so
 * every consumer gets it, rather than recreating the whole function.
 */

export function parseNum(v) {
  if (v === "" || v === null || v === undefined) return 0;
  return parseFloat(String(v).replace(/,/g, "")) || 0;
}

export function fmtMoney(v) {
  return Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtTimestamp(ts) {
  if (!ts) return "—";
  const d = typeof ts?.toDate === "function" ? ts.toDate() : ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function daysBetween(isoDate) {
  if (!isoDate) return 0;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - d) / 86400000));
}

export function agingBucket(days) {
  if (days <= 0) return "current";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return "d90p";
}

// Evenly spaced hues so any number of pie/chart slices gets visually
// distinct colors, how ever many there are.
export function chartColor(i) {
  const hue = (i * 137.508) % 360; // golden-angle spacing
  return `hsl(${hue.toFixed(0)}, 62%, 50%)`;
}

/**
 * Convert an amount to EGP using the rate actually locked on the booking
 * at save time (buyExchangeRate for the buy leg, sellExchangeRate for the
 * sell leg — a booking can legitimately buy in one currency and sell in
 * another). Falls back to the legacy shared `exchangeRate` field, and to 1
 * for EGP.
 */
export function toEGP(amount, currency, row, side) {
  const n = Number(amount) || 0;
  if (!currency || currency === "EGP") return n;
  const specific = side === "buy" ? row.buyExchangeRate : row.sellExchangeRate;
  const rate = Number(specific ?? row.exchangeRate) || 1;
  return n * rate;
}

/**
 * The single normalization pass every Accounts/Reports/Analysis screen
 * runs each raw booking document through before aggregating anything.
 * Handles: Void/Cancelled exclusion (zeroed out, not just flagged — a
 * cancelled booking should count as if it never happened, everywhere),
 * refund sign-flipping, EGP currency conversion, and pulling the handful
 * of differently-named fields each of the four booking sections
 * (Flight/Hotel/Visa/Transport) uses for the same concept (e.g. "date")
 * into one consistent shape.
 */
export function normalizeBookingRow(row, section) {
  const isRefund = !!row.isRefundRow;
  const statusLower = String(row.status || "").toLowerCase();
  const isVoidStatus = statusLower.includes("void") || String(row.ticketType || "").startsWith("V");
  // Cancelled bookings are excluded from every total/report/dashboard
  // figure everywhere else in the app (see the getXTotals functions in
  // lib/helpers.js) — treat them the same way here.
  const isCancelled = statusLower === "cancelled";

  const buyCurrency = row.buyCurrency || row.currency || "EGP";
  const sellCurrency = row.sellCurrency || row.currency || "EGP";

  // Original amounts, in their own booking currency — kept for anything
  // that displays or groups by the booking's real currency.
  let origBuy = Math.abs(parseNum(row.totalBuy ?? row.buyPrice));
  let origSell = Math.abs(parseNum(row.totalSell ?? row.sellPrice));
  if (section === "Visa" && row.embassyFee !== undefined) {
    origBuy = Math.abs(parseNum(row.totalBuy ?? parseNum(row.buyPrice) + parseNum(row.embassyFee)));
  }

  // EGP-converted amounts — this is what every total/aggregate should sum.
  let buy = buyCurrency === "EGP" ? origBuy : toEGP(origBuy, buyCurrency, row, "buy");
  let sell = sellCurrency === "EGP" ? origSell : toEGP(origSell, sellCurrency, row, "sell");

  // Service fee sign follows the same refund/void treatment as buy/sell.
  let serviceFee = parseNum(row.serviceFee);

  if (isVoidStatus || isCancelled) {
    buy = 0;
    sell = 0;
    origBuy = 0;
    origSell = 0;
    serviceFee = 0;
  } else if (isRefund) {
    buy = -buy;
    sell = -sell;
    origBuy = -origBuy;
    origSell = -origSell;
    serviceFee = -serviceFee;
  }

  const paymentMethod = row.paymentMethod || (row.isCC ? "CC" : "Cash");
  // Used for display/sorting/grouping by date.
  const date = row.issueDate || row.applicationDate || row.pickupDate || row.checkIn || row.refundDate || "";
  // Used for AR/AP aging specifically — deliberately does NOT fall back to
  // refundDate: a credit note's age should be based on the original
  // transaction it offsets, not when the credit note itself was raised.
  const agingDate = row.issueDate || row.applicationDate || row.pickupDate || row.checkIn || "";

  return {
    id: `${section}-${row.id}`,
    docId: row.id,
    section,
    date,
    branch: row.branch || "1",
    // Bookings store the salesman's short code/initials in `salesman` and
    // their full name separately in `salesmanName` — expose both under
    // distinct keys so a screen can filter by code and still display the
    // name, instead of only getting whichever one happened to be read.
    salesmanCode: row.salesman || "",
    salesman: row.salesmanName || row.salesman || "Unassigned",
    clientCode: row.clientCode || "",
    clientName: row.clientName || "",
    supplierCode: row.supplierCode || "",
    supplierName: row.supplierName || row.supplierSymbol || "",
    paymentMethod,
    isCash: paymentMethod !== "CC",
    isCC: paymentMethod === "CC",
    ref:
      row.invoiceNumber ||
      row.confirmationNr ||
      row.passengers?.[0]?.ticketNr ||
      row.applicants?.[0]?.passportNr ||
      row.referenceNr ||
      "",
    description:
      section === "Flight"
        ? [row.from, row.to].filter(Boolean).join(" → ") || row.passengers?.[0]?.name || "Air Ticket"
        : section === "Hotel"
          ? [row.hotelName, row.city].filter(Boolean).join(" · ") || "Hotel"
          : section === "Visa"
            ? [row.destination || row.country, row.visaType].filter(Boolean).join(" · ") || "Visa"
            : section === "Transport"
              ? [row.pickupLocation, row.dropoffLocation].filter(Boolean).join(" → ") || row.serviceType || "Transport"
              : section,
    buy,
    sell,
    origBuy,
    origSell,
    buyCurrency,
    sellCurrency,
    // Kept for anything that reads a single "currency" label — but note
    // buy/sell above are ALWAYS EGP; use origBuy/origSell with
    // buyCurrency/sellCurrency for true original-currency figures.
    currency: row.sellCurrency || row.buyCurrency || row.currency || "EGP",
    isMixedCurrency: buyCurrency !== sellCurrency,
    serviceFee,
    profit: sell - buy,
    status: row.status || "",
    invoiceIssued: !!row.invoiceIssued,
    invoicePaid: !!row.invoicePaid,
    isRefund,
    isVoid: isVoidStatus || isCancelled,
    isCancelled,
    pax: row.pax || parseNum(row.adt) + parseNum(row.chd) + parseNum(row.inf) || 1,
    ageDays: daysBetween(agingDate),
  };
}
