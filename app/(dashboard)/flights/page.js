"use client";

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import Navbar from "@/components/Navbar";
import AssignToFileButton from "@/components/AssignToFileButton";
import InvoiceIssueModal from "@/components/InvoiceIssueModal";
import SectionStats from "@/components/SectionStats";
import { useAuth } from "@/lib/auth";
import {
  collection, onSnapshot, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { generateRegNumber, peekNextRegNumber, fetchExchangeRateToEGP, getFlightTotals, getFlightTicketCount, isBranchVisible, isRecordVisible, openPrintWindow, bookingQuery } from "@/lib/helpers";
import { canWriteModule } from "@/lib/permissions";
import { useClosedFiscalYearKeys, isRowClosed } from "@/lib/fiscalYear";
import toast from "react-hot-toast";
import { DollarSign, TrendingUp, TrendingDown, Briefcase } from "lucide-react";
import {
  Plus, Pencil, Trash2, Search, ChevronFirst, ChevronLast,
  ChevronLeft, ChevronRight, Save, X, FileText, Copy, Lock, RefreshCw, Printer, LogOut
} from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { parseTicketText, runOcrOnImage } from "@/lib/ticketOcr";

/* ── Airline accounting codes (first 3 digits of ticket) → Carrier ── */
const AIRLINE_CODES = {
  "077": { carrier: "MS", name: "EgyptAir", gds: "1A" },
  "125": { carrier: "BA", name: "British Airways", gds: "1A" },
  "001": { carrier: "AA", name: "American Airlines", gds: "1S" },
  "006": { carrier: "DL", name: "Delta", gds: "1S" },
  "016": { carrier: "UA", name: "United", gds: "1G" },
  "047": { carrier: "TP", name: "TAP Portugal", gds: "1A" },
  "053": { carrier: "EI", name: "Aer Lingus", gds: "1A" },
  "055": { carrier: "AZ", name: "ITA Airways", gds: "1A" },
  "057": { carrier: "AF", name: "Air France", gds: "1A" },
  "064": { carrier: "OK", name: "Czech Airlines", gds: "1A" },
  "065": { carrier: "SV", name: "Saudia", gds: "1A" },
  "071": { carrier: "ET", name: "Ethiopian", gds: "1A" },
  "072": { carrier: "KL", name: "KLM", gds: "1A" },
  "074": { carrier: "KL", name: "KLM", gds: "1A" },
  "075": { carrier: "IB", name: "Iberia", gds: "1A" },
  "080": { carrier: "LO", name: "LOT Polish", gds: "1A" },
  "081": { carrier: "QF", name: "Qantas", gds: "1A" },
  "082": { carrier: "SN", name: "Brussels Airlines", gds: "1A" },
  "083": { carrier: "SA", name: "South African", gds: "1A" },
  "086": { carrier: "NZ", name: "Air New Zealand", gds: "1A" },
  "098": { carrier: "AI", name: "Air India", gds: "1A" },
  "105": { carrier: "AY", name: "Finnair", gds: "1A" },
  "114": { carrier: "LY", name: "El Al", gds: "1A" },
  "117": { carrier: "SK", name: "SAS", gds: "1A" },
  "131": { carrier: "JL", name: "Japan Airlines", gds: "1A" },
  "139": { carrier: "AB", name: "Air Berlin", gds: "1A" },
  "157": { carrier: "QR", name: "Qatar Airways", gds: "1A" },
  "160": { carrier: "CX", name: "Cathay Pacific", gds: "1A" },
  "163": { carrier: "TK", name: "Turkish Airlines", gds: "1A" },
  "172": { carrier: "KE", name: "Korean Air", gds: "1A" },
  "176": { carrier: "EK", name: "Emirates", gds: "1A" },
  "180": { carrier: "OL", name: "Olympic", gds: "1A" },
  "202": { carrier: "AC", name: "Air Canada", gds: "1A" },
  "205": { carrier: "NH", name: "ANA", gds: "1A" },
  "217": { carrier: "TG", name: "Thai Airways", gds: "1A" },
  "220": { carrier: "LH", name: "Lufthansa", gds: "1A" },
  "232": { carrier: "MH", name: "Malaysia Airlines", gds: "1A" },
  "235": { carrier: "TK", name: "Turkish Airlines", gds: "1A" },
  "257": { carrier: "A3", name: "Aegean", gds: "1A" },
  "297": { carrier: "CI", name: "China Airlines", gds: "1A" },
  "403": { carrier: "HY", name: "Uzbekistan Airways", gds: "1A" },
  "607": { carrier: "EY", name: "Etihad", gds: "1A" },
  "700": { carrier: "SQ", name: "Singapore Airlines", gds: "1A" },
  "724": { carrier: "SW", name: "Air Namibia", gds: "1A" },
  "774": { carrier: "GQ", name: "Sky Express", gds: "1A" },
  "871": { carrier: "A9", name: "Georgian Airways", gds: "1A" },
  "514": { carrier: "G9", name: "Air Arabia", gds: "1A" },
  "513": { carrier: "3O", name: "Air Arabia Maroc", gds: "1A" },
  "033": { carrier: "U2", name: "EasyJet", gds: "1A" },
  "224": { carrier: "FR", name: "Ryanair", gds: "1A" },
  "274": { carrier: "W6", name: "Wizz Air", gds: "1A" },
  "486": { carrier: "J9", name: "Jazeera Airways", gds: "1A" },
  "312": { carrier: "6E", name: "IndiGo", gds: "1A" },
  "328": { carrier: "DY", name: "Norwegian", gds: "1A" },
  "645": { carrier: "EW", name: "Eurowings", gds: "1A" },
  "030": { carrier: "VY", name: "Vueling", gds: "1A" },
  "129": { carrier: "HV", name: "Transavia", gds: "1A" },
  "775": { carrier: "SG", name: "SpiceJet", gds: "1A" },
  "807": { carrier: "AK", name: "AirAsia", gds: "1A" },
  "565": { carrier: "F3", name: "Flyadeal", gds: "1A" },
  "769": { carrier: "NP", name: "Nile Air", gds: "1A" },
  "381": { carrier: "SM", name: "Air Cairo", gds: "1A" },
  "856": { carrier: "NE", name: "Nesma Airlines", gds: "1A" },
  "570": { carrier: "E5", name: "Air Arabia Egypt", gds: "1A" },
  "745": { carrier: "W9", name: "Wizz Air UK", gds: "1A" },
  "378": { carrier: "9P", name: "Flynas", gds: "1A" },
};

const EMPTY_SEGMENT = { city: "", toCity: "", carrier: "", flight: "", class: "Y", date: "", depTime: "", arrTime: "", status: "", fareBasis: "" };

const EMPTY_PAX = { ticketNr: "", pnr: "", name: "", type: "ADT", originalTicketNr: "", emdTicketNr: "", refunded: false, refundAirlineAmount: "", refundCustomerAmount: "" };

const EMPTY_FORM = {
  invoiceType: "ticket",
  currency: "EGP",
  buyCurrency: "EGP",
  sellCurrency: "EGP",
  // EGP value of 1 unit of each side's currency, captured independently
  // (buy and sell can be in different foreign currencies) once at booking
  // time and locked forever after the first save (see `rateLocked` logic).
  // `exchangeRate` is kept in sync with sellExchangeRate for backward
  // compatibility with older code/data that only knew one shared rate.
  buyExchangeRate: 1,
  sellExchangeRate: 1,
  exchangeRate: 1,
  clientCode: "30.00.00.0000",
  clientName: "",
  supplierCode: "50.00.00.0000",
  supplierName: "",
  supplierSymbol: "",
  issueDate: new Date().toISOString().slice(0, 10),
  adt: 1,
  chd: 0,
  inf: 0,
  pax: 1,
  ticketType: "T - Ticket",
  eMisc: "",
  branch: "1",
  tripType: "oneWay",
  fareValue: "",
  taxes: "",
  emdAmount: "",
  serviceFee: "",
  sellPrice: "",
  buyPrice: "",
  fareValueCHD: "",
  taxesCHD: "",
  emdAmountCHD: "",
  serviceFeeCHD: "",
  sellPriceCHD: "",
  buyPriceCHD: "",
  fareValueINF: "",
  taxesINF: "",
  emdAmountINF: "",
  serviceFeeINF: "",
  sellPriceINF: "",
  buyPriceINF: "",
  salesman: "",
  salesmanName: "",
  gds: "",
  remarks: "",
  category: "",
  status: "Confirmed",
  // --- Refund / Void accounting (affects all reports) ---
  refundAirlineAmount: "",
  refundCustomerAmount: "",
  refundDate: "",
  refundReason: "",
  segments: [{ ...EMPTY_SEGMENT }, { ...EMPTY_SEGMENT }],
  passengers: [{ ...EMPTY_PAX }],
  invoiceNumber: "",
  numberPrefix: "",
  sequentialNumber: 0,
  invoiceIssued: false,
  conjunction: false,
  paymentMethod: "Cash",
  isCash: true,
  isCC: false,
};

function splitCode(code, type = "client") {
  if (!code || typeof code !== "string") return type === "client" ? ["30", "00", "00", ""] : ["50", "00", "00", ""];
  const parts = code.split(".");
  if (parts.length === 4) return parts;
  if (parts.length === 1 && code.length >= 2) return [parts[0].slice(0, 2), "00", "00", parts[0].slice(2)];
  return type === "client" ? ["30", "00", "00", ""] : ["50", "00", "00", ""];
}
function joinCode(parts) { return parts.join("."); }

const CODE_SEG_RANGES = [[0, 2], [3, 5], [6, 8], [9, 13]];
function getSegmentRange(index) { return CODE_SEG_RANGES[index] || [0, 2]; }
function getSegmentIndexByPos(pos) {
  if (pos < 3) return 0;
  if (pos < 6) return 1;
  if (pos < 9) return 2;
  return 3;
}
function formatCodeForBlur(code, type) {
  const def = type === "client" ? "30.00.00.0000" : "50.00.00.0000";
  if (!code || typeof code !== "string") return def;
  let trimmed = code.trim();
  if (!trimmed) return def;
  let parts = trimmed.split(".");
  const defParts = def.split(".");
  if (parts.length !== 4) {
    const digits = trimmed.replace(/\D/g, "");
    if (!digits) return def;
    // Build from digits: pad to 10 digits (2+2+2+4)
    const padded = digits.padEnd(10, "0").slice(0, 10);
    parts = [padded.slice(0, 2), padded.slice(2, 4), padded.slice(4, 6), padded.slice(6, 10)];
  }
  parts = parts.map((p, i) => {
    const len = i === 3 ? 4 : 2;
    const fallback = defParts[i];
    let clean = (p || "").replace(/\D/g, "");
    if (clean === "") return fallback;
    return clean.padStart(len, "0").slice(-len);
  });
  return parts.join(".");
}

function formatMoneyInput(val) {
  if (val === "" || val === null || val === undefined) return "";
  const num = parseFloat(String(val).replace(/,/g, ""));
  if (isNaN(num)) return val;
  return num.toFixed(2);
}

function formatDateDMY(isoDate) {
  if (!isoDate) return "-";
  const parts = String(isoDate).split("-");
  if (parts.length === 3 && parts[0].length === 4) {
    const [y, m, d] = parts;
    if (y && m && d) return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
  }
  return isoDate;
}

function formatTicketNr(digits) {
  const d = digits.replace(/\D/g, "").slice(0, 13);
  if (d.length <= 3) return d;
  return d.slice(0, 3) + "-" + d.slice(3);
}

function digitsFromTicket(ticketNr) {
  return (ticketNr || "").replace(/\D/g, "").slice(0, 13);
}

function buildConjunctionTicket(baseDigits13, idx) {
  try {
    const base = BigInt(baseDigits13);
    const firstNum = base + BigInt(idx * 2);
    const secondNum = firstNum + 1n;
    const firstStr = String(firstNum).padStart(13, "0").slice(-13);
    const secondSuffix = String(secondNum).slice(-3).padStart(3, "0");
    return formatTicketNr(firstStr) + " - " + secondSuffix;
  } catch {
    return "";
  }
}

function firstTicketPart(ticketNr) {
  if (!ticketNr) return "";
  return ticketNr.split(" - ")[0].trim();
}

function formatTime24(val) {
  let v = (val || "").replace(/[^0-9]/g, "").slice(0, 4);
  if (!v) return "";
  if (v.length >= 3) v = v.slice(0, 2) + ":" + v.slice(2);
  else return v;
  const parts = v.split(":");
  let h = parseInt(parts[0] || "0", 10);
  let m = parseInt(parts[1] || "0", 10);
  if (isNaN(h) || h < 0) h = 0; if (h > 23) h = 23;
  if (isNaN(m) || m < 0) m = 0; if (m > 59) m = 59;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function normalizeTime24Blur(val) {
  if (!val) return "";
  let v = String(val).trim();
  if (!v) return "";
  // Handle raw digits without colon e.g. "1430" -> "14:30"
  if (!v.includes(":")) {
    const digits = v.replace(/[^0-9]/g, "").slice(0, 4);
    if (!digits) return "";
    if (digits.length >= 3) {
      v = digits.slice(0, 2) + ":" + digits.slice(2);
    } else {
      // 1-2 digits only: treat as hours -> HH:00
      let h = parseInt(digits, 10);
      if (isNaN(h) || h < 0) h = 0; if (h > 23) h = 23;
      return String(h).padStart(2, "0") + ":00";
    }
  }
  let parts = v.split(":");
  if (parts.length === 1 && v.length >= 3) {
    v = v.slice(0, 2) + ":" + v.slice(2);
    parts = v.split(":");
  }
  let h = parseInt(parts[0] || "0", 10);
  let m = parseInt(parts[1] || "0", 10);
  if (isNaN(h) || h < 0) h = 0; if (h > 23) h = 23;
  if (isNaN(m) || m < 0) m = 0; if (m > 59) m = 59;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function calcTotalPax(adt, chd, inf) {
  const a = parseInt(adt) || 0;
  const c = parseInt(chd) || 0;
  const i = parseInt(inf) || 0;
  const total = (a || 1) + c + i;
  // ensure at least 1 adt
  if (a < 1) return 1 + c + i;
  return total;
}

function generatePassengers(adt, chd, inf, existing = []) {
  const a = Math.max(1, Math.min(20, parseInt(adt) || 1));
  const c = Math.max(0, Math.min(20, parseInt(chd) || 0));
  const ii = Math.max(0, Math.min(20, parseInt(inf) || 0));
  const total = a + c + ii;
  return Array.from({ length: total }, (_, idx) => {
    const type = idx < a ? "ADT" : idx < a + c ? "CHD" : "INF";
    const prev = existing[idx];
    if (prev) return { ...prev, originalTicketNr: prev.originalTicketNr || "", emdTicketNr: prev.emdTicketNr || "", type };
    return { ...EMPTY_PAX, type };
  });
}

export default function FlightsPage() {
  const { user, userData, hasPermission, activeBranch, myBranches, branchesList, appFeatures } = useAuth();
  const isAdmin = hasPermission ? hasPermission(["Admin"]) : userData?.role === "Admin";
  const canWrite = canWriteModule(userData, "flights", isAdmin, appFeatures);
  const [flights, setFlights] = useState([]);
  const [clients, setClients] = useState([]);
  const [corporates, setCorporates] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState("list");
  const [mode, setMode] = useState("view");
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [showSupplierPicker, setShowSupplierPicker] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const ocrInputRef = useRef(null);
  const applyParsedRef = useRef(null);
  const listRef = useRef(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundTicketInput, setRefundTicketInput] = useState("");
  const [refundAirlineInput, setRefundAirlineInput] = useState("");
  const [refundCustomerInput, setRefundCustomerInput] = useState("");
  const [refundDateInput, setRefundDateInput] = useState(new Date().toISOString().slice(0, 10));

  const hydrateForm = useCallback((row) => {
    // backward compat: handle old data with only pax
    const adtVal = row.adt !== undefined ? row.adt : (row.pax !== undefined ? row.pax : 1);
    const chdVal = row.chd !== undefined ? row.chd : 0;
    const infVal = row.inf !== undefined ? row.inf : 0;
    const totalPax = (parseInt(adtVal) || 1) + (parseInt(chdVal) || 0) + (parseInt(infVal) || 0);
    const normalizedPassengers = row.passengers?.length
      ? row.passengers.map((p, idx) => {
          const raw = p.ticketNr || "";
          const type = p.type || (idx < (parseInt(adtVal) || 1) ? "ADT" : idx < (parseInt(adtVal) || 1) + (parseInt(chdVal) || 0) ? "CHD" : "INF");
          let ticketNrFormatted;
          if (raw.includes(" - ")) {
            const firstPart = raw.split(" - ")[0].trim();
            const suffix = raw.split(" - ")[1]?.trim().replace(/\D/g, "").slice(0, 3) || "";
            const d = digitsFromTicket(firstPart);
            const formattedFirst = d ? formatTicketNr(d) : firstPart;
            ticketNrFormatted = suffix ? `${formattedFirst} - ${suffix}` : formattedFirst;
            if (!raw) ticketNrFormatted = "";
          } else {
            const d = digitsFromTicket(raw);
            ticketNrFormatted = raw ? formatTicketNr(d) : "";
          }
          const rawOrig = p.originalTicketNr || "";
          let originalTicketNrFormatted = "";
          if (rawOrig) {
            if (rawOrig.includes(" - ")) {
              const firstPartOrig = rawOrig.split(" - ")[0].trim();
              const suffixOrig = rawOrig.split(" - ")[1]?.trim().replace(/\D/g, "").slice(0, 3) || "";
              const dOrig = digitsFromTicket(firstPartOrig);
              const formattedFirstOrig = dOrig ? formatTicketNr(dOrig) : firstPartOrig;
              originalTicketNrFormatted = suffixOrig ? `${formattedFirstOrig} - ${suffixOrig}` : formattedFirstOrig;
            } else {
              const dOrig = digitsFromTicket(rawOrig);
              originalTicketNrFormatted = formatTicketNr(dOrig);
            }
          }
          const rawEmd = p.emdTicketNr || p.newTicketNr || "";
          let emdTicketNrFormatted = "";
          if (rawEmd) {
            if (rawEmd.includes(" - ")) {
              const firstPartEmd = rawEmd.split(" - ")[0].trim();
              const suffixEmd = rawEmd.split(" - ")[1]?.trim().replace(/\D/g, "").slice(0, 3) || "";
              const dEmd = digitsFromTicket(firstPartEmd);
              const formattedFirstEmd = dEmd ? formatTicketNr(dEmd) : firstPartEmd;
              emdTicketNrFormatted = suffixEmd ? `${formattedFirstEmd} - ${suffixEmd}` : formattedFirstEmd;
            } else {
              const dEmd = digitsFromTicket(rawEmd);
              emdTicketNrFormatted = formatTicketNr(dEmd);
            }
          }
          return { ...p, type, ticketNr: ticketNrFormatted, originalTicketNr: originalTicketNrFormatted, emdTicketNr: emdTicketNrFormatted };
        })
      : Array.from({ length: totalPax || 1 }, (_, idx) => {
          const type = idx < (parseInt(adtVal) || 1) ? "ADT" : idx < (parseInt(adtVal) || 1) + (parseInt(chdVal) || 0) ? "CHD" : "INF";
          return { ...EMPTY_PAX, type };
        });
    // ensure passengers length matches total if mismatch (e.g., pax count changed but passengers not updated)
    let finalPassengers = normalizedPassengers;
    if (normalizedPassengers.length !== totalPax) {
      finalPassengers = generatePassengers(adtVal, chdVal, infVal, normalizedPassengers);
    }
    setForm({
      ...EMPTY_FORM,
      ...row,
      eMisc: row.eMisc || "",
      conjunction: row.conjunction || false,
      paymentMethod: row.paymentMethod || (row.isCash ? "Cash" : row.isCC ? "CC" : "Cash"),
      isCash: row.paymentMethod ? row.paymentMethod === "Cash" : row.isCash ? true : row.isCC ? false : true,
      isCC: row.paymentMethod ? row.paymentMethod === "CC" : !!row.isCC,
      adt: parseInt(adtVal) || 1,
      chd: parseInt(chdVal) || 0,
      inf: parseInt(infVal) || 0,
      pax: totalPax,
      buyCurrency: row.buyCurrency || row.currency || "EGP",
      sellCurrency: row.sellCurrency || row.currency || "EGP",
      currency: row.currency || row.buyCurrency || "EGP",
      clientCode: row.clientCode || EMPTY_FORM.clientCode,
      supplierCode: row.supplierCode || EMPTY_FORM.supplierCode,
      segments: row.segments?.length ? row.segments : [{ ...EMPTY_SEGMENT }, { ...EMPTY_SEGMENT }],
      passengers: finalPassengers,
      fareValue: row.fareValue !== undefined && row.fareValue !== "" ? formatMoneyInput(row.fareValue) : "",
      taxes: row.taxes !== undefined && row.taxes !== "" ? formatMoneyInput(row.taxes) : "",
      emdAmount: row.emdAmount !== undefined && row.emdAmount !== "" ? formatMoneyInput(row.emdAmount) : "",
      serviceFee: row.serviceFee !== undefined && row.serviceFee !== "" ? formatMoneyInput(row.serviceFee) : "",
      sellPrice: row.sellPrice !== undefined && row.sellPrice !== "" ? formatMoneyInput(row.sellPrice) : "",
      buyPrice: row.buyPrice !== undefined && row.buyPrice !== "" ? formatMoneyInput(row.buyPrice) : "",
      fareValueCHD: row.fareValueCHD !== undefined && row.fareValueCHD !== "" ? formatMoneyInput(row.fareValueCHD) : "",
      taxesCHD: row.taxesCHD !== undefined && row.taxesCHD !== "" ? formatMoneyInput(row.taxesCHD) : "",
      emdAmountCHD: row.emdAmountCHD !== undefined && row.emdAmountCHD !== "" ? formatMoneyInput(row.emdAmountCHD) : "",
      serviceFeeCHD: row.serviceFeeCHD !== undefined && row.serviceFeeCHD !== "" ? formatMoneyInput(row.serviceFeeCHD) : "",
      sellPriceCHD: row.sellPriceCHD !== undefined && row.sellPriceCHD !== "" ? formatMoneyInput(row.sellPriceCHD) : "",
      buyPriceCHD: row.buyPriceCHD !== undefined && row.buyPriceCHD !== "" ? formatMoneyInput(row.buyPriceCHD) : "",
      fareValueINF: row.fareValueINF !== undefined && row.fareValueINF !== "" ? formatMoneyInput(row.fareValueINF) : "",
      taxesINF: row.taxesINF !== undefined && row.taxesINF !== "" ? formatMoneyInput(row.taxesINF) : "",
      emdAmountINF: row.emdAmountINF !== undefined && row.emdAmountINF !== "" ? formatMoneyInput(row.emdAmountINF) : "",
      serviceFeeINF: row.serviceFeeINF !== undefined && row.serviceFeeINF !== "" ? formatMoneyInput(row.serviceFeeINF) : "",
      sellPriceINF: row.sellPriceINF !== undefined && row.sellPriceINF !== "" ? formatMoneyInput(row.sellPriceINF) : "",
      buyPriceINF: row.buyPriceINF !== undefined && row.buyPriceINF !== "" ? formatMoneyInput(row.buyPriceINF) : "",
      // Never re-fetched — whatever rate was saved on this booking stays.
      buyExchangeRate: row.buyExchangeRate || row.exchangeRate || 1,
      sellExchangeRate: row.sellExchangeRate || row.exchangeRate || 1,
      exchangeRate: row.exchangeRate || 1,
    });
  }, []);

  // Auto-fill buy-side and sell-side exchange rates INDEPENDENTLY, ONLY
  // while creating a brand new booking (mode === "add"). They are fetched
  // separately because a booking can legitimately buy in one foreign
  // currency and sell in a different one (e.g. buy USD / sell EUR) — a
  // single shared rate would silently misprice whichever side wasn't used
  // to fetch it. Once saved once, hydrateForm always reloads the rates
  // that were actually stored on the document, so they never silently
  // change later even if today's market rate moves.
  const [fetchingBuyRate, setFetchingBuyRate] = useState(false);
  const [fetchingSellRate, setFetchingSellRate] = useState(false);
  useEffect(() => {
    if (mode !== "add" || form.buyCurrency === "EGP") return;
    let cancelled = false;
    setFetchingBuyRate(true);
    fetchExchangeRateToEGP(form.buyCurrency).then((rate) => {
      if (cancelled || rate === null) return;
      setForm((f) => (f.buyCurrency === form.buyCurrency ? { ...f, buyExchangeRate: rate } : f));
    }).finally(() => !cancelled && setFetchingBuyRate(false));
    return () => { cancelled = true; };
  }, [mode, form.buyCurrency]);
  useEffect(() => {
    if (mode !== "add" || form.sellCurrency === "EGP") return;
    let cancelled = false;
    setFetchingSellRate(true);
    fetchExchangeRateToEGP(form.sellCurrency).then((rate) => {
      if (cancelled || rate === null) return;
      setForm((f) => (f.sellCurrency === form.sellCurrency ? { ...f, sellExchangeRate: rate, exchangeRate: rate } : f));
    }).finally(() => !cancelled && setFetchingSellRate(false));
    return () => { cancelled = true; };
  }, [mode, form.sellCurrency]);
  const fetchingRate = fetchingBuyRate || fetchingSellRate;

  // Only editable while the booking is still being created — permanently
  // read-only once it exists in the database.
  const rateLocked = mode === "edit";

  const closedYearKeys = useClosedFiscalYearKeys();
  const closedYearKeysToken = useMemo(() => [...closedYearKeys].sort().join(","), [closedYearKeys]);

  /* ── Load data — real-time listeners (no polling) ── */
  useEffect(() => {
    const unsubFlights = onSnapshot(
      bookingQuery("flights", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }),
      (snapshot) => {
        let data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        data = data.filter((row) => isRecordVisible(row, { isAdmin, activeBranch, myBranches, restrictOwn: !!userData?.onlyOwnData, userName: userData?.name, userUid: user?.uid }));
        data = data.filter((row) => !isRowClosed(row, closedYearKeys, "issueDate"));
        data.sort((a, b) => {
          const ta = a.createdAt?.toDate?.() || a.createdAt || 0;
          const tb = b.createdAt?.toDate?.() || b.createdAt || 0;
          return new Date(ta) - new Date(tb); // oldest first, most recent record last
        });
        setFlights(data);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        toast.error("Failed to load flights");
        setLoading(false);
      }
    );

    const unsubClients = onSnapshot(
      collection(db, "clients"),
      (snap) => setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => console.error(e)
    );

    const unsubCorporates = onSnapshot(
      collection(db, "corporates"),
      (snap) => setCorporates(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => console.error(e)
    );

    const unsubSuppliers = onSnapshot(
      collection(db, "suppliers"),
      (snap) => setSuppliers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => console.error(e)
    );

    return () => {
      unsubFlights();
      unsubClients();
      unsubCorporates();
      unsubSuppliers();
    };
  }, [isAdmin, activeBranch, JSON.stringify(myBranches), closedYearKeysToken]);

  // Auto-select first flight on initial load only — never overwrite a New/Add form
  useEffect(() => {
    if (mode !== "view") return;
    if (flights.length > 0 && !selected) {
      setSelected(flights[0]);
      setCurrentIndex(0);
      hydrateForm(flights[0]);
    }
  }, [flights, selected, hydrateForm, mode]);

  // Open specific booking from ?open= id (from Invoices → Edit Booking)
  useEffect(() => {
    const openId = searchParams?.get("open");
    if (!openId || flights.length === 0) return;
    const found = flights.find((f) => f.id === openId);
    if (found) {
      const idx = flights.findIndex((f) => f.id === openId);
      setSelected(found);
      setCurrentIndex(idx >=0 ? idx : 0);
      hydrateForm(found);
      setActiveTab("details");
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [flights, searchParams, hydrateForm]);

  /* ── Navigation ── */
  const filtered = flights.filter((f) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (f.invoiceNumber || "").toLowerCase().includes(s) ||
      (f.clientCode || "").toLowerCase().includes(s) ||
      (f.clientName || "").toLowerCase().includes(s) ||
      (f.supplierSymbol || "").toLowerCase().includes(s) ||
      (f.supplierCode || "").toLowerCase().includes(s) ||
      (f.supplierName || "").toLowerCase().includes(s) ||
      (f.passengers || []).some((p) => (p.ticketNr || "").toLowerCase().includes(s) || (p.name || "").toLowerCase().includes(s))
    );
  });

  const selectRow = (row, index) => {
    setSelected(row);
    setCurrentIndex(index);
    setMode("view");
    hydrateForm(row);
    setActiveTab("list");
  };

  const openDetails = (row, index) => {
    selectRow(row, index);
    setActiveTab("details");
    setMode("view");
  };

  const goFirst = () => filtered.length && selectRow(filtered[0], 0);
  const goLast = () => filtered.length && selectRow(filtered[filtered.length - 1], filtered.length - 1);
  const goPrev = () => currentIndex > 0 && selectRow(filtered[currentIndex - 1], currentIndex - 1);
  const goNext = () => currentIndex < filtered.length - 1 && selectRow(filtered[currentIndex + 1], currentIndex + 1);

  const handleListKeyDown = (e) => {
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); goNext(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); goPrev(); }
    else if (e.key === "Tab") { e.preventDefault(); if (e.shiftKey) goPrev(); else goNext(); }
    else if (e.key === "Home") { e.preventDefault(); goFirst(); }
    else if (e.key === "End") { e.preventDefault(); goLast(); }
    else if (e.key === "Enter") {
      if (selected && currentIndex >= 0) { setActiveTab("details"); }
    }
  };

  useEffect(() => {
    if (activeTab === "list" && mode === "view" && listRef.current) {
      listRef.current.focus();
    }
  }, [activeTab, mode]);

  // Auto-scroll to the bottom (newest record) once the list has loaded, or
  // whenever we come back to the list tab — not on every keystroke of a
  // search, so it doesn't yank the view away while filtering.
  useLayoutEffect(() => {
    if (!loading && activeTab === "list" && listRef.current) {
      // Set synchronously before the browser paints — lands already at the
      // bottom with no visible scroll motion.
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [loading, activeTab]);

  // Keep keyboard highlight visible: scroll selected row into view when currentIndex changes
  useEffect(() => {
    if (currentIndex < 0) return;
    // wait for DOM update
    requestAnimationFrame(() => {
      const el = document.querySelector(`tr[data-index="${currentIndex}"]`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [currentIndex]);

  // Auto calc Buy Price = F.Value + Taxes + EMD Amount (EMD A — associated, penalty-style),
  // or Buy Price = EMD Amount only (EMD S — standalone, additional-service purchase, not tied to a fare/tax).
  const isEMD = form.eMisc === "EMD A" || form.eMisc === "EMD S";
  const isEMDStandalone = form.eMisc === "EMD S";
  useEffect(() => {
    if (mode !== "add" && mode !== "edit") return;
    const updates = {};
    const processFinancial = (fareKey, taxesKey, emdKey, buyKey) => {
      const fare = parseFloat(String(form[fareKey]).replace(/,/g, "")) || 0;
      const taxes = parseFloat(String(form[taxesKey]).replace(/,/g, "")) || 0;
      const emd = isEMD ? (parseFloat(String(form[emdKey]).replace(/,/g, "")) || 0) : 0;
      const hasFareOrTaxOrEmd = isEMDStandalone
        ? form[emdKey] !== ""
        : (form[fareKey] !== "" || form[taxesKey] !== "" || (isEMD && form[emdKey] !== ""));
      const computedBuy = isEMDStandalone ? emd.toFixed(2) : (fare + taxes + emd).toFixed(2);
      const currentBuyNorm = parseFloat(String(form[buyKey]).replace(/,/g, "")) ? parseFloat(String(form[buyKey]).replace(/,/g, "")).toFixed(2) : "";
      if (computedBuy !== currentBuyNorm && hasFareOrTaxOrEmd) {
        const formattedBuy = formatMoneyInput(computedBuy);
        if (formattedBuy !== form[buyKey]) {
          updates[buyKey] = formattedBuy;
        }
      }
    };
    processFinancial("fareValue", "taxes", "emdAmount", "buyPrice");
    if (form.chd > 0) processFinancial("fareValueCHD", "taxesCHD", "emdAmountCHD", "buyPriceCHD");
    if (form.inf > 0) processFinancial("fareValueINF", "taxesINF", "emdAmountINF", "buyPriceINF");
    if (Object.keys(updates).length) setForm((prev) => ({ ...prev, ...updates }));
  }, [form.fareValue, form.taxes, form.emdAmount, form.fareValueCHD, form.taxesCHD, form.emdAmountCHD, form.fareValueINF, form.taxesINF, form.emdAmountINF, form.chd, form.inf, form.eMisc, mode]);


  /* ── Apply parsed ticket/EMD/exchange data into New form ── */
  const applyParsedTicket = (parsed) => {
    const salesmanCode = userData?.name?.split(" ").map((w) => w[0]).join("").toUpperCase() || "";

    let passengers = (parsed.passengers || []).map((p) => ({
      // Fall back to header TKT if passenger-level ticket is empty (common on CHD)
      ticketNr: p.ticketNr || parsed.ticketNr || "",
      pnr: p.pnr || parsed.pnr || "",
      name: p.name || "",
      type: p.type || "ADT",
      originalTicketNr: p.originalTicketNr || parsed.originalTicketNr || "",
      emdTicketNr: p.emdTicketNr || parsed.emdNumber || "",
    }));
    if (passengers.length === 0) {
      passengers = [{
        ticketNr: parsed.ticketNr || "",
        pnr: parsed.pnr || "",
        name: "",
        type: "ADT",
        originalTicketNr: parsed.originalTicketNr || "",
        emdTicketNr: parsed.emdNumber || "",
      }];
    }
    // Normalize ticket format: 072483048371 → 072-483048371
    passengers = passengers.map((p) => {
      const digits = (p.ticketNr || "").replace(/\D/g, "");
      if (digits.length >= 10) {
        return { ...p, ticketNr: digits.slice(0, 3) + "-" + digits.slice(3, 13) };
      }
      return p;
    });
    // Always sort passengers by ticket number (ascending)
    passengers = [...passengers].sort((a, b) => {
      const da = (a.ticketNr || "").replace(/\D/g, "");
      const db = (b.ticketNr || "").replace(/\D/g, "");
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db, undefined, { numeric: true });
    });

    let segments = (parsed.segments || []).map((s) => ({
      city: s.city || "",
      toCity: s.toCity || "",
      carrier: s.carrier || "",
      flight: s.flight || "",
      class: s.class || "Y",
      date: s.date || "",
      depTime: s.depTime || "",
      arrTime: s.arrTime || "",
      status: s.status || "",
      fareBasis: s.fareBasis || "",
    }));
    while (segments.length < 2) segments.push({ ...EMPTY_SEGMENT });

    let gds = parsed.gds || "";
    const ticketDigits = (parsed.ticketNr || parsed.emdNumber || "").replace(/\D/g, "");
    if (ticketDigits.length >= 3 && AIRLINE_CODES[ticketDigits.slice(0, 3)]) {
      const carrier = AIRLINE_CODES[ticketDigits.slice(0, 3)].carrier;
      segments = segments.map((s) => ({ ...s, carrier: s.carrier || carrier }));
    }

    const is1A = parsed.gds === "1A" || parsed.formType === "amadeus_1a" || parsed.formType === "amadeus_emd";
    const isEMD = parsed.formType === "amadeus_emd" || parsed.isEMD;
    if (is1A) gds = "1A";

    // An EMD is always an ADD-ON to a booking, never a booking of its own:
    // it carries no itinerary and no fare/tax of its own, so scanning one
    // must never rewrite what's already on the form. Before this check, an
    // EMD scanned while the form already held a ticket fell through to the
    // "fresh form — full replace" branch below, which wiped the segments
    // back to two blank rows and blanked Fare Value / Taxes / Sell / Buy.
    // (The old guard only caught this in `edit` mode, so the common flow —
    // scan the ticket, then scan its EMD, both in `add` mode — lost
    // everything.) If there's anything real on the form, an EMD now only
    // ever fills its own fields: eMisc, EMD amount, EMD number per pax.
    const formHasBookingData =
      (form.passengers || []).some(
        (p) => (p.ticketNr || "").trim() || (p.name || "").trim() || (p.originalTicketNr || "").trim()
      ) ||
      (form.segments || []).some((sg) => sg.city || sg.toCity || sg.flight || sg.date) ||
      !!form.fareValue || !!form.taxes || !!form.buyPrice || !!form.sellPrice ||
      !!form.fareValueCHD || !!form.taxesCHD || !!form.fareValueINF || !!form.taxesINF ||
      (form.clientCode && form.clientCode !== EMPTY_FORM.clientCode);
    const isEMDOverlay = isEMD && formHasBookingData;

    // Only merge when we are already editing an existing booking.
    // Previously this checked leftover form fields, which caused OCR on a "New" ticket
    // to keep old passenger / fare / client data from the previous ticket.
    const hasExistingExchangeData =
      mode === "edit" &&
      (form.passengers?.some((p) => p.originalTicketNr || p.ticketNr || p.name) ||
        form.fareValue ||
        form.taxes ||
        form.buyPrice ||
        (form.clientCode && form.clientCode !== EMPTY_FORM.clientCode));

    // Resolve airline supplier from TICKET NUMBER first 3 digits (not segment symbol)
    // e.g. 057 → AF (Air France), 077 → MS (EgyptAir)
    let supplierCode = EMPTY_FORM.supplierCode;
    let supplierName = "";
    let supplierSymbol = "";
    const tktDigits = (
      (parsed.ticketNr || "") +
      (passengers[0]?.ticketNr || "") +
      (parsed.emdNumber || "")
    ).replace(/\D/g, "");
    const airlineCode3 = tktDigits.length >= 3 ? tktDigits.slice(0, 3) : (ticketDigits || "").slice(0, 3);
    let carrier = "";
    if (airlineCode3 && AIRLINE_CODES[airlineCode3]) {
      carrier = AIRLINE_CODES[airlineCode3].carrier;
    }
    if (carrier) {
      // Match supplier by airline accounting code stored on supplier, or by symbol = carrier
      const found =
        suppliers.find((s) => String(s.airlineCode || s.ticketPrefix || "").padStart(3, "0") === airlineCode3) ||
        suppliers.find((s) => (s.symbol || "").toUpperCase() === carrier) ||
        suppliers.find((s) => (s.name || "").toUpperCase().includes((AIRLINE_CODES[airlineCode3]?.name || "").toUpperCase().split(" ")[0])) ||
        null;
      if (found) {
        supplierCode = found.code || supplierCode;
        supplierName = found.name || "";
        supplierSymbol = (found.symbol || carrier).toUpperCase();
      } else {
        supplierSymbol = carrier;
      }
      // Fill empty segment carriers from ticket airline only if empty
      segments = segments.map((s) => ({ ...s, carrier: s.carrier || carrier }));
    }

    // Detect if form already has real passenger data (used for appending extra pax while adding)
    const formAlreadyHasPax = (form.passengers || []).some(
      (p) => (p.ticketNr && p.ticketNr.trim()) || (p.name && p.name.trim()) || (p.originalTicketNr && p.originalTicketNr.trim())
    );

    // Append mode: user is adding a new booking and already scanned at least one ticket → add more passengers
    const shouldAppendPax = mode === "add" && formAlreadyHasPax && !isEMD;

    // When merging into an existing booking keep edit mode + selected.
    // When creating a fresh ticket force "add" mode and clear selection.
    if (!hasExistingExchangeData && !shouldAppendPax && !isEMDOverlay) {
      setMode("add");
      setSelected(null);
    }

    let toastMessage = "";

    if (isEMDOverlay) {
      // EMD overlay. Deliberately spreads `prev` and touches nothing else:
      // segments, fareValue/taxes (ADT, CHD and INF), sell/buy prices, pax
      // counts, trip type, client and supplier all stay exactly as they
      // were. Buy Price still recalculates on its own for EMD A via the
      // auto-calc effect above (Fare + Taxes + EMD), which is the intended
      // behaviour — the fare and taxes it reads are untouched.
      setForm((prev) => ({
        ...prev,
        eMisc: parsed.eMisc || prev.eMisc || "EMD A",
        emdAmount: parsed.emdAmount || prev.emdAmount,
        gds: prev.gds || parsed.gds || "",
        // Don't relabel a plain ticket as an exchange just because an EMD
        // was attached to it — only fill the ticket type when it's empty.
        ticketType: prev.ticketType || parsed.ticketType || "T - Ticket",
        remarks: prev.remarks || parsed.remarks || "",
        // Keep existing passengers; only stamp the EMD number onto them.
        // Falls back to the document-level EMD number so a single-pax EMD
        // still lands when the parser gave no per-passenger rows.
        passengers: (prev.passengers || []).map((p, idx) => ({
          ...p,
          emdTicketNr:
            parsed.passengers?.[idx]?.emdTicketNr ||
            (idx === 0 ? parsed.emdNumber || "" : "") ||
            p.emdTicketNr,
        })),
      }));
      toastMessage = "EMD attached — itinerary, fare value and taxes left unchanged.";
    } else if (hasExistingExchangeData) {
      {
        // Merge regular ticket/exchange into existing booking (never an EMD —
        // those are handled by the overlay branch above)
        setForm((prev) => ({
          ...prev,
          supplierCode: parsed.supplierCode || prev.supplierCode,
          supplierName: parsed.supplierName || prev.supplierName,
          supplierSymbol: parsed.supplierSymbol || prev.supplierSymbol,
          gds: segments.length ? (parsed.gds || prev.gds) : prev.gds,
          passengers: (prev.passengers || []).map((p, idx) => ({
            ...p,
            ticketNr: parsed.passengers?.[idx]?.ticketNr !== undefined ? parsed.passengers[idx].ticketNr : p.ticketNr,
            pnr: parsed.passengers?.[idx]?.pnr !== undefined ? parsed.passengers[idx].pnr : p.pnr,
            name: parsed.passengers?.[idx]?.name !== undefined ? parsed.passengers[idx].name : p.name,
          })),
          remarks: parsed.remarks || prev.remarks,
        }));
        toastMessage = "Ticket data merged into existing booking.";
      }
    } else if (shouldAppendPax) {
      // Already have passengers from a previous OCR while adding → append new passenger(s)
      setForm((prev) => {
        const existing = prev.passengers || [];
        const newPax = passengers.map((p) => ({
          ...EMPTY_PAX,
          ticketNr: p.ticketNr || "",
          pnr: p.pnr || "",
          name: p.name || "",
          type: p.type || "ADT",
          originalTicketNr: p.originalTicketNr || "",
          emdTicketNr: p.emdTicketNr || "",
        }));
        // Sort by ticket number (ascending numeric)
        const combined = [...existing, ...newPax].sort((a, b) => {
          const da = (a.ticketNr || "").replace(/\D/g, "");
          const db = (b.ticketNr || "").replace(/\D/g, "");
          if (!da && !db) return 0;
          if (!da) return 1;
          if (!db) return -1;
          return da.localeCompare(db, undefined, { numeric: true });
        });
        const adtCount = combined.filter((p) => (p.type || "ADT") === "ADT").length;
        const chdCount = combined.filter((p) => p.type === "CHD").length;
        const infCount = combined.filter((p) => p.type === "INF").length;

        // Fill CHD/INF accounting fields from this OCR if new pax are children/infants
        const fare = parsed._equiv || parsed.fareValue || "";
        const tax = parsed.taxes || "";
        const newAreAllCHD = newPax.length > 0 && newPax.every((p) => p.type === "CHD");
        const newAreAllINF = newPax.length > 0 && newPax.every((p) => p.type === "INF");
        const finUpdates = {};
        if (newAreAllCHD && fare) {
          finUpdates.fareValueCHD = prev.fareValueCHD || fare;
          finUpdates.taxesCHD = prev.taxesCHD || tax;
        } else if (newAreAllINF && fare) {
          finUpdates.fareValueINF = prev.fareValueINF || fare;
          finUpdates.taxesINF = prev.taxesINF || tax;
        } else if (fare && !prev.fareValue) {
          // New ADT pax and main fare still empty
          finUpdates.fareValue = fare;
          finUpdates.taxes = tax;
        }

        return {
          ...prev,
          ...finUpdates,
          passengers: combined,
          adt: adtCount,
          chd: chdCount,
          inf: infCount,
          pax: combined.length,
          // Keep existing segments / financials; only fill missing supplier if empty
          supplierCode: prev.supplierCode && prev.supplierCode !== EMPTY_FORM.supplierCode ? prev.supplierCode : supplierCode,
          supplierName: prev.supplierName || supplierName,
          supplierSymbol: prev.supplierSymbol || supplierSymbol,
          gds: prev.gds || gds,
        };
      });
      toastMessage = `Added ${passengers.length} passenger(s) — sorted by ticket number. Review & save.`;
    } else {
      // Fresh form — full replace
      setForm({
        ...EMPTY_FORM,
        salesman: salesmanCode,
        salesmanName: userData?.name || "",
        issueDate: parsed.issueDate || EMPTY_FORM.issueDate,
        gds,
        ticketType: parsed.ticketType || "T - Ticket",
        eMisc: parsed.isEMD || parsed.formType === "amadeus_emd"
          ? (parsed.eMisc || "EMD A")
          : (parsed.eMisc || ""),
        clientCode: EMPTY_FORM.clientCode,
        supplierCode,
        supplierName,
        supplierSymbol,
        currency: isEMD ? "EGP" : (parsed.currency || "EGP"),
        buyCurrency: isEMD ? "EGP" : (parsed.currency || "EGP"),
        sellCurrency: isEMD ? "EGP" : (parsed.currency || "EGP"),
        // Place fare/tax into ADT or CHD/INF fields according to passenger type
        ...(() => {
          if (isEMD) {
            return { fareValue: "", taxes: "", sellPrice: "", buyPrice: "", emdAmount: parsed.emdAmount || "" };
          }
          const fare = parsed._equiv || parsed.fareValue || "";
          const tax = parsed.taxes || "";
          const allCHD = passengers.length > 0 && passengers.every((p) => p.type === "CHD");
          const allINF = passengers.length > 0 && passengers.every((p) => p.type === "INF");
          if (allCHD) {
            return {
              fareValue: "", taxes: "", sellPrice: "", buyPrice: "",
              fareValueCHD: fare, taxesCHD: tax, sellPriceCHD: "", buyPriceCHD: "",
              emdAmount: parsed.emdAmount || "",
            };
          }
          if (allINF) {
            return {
              fareValue: "", taxes: "", sellPrice: "", buyPrice: "",
              fareValueINF: fare, taxesINF: tax, sellPriceINF: "", buyPriceINF: "",
              emdAmount: parsed.emdAmount || "",
            };
          }
          // Mixed or ADT — keep on main (ADT) fields
          let buyPrice = "";
          if (parsed.buyPrice) buyPrice = String(parsed.buyPrice);
          else if (parsed.additionalCollection) buyPrice = String(parsed.additionalCollection);
          else if ((parsed.ticketType || "").includes("Exchanging")) {
            const f = parseFloat(parsed._equiv || parsed.fareValue) || 0;
            const t = parseFloat(parsed.taxes) || 0;
            const b = f - t;
            if (b) buyPrice = b.toFixed(2);
          }
          return {
            fareValue: fare,
            taxes: tax,
            sellPrice: "",
            buyPrice,
            emdAmount: parsed.emdAmount || "",
          };
        })(),
        remarks: parsed.remarks || parsed.description || "",
        // Count pax types from OCR (CHD/INF/ADT) instead of assuming all ADT
        adt: (() => {
          const n = passengers.filter((p) => (p.type || "ADT") === "ADT").length;
          return passengers.length === 0 ? 1 : n;
        })(),
        chd: passengers.filter((p) => p.type === "CHD").length,
        inf: passengers.filter((p) => p.type === "INF").length,
        pax: Math.max(1, passengers.length),
        tripType: segments.length > 2 ? "multiCity" : segments.length === 2 ? "roundTrip" : "oneWay",
        segments: segments.length ? segments : [{ ...EMPTY_SEGMENT }, { ...EMPTY_SEGMENT }],
        passengers,
        paymentMethod: parsed.paymentMethod || "Cash",
        isCash: (parsed.paymentMethod || "Cash") === "Cash",
        isCC: parsed.paymentMethod === "CC",
      });
    }

    setActiveTab("details");

    const formLabel = isEMD ? "EMD" : parsed.ticketType === "E - Exchanging" ? "Exchange" : is1A ? "Amadeus 1A" : "ticket";
    const filled = [
      is1A && "GDS:1A",
      isEMD && (parsed.eMisc || "EMD A"),
      parsed.ticketType === "E - Exchanging" && "Exchange",
      (parsed.emdNumber || parsed.ticketNr) && (isEMD ? "EMD Nr" : "Ticket Nr"),
      parsed.originalTicketNr && (isEMD ? "ICW" : "Original TKT"),
      parsed.pnr && "PNR",
      supplierName && `Supplier:${supplierSymbol || supplierName}`,
      passengers.some((p) => p.name) && "Passenger",
      segments.some((s) => s.city || s.flight) && `Flights(${segments.length})`,
      parsed.emdAmount && "EMD Amount",
    ].filter(Boolean);

    if (toastMessage) {
      toast.success(toastMessage, { duration: 5000 });
    } else {
      toast.success(
        filled.length
          ? `Loaded ${formLabel} — ${filled.join(", ")}. Review & save.`
          : "Little data detected — please fill manually.",
        { duration: 5000 }
      );
    }
  };


  // keep latest apply function for paste listener
  applyParsedRef.current = applyParsedTicket;

  /* ── Paste ticket text from clipboard (Amadeus mask) ── */
  const handlePasteTicket = async () => {
    try {
      let text = "";
      try {
        if (navigator.clipboard?.readText) {
          text = await navigator.clipboard.readText();
        }
      } catch (_) {
        /* permission denied — fall through to prompt */
      }
      if (!text || text.trim().length < 15) {
        const pasted = window.prompt("Paste Amadeus ticket / exchange / EMD text here:");
        if (!pasted || pasted.trim().length < 15) {
          toast.error("No ticket text to parse");
          return;
        }
        text = pasted;
      }

      const parsed = parseTicketText(text);
      if (!parsed.ticketNr && !parsed.emdNumber && !parsed.pnr && !(parsed.segments || []).length) {
        toast.error("Could not recognize ticket format. Copy the full Amadeus mask and try again.");
        return;
      }
      applyParsedTicket(parsed);
    } catch (err) {
      console.error(err);
      toast.error("Paste failed: " + (err.message || "Unknown error"));
    }
  };

  /* ── OCR: Scan ticket image and fill form ── */
  const handleOcrFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const okTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg", "image/bmp"];
    if (!okTypes.includes(file.type) && !file.name.match(/\.(jpe?g|png|webp|bmp)$/i)) {
      toast.error("Please upload an image (JPG / PNG / WEBP)");
      return;
    }

    setOcrLoading(true);
    setOcrProgress(0);
    const toastId = toast.loading("Reading ticket... 0%");

    try {
      const text = await runOcrOnImage(file, (p) => {
        setOcrProgress(p);
        toast.loading(`Reading ticket... ${p}%`, { id: toastId });
      });

      // TEMP DEBUG — remove once segment parsing is confirmed fixed.
      console.log("[OCR RAW TEXT]\n" + text);

      if (!text || text.trim().length < 10) {
        toast.error("Could not read text from image. Try Paste Ticket with the text mask.", { id: toastId });
        return;
      }

      const parsed = parseTicketText(text);
      console.log("[OCR PARSED]", parsed);
      if (!parsed.ticketNr && !parsed.emdNumber && !parsed.pnr && !(parsed.segments || []).length) {
        toast.error("Could not recognize ticket data from image. Try Paste Ticket.", { id: toastId });
        return;
      }
      toast.dismiss(toastId);
      applyParsedTicket(parsed);
    } catch (err) {
      console.error(err);
      toast.error("OCR failed: " + (err.message || "Unknown error"), { id: toastId });
    } finally {
      setOcrLoading(false);
      setOcrProgress(0);
    }
  };




  /* ── Ctrl+V / Cmd+V → text mask OR ticket image from clipboard ── */
  useEffect(() => {
    const looksLikeAmadeus = (text) => {
      const u = (text || "").toUpperCase();
      if (!u || u.trim().length < 15) return false;
      return (
        /TKT[-\s]?\d{10,}/.test(u) ||
        /EMD[-\s]?\d{10,}/.test(u) ||
        /LOC[-\s]?[A-Z0-9]{5,7}/.test(u) ||
        /OD-[A-Z]{6}/.test(u) ||
        /FO\s+\d{3}/.test(u) ||
        /SYS-1A/.test(u) ||
        (/\b1A\b/.test(u) && /\d+\s+[OX]?[A-Z]{3}\s+[A-Z]{2}/.test(u))
      );
    };

    const applyText = (text) => {
      const parsed = parseTicketText(text);
      if (!parsed.ticketNr && !parsed.emdNumber && !parsed.pnr && !(parsed.segments || []).length) {
        toast.error("Could not recognize ticket format");
        return false;
      }
      if (applyParsedRef.current) applyParsedRef.current(parsed);
      else toast.error("Parser not ready — refresh the page");
      return true;
    };

    const applyImage = async (fileOrBlob) => {
      setOcrLoading(true);
      setOcrProgress(0);
      const toastId = toast.loading("Reading ticket image... 0%");
      try {
        const text = await runOcrOnImage(fileOrBlob, (p) => {
          setOcrProgress(p);
          toast.loading(`Reading ticket image... ${p}%`, { id: toastId });
        });
        // TEMP DEBUG — remove once segment parsing is confirmed fixed.
        console.log("[OCR RAW TEXT]\n" + text);
        if (!text || text.trim().length < 10) {
          toast.error("Could not read text from image. Try a clearer screenshot.", { id: toastId });
          return;
        }
        const parsed = parseTicketText(text);
        console.log("[OCR PARSED]", parsed);
        if (!parsed.ticketNr && !parsed.emdNumber && !parsed.pnr && !(parsed.segments || []).length) {
          toast.error("Image read, but ticket format not recognized.", { id: toastId });
          console.log("OCR text:", text);
          return;
        }
        toast.dismiss(toastId);
        if (applyParsedRef.current) applyParsedRef.current(parsed);
      } catch (err) {
        console.error(err);
        toast.error("OCR failed: " + (err.message || ""), { id: toastId });
      } finally {
        setOcrLoading(false);
        setOcrProgress(0);
      }
    };

    const onPaste = (e) => {
      const items = e.clipboardData?.items;
      // 1) Prefer image from clipboard (screenshot paste)
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type && item.type.startsWith("image/")) {
            e.preventDefault();
            e.stopPropagation();
            const blob = item.getAsFile();
            if (blob) applyImage(blob);
            return;
          }
        }
      }
      // 2) Text Amadeus mask
      const text =
        e.clipboardData?.getData("text/plain") ||
        e.clipboardData?.getData("text") ||
        "";
      if (text && looksLikeAmadeus(text)) {
        e.preventDefault();
        e.stopPropagation();
        try {
          applyText(text);
        } catch (err) {
          console.error(err);
          toast.error("Failed to parse ticket text");
        }
      }
    };

    document.addEventListener("paste", onPaste, true);
    return () => document.removeEventListener("paste", onPaste, true);
  }, []);

  /* ── CRUD ── */

  const startAdd = async () => {
    const salesmanCode = userData?.name?.split(" ").map((w) => w[0]).join("").toUpperCase() || "";
    const defaultBranch = activeBranch && activeBranch !== "ALL" ? activeBranch : (myBranches[0] || branchesList[0]?.code || "1");
    setMode("add");
    setForm({
      ...EMPTY_FORM,
      branch: defaultBranch,
      salesman: salesmanCode,
      salesmanName: userData?.name || "",
      segments: [{ ...EMPTY_SEGMENT }, { ...EMPTY_SEGMENT }],
      passengers: [{ ...EMPTY_PAX }],
    });
    setSelected(null);
    setActiveTab("details");
    // Show a PREVIEW of the next Reg Nr immediately, without reserving it —
    // the real number is only assigned (and the sequence advanced) when the
    // booking is actually saved, so cancelling never leaves a gap.
    try {
      const regNr = await peekNextRegNumber("flights", "F", defaultBranch);
      setForm((prev) => (prev.regNr ? prev : { ...prev, regNr }));
    } catch {}
  };

  // Refresh the Reg Nr preview when the branch changes while adding, since
  // Reg Nr sequences are scoped per branch (still just a preview — nothing
  // is reserved until save).
  const handleAddBranchChange = async (newBranch) => {
    setForm((prev) => ({ ...prev, branch: newBranch, regNr: "" }));
    try {
      const regNr = await peekNextRegNumber("flights", "F", newBranch);
      setForm((prev) => (prev.branch === newBranch ? { ...prev, regNr } : prev));
    } catch {}
  };

  const startEdit = () => {
    if (!selected) return;
    if (selected.invoiceIssued) {
      if (selected.editUnlocked) {
        toast.success("Booking unlocked by admin — you can edit now");
      } else if (!isAdmin) {
        toast.error("Locked — admin must open invoice to unlock for editing");
        return;
      } else {
        if (!confirm(`Invoice ${selected.invoiceNumber} already issued — open for editing anyway?`)) return;
      }
    }
    setMode("edit");
    hydrateForm(selected);
    setActiveTab("details");
  };

  const cancelEdit = () => {
    setMode("view");
    if (selected) hydrateForm(selected);
    else setForm(EMPTY_FORM);
    setActiveTab("list");
  };

  /* ── Trip type → segments ── */
  const handleTripType = (type) => {
    let count = 2;
    if (type === "roundTrip") count = 3;
    if (type === "multiCity") count = 4;
    const segs = Array.from({ length: count }, (_, i) => form.segments[i] || { ...EMPTY_SEGMENT });
    if (type === "roundTrip" && segs.length > 1 && segs[0]?.city) {
      segs[segs.length - 1] = { ...segs[segs.length - 1], city: segs[0].city };
    }
    setForm({ ...form, tripType: type, segments: segs });
  };

  /* ── Pax count → passengers table (ADT/CHD/INF split) ── */
  const syncPassengersForPax = (adt, chd, inf, prevPassengers) => {
    const total = adt + chd + inf;
    const rawFirst = firstTicketPart(prevPassengers[0]?.ticketNr || "");
    const baseDigits = digitsFromTicket(rawFirst);
    const isBaseComplete = baseDigits.length === 13;
    const isConj = !!form.conjunction;
    return Array.from({ length: total }, (_, i) => {
      const type = i < adt ? "ADT" : i < adt + chd ? "CHD" : "INF";
      if (prevPassengers[i]) return { ...prevPassengers[i], type };
      if (isBaseComplete) {
        if (isConj) {
          const conj = buildConjunctionTicket(baseDigits, i);
          if (conj) return { ...EMPTY_PAX, type, ticketNr: conj };
        } else if (i > 0) {
          try {
            const baseNum = BigInt(baseDigits);
            const nextNum = (baseNum + BigInt(i)).toString().padStart(13, "0").slice(-13);
            return { ...EMPTY_PAX, type, ticketNr: formatTicketNr(nextNum) };
          } catch {
            return { ...EMPTY_PAX, type };
          }
        }
      }
      return { ...EMPTY_PAX, type };
    });
  };

  const handleAdtChange = (val) => {
    const n = Math.max(1, Math.min(20, parseInt(val) || 1));
    const chd = parseInt(form.chd) || 0;
    const inf = parseInt(form.inf) || 0;
    const paxList = syncPassengersForPax(n, chd, inf, form.passengers);
    setForm({ ...form, adt: n, pax: n + chd + inf, passengers: paxList });
  };
  const handleChdChange = (val) => {
    const n = Math.max(0, Math.min(20, parseInt(val) || 0));
    const adt = parseInt(form.adt) || 1;
    const inf = parseInt(form.inf) || 0;
    const paxList = syncPassengersForPax(adt, n, inf, form.passengers);
    setForm({ ...form, chd: n, pax: adt + n + inf, passengers: paxList });
  };
  const handleInfChange = (val) => {
    const n = Math.max(0, Math.min(20, parseInt(val) || 0));
    const adt = parseInt(form.adt) || 1;
    const chd = parseInt(form.chd) || 0;
    const paxList = syncPassengersForPax(adt, chd, n, form.passengers);
    setForm({ ...form, inf: n, pax: adt + chd + n, passengers: paxList });
  };

  const handlePaxChange = (val) => {
    // backward compat: treat as ADT change
    handleAdtChange(val);
  };

  /* ── Client code lookup ── */
  const handleClientCode = (code) => {
    setForm((prev) => {
      const next = { ...prev, clientCode: code };
      const found = clients.find((c) => c.code === code) || corporates.find((c) => c.code === code);
      if (found) next.clientName = found.name || "";
      return next;
    });
  };

  const handleSupplierCode = (code) => {
    setForm((prev) => {
      const next = { ...prev, supplierCode: code };
      const found = suppliers.find((s) => s.code === code);
      if (found) {
        next.supplierName = found.name || "";
        const symbol = (found.symbol || "").toUpperCase();
        next.supplierSymbol = symbol;
        if (symbol) {
          next.segments = (prev.segments || []).map((seg) => ({ ...seg, carrier: symbol }));
        }
      } else {
        next.supplierSymbol = "";
      }
      return next;
    });
  };

  const handleCodeFocus = (e, type) => {
    try { e.target.setSelectionRange(0, 2); } catch {}
    try { e.target.dataset.segment = "0"; } catch {}
    // Ensure selection after focus settles (some browsers reset)
    requestAnimationFrame(() => {
      try { e.target.setSelectionRange(0, 2); } catch {}
    });
  };

  const handleCodeSegmentKeyDown = (e, type) => {
    const ranges = CODE_SEG_RANGES;
    const pos = e.target.selectionStart ?? 0;
    let current = getSegmentIndexByPos(pos);
    // Prefer dataset if selection is collapsed and dataset is coherent
    // But primary is position-based as per spec
    if (e.key === "Tab" && e.shiftKey) {
      if (current > 0) {
        e.preventDefault();
        const prev = current - 1;
        const [s, ee] = ranges[prev];
        try { e.target.setSelectionRange(s, ee); } catch {}
        try { e.target.dataset.segment = String(prev); } catch {}
        requestAnimationFrame(() => { try { e.target.setSelectionRange(s, ee); } catch {} });
      } else {
        // at first segment, allow default Shift+Tab to previous field
        try { e.target.dataset.segment = String(current); } catch {}
      }
      return;
    }
    if (e.key === "Tab" && !e.shiftKey) {
      if (current < 3) {
        e.preventDefault();
        const next = current + 1;
        const [s, ee] = ranges[next];
        try { e.target.setSelectionRange(s, ee); } catch {}
        try { e.target.dataset.segment = String(next); } catch {}
        requestAnimationFrame(() => { try { e.target.setSelectionRange(s, ee); } catch {} });
      } else {
        // last segment: allow default Tab to move to next field (clientName/supplierName)
        try { e.target.dataset.segment = String(current); } catch {}
      }
      return;
    }
    if (e.key === ".") {
      e.preventDefault();
      if (current < 3) {
        const next = current + 1;
        const [s, ee] = ranges[next];
        try { e.target.setSelectionRange(s, ee); } catch {}
        try { e.target.dataset.segment = String(next); } catch {}
        requestAnimationFrame(() => { try { e.target.setSelectionRange(s, ee); } catch {} });
      }
      return;
    }
  };

  const handleCodeBlur = (value, type) => {
    // Support both (value,type) and legacy (type,index,value) – normalize
    let code, t;
    if (value === "client" || value === "supplier") {
      // legacy call handleCodeBlur("client", index, value) – detect
      // In that case type param is index, and third arg is value – not used now, fallback to form value
      t = value;
      code = type; // actually second arg is index or code? fallback to current form
      if (typeof code === "number") {
        // legacy segmented case – ignore, already handled by new path not called
        return;
      }
      // If called as handleCodeBlur("client", "30.00.00.0000") fallback
    } else {
      code = value;
      t = type;
      if (t !== "client" && t !== "supplier") {
        // swapped
        if (code === "client" || code === "supplier") {
          t = code;
          code = type;
        }
      }
    }
    if (t !== "client" && t !== "supplier") return;
    const formatted = formatCodeForBlur(code, t);
    if (t === "client") handleClientCode(formatted);
    else handleSupplierCode(formatted);
  };

  const pickClient = (c) => {
    setForm({ ...form, clientCode: c.code || "", clientName: c.name || "" });
    setShowClientPicker(false);
    setClientSearch("");
  };

  const pickSupplier = (s) => {
    const symbol = (s.symbol || "").toUpperCase();
    setForm((prev) => {
      const next = { ...prev, supplierCode: s.code || "", supplierName: s.name || "", supplierSymbol: symbol };
      if (symbol) {
        next.segments = (prev.segments || []).map((seg) => ({ ...seg, carrier: symbol }));
      }
      return next;
    });
    setShowSupplierPicker(false);
    setSupplierSearch("");
  };

  const handleConjunctionToggle = (checked) => {
    const newForm = { ...form, conjunction: checked };
    if (checked) {
      const rawFirst = firstTicketPart(form.passengers[0]?.ticketNr || "");
      const baseDigits = digitsFromTicket(rawFirst);
      if (baseDigits.length === 13) {
        const paxList = form.passengers.map((p, idx) => {
          const conj = buildConjunctionTicket(baseDigits, idx);
          return { ...p, ticketNr: conj || p.ticketNr };
        });
        newForm.passengers = paxList;
      }
    } else {
      const paxList = form.passengers.map((p) => {
        if ((p.ticketNr || "").includes(" - ")) {
          const first = firstTicketPart(p.ticketNr);
          const d = digitsFromTicket(first);
          return { ...p, ticketNr: d ? formatTicketNr(d) : first };
        }
        return p;
      });
      // Also regenerate sequential single tickets from base if base exists
      const baseDigits = digitsFromTicket(firstTicketPart(paxList[0]?.ticketNr || ""));
      if (baseDigits.length === 13 && paxList.length > 1) {
        for (let i = 1; i < paxList.length; i++) {
          try {
            const baseNum = BigInt(baseDigits);
            const nextNum = (baseNum + BigInt(i)).toString().padStart(13, "0").slice(-13);
            paxList[i] = { ...paxList[i], ticketNr: formatTicketNr(nextNum) };
          } catch {}
        }
        newForm.passengers = paxList;
      } else {
        newForm.passengers = paxList;
      }
    }
    setForm(newForm);
  };

  /* ── Ticket number formatting + auto carrier ── */
  const handleTicketNr = (idx, raw) => {
    const isConj = !!form.conjunction;

    // Conjunction mode: handle conjunctive pair display
    if (isConj) {
      // Extract digits from first ticket part only (ignore suffix if user pastes conj)
      // For idx 0, raw may be like "077-2589631421 - 422" -> we take first part digits
      let rawFirst = raw.includes(" - ") ? raw.split(" - ")[0] : raw;
      let digits = rawFirst.replace(/\D/g, "").slice(0, 13);
      // Incomplete entry: just show formatted first part without suffix until 13 digits
      if (digits.length < 13) {
        let display = digits ? formatTicketNr(digits) : "";
        const paxList = [...form.passengers];
        paxList[idx] = { ...paxList[idx], ticketNr: display };
        setForm({ ...form, passengers: paxList });
        return;
      }
      // Complete 13 digits
      let display;
      if (idx === 0) {
        display = buildConjunctionTicket(digits, 0);
        const paxList = [...form.passengers];
        paxList[0] = { ...paxList[0], ticketNr: display };
        // propagate conjunctive pairs to others
        for (let i = 1; i < paxList.length; i++) {
          const conj = buildConjunctionTicket(digits, i);
          paxList[i] = { ...(paxList[i] || { ...EMPTY_PAX }), ticketNr: conj };
        }
        let extra = {};
        if (digits.length >= 3) {
          const code = digits.slice(0, 3);
          const airline = AIRLINE_CODES[code];
          if (airline) {
            extra.gds = airline.gds;
            const segs = form.segments.map((s) => ({ ...s, carrier: airline.carrier }));
            extra.segments = segs;
          }
        }
        setForm({ ...form, passengers: paxList, ...extra });
        return;
      } else {
        // Editing non-first passenger in conj mode: update only that row's pair
        display = buildConjunctionTicket(digits, idx);
        const paxList = [...form.passengers];
        paxList[idx] = { ...paxList[idx], ticketNr: display };
        setForm({ ...form, passengers: paxList });
        return;
      }
    }

    let digits = raw.replace(/\D/g, "").slice(0, 13);
    let display = formatTicketNr(digits);

    const paxList = [...form.passengers];
    paxList[idx] = { ...paxList[idx], ticketNr: display };

    // When first passenger ticket changes and is complete (13 digits), auto-fill sequential for others
    if (idx === 0 && digits.length === 13) {
      for (let i = 1; i < paxList.length; i++) {
        const existingDigits = digitsFromTicket(paxList[i]?.ticketNr || "");
        const shouldOverwrite = !existingDigits || existingDigits.length !== 13 || (() => {
          // overwrite if follows sequential pattern or empty; simple: always overwrite when base complete, or if empty
          try {
            const baseNum = BigInt(digits);
            const expected = (baseNum + BigInt(i)).toString().padStart(13, "0").slice(-13);
            return existingDigits !== expected ? true : true;
          } catch { return true; }
        })();
        if (shouldOverwrite) {
          try {
            const baseNum = BigInt(digits);
            const nextNum = (baseNum + BigInt(i)).toString().padStart(13, "0").slice(-13);
            paxList[i] = { ...(paxList[i] || { ...EMPTY_PAX }), ticketNr: formatTicketNr(nextNum) };
          } catch {}
        }
      }
    }

    // Auto-fill carrier & GDS from first 3 digits (on first passenger) — auto-fill ALL segments
    let extra = {};
    if (idx === 0 && digits.length >= 3) {
      const code = digits.slice(0, 3);
      const airline = AIRLINE_CODES[code];
      if (airline) {
        extra.gds = airline.gds;
        // Fill carrier in ALL segments (auto-fill requirement)
        const segs = form.segments.map((s) => ({ ...s, carrier: airline.carrier }));
        extra.segments = segs;
      }
    }

    setForm({ ...form, passengers: paxList, ...extra });
  };

  // Helper: search existing flights for a ticket number (digits without dash) and return {flight, passenger}
  const findFlightByTicket = useCallback((ticketDigits) => {
    const digits = (ticketDigits || "").replace(/\D/g, "").slice(0, 13);
    if (digits.length !== 13) return null;
    // Search through all saved flights
    for (const flight of flights) {
      for (const p of (flight.passengers || [])) {
        if (digitsFromTicket(p.ticketNr) === digits) {
          return { flight, passenger: p, name: p.name || "", pnr: p.pnr || "", ticketNr: p.ticketNr || "" };
        }
      }
    }
    // Fallback: search current form's other passengers (useful when ticket duplicated in same form)
    for (let i = 0; i < (form.passengers || []).length; i++) {
      const p = form.passengers[i];
      if (digitsFromTicket(p.ticketNr) === digits && (p.name || p.pnr)) {
        return { flight: null, passenger: p, name: p.name || "", pnr: p.pnr || "", ticketNr: p.ticketNr || "" };
      }
    }
    return null;
  }, [flights, form.passengers]);

  // backward compat alias
  const findPassengerByTicket = findFlightByTicket;

  // Build header updates from found flight -> fill table above
  // price table intentionally NOT copied
  const buildHeaderUpdatesFromFlight = (foundFlight) => {
    if (!foundFlight) return {};
    const f = foundFlight;
    const u = {};
    if (f.clientCode) u.clientCode = f.clientCode;
    if (f.clientName) u.clientName = f.clientName;
    if (f.supplierCode) u.supplierCode = f.supplierCode;
    if (f.supplierName) u.supplierName = f.supplierName;
    if (f.supplierSymbol) u.supplierSymbol = f.supplierSymbol;
    // issueDate intentionally NOT copied — keep current form's date as-is
    // price table intentionally NOT copied — keep current form's financial values as-is
    // skipped financial fields: fareValue, taxes, emdAmount, serviceFee, sellPrice, buyPrice,
    // fareValueCHD, taxesCHD, emdAmountCHD, serviceFeeCHD, sellPriceCHD, buyPriceCHD,
    // fareValueINF, taxesINF, emdAmountINF, serviceFeeINF, sellPriceINF, buyPriceINF,
    // profit, profitCHD, profitINF, buyCurrency, sellCurrency, currency
    if (f.branch) u.branch = f.branch;
    if (f.gds) u.gds = f.gds;
    if (f.salesman) u.salesman = f.salesman;
    if (f.salesmanName) u.salesmanName = f.salesmanName;
    if (f.status) u.status = f.status;
    if (f.category) u.category = f.category;
    if (f.remarks) u.remarks = f.remarks;
    if (f.tripType) u.tripType = f.tripType;
    // flight segments - overwrite to mirror original booking (keep segments copying as before)
    if (f.segments && Array.isArray(f.segments) && f.segments.length) {
      u.segments = f.segments.map((s) => ({ ...EMPTY_SEGMENT, ...s }));
    }
    return u;
  };

  const handleOriginalTicket = (idx, raw) => {
    const digits = (raw || "").replace(/\D/g, "").slice(0, 13);
    const formatted = digits ? formatTicketNr(digits) : "";
    const paxList = [...form.passengers];
    paxList[idx] = { ...paxList[idx], originalTicketNr: formatted };
    if (digits.length === 13) {
      const found = findFlightByTicket(digits);
      if (found && (found.name || found.pnr || found.flight)) {
        if (found.name) paxList[idx].name = found.name;
        if (found.pnr) paxList[idx].pnr = found.pnr;
        // Fill table above from original flight's header/financial/segments — overwrite as user requested
        const headerUpdates = buildHeaderUpdatesFromFlight(found.flight);
        const hasHeader = Object.keys(headerUpdates).length > 0;
        const label = [found.name, found.pnr].filter(Boolean).join(" - PNR ");
        if (hasHeader) {
          setForm((prev) => ({ ...prev, ...headerUpdates, passengers: paxList }));
          toast.success(label ? `Imported ${label} + booking data from ${formatted}` : `Imported booking data from ${formatted}`);
          return;
        }
        toast.success(label ? `Imported ${label} from ${formatted}` : `Imported from ${formatted}`);
      }
    }
    setForm({ ...form, passengers: paxList });
  };

  const handleEmdTicket = (idx, raw) => {
    const digits = (raw || "").replace(/\D/g, "").slice(0, 13);
    const formatted = digits ? formatTicketNr(digits) : "";
    const paxList = [...form.passengers];
    paxList[idx] = { ...paxList[idx], emdTicketNr: formatted };
    // EMD S is a standalone additional-service purchase — it is not associated with
    // any specific ticket, so it should never look up / auto-link an existing ticket's
    // name, PNR, or booking data. Only EMD A (associated) does that lookup.
    if (digits.length === 13 && form.eMisc !== "EMD S") {
      const found = findFlightByTicket(digits);
      if (found && (found.name || found.pnr || found.flight)) {
        if (found.name) paxList[idx].name = found.name;
        if (found.pnr) paxList[idx].pnr = found.pnr;
        // Fill table above from original flight's header/financial/segments
        const headerUpdates = buildHeaderUpdatesFromFlight(found.flight);
        const hasHeader = Object.keys(headerUpdates).length > 0;
        const label = [found.name, found.pnr].filter(Boolean).join(" - PNR ");
        if (hasHeader) {
          setForm((prev) => ({ ...prev, ...headerUpdates, passengers: paxList }));
          toast.success(label ? `Imported ${label} + booking data from ${formatted}` : `Imported booking data from ${formatted}`);
          return;
        }
        toast.success(label ? `Imported ${label} from ${formatted}` : `Imported from ${formatted}`);
      }
    }
    setForm({ ...form, passengers: paxList });
  };

  const updatePax = (idx, field, value) => {
    let v = value;
    if (field === "name") {
      v = v.toUpperCase().replace(/[^A-Z0-9\/\-\s]/g, "").slice(0, 50);
    } else if (field === "pnr") {
      v = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    }
    const paxList = [...form.passengers];
    paxList[idx] = { ...paxList[idx], [field]: v };
    setForm({ ...form, passengers: paxList });
  };

  const handlePaxRefundToggle = (idx, checked) => {
    const paxList = [...form.passengers];
    const p = paxList[idx];
    if (checked) {
      const isCHD = p.type === "CHD";
      const isINF = p.type === "INF";
      const buy = isINF ? parseFloat(form.buyPriceINF) || 0 : isCHD ? parseFloat(form.buyPriceCHD) || 0 : parseFloat(form.buyPrice) || 0;
      const sell = isINF ? parseFloat(form.sellPriceINF) || 0 : isCHD ? parseFloat(form.sellPriceCHD) || 0 : parseFloat(form.sellPrice) || 0;
      paxList[idx] = { ...p, refunded: true, refundAirlineAmount: p.refundAirlineAmount || (buy ? buy.toFixed(2) : ""), refundCustomerAmount: p.refundCustomerAmount || (sell ? sell.toFixed(2) : "") };
    } else {
      paxList[idx] = { ...p, refunded: false, refundAirlineAmount: "", refundCustomerAmount: "" };
    }
    setForm({ ...form, passengers: paxList });
  };

  const handleSegmentTab = (e, rowIdx, field) => {
    if (e.key === "Tab" || e.key === "Enter") {
      const isShift = e.shiftKey;
      const isTab = e.key === "Tab";
      const isEnter = e.key === "Enter";
      if (isTab && !isShift) {
        const nextRow = rowIdx + 1;
        if (nextRow < form.segments.length) {
          e.preventDefault();
          const nextEl = document.getElementById(`seg-${nextRow}-${field}`);
          if (nextEl) { nextEl.focus(); nextEl.select?.(); }
        }
        // last row: allow default Tab to exit table
      } else if (isTab && isShift) {
        const prevRow = rowIdx - 1;
        if (prevRow >= 0) {
          e.preventDefault();
          const prevEl = document.getElementById(`seg-${prevRow}-${field}`);
          if (prevEl) { prevEl.focus(); prevEl.select?.(); }
        }
      } else if (isEnter && !isShift) {
        const nextRow = rowIdx + 1;
        if (nextRow < form.segments.length) {
          e.preventDefault();
          const nextEl = document.getElementById(`seg-${nextRow}-${field}`);
          if (nextEl) { nextEl.focus(); nextEl.select?.(); }
        }
      }
    }
  };

  const updateSegment = (idx, field, value) => {
    // City / To: force uppercase 3-letter airport code
    if (field === "city" || field === "toCity") {
      value = value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    }
    // Carrier auto-fill: propagate to ALL rows
    if (field === "carrier") {
      const upper = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
      const newSegs = form.segments.map((s) => ({ ...s, carrier: upper }));
      setForm({ ...form, segments: newSegs });
      return;
    }
    // City auto-fill for roundTrip: last city = first city (return to origin)
    if (field === "city" && idx === 0 && form.tripType === "roundTrip" && form.segments.length > 1) {
      const segs = [...form.segments];
      segs[idx] = { ...segs[idx], [field]: value };
      const lastIdx = segs.length - 1;
      segs[lastIdx] = { ...segs[lastIdx], city: value };
      setForm({ ...form, segments: segs });
      return;
    }
    const segs = [...form.segments];
    segs[idx] = { ...segs[idx], [field]: value };
    setForm({ ...form, segments: segs });
  };

  const addSegment = () => {
    const newSeg = { ...EMPTY_SEGMENT };
    // auto-fill carrier from existing segments
    const existingCarrier = form.segments.find((s) => s.carrier)?.carrier || form.segments[0]?.carrier || "";
    if (existingCarrier) newSeg.carrier = existingCarrier;
    let newSegments = [...form.segments, newSeg];
    // roundTrip: last city = departure airport code
    if (form.tripType === "roundTrip" && newSegments.length > 1 && newSegments[0]?.city) {
      newSegments[newSegments.length - 1] = { ...newSegments[newSegments.length - 1], city: newSegments[0].city };
    }
    setForm({ ...form, segments: newSegments });
  };

  const removeSegment = (idx) => {
    if (form.segments.length <= 1) return;
    let newSegments = form.segments.filter((_, i) => i !== idx);
    // keep roundTrip sync after removal
    if (form.tripType === "roundTrip" && newSegments.length > 1 && newSegments[0]?.city) {
      newSegments[newSegments.length - 1] = { ...newSegments[newSegments.length - 1], city: newSegments[0].city };
    }
    setForm({ ...form, segments: newSegments });
  };

  /* ── Money fields ── Net Profit = Sell - Buy, Buy = F.Value + Taxes + EMD Amount (when EMD) ── */
  const handleMoneyBlur = (field) => {
    setForm((prev) => {
      const next = { ...prev, [field]: formatMoneyInput(prev[field]) };
      const isEMDPrev = prev.eMisc === "EMD A" || prev.eMisc === "EMD S";
      const groups = [
        { fareKey: "fareValue", taxesKey: "taxes", emdKey: "emdAmount", buyKey: "buyPrice" },
        { fareKey: "fareValueCHD", taxesKey: "taxesCHD", emdKey: "emdAmountCHD", buyKey: "buyPriceCHD" },
        { fareKey: "fareValueINF", taxesKey: "taxesINF", emdKey: "emdAmountINF", buyKey: "buyPriceINF" },
      ];
      for (const g of groups) {
        const { fareKey, taxesKey, emdKey, buyKey } = g;
        if (field === fareKey || field === taxesKey || field === emdKey) {
          const fareFormatted = field === fareKey ? next[field] : prev[fareKey];
          const taxesFormatted = field === taxesKey ? next[field] : prev[taxesKey];
          const emdFormatted = field === emdKey ? next[field] : prev[emdKey];
          const f = parseFloat(String(fareFormatted).replace(/,/g, "")) || 0;
          const t = parseFloat(String(taxesFormatted).replace(/,/g, "")) || 0;
          const emd = isEMDPrev ? (parseFloat(String(emdFormatted).replace(/,/g, "")) || 0) : 0;
          const newBuy = f + t + emd;
          next[buyKey] = formatMoneyInput(String(newBuy));
        }
      }
      return next;
    });
  };

  // Net Profit = Sell - Buy (independent) — per person
  const parseNum = (v) => parseFloat(String(v ?? "").replace(/,/g, "")) || 0;
  const calcProfit = () => parseNum(form.sellPrice) - parseNum(form.buyPrice);
  const calcProfitPercent = () => {
    const sell = parseNum(form.sellPrice);
    if (sell === 0) return "0.00";
    return ((calcProfit() / sell) * 100).toFixed(2);
  };
  const calcProfitCHD = () => parseNum(form.sellPriceCHD) - parseNum(form.buyPriceCHD);
  const calcProfitPercentCHD = () => {
    const sell = parseNum(form.sellPriceCHD);
    if (sell === 0) return "0.00";
    return ((calcProfitCHD() / sell) * 100).toFixed(2);
  };
  const calcProfitINF = () => parseNum(form.sellPriceINF) - parseNum(form.buyPriceINF);
  const calcProfitPercentINF = () => {
    const sell = parseNum(form.sellPriceINF);
    if (sell === 0) return "0.00";
    return ((calcProfitINF() / sell) * 100).toFixed(2);
  };

  // ── Per-person pricing helpers (pricing is per Pax, totals = per person * count) ──
  const adtCount = Math.max(1, parseInt(form.adt) || 1);
  const chdCount = Math.max(0, parseInt(form.chd) || 0);
  const infCount = Math.max(0, parseInt(form.inf) || 0);
  const calcAdultBuyPerPerson = () => parseNum(form.fareValue) + parseNum(form.taxes) + (isEMD ? parseNum(form.emdAmount) : 0);
  const calcAdultBuyPer = () => {
    const p = parseNum(form.buyPrice);
    return p !== 0 || form.buyPrice !== "" ? p : calcAdultBuyPerPerson();
  };
  const calcAdultProfitPerPerson = () => parseNum(form.sellPrice) - calcAdultBuyPer();
  const calcAdultTotalBuy = () => calcAdultBuyPer() * adtCount;
  const calcAdultTotalSell = () => parseNum(form.sellPrice) * adtCount;
  const calcAdultTotalProfit = () => calcAdultTotalSell() - calcAdultTotalBuy();
  const calcChdBuyPerPerson = () => parseNum(form.fareValueCHD) + parseNum(form.taxesCHD) + (isEMD ? parseNum(form.emdAmountCHD) : 0);
  const calcChdBuyPer = () => {
    const p = parseNum(form.buyPriceCHD);
    return p !== 0 || form.buyPriceCHD !== "" ? p : calcChdBuyPerPerson();
  };
  const calcChdProfitPerPerson = () => parseNum(form.sellPriceCHD) - calcChdBuyPer();
  const calcChdTotalBuy = () => calcChdBuyPer() * chdCount;
  const calcChdTotalSell = () => parseNum(form.sellPriceCHD) * chdCount;
  const calcChdTotalProfit = () => calcChdTotalSell() - calcChdTotalBuy();
  const calcInfBuyPerPerson = () => parseNum(form.fareValueINF) + parseNum(form.taxesINF) + (isEMD ? parseNum(form.emdAmountINF) : 0);
  const calcInfBuyPer = () => {
    const p = parseNum(form.buyPriceINF);
    return p !== 0 || form.buyPriceINF !== "" ? p : calcInfBuyPerPerson();
  };
  const calcInfProfitPerPerson = () => parseNum(form.sellPriceINF) - calcInfBuyPer();
  const calcInfTotalBuy = () => calcInfBuyPer() * infCount;
  const calcInfTotalSell = () => parseNum(form.sellPriceINF) * infCount;
  const calcInfTotalProfit = () => calcInfTotalSell() - calcInfTotalBuy();
  const calcOverallTotalBuy = () => calcAdultTotalBuy() + (chdCount > 0 ? calcChdTotalBuy() : 0) + (infCount > 0 ? calcInfTotalBuy() : 0);
  const calcOverallTotalSell = () => calcAdultTotalSell() + (chdCount > 0 ? calcChdTotalSell() : 0) + (infCount > 0 ? calcInfTotalSell() : 0);
  const calcOverallTotalProfit = () => calcOverallTotalSell() - calcOverallTotalBuy();

  // Helper for list rows: compute totals from stored per-person values (or use stored totals if present for backward compat)
  const getRowTotals = (row) => {
    const a = Math.max(1, parseInt(row.adt ?? row.pax ?? 1) || 1);
    const c = Math.max(0, parseInt(row.chd) || 0);
    const ii = Math.max(0, parseInt(row.inf) || 0);
    if (row.totalBuy !== undefined && row.totalSell !== undefined) {
      const tb = parseFloat(row.totalBuy) || 0;
      const ts = parseFloat(row.totalSell) || 0;
      const tp = row.totalProfit !== undefined ? parseFloat(row.totalProfit) || 0 : ts - tb;
      return { totalBuy: tb, totalSell: ts, totalProfit: tp, adt: a, chd: c, inf: ii };
    }
    const buyADT = parseFloat(row.buyPrice) || 0;
    const sellADT = parseFloat(row.sellPrice) || 0;
    const buyCHD = parseFloat(row.buyPriceCHD) || 0;
    const sellCHD = parseFloat(row.sellPriceCHD) || 0;
    const buyINF = parseFloat(row.buyPriceINF) || 0;
    const sellINF = parseFloat(row.sellPriceINF) || 0;
    const totalBuy = buyADT * a + buyCHD * c + buyINF * ii;
    const totalSell = sellADT * a + sellCHD * c + sellINF * ii;
    const totalProfit = totalSell - totalBuy;
    return { totalBuy, totalSell, totalProfit, adt: a, chd: c, inf: ii };
  };

  // ── Refund / Void accounting (affects all reports and dashboard) ──
  const isVoidRow = (row) => {
    const s = String(row.status || "").toLowerCase();
    const t = String(row.ticketType || "");
    return s.includes("void") || t.startsWith("V");
  };
  const isRefundedRow = (row) => {
    const s = String(row.status || "").toLowerCase();
    const t = String(row.ticketType || "");
    return s.includes("refund") || t.startsWith("R");
  };
  const getEffectiveTotals = (row) => {
    const raw = getRowTotals(row);
    // Cancelled bookings are excluded entirely from every total, report and
    // dashboard figure — as if they never existed.
    if (String(row.status || "").toLowerCase() === "cancelled") {
      return { totalBuy: 0, totalSell: 0, totalProfit: 0, adt: raw.adt, chd: raw.chd, inf: raw.inf, isCancelled: true };
    }
    if (isVoidRow(row)) {
      return { totalBuy: 0, totalSell: 0, totalProfit: 0, adt: raw.adt, chd: raw.chd, inf: raw.inf, isVoid: true };
    }

    // Dedicated credit-note / refund row → negative contribution (do not treat original as credit)
    if (row.isRefundRow) {
      const sell = Math.abs(raw.totalSell);
      const buy = Math.abs(raw.totalBuy);
      return {
        totalBuy: -buy,
        totalSell: -sell,
        totalProfit: -(sell - buy),
        adt: raw.adt,
        chd: raw.chd,
        inf: raw.inf,
        isRefunded: true,
        isCredit: true,
        refundAirline: buy,
        refundCustomer: sell,
        refundedCount: 1,
      };
    }

    let effBuy = Math.abs(raw.totalBuy);
    let effSell = Math.abs(raw.totalSell);
    let hasRefund = false;
    let refundAirlineTotal = 0;
    let refundCustomerTotal = 0;

    // Partial passenger refunds on the same booking (no separate refund row)
    const paxRefunded = (row.passengers || []).filter((p) => p.refunded);
    if (paxRefunded.length > 0) {
      hasRefund = true;
      for (const p of paxRefunded) {
        let air = parseFloat(p.refundAirlineAmount);
        let cust = parseFloat(p.refundCustomerAmount);
        const hasPaxValues = p.refundAirlineAmount !== "" || p.refundCustomerAmount !== "";
        if (!hasPaxValues) {
          const isCHD = p.type === "CHD";
          const isINF = p.type === "INF";
          air = isINF ? parseFloat(row.buyPriceINF) || 0 : isCHD ? parseFloat(row.buyPriceCHD) || 0 : parseFloat(row.buyPrice) || 0;
          cust = isINF ? parseFloat(row.sellPriceINF) || 0 : isCHD ? parseFloat(row.sellPriceCHD) || 0 : parseFloat(row.sellPrice) || 0;
        } else {
          air = isNaN(air) ? 0 : air;
          cust = isNaN(cust) ? 0 : cust;
        }
        effBuy -= Math.abs(air);
        effSell -= Math.abs(cust);
        refundAirlineTotal += Math.abs(air);
        refundCustomerTotal += Math.abs(cust);
      }
    }

    // Original ticket marked Refunded without per-pax values: keep full sale
    // (deduction comes only from the separate isRefundRow credit note)
    if (isRefundedRow(row) && !hasRefund) {
      return { ...raw, totalBuy: effBuy, totalSell: effSell, totalProfit: effSell - effBuy, isRefunded: true };
    }

    effBuy = Math.max(0, effBuy);
    effSell = Math.max(0, effSell);
    if (hasRefund) {
      return { totalBuy: effBuy, totalSell: effSell, totalProfit: effSell - effBuy, adt: raw.adt, chd: raw.chd, inf: raw.inf, isRefunded: true, refundAirline: refundAirlineTotal, refundCustomer: refundCustomerTotal, refundedCount: paxRefunded.length };
    }
    return { ...raw, totalBuy: effBuy, totalSell: effSell, totalProfit: effSell - effBuy };
  };

  /* ── Save (without invoice) — per person pricing, totals = per person * count ── */
  const handleSave = async () => {
    try {
      const profit = calcProfit();
      const profitCHD = calcProfitCHD();
      const profitINF = calcProfitINF();
      const adtNum = Math.max(1, parseInt(form.adt) || 1);
      const chdNum = Math.max(0, parseInt(form.chd) || 0);
      const infNum = Math.max(0, parseInt(form.inf) || 0);
      const totalPax = adtNum + chdNum + infNum;
      // per-person values (stored as per pax) — already parseNum from form
      const buyPerADT = parseNum(form.buyPrice) || (parseNum(form.fareValue) + parseNum(form.taxes) + (isEMD ? parseNum(form.emdAmount) : 0));
      const sellPerADT = parseNum(form.sellPrice);
      const buyPerCHD = parseNum(form.buyPriceCHD) || (parseNum(form.fareValueCHD) + parseNum(form.taxesCHD) + (isEMD ? parseNum(form.emdAmountCHD) : 0));
      const sellPerCHD = parseNum(form.sellPriceCHD);
      const buyPerINF = parseNum(form.buyPriceINF) || (parseNum(form.fareValueINF) + parseNum(form.taxesINF) + (isEMD ? parseNum(form.emdAmountINF) : 0));
      const sellPerINF = parseNum(form.sellPriceINF);
      const totalBuyADT = buyPerADT * adtNum;
      const totalSellADT = sellPerADT * adtNum;
      const totalProfitADT = totalSellADT - totalBuyADT;
      const totalBuyCHD = buyPerCHD * chdNum;
      const totalSellCHD = sellPerCHD * chdNum;
      const totalProfitCHD = totalSellCHD - totalBuyCHD;
      const totalBuyINF = buyPerINF * infNum;
      const totalSellINF = sellPerINF * infNum;
      const totalProfitINF = totalSellINF - totalBuyINF;
      const totalBuy = totalBuyADT + totalBuyCHD + totalBuyINF;
      const totalSell = totalSellADT + totalSellCHD + totalSellINF;
      const totalProfit = totalSell - totalBuy;
      const payload = {
        ...form,
        paymentMethod: form.paymentMethod || "",
        isCash: form.paymentMethod === "Cash",
        isCC: form.paymentMethod === "CC",
        adt: adtNum,
        chd: chdNum,
        inf: infNum,
        pax: totalPax,
        fareValue: parseNum(form.fareValue),
        taxes: parseNum(form.taxes),
        emdAmount: parseNum(form.emdAmount),
        serviceFee: parseNum(form.serviceFee),
        sellPrice: parseNum(form.sellPrice),
        buyPrice: parseNum(form.buyPrice),
        fareValueCHD: parseNum(form.fareValueCHD),
        taxesCHD: parseNum(form.taxesCHD),
        emdAmountCHD: parseNum(form.emdAmountCHD),
        serviceFeeCHD: parseNum(form.serviceFeeCHD),
        sellPriceCHD: parseNum(form.sellPriceCHD),
        buyPriceCHD: parseNum(form.buyPriceCHD),
        fareValueINF: parseNum(form.fareValueINF),
        taxesINF: parseNum(form.taxesINF),
        emdAmountINF: parseNum(form.emdAmountINF),
        serviceFeeINF: parseNum(form.serviceFeeINF),
        sellPriceINF: parseNum(form.sellPriceINF),
        buyPriceINF: parseNum(form.buyPriceINF),
        profit,
        profitCHD,
        profitINF,
        // totals per category (per person * count) — for list display & reporting
        totalBuyADT,
        totalSellADT,
        totalProfitADT,
        totalBuyCHD,
        totalSellCHD,
        totalProfitCHD,
        totalBuyINF,
        totalSellINF,
        totalProfitINF,
        totalBuy,
        totalSell,
        totalProfit,
        from: form.segments[0]?.city || "",
        to: form.segments[form.segments.length - 1]?.city || "",
        flightNo: form.segments[0]?.flight || "",
        airline: form.segments[0]?.carrier || "",
        updatedAt: serverTimestamp(),
        // Clear unlock after save — relock
        editUnlocked: false,
        editUnlockedBy: null,
        editUnlockedAt: null,
      };
      // Exchange rates are fixed the moment a booking is first created and
      // must never be touched again on subsequent edits.
      if (mode === "edit" && selected) {
        payload.buyExchangeRate = selected.buyExchangeRate || selected.exchangeRate || 1;
        payload.sellExchangeRate = selected.sellExchangeRate || selected.exchangeRate || 1;
        payload.exchangeRate = selected.exchangeRate || 1;
      } else {
        payload.buyExchangeRate = parseNum(form.buyExchangeRate) || 1;
        payload.sellExchangeRate = parseNum(form.sellExchangeRate) || 1;
        payload.exchangeRate = parseNum(form.exchangeRate) || 1;
      }

      if (mode === "add") {
        payload.createdAt = serverTimestamp();
        payload.invoiceIssued = false;
        payload.invoiceNumber = "";
        // Immutable owner of this booking. Read by the "Only see own
        // work" permission both in the UI and in the Firestore rules,
        // which is why it is written once here on create and never
        // sent again on an update.
        payload.salesmanUid = user?.uid || "";
        payload.salesmanName = payload.salesmanName || userData?.name || "";
        payload.regNr = await generateRegNumber("flights", "F", form.branch);
        const docRef = await addDoc(collection(db, "flights"), payload);
        toast.success("Booking saved");
        // onSnapshot updates list automatically
        setMode("view");
        setActiveTab("list");
      } else if (mode === "edit" && selected) {
        await updateDoc(doc(db, "flights", selected.id), payload);
        toast.success("Updated successfully");
        // onSnapshot updates list automatically
        setMode("view");
        setActiveTab("list");
      }
    } catch (error) {
      console.error(error);
      toast.error("Save failed: " + (error.message || ""));
    }
  };

  /* ── Issue Invoice ──
   * Opens the invoice document screen rather than stamping a number onto
   * this single booking. Inside it the user can tick the client's other
   * non-invoiced AIR TICKETS and put them all on one invoice; hotels, visa
   * and transport keep their own separate documents and series.
   */
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);

  const handleIssueInvoice = () => {
    if (mode === "add" || !selected) {
      toast.error("Please Save the booking first, then Issue Invoice");
      return;
    }
    if (selected.invoiceIssued && selected.invoiceNumber) {
      toast.error("Invoice already issued: " + selected.invoiceNumber);
      return;
    }
    setInvoiceModalOpen(true);
  };

  const handleInvoiceIssued = (inv) => {
    const updated = { ...selected, invoiceNumber: inv.fullNumber, invoiceIssued: true };
    setSelected(updated);
    hydrateForm(updated);
  };

  const handlePrint = () => {
    if (!selected) return;
    const segRows = (selected.segments || []).length
      ? selected.segments.map((s) => `<tr><td>${s.city || ""}</td><td>${s.toCity || ""}</td><td>${s.carrier || ""}</td><td>${s.flight || ""}</td><td>${s.class || ""}</td><td>${s.date ? formatDateDMY(s.date) : ""}</td><td>${s.depTime || ""}</td><td>${s.arrTime || ""}</td><td>${s.status || ""}</td></tr>`).join("")
      : `<tr><td colspan="8" style="text-align:center;color:#94a3b8">-</td></tr>`;
    const paxRows = (selected.passengers || []).length
      ? selected.passengers.map((p, i) => `<tr><td>${i + 1}</td><td>${p.ticketNr || ""}</td><td>${p.name || ""}</td><td>${p.type || ""}</td></tr>`).join("")
      : `<tr><td colspan="4" style="text-align:center;color:#94a3b8">-</td></tr>`;
    const body = `
      <h2>${selected.from || ""} → ${selected.to || ""} ${selected.flightNo || ""}</h2>
      <div class="sub">Reg Nr ${selected.regNr || "-"} ${selected.invoiceNumber ? "· Invoice " + selected.invoiceNumber : ""}</div>
      <div class="grid2">
        <div><span class="lbl">Client</span><br/>${selected.clientName || "-"}</div>
        <div><span class="lbl">Supplier</span><br/>${selected.supplierName || "-"}</div>
        <div><span class="lbl">GDS</span><br/>${selected.gds || "-"}</div>
        <div><span class="lbl">Issue Date</span><br/>${selected.issueDate ? formatDateDMY(selected.issueDate) : "-"}</div>
      </div>
      <table><thead><tr><th>City</th><th>To</th><th>Carrier</th><th>Flight</th><th>Class</th><th>Date</th><th>Dep.Time</th><th>Arr.Time</th><th>Status</th></tr></thead><tbody>${segRows}</tbody></table>
      <table><thead><tr><th>#</th><th>Ticket Nr</th><th>Passengers</th><th>Type</th></tr></thead><tbody>${paxRows}</tbody></table>
    `;
    openPrintWindow(`${selected.from || ""}-${selected.to || ""} ${selected.regNr || ""}`, body);
  };

  const handleCopy = async () => {
    if (!selected) {
      toast.error("Select a booking first");
      return;
    }
    const salesmanCode = userData?.name?.split(" ").map((w) => w[0]).join("").toUpperCase() || "";
    const newPassengers = (selected.passengers || []).map((p) => ({
      ticketNr: "",
      pnr: "",
      name: p.name || "",
      type: p.type || "ADT",
      originalTicketNr: "",
      emdTicketNr: "",
    }));
    const passengers = newPassengers.length ? newPassengers : [{ ...EMPTY_PAX }];
    const adt = selected.adt || 1;
    const chd = selected.chd || 0;
    const inf = selected.inf || 0;
    const totalPax = passengers.length;
    const copyBranch = activeBranch && activeBranch !== "ALL" ? activeBranch : (myBranches[0] || branchesList[0]?.code || "1");

    setMode("add");
    setForm({
      ...EMPTY_FORM,
      branch: copyBranch,
      issueDate: new Date().toISOString().slice(0, 10),
      clientCode: selected.clientCode || "",
      clientName: selected.clientName || "",
      pax: totalPax,
      adt,
      chd,
      inf,
      passengers,
      salesman: salesmanCode,
      salesmanName: userData?.name || "",
    });
    setSelected(null);
    setActiveTab("details");
    toast.success("Opened copy with passenger names and client");
    // auto-focus clientCode single input and select first segment "30" (0-2)
    setTimeout(() => {
      const el = document.getElementById("clientCode");
      if (el) { el.focus(); try { el.setSelectionRange(0, 2); } catch { el.select?.(); } try { el.dataset.segment = "0"; } catch {} }
    }, 100);
    // Show a Reg Nr preview immediately, same as a fresh "New" booking.
    try {
      const regNr = await peekNextRegNumber("flights", "F", copyBranch);
      setForm((prev) => (prev.regNr ? prev : { ...prev, regNr }));
    } catch {}
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (selected.invoiceIssued) {
      toast.error("Cannot delete — invoice already issued and booking is locked");
      return;
    }
    if (!confirm("Delete this record?")) return;
    try {
      await deleteDoc(doc(db, "flights", selected.id));
      toast.success("Deleted");
      setSelected(null);
      setCurrentIndex(-1);
      setForm(EMPTY_FORM);
      // onSnapshot updates list automatically
    } catch (error) {
      toast.error("Delete failed");
    }
  };

  // ── Refund by Ticket Number ──
  const handleRefundTicketBlur = (overrideValue) => {
    const norm = digitsFromTicket(overrideValue !== undefined ? overrideValue : refundTicketInput);
    if (!norm) return;
    for (const f of flights) {
      for (let i = 0; i < (f.passengers || []).length; i++) {
        const pn = digitsFromTicket(f.passengers[i].ticketNr || "");
        if (pn === norm) {
          const p = f.passengers[i];
          const isCHD = p.type === "CHD";
          const isINF = p.type === "INF";
          const buy = isINF ? f.buyPriceINF : isCHD ? f.buyPriceCHD : f.buyPrice;
          const sell = isINF ? f.sellPriceINF : isCHD ? f.sellPriceCHD : f.sellPrice;
          if (!refundAirlineInput) setRefundAirlineInput(buy ? Number(buy).toFixed(2) : "");
          if (!refundCustomerInput) setRefundCustomerInput(sell ? Number(sell).toFixed(2) : "");
          return;
        }
      }
    }
  };

  const handleRefundByTicket = async () => {
    const norm = digitsFromTicket(refundTicketInput);
    if (!norm) {
      toast.error("Enter a valid ticket number");
      return;
    }
    let found = null;
    let paxIdx = -1;
    for (const f of flights) {
      for (let i = 0; i < (f.passengers || []).length; i++) {
        const pn = digitsFromTicket(f.passengers[i].ticketNr || "");
        if (pn && pn === norm) {
          found = f;
          paxIdx = i;
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      toast.error("Ticket not found");
      return;
    }
    // Prevent duplicate refund for same ticket (search refund rows)
    const alreadyRefunded = flights.some(
      (ff) => ff.isRefundRow && digitsFromTicket(ff.originalTicketNr || "") === norm
    );
    if (alreadyRefunded) {
      toast.error("Refund invoice already created for this ticket");
      return;
    }
    if (found.passengers[paxIdx]?.refunded) {
      toast.error("Ticket already refunded in original booking");
      return;
    }
    const pax = found.passengers[paxIdx];
    const isCHD = pax.type === "CHD";
    const isINF = pax.type === "INF";
    // Amounts: if empty, use original passenger price
    const defBuy = isINF ? found.buyPriceINF : isCHD ? found.buyPriceCHD : found.buyPrice;
    const defSell = isINF ? found.sellPriceINF : isCHD ? found.sellPriceCHD : found.sellPrice;
    const airlineAmt = refundAirlineInput !== "" ? parseFloat(refundAirlineInput) || 0 : parseFloat(defBuy) || 0;
    const customerAmt = refundCustomerInput !== "" ? parseFloat(refundCustomerInput) || 0 : parseFloat(defSell) || 0;

    // Sell currency determines CNTE or CNTF
    const sellCurr = found.sellCurrency || found.currency || "EGP";
    const isForeign = sellCurr === "USD" || sellCurr === "EUR" || sellCurr === "FOREIGN";

    try {
      // 1) Mark original as Refunded — keep original ticketType so it remains a sale invoice
      await updateDoc(doc(db, "flights", found.id), {
        status: "Refunded",
        updatedAt: serverTimestamp(),
      });

      // 2) Create refund row WITHOUT invoice — user will issue CNTE/CNTF later via Issue Invoice

      const refundRow = {
        // Customer and supplier data from original booking
        clientCode: found.clientCode || "",
        clientName: found.clientName || "",
        supplierCode: found.supplierCode || "",
        supplierName: found.supplierName || "",
        supplierSymbol: found.supplierSymbol || "",
        gds: found.gds || "",
        salesman: found.salesman || "",
        salesmanName: found.salesmanName || "",
        // The refund row is a new record owned by whoever raised it, so it
        // gets the current user's uid — not the original booking's owner.
        salesmanUid: user?.uid || "",
        issueDate: refundDateInput || new Date().toISOString().slice(0, 10),
        refundDate: refundDateInput || new Date().toISOString().slice(0, 10),
        adt: isCHD || isINF ? 0 : 1,
        chd: isCHD ? 1 : 0,
        inf: isINF ? 1 : 0,
        pax: 1,
        ticketType: "R - Refund",
        status: "Refunded",
        isRefundRow: true,
        originalFlightId: found.id,
        originalTicketNr: formatTicketNr(norm),
        // single passenger only
        passengers: [{ ...pax, refunded: false }],
        segments: found.segments ? [...found.segments] : [{ ...EMPTY_SEGMENT }, { ...EMPTY_SEGMENT }],
        from: found.from || "",
        to: found.to || "",
        flightNo: found.flightNo || "",
        airline: found.airline || "",
        // Refund prices (positive - will be deducted in reports)
        buyCurrency: found.buyCurrency || "EGP",
        sellCurrency: sellCurr,
        currency: sellCurr,
        buyPrice: isCHD || isINF ? 0 : airlineAmt,
        buyPriceCHD: isCHD ? airlineAmt : 0,
        buyPriceINF: isINF ? airlineAmt : 0,
        sellPrice: isCHD || isINF ? 0 : customerAmt,
        sellPriceCHD: isCHD ? customerAmt : 0,
        sellPriceINF: isINF ? customerAmt : 0,
        fareValue: 0,
        taxes: 0,
        emdAmount: 0,
        totalBuy: airlineAmt,
        totalSell: customerAmt,
        totalProfit: customerAmt - airlineAmt,
        profit: isCHD || isINF ? 0 : customerAmt - airlineAmt,
        profitCHD: isCHD ? customerAmt - airlineAmt : 0,
        profitINF: isINF ? customerAmt - airlineAmt : 0,
        // Refund row without invoice — will get CNTE/CNTF when user clicks Issue Invoice
        invoiceType: "refund",
        invoiceNumber: "",
        numberPrefix: "",
        sequentialNumber: 0,
        invoiceIssued: false,
        conjunction: false,
        paymentMethod: found.paymentMethod || "Cash",
        isCash: found.isCash ?? true,
        isCC: found.isCC ?? false,
        remarks: `Refund for ${formatTicketNr(norm)} from ${found.invoiceNumber || found.clientName || ""}`,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await addDoc(collection(db, "flights"), refundRow);
      toast.success(`Refund row created for ticket ${formatTicketNr(norm)} — select it in main table and click Issue Invoice for CNTE/CNTF`);
      setShowRefundModal(false);
      setRefundTicketInput("");
      setRefundAirlineInput("");
      setRefundCustomerInput("");
      setRefundDateInput(new Date().toISOString().slice(0, 10));
      setActiveTab("list");
    } catch (e) {
      console.error(e);
      toast.error("Failed to create refund row: " + (e.message || ""));
    }
  };

  const fmt = (v) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isEditing = mode === "add" || mode === "edit";

  /* ── F5 on client/supplier name ── */
  const handleNameKeyDown = (e, type) => {
    if (e.key === "F5") {
      e.preventDefault();
      if (type === "client") setShowClientPicker(true);
      if (type === "supplier") setShowSupplierPicker(true);
    }
  };

  // Clients and Corporates share the "Client Code / Client Name" fields
  // across bookings (Corporates use the 30.01.00.XXXX sub-range), so the
  // F5 picker searches both together.
  const clientAndCorporateOptions = useMemo(
    () => [
      ...clients.map((c) => ({ ...c, kind: "client" })),
      ...corporates.map((c) => ({ ...c, kind: "corporate" })),
    ],
    [clients, corporates]
  );

  const filteredClients = clientAndCorporateOptions.filter((c) => {
    if (!clientSearch) return true;
    const s = clientSearch.toLowerCase();
    return (c.code || "").toLowerCase().includes(s) || (c.name || "").toLowerCase().includes(s);
  });

  const filteredSuppliers = suppliers.filter((s) => {
    if (!supplierSearch) return true;
    const q = supplierSearch.toLowerCase();
    return (s.code || "").toLowerCase().includes(q) || (s.name || "").toLowerCase().includes(q) || (s.symbol || "").toLowerCase().includes(q) || (s.category || "").toLowerCase().includes(q);
  });

  // Section header dashboard — Sales / Cost / Profit / Bookings across
  // every flight booking currently loaded, converted to EGP the same way
  // the main dashboard does it.
  const sectionStats = useMemo(() => {
    let totalSell = 0, totalBuy = 0, totalProfit = 0, totalTickets = 0;
    flights.forEach((row) => {
      const t = getFlightTotals(row);
      totalSell += t.totalSell;
      totalBuy += t.totalBuy;
      totalProfit += t.totalProfit;
      totalTickets += getFlightTicketCount(row);
    });
    return [
      { label: "Total Sales", value: totalSell.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), suffix: " EGP", icon: DollarSign, color: "bg-emerald-600" },
      { label: "Total Cost", value: totalBuy.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), suffix: " EGP", icon: TrendingDown, color: "bg-slate-500" },
      {
        label: "Net Profit",
        value: totalProfit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        suffix: " EGP",
        icon: TrendingUp,
        color: totalProfit >= 0 ? "bg-teal-600" : "bg-red-500",
        valueClass: totalProfit >= 0 ? "text-teal-700" : "text-red-600",
      },
      { label: "Total Tickets", value: totalTickets.toLocaleString("en-US"), icon: Briefcase, color: "bg-indigo-500" },
    ];
  }, [flights]);

  return (
    <div className="flex flex-col h-[calc(100vh-0px)]">
      <Navbar title={"Air Ticket"} />
      <SectionStats stats={sectionStats} />

      {/* TOOLBAR */}
      <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 flex items-center gap-1 flex-wrap text-xs">
        <button onClick={goFirst} className="tb-btn" title="First"><ChevronFirst size={14} /></button>
        <button onClick={goPrev} className="tb-btn" title="Prior"><ChevronLeft size={14} /></button>
        <button onClick={goNext} className="tb-btn" title="Next"><ChevronRight size={14} /></button>
        <button onClick={goLast} className="tb-btn" title="Last"><ChevronLast size={14} /></button>
        <span className="w-px h-5 bg-slate-300 mx-1" />
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="pl-6 pr-2 py-1 text-xs border border-slate-300 rounded w-40 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <span className="w-px h-5 bg-slate-300 mx-1" />
        <button onClick={startAdd} disabled={!canWrite} className="tb-btn-blue" title={!canWrite ? "View only — you don't have write access to this page" : undefined}><Plus size={14} /> New</button>
        <button onClick={startEdit} disabled={!canWrite || !selected || isEditing || (selected?.invoiceIssued && !isAdmin && !selected?.editUnlocked)} className="tb-btn" title={!canWrite ? "View only — you don't have write access to this page" : selected?.invoiceIssued ? (selected?.editUnlocked ? "Unlocked by admin — you can edit" : isAdmin ? "Locked — admin confirm to edit" : "Locked — admin must unlock via Invoices") : "Edit"}><Pencil size={14} /> Edit</button>
        <button onClick={handleDelete} disabled={!selected || isEditing || selected?.invoiceIssued || !isAdmin} className="tb-btn text-red-600" title={!isAdmin ? "Admin / General Manager only" : selected?.invoiceIssued ? "Locked — invoice already issued" : "Delete"}><Trash2 size={14} /> Delete</button>
        {isEditing && (
          <>
            <span className="w-px h-5 bg-slate-300 mx-1" />
            <button onClick={handleSave} className="tb-btn-blue"><Save size={14} /> Save</button>
            <button onClick={cancelEdit} className="tb-btn"><X size={14} /> Cancel</button>
          </>
        )}
        <div className="flex-1" />
        <span className="text-gray-500">{filtered.length ? `${currentIndex + 1} / ${filtered.length}` : "0"}</span>
        <span className="w-px h-5 bg-slate-300 mx-1" />
        <button onClick={cancelEdit} className="tb-btn" title="Exit — back to the list"><LogOut size={14} /> Exit</button>
      </div>

      {/* ACTION BAR */}
      {!isEditing && (
        <div className="bg-slate-50 border-b border-slate-200 px-3 py-1.5 flex items-center gap-1 flex-wrap text-xs">
          <AssignToFileButton type="flights" row={selected} disabled={!selected} />
          {selected && (
            <>
              <button onClick={handlePrint} className="tb-btn" title="Print">
                <Printer size={14} /> Print
              </button>
              <button
                onClick={() => {
                  const defTicket = selected?.passengers?.[0]?.ticketNr || "";
                  setRefundTicketInput(digitsFromTicket(defTicket) ? formatTicketNr(digitsFromTicket(defTicket)) : defTicket);
                  setRefundAirlineInput("");
                  setRefundCustomerInput("");
                  setRefundDateInput(new Date().toISOString().slice(0, 10));
                  setShowRefundModal(true);
                  setTimeout(() => handleRefundTicketBlur(), 100);
                }}
                disabled={!canWrite}
                className="tb-btn text-amber-700"
                title={!canWrite ? "View only — you don't have write access to this page" : "Refund by ticket number"}
              >
                <Trash2 size={14} /> Refund by Ticket
              </button>
              <button onClick={handleCopy} disabled={!canWrite} className="tb-btn" title={!canWrite ? "View only — you don't have write access to this page" : "Copy"}>
                <Copy size={14} /> Copy
              </button>
              <button onClick={handleIssueInvoice} disabled={!canWrite || selected.invoiceIssued} className="tb-btn" title={!canWrite ? "View only — you don't have write access to this page" : selected.invoiceIssued ? "Invoice already issued" : "Issue Invoice"}>
                <FileText size={14} /> {selected.invoiceIssued ? `Invoice: ${selected.invoiceNumber}` : "Issue Invoice"}
              </button>
            </>
          )}
        </div>
      )}

      {/* TABS */}
      <div className="bg-white border-b px-3 flex gap-0 text-xs">
        {["list", "details"].map((tab) => (
          <button key={tab} onClick={() => !isEditing && setActiveTab(tab)} className={`px-4 py-2 font-medium border-b-2 capitalize ${activeTab === tab || (isEditing && tab === "details") ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto bg-slate-50">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* ===================== LIST ===================== */}
            {activeTab === "list" && !isEditing && (
              <div className="p-2 space-y-3 flex flex-col h-[calc(100vh-180px)]">
                <div ref={listRef} tabIndex={0} autoFocus onKeyDown={handleListKeyDown} className="bg-white border border-slate-300 rounded overflow-auto flex-none outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400" style={{height: selected ? "52vh" : "68vh", minHeight: "260px"}}>
                  <table className="w-full text-[10px] border-collapse">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr>
                        <th className="th text-center border border-slate-300">Reg Nr</th>
                        <th className="th border border-slate-300">Invoice</th>
                        <th className="th border border-slate-300">Client</th>
                        <th className="th border border-slate-300" title="Supplier Symbol">Ticket</th>
                        <th className="th border border-slate-300">Supplier</th>
                        <th className="th text-center border border-slate-300">GDS</th>
                        <th className="th border border-slate-300">Issue Date</th>
                        <th className="th text-center border border-slate-300">Pax</th>
                        <th className="th text-right border border-slate-300">Fare</th>
                        <th className="th text-right border border-slate-300">Tax</th>
                        <th className="th text-right border border-slate-300">Service</th>
                        <th className="th text-right border border-slate-300">Sell</th>
                        <th className="th text-right border border-slate-300">Buy</th>
                        <th className="th text-right border border-slate-300">Profit</th>
                        <th className="th border border-slate-300">From</th>
                        <th className="th border border-slate-300">To</th>
                        <th className="th border border-slate-300">Flight</th>
                        <th className="th border border-slate-300">Salesman</th>
                        <th className="th border border-slate-300">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr><td colSpan={19} className="px-4 py-10 text-center text-gray-400">No records. Click New to create.</td></tr>
                      ) : filtered.map((row, idx) => {
                        const totals = getEffectiveTotals(row);
                        const rawTotals = getRowTotals(row);
                        const isVoid = totals.isVoid;
                        const isRefunded = totals.isRefunded;
                        const isCancelled = totals.isCancelled;
                        return (
                        <tr key={row.id} data-index={idx} title={isCancelled ? "CANCELLED — ignored in all totals and reports" : isVoid ? "VOID — Total = 0" : isRefunded ? `Refunded: Original Buy ${fmt(rawTotals.totalBuy)}/Sell ${fmt(rawTotals.totalSell)} → After deduction Buy ${fmt(totals.totalBuy)}/Sell ${fmt(totals.totalSell)}` : "Double click to view details — Sell/Buy/Profit are totals (per pax × count)"} tabIndex={-1} onFocus={() => selectRow(row, idx)} onClick={() => selectRow(row, idx)} onDoubleClick={() => openDetails(row, idx)} onKeyDown={(e) => { if (e.key === "Enter") selectRow(row, idx); }} className={`cursor-pointer border-t border-slate-100 hover:bg-blue-50 focus:bg-blue-100 outline-none ${isCancelled ? "opacity-40 grayscale text-slate-400" : isVoid ? "bg-red-50 opacity-70" : isRefunded ? "bg-amber-50" : ""} ${selected?.id === row.id ? "bg-blue-100 ring-1 ring-blue-300 ring-inset" : ""}`}>
                          <td className="td text-center font-mono font-medium text-slate-700 border border-slate-200">{row.regNr || "-"}</td>
                          <td className={`td border border-slate-200 ${row.editUnlocked ? "text-slate-400 font-normal opacity-60" : "font-medium text-blue-700"}`}>{row.invoiceNumber || ""}</td>
                          <td className="td border border-slate-200">{row.clientCode || row.clientName || "-"}</td>
                          <td className="td font-mono font-bold text-blue-600 text-[10px] border border-slate-200" title="Supplier Symbol">{row.supplierSymbol || row.supplierCode || "-"}</td>
                          <td className="td border border-slate-200">{row.supplierName || row.supplierCode || "-"}</td>
                          <td className="td text-center font-mono border border-slate-200">{row.gds || "-"}</td>
                          <td className="td border border-slate-200">{row.issueDate ? formatDateDMY(row.issueDate) : "-"}</td>
                          <td className="td text-center border border-slate-200" title={row.chd || row.inf ? `ADT:${row.adt||1} CHD:${row.chd||0} INF:${row.inf||0}` : ""}>{row.pax || (parseInt(row.adt||0)+(parseInt(row.chd||0)+(parseInt(row.inf||0)))) || 1}</td>
                          <td className="td text-right border border-slate-200" title="Per ADT fare">{fmt(row.fareValue)}</td>
                          <td className="td text-right border border-slate-200" title="Per ADT tax">{fmt(row.taxes)}</td>
                          <td className="td text-right border border-slate-200">{fmt(row.serviceFee)}</td>
                          <td className="td text-right font-medium border border-slate-200" title={`Per ADT ${fmt(row.sellPrice)} × ${totals.adt}${totals.chd?` + CHD ${fmt(row.sellPriceCHD)}×${totals.chd}`:""}${totals.inf?` + INF ${fmt(row.sellPriceINF)}×${totals.inf}`:""}`}>{fmt(totals.totalSell)}</td>
                          <td className="td text-right border border-slate-200" title={`Per ADT ${fmt(row.buyPrice)} × ${totals.adt}${totals.chd?` + CHD ${fmt(row.buyPriceCHD)}×${totals.chd}`:""}${totals.inf?` + INF ${fmt(row.buyPriceINF)}×${totals.inf}`:""}`}>{fmt(totals.totalBuy)}</td>
                          <td className={`td text-right font-medium border border-slate-200 ${totals.totalProfit >= 0 ? "text-green-600" : "text-red-600"}`} title={`Total Profit = Total Sell - Total Buy`}>{fmt(totals.totalProfit)}</td>
                          <td className="td border border-slate-200">{row.from || "-"}</td>
                          <td className="td border border-slate-200">{row.to || "-"}</td>
                          <td className="td border border-slate-200">{row.flightNo || "-"}</td>
                          <td className="td border border-slate-200">{row.salesmanName || row.salesman || "-"}</td>
                          <td className="td border border-slate-200">
                            <span className={`badge text-[10px] ${row.status === "Confirmed" ? "badge-green" : row.status === "Refunded" ? "badge bg-amber-100 text-amber-700 border-amber-300" : row.status === "Void" ? "badge bg-red-100 text-red-700 border-red-300" : row.status === "Pending" ? "badge-yellow" : row.status === "Cancelled" ? "badge-red" : "badge-gray"}`}>
                              {row.status || "-"}
                            </span>
                            {isRefunded && <span className="ml-1 text-[9px] text-amber-600 font-mono">−{fmt(totals.refundCustomer||0)}</span>}
                            {isVoid && <span className="ml-1 text-[9px] text-red-600 font-bold">VOID</span>}
                            {row.editUnlocked ? <span className="ml-1 inline-flex items-center gap-0.5 text-[9px] text-emerald-700 font-bold border border-emerald-200 bg-emerald-50 px-1 rounded"><Lock size={9} /> Unlocked</span> : row.invoiceIssued ? <span className="ml-1 inline-flex items-center gap-0.5 text-[9px] text-red-700 font-bold border border-red-200 bg-red-50 px-1 rounded"><Lock size={9} /> Locked</span> : null}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {selected && (
                  <div className="bg-blue-50 border border-blue-200 rounded overflow-hidden flex flex-col" style={{height: "20vh", minHeight: "140px"}}>
                    <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-blue-200 flex-1 overflow-auto">
                      {/* LEFT - exactly like image */}
                      <div className="overflow-auto">
                        <table className="w-full text-[11px] border-collapse bg-blue-50">
                          <thead>
                            <tr className="bg-blue-100 border-b border-blue-200">
                              <th className="th border-r border-blue-200">City</th>
                              <th className="th border-r border-blue-200">To</th>
                              <th className="th border-r border-blue-200">Carrier</th>
                              <th className="th border-r border-blue-200">Flight</th>
                              <th className="th border-r border-blue-200">Class</th>
                              <th className="th border-r border-blue-200">Date</th>
                              <th className="th border-r border-blue-200">Dep.Time</th>
                              <th className="th border-r border-blue-200">Arr.Time</th>
                              <th className="th border-r border-blue-200">Status</th>
                              <th className="th">F.Basis</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(selected.segments || []).length === 0 ? (
                              <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-400 text-[11px]">-</td></tr>
                            ) : (
                              selected.segments.map((seg, idx) => (
                                <tr key={idx} className="border-t border-slate-200">
                                  <td className="td border-r border-slate-100">{seg.city || ""}</td>
                                  <td className="td border-r border-slate-100">{seg.toCity || ""}</td>
                                  <td className="td border-r border-slate-100">{seg.carrier || ""}</td>
                                  <td className="td border-r border-slate-100">{seg.flight || ""}</td>
                                  <td className="td border-r border-slate-100">{seg.class || ""}</td>
                                  <td className="td border-r border-slate-100">{seg.date ? formatDateDMY(seg.date) : ""}</td>
                                  <td className="td border-r border-slate-100">{seg.depTime || ":"}</td>
                                  <td className="td border-r border-slate-100">{seg.arrTime || ":"}</td>
                                  <td className="td border-r border-slate-100">{seg.status || ""}</td>
                                  <td className="td">{seg.fareBasis || ""}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                      {/* RIGHT - exactly like image */}
                      <div className="overflow-auto">
                        <table className="w-full text-[11px] border-collapse bg-blue-50">
                          <thead>
                            <tr className="bg-blue-100 border-b border-blue-200">
                              <th className="th w-8 border-r border-blue-200 text-center"></th>
                              <th className="th border-r border-blue-200">Ticket Nr</th>
                              <th className="th border-r border-blue-200">Passengers</th>
                              <th className="th text-center">Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(selected.passengers || []).length === 0 ? (
                              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400 text-[11px]">-</td></tr>
                            ) : (
                              selected.passengers.map((p, idx) => (
                                <tr key={idx} className="border-t border-slate-200">
                                  <td className="td text-center border-r border-slate-100 text-gray-600">{idx + 1}</td>
                                  <td className="td font-mono border-r border-slate-100">{p.ticketNr || ""}</td>
                                  <td className="td border-r border-slate-100">{p.name || ""}</td>
                                  <td className="td text-center"><span className={`inline-flex px-1 py-0.5 rounded text-[9px] font-bold border ${p.type==="CHD"?"bg-blue-50 text-blue-700 border-blue-200":p.type==="INF"?"bg-amber-50 text-amber-700 border-amber-200":"bg-slate-50 text-slate-600 border-slate-200"}`}>{p.type||"-"}</span></td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===================== DETAILS FORM ===================== */}
            {(activeTab === "details" || isEditing) && (
              <div className="p-2 space-y-2">
                {(form.invoiceIssued || selected?.invoiceIssued) && !(form.editUnlocked || selected?.editUnlocked) ? (
                  <div className="bg-red-50 border border-red-300 text-red-700 text-xs font-semibold px-3 py-2 rounded flex items-center gap-2">
                    <Lock size={14} /> Locked — Invoice {form.invoiceNumber || selected?.invoiceNumber || ""} already issued, no edits allowed
                  </div>
                ) : null}
                {/* Header fields - Row 1: invoice meta. Row 2: Client/Supplier Code+Name together with PAX/CHD/INF. Row 3: GDS/Salesman/Status. */}
                <div className="bg-white border border-slate-200 rounded p-2 space-y-1.5">
                  <div className="text-xs flex flex-wrap gap-x-2 gap-y-1">
                    <div className="w-32">
                      <label className="lbl">Invoice Type</label>
                      <select disabled={!isEditing} value={form.invoiceType} onChange={(e) => setForm({ ...form, invoiceType: e.target.value })} className="inp">
                        <option value="ticket">Ticket</option>
                        <option value="service">Service</option>
                      </select>
                    </div>
                    <div className="w-32">
                      <label className="lbl">Invoice No</label>
                      <input disabled value={form.invoiceNumber || ""} placeholder="" className="inp bg-slate-50" />
                    </div>
                    <div className="w-32">
                      <label className="lbl">Reg Nr</label>
                      <input disabled value={form.regNr || ""} placeholder="" className="inp bg-slate-50" />
                    </div>
                    <div className="w-40">
                      <label className="lbl">Issue Date</label>
                      <input type="date" lang="en-GB" disabled={!isEditing} value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className="inp" />
                    </div>
                    <div className="w-40">
                      <label className="lbl">Branch</label>
                      {mode === "add" && (isAdmin ? branchesList : branchesList.filter((b) => myBranches.includes(b.code))).length > 1 ? (
                        <select value={form.branch} onChange={(e) => handleAddBranchChange(e.target.value)} className="inp">
                          {(isAdmin ? branchesList : branchesList.filter((b) => myBranches.includes(b.code))).map((b) => (
                            <option key={b.code} value={b.code}>{b.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input disabled value={branchesList.find((b) => b.code === form.branch)?.name || form.branch} className="inp bg-slate-50" />
                      )}
                    </div>
                  </div>

                  <div className="text-xs flex flex-wrap items-end gap-x-2 gap-y-1">
                    <div className="w-28">
                      <label className="lbl">Client Code</label>
                      <input
                        id="clientCode"
                        value={form.clientCode}
                        onChange={e=>handleClientCode(e.target.value)}
                        onFocus={e=>handleCodeFocus(e, "client")}
                        onKeyDown={e=>handleCodeSegmentKeyDown(e, "client")}
                        onBlur={e=>handleCodeBlur(e.target.value, "client")}
                        placeholder="30.00.00.0000"
                        className="inp font-mono text-left"
                        disabled={!isEditing}
                      />
                    </div>
                    <div className="w-40">
                      <label className="lbl">Client Name <span className="text-gray-400 font-normal">(F5)</span></label>
                      <input disabled={!isEditing} value={form.clientName} onChange={e=>setForm({...form, clientName:e.target.value})} onKeyDown={(e)=>handleNameKeyDown(e,"client")} className="inp" placeholder="Press F5 to select client" />
                    </div>
                    <div className="w-28">
                      <label className="lbl">Supplier Code</label>
                      <input
                        id="supplierCode"
                        value={form.supplierCode}
                        onChange={e=>handleSupplierCode(e.target.value)}
                        onFocus={e=>handleCodeFocus(e, "supplier")}
                        onKeyDown={e=>handleCodeSegmentKeyDown(e, "supplier")}
                        onBlur={e=>handleCodeBlur(e.target.value, "supplier")}
                        placeholder="50.00.00.0000"
                        className="inp font-mono text-left"
                        disabled={!isEditing}
                      />
                    </div>
                    <div className="w-40">
                      <label className="lbl">Supplier Name <span className="text-gray-400 font-normal">(F5)</span></label>
                      <input disabled={!isEditing} value={form.supplierName} onChange={e=>setForm({...form, supplierName:e.target.value})} onKeyDown={(e)=>handleNameKeyDown(e,"supplier")} className="inp" placeholder="Press F5 to select supplier" />
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <div className="w-14"><label className="lbl">PAX</label><input type="number" min="1" max="20" disabled={!isEditing} value={form.adt} onChange={(e) => handleAdtChange(e.target.value)} onFocus={(e) => e.target.select()} className="inp text-center w-full" /></div>
                      <div className="w-14"><label className="lbl">CHD</label><input type="number" min="0" max="20" disabled={!isEditing} value={form.chd} onChange={(e) => handleChdChange(e.target.value)} onFocus={(e) => e.target.select()} className="inp text-center w-full" /></div>
                      <div className="w-14"><label className="lbl">INF</label><input type="number" min="0" max="20" disabled={!isEditing} value={form.inf} onChange={(e) => handleInfChange(e.target.value)} onFocus={(e) => e.target.select()} className="inp text-center w-full" /></div>
                    </div>
                  </div>

                  <div className="text-xs flex flex-wrap gap-x-2 gap-y-1">
                    <div className="w-32">
                      <label className="lbl">GDS</label>
                      <select disabled={!isEditing} value={form.gds} onChange={(e) => setForm({ ...form, gds: e.target.value })} className="inp w-full">
                        <option value="">-</option>
                        <option value="1A">1A</option>
                        <option value="1S">1S</option>
                        <option value="1G">1G</option>
                        <option value="1B">1B</option>
                        <option value="1P">1P</option>
                      </select>
                    </div>
                    <div className="w-40">
                      <label className="lbl">Salesman</label>
                      <input disabled value={form.salesmanName || form.salesman} className="inp bg-slate-50" />
                    </div>
                    <div className="w-40">
                      <label className="lbl">Status</label>
                      <select
                        disabled={!isEditing}
                        value={form.status}
                        onChange={(e) => setForm({ ...form, status: e.target.value })}
                        className="inp"
                      >
                        <option value="Confirmed">Confirmed</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Passengers table - MOVED BEFORE FLIGHT SEGMENTS - Order: Ticket Number -> Passenger Name -> PNR */}
                <div className="bg-white border border-slate-200 rounded overflow-hidden">
                  <div className="bg-slate-100 px-2 py-1 flex flex-nowrap items-center justify-between text-xs font-semibold text-slate-600">
                    <span className="whitespace-nowrap">Passengers ({form.pax}) — ADT:{form.adt} CHD:{form.chd} INF:{form.inf}</span>
                    <div className="flex flex-nowrap items-center gap-2">
                      <div className="flex flex-nowrap items-center gap-1">
                        <label className="whitespace-nowrap text-[10px] font-semibold">E-Miscellaneous</label>
                        <select disabled={!isEditing} value={form.eMisc || ""} onChange={(e) => setForm({ ...form, eMisc: e.target.value })} className="inp text-[10px] h-6 w-24 py-0 px-1">
                          <option value="">-</option>
                          <option value="EMD A">EMD A</option>
                          <option value="EMD S">EMD S</option>
                        </select>
                      </div>
                      <div className="flex flex-nowrap items-center gap-1">
                        <label className="whitespace-nowrap text-[10px] font-normal">Type</label>
                        <select disabled={!isEditing} value={form.ticketType} onChange={(e) => setForm({ ...form, ticketType: e.target.value })} className="inp text-[10px] h-6 w-24 py-0 px-1">
                          <option value="T - Ticket">T - Ticket</option>
                          <option value="E - Exchanging">E - Exchanging</option>
                          <option value="R - Refund">R - Refund</option>
                          <option value="V - Void">V - Void</option>
                        </select>
                      </div>
                      <label className="flex flex-nowrap items-center gap-1 whitespace-nowrap text-[10px] font-normal cursor-pointer" title="Each passenger gets 2 ticket numbers">
                        <input type="checkbox" checked={!!form.conjunction} onChange={(e) => handleConjunctionToggle(e.target.checked)} disabled={!isEditing} className="w-3 h-3" />
                        Conjunction
                      </label>
                    </div>
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="th w-8">#</th>
                          <th className="th">Ticket Number</th>
                          <th className="th">Passenger Name</th>
                          {(form.ticketType === "E - Exchanging" || form.eMisc === "EMD A") && <th className="th">Original Ticket Nr</th>}
                          <th className="th">PNR</th>
                          <th className="th w-14 text-center">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {form.passengers.map((p, idx) => (
                          <React.Fragment key={idx}>
                            <tr className="border-t border-slate-100">
                              <td className="td text-center text-gray-400">{idx + 1}</td>
                              <td className="td">
                                <input
                                  disabled={!isEditing}
                                  value={p.ticketNr}
                                  onChange={(e) => handleTicketNr(idx, e.target.value)}
                                  className="inp-sm font-mono"
                                  placeholder="077-1234567890"
                                  maxLength={form.conjunction ? 20 : 14}
                                />
                              </td>
                              <td className="td">
                                <input
                                  disabled={!isEditing}
                                  value={p.name}
                                  onChange={(e) => updatePax(idx, "name", e.target.value)}
                                  className="inp-sm uppercase"
                                  placeholder="LASTNAME/FIRSTNAME"
                                  style={{ textTransform: "uppercase" }}
                                />
                              </td>
                              {(form.ticketType === "E - Exchanging" || form.eMisc === "EMD A") && (
                                <td className="td">
                                  <input
                                    disabled={!isEditing}
                                    value={form.ticketType === "E - Exchanging" ? (p.originalTicketNr || "") : (p.emdTicketNr || "")}
                                    onChange={(e) => {
                                      if (form.ticketType === "E - Exchanging") handleOriginalTicket(idx, e.target.value)
                                      else handleEmdTicket(idx, e.target.value)
                                    }}
                                    placeholder="077-1234567890"
                                    maxLength={14}
                                    className="inp-sm font-mono"
                                    title="Ticket this EMD A is associated with"
                                  />
                                </td>
                              )}
                              <td className="td">
                                <input
                                  disabled={!isEditing}
                                  value={p.pnr}
                                  onChange={(e) => updatePax(idx, "pnr", e.target.value)}
                                  className="inp-sm font-mono uppercase"
                                  placeholder="ABC123"
                                  maxLength={6}
                                  style={{ textTransform: "uppercase" }}
                                />
                              </td>
                              <td className="td text-center">
                                <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold border ${p.type === "CHD" ? "bg-blue-50 text-blue-700 border-blue-200" : p.type === "INF" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-slate-50 text-slate-600 border-slate-200"}`}>{p.type || (idx < (parseInt(form.adt)||1) ? "ADT" : idx < (parseInt(form.adt)||1)+(parseInt(form.chd)||0) ? "CHD" : "INF")}</span>
                              </td>
                            </tr>
                            {(form.eMisc === "EMD A" || form.eMisc === "EMD S") && (
                              <tr className="border-t border-slate-100 bg-sky-50/40">
                                <td className="td text-center text-slate-400 text-[10px]">{idx + 1}*</td>
                                <td className="td">
                                  <input
                                    disabled={!isEditing}
                                    value={p.emdTicketNr || ""}
                                    onChange={(e) => handleEmdTicket(idx, e.target.value)}
                                    placeholder="EMD 077-1234567890"
                                    maxLength={14}
                                    className="inp-sm font-mono bg-white"
                                     title="EMD Ticket Number"
                                  />
                                </td>
                                <td className="td">
                                  <input disabled value={p.name || ""} className="inp-sm bg-slate-50 uppercase" placeholder="—" style={{ textTransform: "uppercase" }} />
                                </td>
                                {(form.ticketType === "E - Exchanging" || form.eMisc === "EMD A") && (
                                  <td className="td">
                                    <input disabled value={p.ticketNr || ""} className="inp-sm bg-slate-50 font-mono" placeholder="—" title="Associated Ticket / Original" />
                                  </td>
                                )}
                                <td className="td">
                                  <input disabled value={p.pnr || ""} className="inp-sm bg-slate-50 font-mono uppercase" placeholder="—" style={{ textTransform: "uppercase" }} />
                                </td>
                                <td className="td text-center">
                                  <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold border bg-sky-100 text-sky-700 border-sky-200">{form.eMisc}</span>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Trip Type + Flight Segments */}
                <div className="bg-white border border-slate-200 rounded overflow-hidden">
                  <div className="bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 flex items-center gap-4 flex-wrap">
                    <span>Flight Segments</span>
                    <div className="flex gap-2">
                      {[
                        { id: "oneWay", label: "One Way" },
                        { id: "roundTrip", label: "Round Trip" },
                        { id: "multiCity", label: "Multi City" },
                      ].map((tt) => (
                        <button
                          key={tt.id}
                          type="button"
                          disabled={!isEditing}
                          onClick={() => handleTripType(tt.id)}
                          className={`px-2.5 py-0.5 rounded text-[11px] border transition ${
                            form.tripType === tt.id
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-slate-600 border-slate-300 hover:border-blue-400"
                          } ${!isEditing ? "opacity-60" : ""}`}
                        >
                          {tt.label}
                        </button>
                      ))}
                    </div>
                    {isEditing && (
                      <button onClick={addSegment} className="text-blue-600 hover:underline text-[11px] ml-auto">+ Add Segment</button>
                    )}
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="th">#</th>
                          <th className="th">City</th>
                          <th className="th">To</th>
                          <th className="th">Carrier</th>
                          <th className="th">Flight</th>
                          <th className="th">CL</th>
                          <th className="th">Date</th>
                          <th className="th">Dep</th>
                          <th className="th">Arr</th>
                          <th className="th">Status</th>
                          <th className="th">Fare Basis</th>
                          {isEditing && <th className="th"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {form.segments.map((seg, idx) => (
                          <tr key={idx} className="border-t border-slate-100">
                            <td className="td text-center text-gray-400">{idx + 1}</td>
                            <td className="td"><input id={`seg-${idx}-city`} disabled={!isEditing} value={seg.city} onChange={(e) => updateSegment(idx, "city", e.target.value)} onKeyDown={(e) => handleSegmentTab(e, idx, "city")} className="inp-sm uppercase font-mono" placeholder="CAI" maxLength={3} style={{ textTransform: "uppercase" }} /></td>
                            <td className="td"><input id={`seg-${idx}-toCity`} disabled={!isEditing} value={seg.toCity || ""} onChange={(e) => updateSegment(idx, "toCity", e.target.value)} onKeyDown={(e) => handleSegmentTab(e, idx, "toCity")} className="inp-sm uppercase font-mono" placeholder="SSH" maxLength={3} style={{ textTransform: "uppercase" }} /></td>
                            <td className="td"><input id={`seg-${idx}-carrier`} disabled={!isEditing} value={seg.carrier} onChange={(e) => updateSegment(idx, "carrier", e.target.value)} onKeyDown={(e) => handleSegmentTab(e, idx, "carrier")} className="inp-sm uppercase font-mono" placeholder="MS" style={{ textTransform: "uppercase" }} /></td>
                            <td className="td"><input id={`seg-${idx}-flight`} disabled={!isEditing} value={seg.flight} onChange={(e) => updateSegment(idx, "flight", e.target.value)} onKeyDown={(e) => handleSegmentTab(e, idx, "flight")} className="inp-sm" placeholder="123" /></td>
                            <td className="td"><input id={`seg-${idx}-class`} disabled={!isEditing} value={seg.class} onChange={(e) => updateSegment(idx, "class", e.target.value)} onKeyDown={(e) => handleSegmentTab(e, idx, "class")} className="inp-sm w-10" /></td>
                            <td className="td"><input id={`seg-${idx}-date`} type="date" lang="en-GB" disabled={!isEditing} value={seg.date} onChange={(e) => updateSegment(idx, "date", e.target.value)} onKeyDown={(e) => handleSegmentTab(e, idx, "date")} className="inp-sm" /></td>
                            <td className="td"><input id={`seg-${idx}-depTime`} type="text" placeholder="HH:MM" inputMode="numeric" pattern="[0-2][0-9]:[0-5][0-9]" maxLength={5} disabled={!isEditing} value={seg.depTime || ""} onChange={(e) => { let v = e.target.value.replace(/[^0-9:]/g, "").slice(0, 5); if (v.length === 2 && !v.includes(":") && (seg.depTime || "").length < 2) v = v + ":"; updateSegment(idx, "depTime", v); }} onBlur={() => { const val = normalizeTime24Blur(seg.depTime || ""); if (!val) { if (!seg.depTime) return; updateSegment(idx, "depTime", ""); return; } if (val !== seg.depTime) updateSegment(idx, "depTime", val); }} onKeyDown={(e) => handleSegmentTab(e, idx, "depTime")} className="inp-sm text-center font-mono" /></td>
                            <td className="td"><input id={`seg-${idx}-arrTime`} type="text" placeholder="HH:MM" inputMode="numeric" pattern="[0-2][0-9]:[0-5][0-9]" maxLength={5} disabled={!isEditing} value={seg.arrTime || ""} onChange={(e) => { let v = e.target.value.replace(/[^0-9:]/g, "").slice(0, 5); if (v.length === 2 && !v.includes(":") && (seg.arrTime || "").length < 2) v = v + ":"; updateSegment(idx, "arrTime", v); }} onBlur={() => { const val = normalizeTime24Blur(seg.arrTime || ""); if (!val) { if (!seg.arrTime) return; updateSegment(idx, "arrTime", ""); return; } if (val !== seg.arrTime) updateSegment(idx, "arrTime", val); }} onKeyDown={(e) => handleSegmentTab(e, idx, "arrTime")} className="inp-sm text-center font-mono" /></td>
                            <td className="td"><input id={`seg-${idx}-status`} disabled={!isEditing} value={seg.status} onChange={(e) => updateSegment(idx, "status", e.target.value)} onKeyDown={(e) => handleSegmentTab(e, idx, "status")} className="inp-sm" /></td>
                            <td className="td"><input id={`seg-${idx}-fareBasis`} disabled={!isEditing} value={seg.fareBasis} onChange={(e) => updateSegment(idx, "fareBasis", e.target.value)} onKeyDown={(e) => handleSegmentTab(e, idx, "fareBasis")} className="inp-sm" /></td>
                            {isEditing && (
                              <td className="td">
                                <button onClick={() => removeSegment(idx)} className="text-red-500 hover:text-red-700 text-xs">×</button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Financial - F.Value + Taxes = Buy Price and Sell Price - Buy Price = Net Profit */}
                <div className="bg-white border border-slate-200 rounded p-2">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-2 gap-y-1 text-xs">
                    <div className="col-span-full flex gap-4 items-end">
                      <div className="w-24">
                        <label className="lbl">Buy Currency</label>
                        <select disabled={!isEditing} value={form.buyCurrency} onChange={(e) => setForm({ ...form, buyCurrency: e.target.value })} className="inp w-full">
                          <option value="EGP">EGP</option>
                          <option value="USD">USD</option>
                          <option value="EUR">EUR</option>
                        </select>
                      </div>
                      <div className="w-24">
                        <label className="lbl">Sell Currency</label>
                        <select disabled={!isEditing} value={form.sellCurrency} onChange={(e) => setForm({ ...form, sellCurrency: e.target.value })} className="inp w-full">
                          <option value="EGP">EGP</option>
                          <option value="USD">USD</option>
                          <option value="EUR">EUR</option>
                        </select>
                      </div>
                      {form.buyCurrency !== "EGP" && (
                        <div className="w-32">
                          <label className="lbl">Buy Rate→EGP</label>
                          <div className="inp w-full text-right bg-slate-50 flex items-center justify-end gap-1">
                            {fetchingBuyRate && mode === "add" ? (
                              <>
                                <RefreshCw size={11} className="animate-spin text-slate-400" />
                                <span className="text-slate-400 text-[11px]">fetching…</span>
                              </>
                            ) : (
                              <span>{fmt(form.buyExchangeRate)}</span>
                            )}
                          </div>
                        </div>
                      )}
                      {form.sellCurrency !== "EGP" && (
                        <div className="w-32">
                          <label className="lbl">Sell Rate→EGP</label>
                          <div className="inp w-full text-right bg-slate-50 flex items-center justify-end gap-1">
                            {fetchingSellRate && mode === "add" ? (
                              <>
                                <RefreshCw size={11} className="animate-spin text-slate-400" />
                                <span className="text-slate-400 text-[11px]">fetching…</span>
                              </>
                            ) : (
                              <span>{fmt(form.sellExchangeRate)}</span>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-4 ml-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="paymentMethod" value="Cash" checked={form.paymentMethod==="Cash"} onChange={e=>setForm({...form, paymentMethod:"Cash", isCash:true, isCC:false})} disabled={!isEditing} className="w-4 h-4 accent-blue-600" />
                          <span className="text-xs font-medium">Cash</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="paymentMethod" value="CC" checked={form.paymentMethod==="CC"} onChange={e=>setForm({...form, paymentMethod:"CC", isCash:false, isCC:true})} disabled={!isEditing} className="w-4 h-4 accent-blue-600" />
                          <span className="text-xs font-medium">CC</span>
                        </label>
                      </div>
                    </div>
                    <div>
                      <label className="lbl">F. Value (per Adult)</label>
                      <input type="text" inputMode="decimal" disabled={!isEditing} value={form.fareValue} onChange={(e) => setForm({ ...form, fareValue: e.target.value })} onBlur={() => handleMoneyBlur("fareValue")} className="inp" title="Per Adult" />
                    </div>
                    <div>
                      <label className="lbl">Taxes (per Adult)</label>
                      <input type="text" inputMode="decimal" disabled={!isEditing} value={form.taxes} onChange={(e) => setForm({ ...form, taxes: e.target.value })} onBlur={() => handleMoneyBlur("taxes")} className="inp" title="Per Adult" />
                    </div>
                    {(form.eMisc === "EMD A" || form.eMisc === "EMD S") && (
                      <div><label className="lbl">EMD Amount (per Adult)</label><input type="text" inputMode="decimal" disabled={!isEditing} value={form.emdAmount} onChange={e=>setForm({...form, emdAmount:e.target.value})} onBlur={()=>handleMoneyBlur("emdAmount")} className="inp" title="Per Adult" /></div>
                    )}
                    <div>
                      <label className="lbl">Buy Price (per Adult)</label>
                      <input type="text" inputMode="decimal" disabled={!isEditing} value={form.buyPrice} onChange={(e) => setForm({ ...form, buyPrice: e.target.value })} onBlur={() => handleMoneyBlur("buyPrice")} className="inp bg-slate-50" title={isEMDStandalone ? "Auto: EMD Amount only (per Adult) — EMD S is a standalone service, not tied to fare/taxes" : "Auto: F.Value + Taxes" + (isEMD ? " + EMD Amount" : "") + " (per Adult)"} />
                    </div>
                    <div>
                      <label className="lbl">Sell Price (per Adult)</label>
                      <input type="text" inputMode="decimal" disabled={!isEditing} value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} onBlur={() => handleMoneyBlur("sellPrice")} className="inp font-medium" title="Per Adult" />
                    </div>
                    <div>
                      <label className="lbl">Net Profit (per Adult)</label>
                      <input disabled value={fmt(calcProfit())} className="inp bg-green-50 text-green-700 font-semibold border-green-200" title="Net Profit per Adult — Sell - Buy" />
                    </div>
                    <div>
                      <label className="lbl">Profit % (per Adult)</label>
                      <input disabled value={calcProfitPercent() + "%"} className="inp bg-green-50 text-green-700 font-semibold" />
                    </div>
                    <div className="col-span-2">
                      <label className="lbl">Remarks</label>
                      <input disabled={!isEditing} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className="inp" />
                    </div>
                    <div className="col-span-full mt-1">
                      <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span className="font-semibold">Total for {adtCount} ADT:</span>
                        <span>Buy {fmt(calcAdultTotalBuy())} {form.buyCurrency || form.currency}</span>
                        <span>Sell {fmt(calcAdultTotalSell())} {form.sellCurrency || form.currency}</span>
                        <span className={calcAdultTotalProfit() >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>Profit {fmt(calcAdultTotalProfit())}</span>
                        <span className="text-slate-400">(per pax × {adtCount})</span>
                      </div>
                    </div>
                  </div>
                  {/* Child Prices - dynamic when CHD > 0 */}
                  {form.chd > 0 && (
                    <div className="border-t pt-2 mt-2">
                      <p className="text-xs font-semibold text-blue-600">Child (CHD) Prices — {form.chd} child{form.chd>1?"ren":""}</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-2 gap-y-1 text-xs mt-1.5">
                        <div>
                          <label className="lbl">F. Value CHD (per Child)</label>
                          <input type="text" inputMode="decimal" disabled={!isEditing} value={form.fareValueCHD} onChange={(e) => setForm({ ...form, fareValueCHD: e.target.value })} onBlur={() => handleMoneyBlur("fareValueCHD")} className="inp" title="Per Child" />
                        </div>
                        <div>
                          <label className="lbl">Taxes CHD (per Child)</label>
                          <input type="text" inputMode="decimal" disabled={!isEditing} value={form.taxesCHD} onChange={(e) => setForm({ ...form, taxesCHD: e.target.value })} onBlur={() => handleMoneyBlur("taxesCHD")} className="inp" title="Per Child" />
                        </div>
                        {(form.eMisc === "EMD A" || form.eMisc === "EMD S") && (
                          <div><label className="lbl">EMD Amount CHD (per Child)</label><input type="text" inputMode="decimal" disabled={!isEditing} value={form.emdAmountCHD} onChange={e=>setForm({...form, emdAmountCHD:e.target.value})} onBlur={()=>handleMoneyBlur("emdAmountCHD")} className="inp" title="Per Child" /></div>
                        )}
                        <div>
                          <label className="lbl">Buy CHD (per Child)</label>
                          <input type="text" inputMode="decimal" disabled value={form.buyPriceCHD} className="inp bg-slate-50" title={isEMDStandalone ? "Auto: EMD Amount CHD only (per Child) — EMD S is a standalone service" : "Auto: F.Value CHD + Taxes CHD" + (isEMD ? " + EMD Amount CHD" : "") + " (per Child)"} />
                        </div>
                        <div>
                          <label className="lbl">Sell CHD (per Child)</label>
                          <input type="text" inputMode="decimal" disabled={!isEditing} value={form.sellPriceCHD} onChange={(e) => setForm({ ...form, sellPriceCHD: e.target.value })} onBlur={() => handleMoneyBlur("sellPriceCHD")} className="inp font-medium" title="Per Child" />
                        </div>
                        <div>
                          <label className="lbl">Net Profit CHD (per Child)</label>
                          <input disabled value={fmt(calcProfitCHD())} className="inp bg-blue-50 text-blue-700 font-semibold border-blue-200" title="Net Profit per Child — Sell - Buy" />
                        </div>
                        <div>
                          <label className="lbl">Profit % CHD (per Child)</label>
                          <input disabled value={calcProfitPercentCHD() + "%"} className="inp bg-blue-50 text-blue-700 font-semibold" />
                        </div>
                        <div className="col-span-full mt-1">
                          <div className="text-[11px] text-slate-600 bg-blue-50/60 border border-blue-200 rounded px-2 py-1 flex flex-wrap gap-x-3 gap-y-1">
                            <span className="font-semibold text-blue-700">Total for {chdCount} CHD:</span>
                            <span>Buy {fmt(calcChdTotalBuy())} {form.buyCurrency || form.currency}</span>
                            <span>Sell {fmt(calcChdTotalSell())} {form.sellCurrency || form.currency}</span>
                            <span className={calcChdTotalProfit() >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>Profit {fmt(calcChdTotalProfit())}</span>
                            <span className="text-slate-400">(per Child × {chdCount})</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Infant Prices - dynamic when INF > 0 */}
                  {form.inf > 0 && (
                    <div className="border-t pt-2 mt-2">
                      <p className="text-xs font-semibold text-amber-600">Infant (INF) Prices — {form.inf} infant{form.inf>1?"s":""}</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-2 gap-y-1 text-xs mt-1.5">
                        <div>
                          <label className="lbl">F. Value INF (per Infant)</label>
                          <input type="text" inputMode="decimal" disabled={!isEditing} value={form.fareValueINF} onChange={(e) => setForm({ ...form, fareValueINF: e.target.value })} onBlur={() => handleMoneyBlur("fareValueINF")} className="inp" title="Per Infant" />
                        </div>
                        <div>
                          <label className="lbl">Taxes INF (per Infant)</label>
                          <input type="text" inputMode="decimal" disabled={!isEditing} value={form.taxesINF} onChange={(e) => setForm({ ...form, taxesINF: e.target.value })} onBlur={() => handleMoneyBlur("taxesINF")} className="inp" title="Per Infant" />
                        </div>
                        {(form.eMisc === "EMD A" || form.eMisc === "EMD S") && (
                          <div><label className="lbl">EMD Amount INF (per Infant)</label><input type="text" inputMode="decimal" disabled={!isEditing} value={form.emdAmountINF} onChange={e=>setForm({...form, emdAmountINF:e.target.value})} onBlur={()=>handleMoneyBlur("emdAmountINF")} className="inp" title="Per Infant" /></div>
                        )}
                        <div>
                          <label className="lbl">Buy INF (per Infant)</label>
                          <input type="text" inputMode="decimal" disabled value={form.buyPriceINF} className="inp bg-slate-50" title={isEMDStandalone ? "Auto: EMD Amount INF only (per Infant) — EMD S is a standalone service" : "Auto: F.Value INF + Taxes INF" + (isEMD ? " + EMD Amount INF" : "") + " (per Infant)"} />
                        </div>
                        <div>
                          <label className="lbl">Sell INF (per Infant)</label>
                          <input type="text" inputMode="decimal" disabled={!isEditing} value={form.sellPriceINF} onChange={(e) => setForm({ ...form, sellPriceINF: e.target.value })} onBlur={() => handleMoneyBlur("sellPriceINF")} className="inp font-medium" title="Per Infant" />
                        </div>
                        <div>
                          <label className="lbl">Net Profit INF (per Infant)</label>
                          <input disabled value={fmt(calcProfitINF())} className="inp bg-amber-50 text-amber-700 font-semibold border-amber-200" title="Net Profit per Infant — Sell - Buy" />
                        </div>
                        <div>
                          <label className="lbl">Profit % INF (per Infant)</label>
                          <input disabled value={calcProfitPercentINF() + "%"} className="inp bg-amber-50 text-amber-700 font-semibold" />
                        </div>
                        <div className="col-span-full mt-1">
                          <div className="text-[11px] text-slate-600 bg-amber-50/60 border border-amber-200 rounded px-2 py-1 flex flex-wrap gap-x-3 gap-y-1">
                            <span className="font-semibold text-amber-700">Total for {infCount} INF:</span>
                            <span>Buy {fmt(calcInfTotalBuy())} {form.buyCurrency || form.currency}</span>
                            <span>Sell {fmt(calcInfTotalSell())} {form.sellCurrency || form.currency}</span>
                            <span className={calcInfTotalProfit() >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>Profit {fmt(calcInfTotalProfit())}</span>
                            <span className="text-slate-400">(per Infant × {infCount})</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Overall booking totals */}
                  <div className="border-t-2 border-slate-300 pt-2 mt-3">
                    <div className="text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-300 rounded px-2 py-1.5 flex flex-wrap gap-x-4 gap-y-1 items-center">
                      <span className="font-bold">Overall Totals for {adtCount + chdCount + infCount} Pax (ADT:{adtCount} CHD:{chdCount} INF:{infCount}):</span>
                      <span>Buy <span className="font-semibold">{fmt(calcOverallTotalBuy())} {form.buyCurrency || form.currency}</span></span>
                      <span>Sell <span className="font-semibold">{fmt(calcOverallTotalSell())} {form.sellCurrency || form.currency}</span></span>
                      <span className={calcOverallTotalProfit() >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>Profit {fmt(calcOverallTotalProfit())} {form.sellCurrency || form.currency}</span>
                      {(form.buyCurrency !== "EGP" || form.sellCurrency !== "EGP") && (() => {
                        const buyR = parseNum(form.buyExchangeRate) || 1;
                        const sellR = parseNum(form.sellExchangeRate) || 1;
                        const buyEGPv = form.buyCurrency !== "EGP" ? calcOverallTotalBuy() * buyR : calcOverallTotalBuy();
                        const sellEGPv = form.sellCurrency !== "EGP" ? calcOverallTotalSell() * sellR : calcOverallTotalSell();
                        const profitEGPv = sellEGPv - buyEGPv;
                        return (
                          <span className="text-slate-500">
                            (≈ Buy {fmt(buyEGPv)} EGP / Sell {fmt(sellEGPv)} EGP / Profit{" "}
                            <span className={profitEGPv >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>{fmt(profitEGPv)} EGP</span>)
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  {/* ── Refund / Void accounting (show only when already refunded) ── */}
                  {(form.status === "Refunded" || form.status === "Void" || form.ticketType === "R - Refund" || form.ticketType === "V - Void" || form.isRefundRow) && (
                    <div className={`border-2 rounded p-3 mt-3 ${form.status === "Void" || form.ticketType === "V - Void" ? "bg-red-50 border-red-300" : "bg-amber-50 border-amber-300"}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-xs font-bold px-2 py-1 rounded ${form.status === "Void" ? "bg-red-600 text-white" : "bg-amber-600 text-white"}`}>
                          {form.status === "Void" || form.ticketType === "V - Void" ? "VOID — Ticket cancelled (Total = 0)" : "REFUND — Details"}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {form.status === "Void" ? "All totals will be zeroed in reports" : "Amounts will be deducted from totals in all reports and dashboard"}
                        </span>
                      </div>

                      {form.status === "Void" || form.ticketType === "V - Void" ? (
                        <div className="text-xs text-red-700 bg-white border border-red-200 rounded px-3 py-2">
                          <p className="font-semibold">Void: No amounts needed — Buy = 0, Sell = 0, Profit = 0 will be calculated automatically in all reports.</p>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                              <label className="lbl">Void Date</label>
                              <input type="date" disabled={!isEditing} value={form.refundDate || ""} onChange={(e) => setForm({ ...form, refundDate: e.target.value })} className="inp" />
                            </div>
                            <div>
                              <label className="lbl">Reason</label>
                              <input disabled={!isEditing} value={form.refundReason || ""} onChange={(e) => setForm({ ...form, refundReason: e.target.value })} className="inp" placeholder="Reason" />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div>
                              <label className="lbl">Airline Refund (deduct from Buy)</label>
                              <input type="text" inputMode="decimal" disabled={!isEditing} value={form.refundAirlineAmount} onChange={(e) => setForm({ ...form, refundAirlineAmount: e.target.value.replace(/[^0-9.]/g,"") })} onBlur={() => setForm({ ...form, refundAirlineAmount: form.refundAirlineAmount ? Number(form.refundAirlineAmount).toFixed(2) : "" })} className="inp font-mono" placeholder="800.00" />
                              <span className="text-[10px] text-slate-400">Amount refunded by airline</span>
                            </div>
                            <div>
                              <label className="lbl">Customer Refund (deduct from Sell)</label>
                              <input type="text" inputMode="decimal" disabled={!isEditing} value={form.refundCustomerAmount} onChange={(e) => setForm({ ...form, refundCustomerAmount: e.target.value.replace(/[^0-9.]/g,"") })} onBlur={() => setForm({ ...form, refundCustomerAmount: form.refundCustomerAmount ? Number(form.refundCustomerAmount).toFixed(2) : "" })} className="inp font-mono" placeholder="700.00" />
                              <span className="text-[10px] text-slate-400">Amount refunded to customer</span>
                            </div>
                            <div>
                              <label className="lbl">Refund Date</label>
                              <input type="date" disabled={!isEditing} value={form.refundDate || ""} onChange={(e) => setForm({ ...form, refundDate: e.target.value })} className="inp" />
                            </div>
                            <div>
                              <label className="lbl">Reason</label>
                              <input disabled={!isEditing} value={form.refundReason || ""} onChange={(e) => setForm({ ...form, refundReason: e.target.value })} className="inp" placeholder="Reason" />
                            </div>
                          </div>

                          {/* Preview after refund */}
                          <div className="mt-2 bg-white border border-amber-200 rounded px-3 py-2 text-xs">
                            <p className="font-semibold text-amber-800 mb-1">Preview after deduction (shown in all reports):</p>
                            <div className="flex flex-wrap gap-4">
                              <span>Original: Buy {fmt(calcOverallTotalBuy())} / Sell {fmt(calcOverallTotalSell())} / Profit {fmt(calcOverallTotalProfit())}</span>
                              <span className="text-slate-300">→</span>
                              <span className="font-bold">
                                After refund: Buy {fmt(Math.max(0, calcOverallTotalBuy() - (parseFloat(form.refundAirlineAmount)||0)))} / Sell {fmt(Math.max(0, calcOverallTotalSell() - (parseFloat(form.refundCustomerAmount)||0)))} / Profit <span className={(Math.max(0, calcOverallTotalSell() - (parseFloat(form.refundCustomerAmount)||0)) - Math.max(0, calcOverallTotalBuy() - (parseFloat(form.refundAirlineAmount)||0))) >=0 ? "text-green-600" : "text-red-600"}>{fmt(Math.max(0, calcOverallTotalSell() - (parseFloat(form.refundCustomerAmount)||0)) - Math.max(0, calcOverallTotalBuy() - (parseFloat(form.refundAirlineAmount)||0)))}</span>
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1">Retained penalty = (Customer Refund - Airline Refund) = {fmt((parseFloat(form.refundAirlineAmount)||0) - (parseFloat(form.refundCustomerAmount)||0))} — shown as profit difference</p>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

              </div>
            )}
          </>
        )}
      </div>

      {/* Client Picker Modal */}
      {showClientPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-modal-backdrop">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[70vh] flex flex-col animate-modal-panel">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold text-sm">Select Client</h3>
              <button onClick={() => setShowClientPicker(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-3 border-b">
              <input autoFocus value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder="Search code or name..." className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="overflow-auto flex-1">
              {filteredClients.length === 0 ? (
                <p className="p-4 text-center text-gray-400 text-sm">No clients found. Add clients first.</p>
              ) : filteredClients.map((c) => (
                <button key={c.id} onClick={() => pickClient(c)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 border-b border-slate-100 flex justify-between items-center gap-2">
                  <span className="font-medium flex items-center gap-2">
                    {c.kind === "corporate" && <span className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">Corp</span>}
                    {c.name}
                  </span>
                  <span className="text-gray-400 font-mono text-xs">{c.code}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Supplier Picker Modal */}
      {showSupplierPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-modal-backdrop">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[70vh] flex flex-col animate-modal-panel">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold text-sm">Select Supplier</h3>
              <button onClick={() => setShowSupplierPicker(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-3 border-b">
              <input autoFocus value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} placeholder="Search symbol / code / name..." className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="overflow-auto flex-1">
              {filteredSuppliers.length === 0 ? (
                <p className="p-4 text-center text-gray-400 text-sm">No suppliers found. Add suppliers first.</p>
              ) : filteredSuppliers.map((s) => (
                <button key={s.id} onClick={() => pickSupplier(s)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 border-b border-slate-100 flex justify-between items-center gap-2">
                  <span className="font-medium flex items-center gap-2">
                    {s.symbol && <span className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200">{s.symbol}</span>}
                    <span>{s.name}</span>
                    <span className="text-gray-400 font-mono text-xs">({s.code})</span>
                  </span>
                  <span className="text-gray-400 text-xs whitespace-nowrap">{s.category || ""}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Refund by Ticket Modal ── */}
      {showRefundModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl animate-modal-panel">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h3 className="font-bold text-sm flex items-center gap-2"><Trash2 size={16} className="text-amber-600" /> Refund by Ticket Number</h3>
              <button onClick={() => setShowRefundModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="lbl">Ticket Number *</label>
                <input
                  autoFocus
                  value={refundTicketInput}
                  onChange={(e) => {
                    const clean = e.target.value.toUpperCase().replace(/[^A-Z0-9\-]/g,"").slice(0,14);
                    // auto format 077-1234567890
                    const digits = clean.replace(/[^0-9]/g,"").slice(0,13);
                    const formatted = digits.length > 3 ? digits.slice(0,3)+"-"+digits.slice(3) : digits;
                    setRefundTicketInput(formatted);
                    // Import the original ticket's Buy/Sell as soon as it matches —
                    // no need to wait for blur. Pass the fresh value directly since
                    // state updates are async and wouldn't be visible yet otherwise.
                    handleRefundTicketBlur(formatted);
                  }}
                  onBlur={() => handleRefundTicketBlur()}
                  placeholder="077-1234567890"
                  className="inp font-mono text-sm"
                />
                <p className="text-[11px] text-slate-400 mt-1">Enter full ticket number — original Buy/Sell will be imported automatically below</p>
              </div>
              {(() => {
                const norm = digitsFromTicket(refundTicketInput);
                if (!norm) return null;
                for (const f of flights) {
                  for (const p of f.passengers || []) {
                    if (digitsFromTicket(p.ticketNr || "") === norm) {
                      const isCHD = p.type === "CHD";
                      const isINF = p.type === "INF";
                      const origBuy = isINF ? f.buyPriceINF : isCHD ? f.buyPriceCHD : f.buyPrice;
                      const origSell = isINF ? f.sellPriceINF : isCHD ? f.sellPriceCHD : f.sellPrice;
                      return (
                        <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-xs space-y-1">
                          <div>
                            <span className="text-slate-500">Client: </span>
                            <span className="font-semibold">{f.clientCode || ""} {f.clientCode && f.clientName ? "—" : ""} {f.clientName || ""}</span>
                            <span className="mx-2 text-slate-300">|</span>
                            <span className="text-slate-500">Passenger: </span>
                            <span className="font-semibold">{p.name || "-"}</span>
                            <span className="mx-2 text-slate-300">|</span>
                            <span className="text-slate-500">PNR: </span>
                            <span className="font-mono">{p.pnr || "-"}</span>
                          </div>
                          <div className="pt-1 border-t border-blue-200">
                            <span className="text-slate-500">Original Buy: </span>
                            <span className="font-semibold">{fmt(origBuy)} {f.buyCurrency || f.currency || "EGP"}</span>
                            <span className="mx-2 text-slate-300">|</span>
                            <span className="text-slate-500">Original Sell: </span>
                            <span className="font-semibold">{fmt(origSell)} {f.sellCurrency || f.currency || "EGP"}</span>
                            <span className="ml-2 text-[10px] text-blue-600">(imported below — edit if the actual refund differs)</span>
                          </div>
                        </div>
                      );
                    }
                  }
                }
                return null;
              })()}
              <div>
                <label className="lbl">Refund Date</label>
                <input type="date" value={refundDateInput} onChange={(e) => setRefundDateInput(e.target.value)} className="inp" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="lbl">Airline Refund (deduct from Buy)</label>
                  <input type="text" inputMode="decimal" value={refundAirlineInput} onChange={(e) => setRefundAirlineInput(e.target.value.replace(/[^0-9.]/g,""))} placeholder="800.00" className="inp font-mono" />
                </div>
                <div>
                  <label className="lbl">Customer Refund (deduct from Sell)</label>
                  <input type="text" inputMode="decimal" value={refundCustomerInput} onChange={(e) => setRefundCustomerInput(e.target.value.replace(/[^0-9.]/g,""))} placeholder="700.00" className="inp font-mono" />
                </div>
              </div>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">Leave both fields empty for full refund by passenger price. Amounts are deducted immediately from main table and dashboard.</p>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowRefundModal(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">Cancel</button>
                <button onClick={handleRefundByTicket} className="px-5 py-2 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium">Confirm Refund</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .tb-btn {
          display: inline-flex; align-items: center; gap: 3px;
          padding: 3px 8px; font-size: 11px;
          border: 1px solid #cbd5e1; border-radius: 3px;
          background: white; color: #334155; cursor: pointer;
        }
        .tb-btn:hover:not(:disabled) { background: #f1f5f9; }
        .tb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .tb-btn-blue {
          display: inline-flex; align-items: center; gap: 3px;
          padding: 3px 10px; font-size: 11px;
          border: 1px solid #2563eb; border-radius: 3px;
          background: #2563eb; color: white; cursor: pointer;
        }
        .tb-btn-blue:hover { background: #1d4ed8; }
        .th { padding: 3px 6px; text-align: left; font-weight: 600; color: #64748b; white-space: nowrap; font-size: 10px; text-transform: uppercase; }
        .td { padding: 2px 6px; white-space: nowrap; }
        .lbl { display: block; font-size: 10px; font-weight: 600; color: #64748b; margin-bottom: 1px; text-transform: uppercase; }
        .inp {
          width: 100%; padding: 3px 6px; font-size: 11px;
          border: 1px solid #cbd5e1; border-radius: 3px; outline: none;
        }
        .inp:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.12); }
        .inp:disabled { background: #f8fafc; color: #475569; }
        .inp-sm {
          width: 100%; padding: 2px 4px; font-size: 10px;
          border: 1px solid #e2e8f0; border-radius: 2px; outline: none; background: transparent;
        }
        .inp-sm:focus { border-color: #2563eb; background: white; }
        .inp-sm:disabled { color: #475569; }
        /* Remove number input spinners */
        .no-spin::-webkit-outer-spin-button,
        .no-spin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .no-spin { -moz-appearance: textfield; }
      `}</style>
      <InvoiceIssueModal
        open={invoiceModalOpen}
        section="flights"
        record={selected}
        onClose={() => setInvoiceModalOpen(false)}
        onIssued={handleInvoiceIssued}
      />
    </div>
  );
}
