/**
 * Ticket OCR — specialized for Amadeus (1A) cryptic ticket mask
 * + generic fallback for other layouts
 */

const MONTHS = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/**
 * Strip stray OCR noise glyphs (currency symbols, bullets, degree signs,
 * etc.) that Tesseract sometimes inserts between real tokens — e.g. reading
 * a faint column divider as "¥" or a status icon as "°". Left in place,
 * these break the tight token-adjacency regexes below (a single stray char
 * between "Y" and "19SEP" is enough to make a whole segment fail to match).
 * Keeps letters, digits, whitespace, and the punctuation real ticket lines
 * actually use.
 */
function sanitizeOcrNoise(str) {
  return String(str || "").replace(/[^A-Za-z0-9\s/.,-]/g, " ");
}

/** Convert 23APR26 or 25APR → YYYY-MM-DD */
function parseAmadeusDate(str, fallbackYear) {
  if (!str) return "";
  const m = String(str).toUpperCase().match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})?$/);
  if (!m) return "";
  const day = m[1].padStart(2, "0");
  const mon = MONTHS[m[2]];
  let year = m[3] ? "20" + m[3] : String(fallbackYear || new Date().getFullYear());
  return `${year}-${mon}-${day}`;
}

/** Convert 0425 → 04:25 */
function parseAmadeusTime(str) {
  if (!str) return "";
  const d = String(str).replace(/\D/g, "");
  if (d.length === 3) return `0${d[0]}:${d.slice(1)}`;
  if (d.length === 4) return `${d.slice(0, 2)}:${d.slice(2)}`;
  return "";
}

/**
 * Detect Amadeus 1A ticket mask
 * Signatures: TKT-, LOC-, " 1A ", OD-, segment lines like "1 OCAI AF 551"
 */
export function isAmadeus1A(text) {
  const u = (text || "").toUpperCase();
  const hasTkt = /TKT[-\s]?\d{10,}/.test(u) || /\b\d{3}[-\s]?\d{10}\b/.test(u);
  const hasLoc = /LOC[-\s]?[A-Z0-9]{5,7}/.test(u);
  const has1A = /\b1A\b/.test(u);
  const hasOd = /OD-[A-Z]{6}/.test(u);
  const hasSeg = /\d\s+[0OX]{0,2}[A-Z]{3}\s+[A-Z]{2}\s*\d{1,4}/.test(u);
  const hasEquiv = /EQUIV\s+EGP|TOTALTAX\s+EGP|FARE\s+F\s+USD/i.test(u);
  // Need ticket number + at least 2 Amadeus signatures (tolerant of OCR noise)
  const signals = [hasLoc, has1A, hasOd, hasSeg, hasEquiv].filter(Boolean).length;
  return hasTkt && signals >= 2;
}

/**
 * Parse Amadeus cryptic e-ticket text
 */

/**
 * Detect Amadeus EMD (Electronic Miscellaneous Document)
 * Signatures: EMD-, TYPE-S/A, SYS-1A, RFIC-, ICW-, DESCRIPTION-
 */
export function isAmadeusEMD(text) {
  const u = (text || "").toUpperCase();
  const hasEmd = /EMD[-\s]?\d{10,}/.test(u);
  const hasType = /TYPE-[SA]/.test(u);
  const hasRfic = /RFIC-[A-Z]/.test(u);
  const hasSys = /SYS-1A/.test(u) || /\b1A\b/.test(u);
  return hasEmd && (hasType || hasRfic || hasSys);
}

export function parseAmadeus1A(rawText) {
  const text = (rawText || "").replace(/\r/g, "\n");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const full = text.replace(/\n/g, " ");

  const result = {
    formType: "amadeus_1a",
    gds: "1A",
    passengers: [],
    segments: [],
    pnr: "",
    ticketNr: "",
    airline: "",
    from: "",
    to: "",
    issueDate: "",
    fareValue: "",
    taxes: "",
    currency: "EGP",
    buyCurrency: "EGP",
    sellCurrency: "EGP",
    fareCurrency: "",
    raw: text,
  };

  // ── TKT-0576907816432-433 ──
  // OCR-tolerant patterns for ticket number
  const tktPatterns = [
    /TKT[-\s]?(\d{3})[-\s]?(\d{7,10})(?:[-\s](\d{1,4}))?/i,
    /TKT[^\d]{0,3}(\d{3})[^\d]{0,2}(\d{7,10})/i,
    /\b(\d{3})[-\s](\d{10})\b/,
    /\b(\d{13})\b/,
  ];
  for (const re of tktPatterns) {
    const tktM = full.match(re);
    if (!tktM) continue;
    if (tktM[2] !== undefined && String(tktM[1]).length === 3) {
      result.ticketNr = `${tktM[1]}-${String(tktM[2]).replace(/\D/g, "").slice(0, 10)}`;
      break;
    }
    if (tktM[1] && String(tktM[1]).length === 13) {
      const d = String(tktM[1]);
      result.ticketNr = `${d.slice(0, 3)}-${d.slice(3)}`;
      break;
    }
  }

  // ── LOC-76L4TL (PNR) ──
  const locM = full.match(/LOC[-\s]?([A-Z0-9]{5,7})/i);
  if (locM) result.pnr = locM[1].toUpperCase();

  // ── DOI-23APR26 (Date of Issue) ──
  const doiM = full.match(/DOI[-\s]?(\d{1,2}[A-Z]{3}\d{0,2})/i);
  if (doiM) result.issueDate = parseAmadeusDate(doiM[1]);

  // ── OD-CAICAI ──
  const odM = full.match(/OD-([A-Z]{3})([A-Z]{3})/i);
  if (odM) {
    result.from = odM[1].toUpperCase();
    result.to = odM[2].toUpperCase();
  }

    // ── Passenger lines ──
  // Examples:
  //   1.AHMED/MARWAN AWAD MR                ADT
  //   1.BOTROS/MARIA MISS                  CHD              ST
  //   1.SMITH/JOHN MSTR                    INF
  const names = new Set();
  for (const line of lines) {
    // Must start with "1." / "2." etc.
    if (!/^\s*\d+\./.test(line)) continue;

    // Extract type first: prefer CHD/INF over ADT/ST when multiple markers present
    let type = "ADT";
    const typeMatches = [...line.matchAll(/\b(ADT|CHD|INF|ST)\b/gi)].map((x) => x[1].toUpperCase());
    if (typeMatches.includes("CHD")) type = "CHD";
    else if (typeMatches.includes("INF")) type = "INF";
    else if (typeMatches.includes("ADT")) type = "ADT";
    // ST alone → ADT (sold ticket indicator, not a pax type)

    // Name: "LAST/FIRST [MIDDLE] [TITLE]" — keep MR/MRS/MS/MISS/MSTR in the name
    const nameM =
      line.match(/^\s*\d+\.\s*([A-Z][A-Z\-\s]*\/[A-Z][A-Z\-\s]*?(?:\s+(?:MR|MRS|MS|MISS|MSTR))?)(?:\s+(?:ADT|CHD|INF|ST)\b|\s{2,}|\s*$)/i) ||
      line.match(/^\s*\d+\.\s*([A-Z][A-Z\-\s]*\/[A-Z][A-Z\-\s]+)/i);
    if (!nameM) continue;

    let name = nameM[1].replace(/\s+/g, " ").trim().toUpperCase();
    // Strip only type markers (CHD/ADT/INF/ST), keep titles (MR/MRS/MISS...)
    name = name.replace(/\s+(ADT|CHD|INF|ST)\s*$/i, "").trim();

    // Dedupe key without title so "BOTROS/MARIA" and "BOTROS/MARIA MISS" don't both add
    const nameKey = name.replace(/\s+(MR|MRS|MS|MISS|MSTR)\s*$/i, "").trim();
    if (!name.includes("/") || nameKey.length < 5 || names.has(nameKey)) continue;
    names.add(nameKey);

    result.passengers.push({
      name,
      ticketNr: result.ticketNr,
      pnr: result.pnr,
      type,
      originalTicketNr: "",
      emdTicketNr: "",
    });
  }
  // Fallback on full text
  if (result.passengers.length === 0) {
    const p2 = full.match(/\d+\.\s*([A-Z][A-Z\-]+\/[A-Z][A-Z\-\s]+?(?:\s+(?:MR|MRS|MS|MISS|MSTR))?)(?:\s+(?:ADT|CHD|INF)|\s{2,}|\s*$)/i);
    if (p2) {
      let name = p2[1].replace(/\s+/g, " ").trim().toUpperCase();
      name = name.replace(/\s+(ADT|CHD|INF)\s*$/i, "").trim();
      let type = "ADT";
      if (/\bCHD\b/i.test(full)) type = "CHD";
      else if (/\bINF\b/i.test(full)) type = "INF";
      result.passengers.push({
        name,
        ticketNr: result.ticketNr,
        pnr: result.pnr,
        type,
        originalTicketNr: "",
        emdTicketNr: "",
      });
    }
  }
  if (result.passengers.length === 0 && (result.ticketNr || result.pnr)) {
    result.passengers.push({
      name: "",
      ticketNr: result.ticketNr,
      pnr: result.pnr,
      type: "ADT",
      originalTicketNr: "",
      emdTicketNr: "",
    });
  }

  // ── Segments ──
  // Formats seen (the normal case — one full line per segment):
  // 1 OCAI AF 551  R 25APR0425  OK RGL0TBRA
  // 2 XCDG AF3581DL X 25APR1100  OK RGL0TBRA
  // 3 XMSP DL3714  X 25APR2137  OK RGL0TBRA
  //
  // Tesseract sometimes reads the ticket's wide column gaps as separate
  // blocks and returns all the "seq/city/carrier/flight" fragments first,
  // then all the "class/date/status/fareBasis" fragments afterwards, e.g.:
  //   1 OCAI SM 4
  //   2 OSSH SM 5
  //   Y 19SEP1100 OK YDOEG
  //   Y 26SEP1315 OK YDOEG
  // Matching a single regex against the whole joined text would pair
  // segment 2's header with segment 1's date (wrong city+date combo). To
  // avoid that we first match each line on its own — a match can never
  // straddle two unrelated rows that way — and only fall back to pairing
  // leftover "header-only" lines with leftover "date-only" lines (by their
  // order of appearance, which OCR preserves within each column) when a
  // line-by-line match wasn't possible.
  const issueYear = result.issueDate ? parseInt(result.issueDate.slice(0, 4), 10) : new Date().getFullYear();
  // The O/X origin/destination marker is a single glyph on the real ticket,
  // but Tesseract regularly mangles it into "0O"/"O0"/"00" (reading it as a
  // zero, or as both a zero and the letter) — so we accept up to 2 chars
  // from {0, O, X} there instead of exactly one.
  const segLineRe = /^(\d+)\s+([0OX]{0,2})([A-Z]{3})\s+([A-Z]{2,4})\s*(\d{1,4}|[A-Z]{1,2})[A-Z]{0,2}\s+[A-Z]?\s*(\d{1,2}[A-Z]{3})(\d{3,4})?\s+(OK|NS|SA|HL)?\s*([A-Z0-9]+)?/i;
  const headerOnlyRe = /^(\d+)\s+([0OX]{0,2})([A-Z]{3})\s+([A-Z]{2,4})\s*(\d{1,4}|[A-Z]{1,2})\s*$/i;
  const tailOnlyRe = /^([A-Z])?\s*(\d{1,2}[A-Z]{3})(\d{3,4})?\s+(OK|NS|SA|HL)?\s*([A-Z0-9]*)\s*$/i;

  const cleanLines = lines.map((l) => sanitizeOcrNoise(l).replace(/\s+/g, " ").trim());

  const buildSegment = (city, carrier, flight, cls, dateTok, timeTok, status, fareBasis) => ({
    city: (city || "").toUpperCase(),
    carrier: (carrier || "").toUpperCase(),
    flight: flight || "",
    class: (cls || "Y").toUpperCase(),
    date: parseAmadeusDate(dateTok, issueYear),
    depTime: parseAmadeusTime(timeTok || ""),
    arrTime: "",
    status: (status || "OK").toUpperCase(),
    fareBasis: (fareBasis || "").toUpperCase(),
  });

  const found = []; // { seq: number, seg }
  const consumed = new Array(cleanLines.length).fill(false);

  // Pass 1: complete single-line segments (the common, reliable case)
  cleanLines.forEach((l, i) => {
    if (!l) return;
    const m = l.match(segLineRe);
    if (!m) return;
    let cls = null;
    const clsM = l.match(new RegExp(m[5] + "[A-Z]{0,2}\\s+([A-Z])\\s+" + m[6], "i"));
    if (clsM) cls = clsM[1];
    found.push({ seq: parseInt(m[1], 10), seg: buildSegment(m[3], m[4], m[5], cls, m[6], m[7], m[8], m[9]) });
    consumed[i] = true;
  });

  // Pass 2: leftover header-only / date-only lines (column-split case)
  const headers = [];
  const tails = [];
  cleanLines.forEach((l, i) => {
    if (consumed[i] || !l) return;
    const h = l.match(headerOnlyRe);
    if (h) { headers.push(h); consumed[i] = true; return; }
    // Only treat as a "tail" if it actually contains a date token — avoids
    // false positives on unrelated short lines.
    if (/\d{1,2}[A-Z]{3}/i.test(l)) {
      const t = l.match(tailOnlyRe);
      if (t) { tails.push(t); consumed[i] = true; }
    }
  });
  if (headers.length && headers.length === tails.length) {
    headers.forEach((h, i) => {
      const t = tails[i];
      found.push({ seq: parseInt(h[1], 10), seg: buildSegment(h[3], h[4], h[5], t[1], t[2], t[3], t[4], t[5]) });
    });
  }

  // Keep segments in the ticket's own sequence order (1, 2, 3…) regardless
  // of which pass found them.
  found.sort((a, b) => a.seq - b.seq);
  result.segments = found.map((f) => f.seg);

  // Last-resort fallback: very loose single-token scan if nothing above matched.
  if (result.segments.length === 0) {
    for (const line of lines) {
      const cl = sanitizeOcrNoise(line).replace(/\s+/g, " ").trim();
      const m = cl.match(/^(\d+)\s+([0OX]{0,2})([A-Z]{3})\s+([A-Z]{2})\s*(\d{1,4})/i);
      if (!m) continue;
      const dateTime = cl.match(/(\d{1,2}[A-Z]{3})(\d{3,4})?/i);
      result.segments.push({
        city: m[3].toUpperCase(),
        carrier: m[4].toUpperCase(),
        flight: m[5],
        class: "Y",
        date: dateTime ? parseAmadeusDate(dateTime[1], issueYear) : "",
        depTime: dateTime && dateTime[2] ? parseAmadeusTime(dateTime[2]) : "",
        arrTime: "",
        status: "OK",
        fareBasis: "",
      });
    }
  }

  if (result.segments.length) {
    result.from = result.from || result.segments[0].city;
    result.airline = result.segments[0].carrier;
    // last segment city before final destination often connection; OD-to is better
    result.to = result.to || result.segments[result.segments.length - 1].city;
  }

  // ── Final arrival city ──
  // Amadeus prints one more line right after the segment list with just the
  // trip's final destination airport code (e.g. a lone "CAI" line closing a
  // CAI→SSH→CAI round trip). It's not part of any segment's own line, so
  // the matching above never sees it — but it's exactly the arrival point
  // of the last segment. Look for it on the line right after whichever
  // segment line was consumed last.
  let finalArrivalCity = "";
  const lastConsumedIdx = consumed.reduce((max, isUsed, i) => (isUsed ? i : max), -1);
  if (lastConsumedIdx >= 0) {
    for (let i = lastConsumedIdx + 1; i < cleanLines.length; i++) {
      const l = cleanLines[i];
      if (!l) continue;
      if (/^[A-Z]{3}$/.test(l)) finalArrivalCity = l.toUpperCase();
      break; // only the very next non-empty line counts
    }
  }
  if (finalArrivalCity) result.to = finalArrivalCity;

  // Each segment's arrival city = the next segment's departure city (it's a
  // connecting/return leg); the last segment's arrival is the final
  // destination captured above (falling back to OD's "to" if that line
  // wasn't found).
  result.segments = result.segments.map((seg, i, arr) => ({
    ...seg,
    toCity: i < arr.length - 1 ? arr[i + 1].city : (finalArrivalCity || result.to || ""),
  }));

  // ── Exchange detection FIRST (affects how amounts are mapped) ──
  // FO 057-6907816432... = original ticket (exchange/reissue)
  const foM = full.match(/\bFO\s+(\d{3})[\s-]?(\d{7,10})/i);
  if (foM) {
    result.ticketType = "E - Exchanging";
    result.originalTicketNr = `${foM[1]}-${foM[2]}`;
    if (result.passengers[0]) {
      result.passengers[0].originalTicketNr = result.originalTicketNr;
    }
  } else if (/\bFARE\s+R\b/i.test(full) && /TOTAL\s+\w+\s+[0-9.,]+A\b/i.test(full)) {
    result.ticketType = "E - Exchanging";
  } else {
    result.ticketType = "T - Ticket";
  }
  const isExchange = result.ticketType === "E - Exchanging";

  // ── Fares ──
  // Priority for form "F. Value":
  //   1) EQUIV (local amount) when present
  //   2) else FARE when already in EGP (FARE F EGP xxx)
  //   3) else FARE in foreign currency
  //   4) else TOTAL - TOTALTAX (fallback when OCR misses FARE/EQUIV line)
  // OCR-tolerant patterns (extra spaces, missing letter, FEGP stuck, etc.)
  const farePatterns = [
    /FARE\s+[A-Z]?\s*(USD|EUR|EGP)\s+([0-9,]+\.?[0-9]*)/i,
    /FARE\s*[A-Z]?\s*(USD|EUR|EGP)\s*([0-9,]+\.?[0-9]*)/i,
    /FARE[^A-Z0-9]{0,6}(USD|EUR|EGP)[^0-9]{0,4}([0-9,]+\.?[0-9]*)/i,
    /\bF(?:ARE)?\s*[FR]?\s*(EGP)\s+([0-9,]+\.?[0-9]*)/i,
  ];
  let fareAmount = "";
  let fareCurrency = "";
  for (const re of farePatterns) {
    const fareM = full.match(re);
    if (fareM) {
      fareCurrency = fareM[1].toUpperCase();
      fareAmount = fareM[2].replace(/,/g, "");
      result.fareCurrency = fareCurrency;
      break;
    }
  }
  // EQUIV EGP 20318.00 → preferred local currency fare
  const equivM = full.match(/EQUIV\s*(EGP|USD|EUR)\s*([0-9,]+\.?[0-9]*)/i)
    || full.match(/EQUIV[^A-Z0-9]{0,4}(EGP|USD|EUR)[^0-9]{0,4}([0-9,]+\.?[0-9]*)/i);
  if (equivM) {
    result.currency = equivM[1].toUpperCase();
    result._equiv = equivM[2].replace(/,/g, "");
    result.fareValue = result._equiv;
  } else if (fareAmount) {
    result.fareValue = fareAmount;
    if (fareCurrency === "EGP") {
      result.currency = "EGP";
      result._equiv = fareAmount;
    }
  }
  // TOTALTAX EGP 28707.80  (avoid matching plain TOTAL)
  const taxM = full.match(/TOTAL\s*TAX\s+(EGP|USD|EUR)\s+([0-9,]+\.?[0-9]*)/i)
    || full.match(/TOTALTAX\s+(EGP|USD|EUR)\s+([0-9,]+\.?[0-9]*)/i)
    || full.match(/TOTAL\s*TAX[^A-Z0-9]{0,4}(EGP|USD|EUR)[^0-9]{0,4}([0-9,]+\.?[0-9]*)/i);
  if (taxM) result.taxes = taxM[2].replace(/,/g, "");

  // TOTAL EGP 49025.80  or  TOTAL EGP 2602.80A
  // Must not confuse with TOTALTAX
  const totalM = full.match(/\bTOTAL(?!\s*TAX)\s+(EGP|USD|EUR)\s+([0-9,]+\.?[0-9]*)A?\b/i)
    || full.match(/\bTOTAL(?!\s*TAX)[^A-Z0-9]{0,4}(EGP|USD|EUR)[^0-9]{0,4}([0-9,]+\.?[0-9]*)A?\b/i);
  if (totalM) {
    result.currency = totalM[1].toUpperCase();
    const totalAmt = totalM[2].replace(/,/g, "");
    result.totalAmount = totalAmt;
    if (isExchange) {
      // Exchange rules (user):
      //   Fare Value = TOTAL - Taxes
      //   Buy Price  = TOTAL
      //   Sell Price = empty (manual)
      const taxNum = parseFloat(result.taxes) || 0;
      const totalNum = parseFloat(totalAmt) || 0;
      const fareNum = totalNum - taxNum;
      result.fareValue = fareNum ? fareNum.toFixed(2) : "";
      result._equiv = result.fareValue;
      result.buyPrice = totalAmt;
      result.additionalCollection = totalAmt;
      result.sellPrice = "";
    } else {
      // Regular ticket fallback: if FARE/EQUIV missed by OCR → F.Value = TOTAL - TAX
      if (!result.fareValue && result.taxes) {
        const taxNum = parseFloat(result.taxes) || 0;
        const totalNum = parseFloat(totalAmt) || 0;
        const fareNum = totalNum - taxNum;
        if (fareNum > 0) {
          result.fareValue = fareNum.toFixed(2);
          result._equiv = result.fareValue;
          result.currency = result.currency || "EGP";
        }
      }
      // Regular ticket: TOTAL reference only — sell stays empty
      result.sellPrice = "";
      result._total = totalAmt;
    }
  }

  // FP CASH / CC
  if (/FP\s+.*CASH/i.test(full)) result.paymentMethod = "Cash";
  if (/FP\s+.*CC/i.test(full) && !/CASH/i.test(full.match(/FP\s+[^\n]+/i)?.[0] || "")) {
    result.paymentMethod = "CC";
  }

  return result;
}

/**
 * Generic fallback parser (non-Amadeus)
 */

/**
 * Parse Amadeus EMD (Associated / Standalone)
 */
export function parseAmadeusEMD(rawText) {
  const text = (rawText || "").replace(/\r/g, "\n");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const full = text.replace(/\n/g, " ");

  const result = {
    formType: "amadeus_emd",
    gds: "1A",
    ticketType: "T - Ticket",
    eMisc: "EMD A", // default Associated
    isEMD: true,
    passengers: [],
    segments: [],
    pnr: "",
    ticketNr: "",
    emdNumber: "",
    originalTicketNr: "", // ICW - in connection with
    airline: "",
    from: "",
    to: "",
    issueDate: "",
    fareValue: "",
    taxes: "",
    sellPrice: "",
    emdAmount: "",
    currency: "EGP",
    description: "",
    rfic: "",
    rfisc: "",
    raw: text,
  };

  // TYPE-A = Associated (EMD A), TYPE-S = Standalone (EMD S)
  // If ICW present → treat as Associated (EMD A) even when TYPE-S
  const typeM = full.match(/TYPE[-\s]?([AS])/i);
  const hasIcw = /ICW[-\s]?\d{3}/i.test(full);
  if (hasIcw || (typeM && typeM[1].toUpperCase() === "A")) {
    result.eMisc = "EMD A";
  } else if (typeM && typeM[1].toUpperCase() === "S") {
    result.eMisc = "EMD S";
  } else {
    result.eMisc = "EMD A";
  }

  // EMD-0571951948311
  const emdM = full.match(/EMD[-\s]?(\d{3})(\d{7,10})/i);
  if (emdM) {
    result.emdNumber = `${emdM[1]}-${emdM[2]}`;
    result.ticketNr = result.emdNumber; // also expose as ticket nr for list
  }

  // SYS-1A / LOC-76L4TL
  if (/SYS-1A|\b1A\b/i.test(full)) result.gds = "1A";
  const locM = full.match(/LOC[-\s]?([A-Z0-9]{5,7})/i);
  if (locM) result.pnr = locM[1].toUpperCase();

  // DOI-10AUG26
  const doiM = full.match(/DOI[-\s]?(\d{1,2}[A-Z]{3}\d{0,2})/i);
  if (doiM) result.issueDate = parseAmadeusDate(doiM[1]);

  // PAX- AHMED/MARWAN AWAD MR  (keep title)
  const paxM = full.match(/PAX[-\s]+([A-Z][A-Z\-\s]*\/[A-Z][A-Z\-\s]*?(?:\s+(?:MR|MRS|MS|MISS|MSTR))?)(?:\s+(?:ADT|CHD|INF)|\s{2,}|\s*$)/i);
  if (paxM) {
    let name = paxM[1].replace(/\s+/g, " ").trim().toUpperCase();
    name = name.replace(/\s+(ADT|CHD|INF)\s*$/i, "").trim();
    result.passengers.push({
      name,
      ticketNr: "",
      pnr: result.pnr,
      type: /\bCHD\b/i.test(full) ? "CHD" : /\bINF\b/i.test(full) ? "INF" : "ADT",
      originalTicketNr: "",
      emdTicketNr: result.emdNumber,
    });
  }

  // ICW-0574830484377 (In Connection With = linked ticket)
  const icwM = full.match(/ICW[-\s]?(\d{3})[-\s]?(\d{7,10})/i);
  if (icwM) {
    result.originalTicketNr = `${icwM[1]}-${icwM[2]}`;
    if (result.passengers[0]) {
      result.passengers[0].originalTicketNr = result.originalTicketNr;
      result.passengers[0].ticketNr = result.originalTicketNr;
    }
  }

  // RFIC-D / RFISC-98F AF
  const rficM = full.match(/RFIC[-\s]?([A-Z0-9])/i);
  if (rficM) result.rfic = rficM[1].toUpperCase();
  const rfiscM = full.match(/RFISC[-\s]?([A-Z0-9]+)\s+([A-Z]{2})?/i);
  if (rfiscM) {
    result.rfisc = rfiscM[1].toUpperCase();
    if (rfiscM[2]) result.airline = rfiscM[2].toUpperCase();
  }

  // DESCRIPTION-PENALTY FEE
  const descM = full.match(/DESCRIPTION[-\s]+([A-Z0-9 \/\-]+?)(?:\s+NON-|\s+CONSUMED|\s+PRESENT|\s+ICW|\s+SERVICE|$)/i);
  if (descM) result.description = descM[1].replace(/\s+/g, " ").trim();

  // VALUE-14952.00
  const valM = full.match(/VALUE[-\s]+([0-9,]+\.?[0-9]*)/i);
  if (valM) result.emdAmount = valM[1].replace(/,/g, "");

  // FARE / TOTAL EGP 14952.00
  const fareM = full.match(/FARE\s+[A-Z]?\s*(EGP|USD|EUR)\s+([0-9,]+\.?[0-9]*)/i);
  if (fareM) {
    result.currency = fareM[1].toUpperCase();
    result.currency = fareM[1].toUpperCase();
    // fare not applied to form for EMD — only emdAmount
    result._emdFareRef = fareM[2].replace(/,/g, "");
  }
  const totalM = full.match(/TOTAL\s+(EGP|USD|EUR)\s+([0-9,]+\.?[0-9]*)/i);
  if (totalM) {
    result.currency = totalM[1].toUpperCase();
    // EMD: TOTAL always goes to EMD Amount (never Sell Price)
    result.emdAmount = totalM[2].replace(/,/g, "");
    result.sellPrice = "";
  }
  // VALUE-14952.00 already may set emdAmount — TOTAL wins if both exist
  if (totalM) {
    result.emdAmount = totalM[2].replace(/,/g, "");
  }

  // Correction: if EMD amount seems off by ~100 or doesn't match FARE reference
  const fareRef = result._emdFareRef ? parseFloat(result._emdFareRef) : 0;
  const valRef = valM ? parseFloat(valM[1].replace(/,/g, "")) : 0;
  const totalRef = totalM ? parseFloat(totalM[2].replace(/,/g, "")) : 0;
  const emdCurrent = parseFloat(result.emdAmount ? String(result.emdAmount).replace(/,/g, "") : "0") || 0;

  // If there's a clear reference (FARE line or VALUE line) and emdAmount is missing or off
  const referenceValue = valRef || fareRef || totalRef;
  if (referenceValue > 0 && emdCurrent > 0) {
    const diff = Math.abs(emdCurrent - referenceValue);
    // If exactly 100 less (common OCR digit misread: 9 -> 8) OR if emd is 0 and reference exists
    if (diff === 100 || (emdCurrent === 0 && referenceValue > 0)) {
      result.emdAmount = String(Math.round(referenceValue));
    }
  } else if (referenceValue > 0 && (emdCurrent === 0 || !emdCurrent)) {
    result.emdAmount = String(Math.round(referenceValue));
  }

  if (/FP\s+.*CASH/i.test(full)) result.paymentMethod = "Cash";
  if (/FP\s+.*CC/i.test(full)) result.paymentMethod = "CC";

  // Remarks for form
  const parts = [];
  if (result.description) parts.push(result.description);
  if (result.emdNumber) parts.push("EMD:" + result.emdNumber);
  if (result.originalTicketNr) parts.push("ICW:" + result.originalTicketNr);
  result.remarks = "";

  if (result.passengers.length === 0 && result.emdNumber) {
    result.passengers.push({
      name: "",
      ticketNr: result.originalTicketNr || "",
      pnr: result.pnr,
      type: "ADT",
      originalTicketNr: result.originalTicketNr || "",
      emdTicketNr: result.emdNumber,
    });
  }

  return result;
}

export function parseGenericTicket(rawText) {
  const text = (rawText || "").replace(/\r/g, "\n");
  const upper = text.toUpperCase();
  const result = {
    formType: "generic",
    gds: "",
    passengers: [],
    segments: [],
    pnr: "",
    ticketNr: "",
    airline: "",
    from: "",
    to: "",
    issueDate: "",
    fareValue: "",
    taxes: "",
    currency: "EGP",
    raw: text,
  };

  const pnrLabel = text.match(/(?:PNR|Booking Reference|Record Locator)[:\s]*([A-Z0-9]{5,7})/i);
  if (pnrLabel) result.pnr = pnrLabel[1].toUpperCase();

  const ticketPatterns = [
    /(?:TICKET|E-?TICKET|DOCUMENT|TKT)[:\s#No.]*([0-9]{3}[-\s]?[0-9]{7,10})/i,
    /\b([0-9]{3})[-\s]?([0-9]{7,10})\b/,
  ];
  for (const re of ticketPatterns) {
    const m = text.match(re);
    if (m) {
      const digits = (m[1] + (m[2] || "")).replace(/\D/g, "");
      if (digits.length >= 10) {
        result.ticketNr = digits.slice(0, 3) + "-" + digits.slice(3, 13);
        break;
      }
    }
  }

  // Only accept real passenger-style names: LAST/FIRST, reject fare/remark junk
  // Reject: ONLY/NON, TAX/FEE, VALID/ON, etc.
  const JUNK_NAME = /^(ONLY|NON|ENDO|VALID|TAX|FEE|FOR|USE|TWD|FC|FP|FE|FARE|EQUIV|TOTAL|CASH|CC|NUC|ROE|END)\b/i;
  // Capture title (MR/MRS/MISS...) as part of the name
  const nameRe = /\b([A-Z]{2,})\/([A-Z][A-Z\s]{1,40}?)(?:\s+(MR|MRS|MS|MISS|MSTR))?(?=\s+(?:ADT|CHD|INF|ST)\b|\s{2,}|\s|$)/g;
  let nm;
  while ((nm = nameRe.exec(upper)) !== null) {
    let last = nm[1].trim();
    let first = nm[2].replace(/\s+/g, " ").trim();
    const title = (nm[3] || "").toUpperCase();
    // Strip type markers that OCR glued into the first name
    first = first.replace(/\s+(ADT|CHD|INF|ST)\b.*$/i, "").trim();
    if (JUNK_NAME.test(last) || JUNK_NAME.test(first)) continue;
    if (last.length < 2 || first.length < 2) continue;
    const name = title ? `${last}/${first} ${title}` : `${last}/${first}`;
    let type = "ADT";
    const ctx = upper.slice(Math.max(0, nm.index - 5), nm.index + nm[0].length + 30);
    if (/\bCHD\b/.test(ctx)) type = "CHD";
    else if (/\bINF\b/.test(ctx)) type = "INF";
    result.passengers.push({
      name,
      ticketNr: result.ticketNr,
      pnr: result.pnr,
      type,
      originalTicketNr: "",
      emdTicketNr: "",
    });
  }
  if (result.passengers.length === 0 && (result.ticketNr || result.pnr)) {
    result.passengers.push({ name: "", ticketNr: result.ticketNr, pnr: result.pnr, type: "ADT", originalTicketNr: "", emdTicketNr: "", });
  }

  return result;
}

/** Clean passenger names/types after any parser — keeps MR/MRS/MISS/MSTR titles */
function sanitizePassengers(passengers) {
  const JUNK = /^(ONLY|NON|ENDO|VALID|TAX|FEE|FOR|USE|TWD|FC|FP|FE|FARE|EQUIV|TOTAL|CASH|CC|NUC|ROE|END)\b/i;
  const TITLE = "MR|MRS|MS|MISS|MSTR";
  return (passengers || [])
    .map((p) => {
      let name = (p.name || "").replace(/\s+/g, " ").trim().toUpperCase();
      // Pull type from name if OCR glued "CHD"/"INF" into it
      let type = (p.type || "ADT").toUpperCase();
      if (/\bCHD\b/.test(name)) type = "CHD";
      else if (/\bINF\b/.test(name)) type = "INF";
      // Strip only type markers; KEEP titles (MR/MRS/MISS/MSTR)
      name = name
        .replace(/\s+(ADT|CHD|INF|ST)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      // Keep LAST/FIRST [MIDDLE...] [TITLE]
      const m = name.match(
        new RegExp(`^([A-Z][A-Z\\-]+\\/[A-Z][A-Z\\-]*(?:\\s+[A-Z][A-Z\\-]*){0,3}(?:\\s+(?:${TITLE}))?)`)
      );
      if (m) name = m[1].trim();
      return { ...p, name, type: ["ADT", "CHD", "INF"].includes(type) ? type : "ADT" };
    })
    .filter((p) => {
      if (!p.name) return true;
      const [last, first] = p.name.split("/");
      if (!last || !first) return false;
      if (JUNK.test(last) || JUNK.test(first)) return false;
      if (/\b(ENDO|CASH|TAX|FEE|DETAILS|VALID|ONLY)\b/i.test(p.name)) return false;
      return true;
    });
}

/**
 * Main parse entry — detect form then parse
 */
export function parseTicketText(rawText) {
  let result;
  // EMD before regular ticket (both may share LOC/1A markers)
  if (isAmadeusEMD(rawText)) {
    result = parseAmadeusEMD(rawText);
  } else if (isAmadeus1A(rawText)) {
    result = parseAmadeus1A(rawText);
  } else {
    result = parseGenericTicket(rawText);
  }
  if (result && result.passengers) {
    result.passengers = sanitizePassengers(result.passengers);
    // Ensure every passenger has the ticket number from header TKT
    if (result.ticketNr) {
      result.passengers = result.passengers.map((p) => ({
        ...p,
        ticketNr: p.ticketNr || result.ticketNr,
      }));
    }
    // If sanitize removed everyone but we have ticket/pnr, keep a blank slot
    if (result.passengers.length === 0 && (result.ticketNr || result.pnr)) {
      result.passengers.push({
        name: "",
        ticketNr: result.ticketNr || "",
        pnr: result.pnr || "",
        type: "ADT",
        originalTicketNr: "",
        emdTicketNr: "",
      });
    }
  }
  return result;
}

/**
 * Upscale + boost contrast on a ticket image before handing it to Tesseract.
 * Ticket screenshots are usually small (often well under 800px wide), and
 * at that size Tesseract regularly confuses similar glyphs (I/T, 0/O, 1/I)
 * and misreads wide column gaps as separate blocks. Rendering at ~3x with
 * autocontrast measurably improves both character accuracy and layout
 * reading order. Falls back to the original file if canvas isn't available
 * (non-browser context) or preprocessing fails for any reason.
 */
async function preprocessTicketImage(file) {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.max(1, Math.min(3, Math.round(1600 / Math.max(bitmap.width, bitmap.height))));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width * scale;
    canvas.height = bitmap.height * scale;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    // Grayscale + simple autocontrast stretch — sharpens the boundary
    // between text and background without fully binarizing (which tends
    // to lose thin character strokes on compressed screenshots).
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = gray;
      if (gray < min) min = gray;
      if (gray > max) max = gray;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.min(255, Math.max(0, ((d[i] - min) / range) * 255));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob || file;
  } catch (_) {
    return file;
  }
}

/**
 * Run Tesseract OCR on an image File/Blob
 */
export async function runOcrOnImage(file, onProgress) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (m) => {
      if (onProgress && m.status === "recognizing text") {
        onProgress(Math.round((m.progress || 0) * 100));
      }
    },
  });
  try {
    // PSM 6 = "assume a single uniform block of text". Ticket masks have
    // wide gaps between columns that Tesseract's default automatic layout
    // mode (PSM 3) sometimes misreads as separate blocks, scrambling row
    // order (segment 2's flight number ends up paired with segment 1's
    // date, etc.). Forcing PSM 6 keeps it reading straight down the page,
    // line by line, in the order the ticket actually lays them out.
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    const processed = await preprocessTicketImage(file);
    const { data } = await worker.recognize(processed);
    return data.text || "";
  } finally {
    await worker.terminate();
  }
}

/**
 * Parse plain text directly (for testing without OCR)
 */
export function parseTicketFromText(text) {
  return parseTicketText(text);
}
