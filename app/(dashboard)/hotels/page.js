"use client";

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import Navbar from "@/components/Navbar";
import SectionStats from "@/components/SectionStats";
import AssignToFileButton from "@/components/AssignToFileButton";
import InvoiceIssueModal from "@/components/InvoiceIssueModal";
import { useAuth } from "@/lib/auth";
import { canWriteModule } from "@/lib/permissions";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { fetchExchangeRateToEGP, getHotelTotals, generateRegNumber, peekNextRegNumber, isBranchVisible, isRecordVisible, openPrintWindow, bookingQuery } from "@/lib/helpers";
import { useClosedFiscalYearKeys, isRowClosed } from "@/lib/fiscalYear";
import toast from "react-hot-toast";
import {
  Plus, Minus, Pencil, Trash2, Search, ChevronFirst, ChevronLast,
  ChevronLeft, ChevronRight, Save, X, FileText, RefreshCw, DollarSign, TrendingUp, TrendingDown, Briefcase, Printer, LogOut,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

const EMPTY_GUEST = { name: "", type: "ADT", roomNr: "" };
const EMPTY_ROOM_GUEST = { name: "" };
// Each booking can contain several physical rooms, and each room now
// carries its own full set of details (type, room number, meal plan,
// buy/sell rate, its own check-in/check-out/nights, and its own list of
// occupant names) instead of being grouped as "N rooms of the same type"
// or sharing one check-in/out for the whole booking.
const EMPTY_ROOM = {
  roomType: "Standard", roomNr: "", mealPlan: "BB", buyPrice: "", sellPrice: "",
  checkIn: "", checkOut: "", nights: 1,
  guests: [{ ...EMPTY_ROOM_GUEST }],
};

const EMPTY_FORM = {
  clientCode: "30.00.00.0000",
  clientName: "",
  supplierCode: "50.00.00.0000",
  supplierName: "",
  hotelName: "",
  city: "",
  country: "",
  confirmationNr: "",
  voucherNr: "",
  checkIn: "",
  checkOut: "",
  nights: 1,
  // `rooms` and `roomType` are kept as derived summary fields (total room
  // count / comma-joined type list) for older code and list-view display —
  // `roomLines` below is the actual source of truth: one entry per physical
  // room, each with its own type, room number, meal plan and buy/sell rate.
  rooms: 1,
  roomType: "Standard",
  roomLines: [{ ...EMPTY_ROOM }],
  mealPlan: "BB",
  adt: 1,
  chd: 0,
  inf: 0,
  pax: 1,
  guests: [{ ...EMPTY_GUEST }],
  buyCurrency: "EGP",
  sellCurrency: "EGP",
  currency: "EGP",
  // EGP value of 1 unit of each side's currency, captured independently
  // (buy and sell can be in different foreign currencies) once at booking
  // time and locked forever after the first save (see `rateLocked` logic).
  // `exchangeRate` is kept in sync with sellExchangeRate for backward
  // compatibility with older code/data that only knew one shared rate.
  buyExchangeRate: 1,
  sellExchangeRate: 1,
  exchangeRate: 1,
  buyPrice: "",
  sellPrice: "",
  serviceFee: "",
  status: "Confirmed",
  branch: "1",
  salesman: "",
  salesmanName: "",
  issueDate: new Date().toISOString().slice(0, 10),
  remarks: "",
  paymentMethod: "Cash",
  isCash: true,
  isCC: false,
  invoiceNumber: "",
  numberPrefix: "",
  sequentialNumber: 0,
  invoiceIssued: false,
  invoicePaid: false,
};

const ROOM_TYPES = ["Standard", "Superior", "Deluxe", "Suite", "Family", "Twin", "Double", "Triple", "Single"];
const MEAL_PLANS = [
  { v: "RO", l: "Room Only" },
  { v: "BB", l: "Bed & Breakfast" },
  { v: "HB", l: "Half Board" },
  { v: "FB", l: "Full Board" },
  { v: "AI", l: "All Inclusive" },
];
const STATUSES = ["Confirmed", "Cancelled"];

function parseNum(v) {
  if (v === "" || v === null || v === undefined) return 0;
  return parseFloat(String(v).replace(/,/g, "")) || 0;
}
function fmt(v) {
  return Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 1;
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  const diff = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 1;
}

export default function HotelsPage() {
  const { user, userData, hasPermission, activeBranch, myBranches, branchesList, appFeatures } = useAuth();
  const isAdmin = hasPermission ? hasPermission(["Admin"]) : userData?.role === "Admin";
  const canWrite = canWriteModule(userData, "hotels", isAdmin, appFeatures);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [hotels, setHotels] = useState([]);
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
  const listRef = useRef(null);

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

  const isEditing = mode === "add" || mode === "edit";

  const closedYearKeys = useClosedFiscalYearKeys();
  const closedYearKeysToken = useMemo(() => [...closedYearKeys].sort().join(","), [closedYearKeys]);

  useEffect(() => {
    const unsubH = onSnapshot(bookingQuery("hotels", { isAdmin, myBranches, restrictOwn: !!userData?.onlyOwnData, userUid: user?.uid }), (snap) => {
      let data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      data = data.filter((row) => isRecordVisible(row, { isAdmin, activeBranch, myBranches, restrictOwn: !!userData?.onlyOwnData, userName: userData?.name, userUid: user?.uid }));
      data = data.filter((row) => !isRowClosed(row, closedYearKeys, "issueDate"));
      data.sort((a, b) => {
        const ta = a.createdAt?.toDate?.() || a.createdAt || 0;
        const tb = b.createdAt?.toDate?.() || b.createdAt || 0;
        return new Date(ta) - new Date(tb); // oldest first, most recent record last
      });
      setHotels(data);
      setLoading(false);
    }, () => setLoading(false));

    const unsubC = onSnapshot(collection(db, "clients"), (snap) => {
      setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubCorp = onSnapshot(collection(db, "corporates"), (snap) => {
      setCorporates(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubS = onSnapshot(collection(db, "suppliers"), (snap) => {
      setSuppliers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubH(); unsubC(); unsubCorp(); unsubS(); };
  }, [isAdmin, activeBranch, JSON.stringify(myBranches), closedYearKeysToken]);

  const hydrateForm = useCallback((row) => {
    // Older bookings may have a single rooms/roomType/buyPrice/sellPrice
    // (pre room-lines), or a roomLines array grouped as "N rooms of one
    // type" (an earlier version of this feature), and any of those shapes
    // may predate per-room check-in/check-out/guests (which lived only at
    // the booking level back then). Expand into one row per physical room,
    // each carrying its own dates, nights and occupant names going forward.

    // Legacy flat guest list (booking-level) was tagged with a free-text
    // `roomNr` — group those by roomNr so they can be reattached to the
    // matching expanded room below. Guests with no matching room number
    // fall into the "" bucket and get distributed to rooms that end up
    // with no guests of their own.
    const legacyGuestsByRoomNr = {};
    (row.guests || []).forEach((g) => {
      const key = (g.roomNr || "").trim();
      (legacyGuestsByRoomNr[key] = legacyGuestsByRoomNr[key] || []).push({ name: g.name || "" });
    });
    const leftoverGuests = legacyGuestsByRoomNr[""] || [];
    let leftoverIdx = 0;

    const buildRoom = (base, roomNr) => {
      if (base.guests?.length) {
        return { ...EMPTY_ROOM, ...base, guests: base.guests.map((g) => ({ ...EMPTY_ROOM_GUEST, ...g })) };
      }
      const key = (roomNr || "").trim();
      let guests = key && legacyGuestsByRoomNr[key] ? legacyGuestsByRoomNr[key] : null;
      if (!guests && leftoverIdx < leftoverGuests.length) {
        guests = [leftoverGuests[leftoverIdx]];
        leftoverIdx += 1;
      }
      return {
        ...EMPTY_ROOM,
        ...base,
        checkIn: base.checkIn || row.checkIn || "",
        checkOut: base.checkOut || row.checkOut || "",
        nights: base.nights || row.nights || 1,
        guests: guests?.length ? guests.map((g) => ({ ...EMPTY_ROOM_GUEST, ...g })) : [{ ...EMPTY_ROOM_GUEST }],
      };
    };

    let roomLines;
    if (row.roomLines?.length) {
      roomLines = row.roomLines.flatMap((l) => {
        const count = Math.max(1, parseInt(l.rooms) || 1);
        return Array.from({ length: count }, () => buildRoom({
          roomType: l.roomType || "Standard",
          roomNr: l.roomNr || "",
          mealPlan: l.mealPlan || row.mealPlan || "BB",
          buyPrice: l.buyPrice !== undefined && l.buyPrice !== "" ? String(l.buyPrice) : "",
          sellPrice: l.sellPrice !== undefined && l.sellPrice !== "" ? String(l.sellPrice) : "",
          checkIn: l.checkIn || "",
          checkOut: l.checkOut || "",
          nights: l.nights || 0,
          guests: l.guests,
        }, l.roomNr));
      });
    } else {
      const count = Math.max(1, parseInt(row.rooms) || 1);
      roomLines = Array.from({ length: count }, () => buildRoom({
        roomType: row.roomType || "Standard",
        mealPlan: row.mealPlan || "BB",
        buyPrice: row.buyPrice !== undefined && row.buyPrice !== "" ? String(row.buyPrice) : "",
        sellPrice: row.sellPrice !== undefined && row.sellPrice !== "" ? String(row.sellPrice) : "",
      }, ""));
    }
    setForm({
      ...EMPTY_FORM,
      ...row,
      roomLines,
      buyPrice: row.buyPrice !== undefined && row.buyPrice !== "" ? String(row.buyPrice) : "",
      sellPrice: row.sellPrice !== undefined && row.sellPrice !== "" ? String(row.sellPrice) : "",
      serviceFee: row.serviceFee !== undefined && row.serviceFee !== "" ? String(row.serviceFee) : "",
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

  // The rate is only ever editable while the booking is still being
  // created. As soon as it exists in the database (mode === "edit"), it is
  // permanently read-only — this is what "locks" the rate to the booking.
  const rateLocked = mode === "edit";

  useEffect(() => {
    if (hotels.length && currentIndex < 0 && mode === "view" && activeTab === "list") {
      setCurrentIndex(0);
      setSelected(hotels[0]);
    }
  }, [hotels, currentIndex, mode, activeTab]);

  // Open specific booking from ?open= id (from Invoices → Unlock)
  useEffect(() => {
    const openId = searchParams?.get("open");
    if (!openId || hotels.length === 0) return;
    const found = hotels.find((h) => h.id === openId);
    if (found) {
      const idx = hotels.findIndex((h) => h.id === openId);
      setSelected(found);
      setCurrentIndex(idx >= 0 ? idx : 0);
      hydrateForm(found);
      setActiveTab("details");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [hotels, searchParams, hydrateForm]);

  const filtered = hotels.filter((h) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (h.clientName || "").toLowerCase().includes(s) ||
      (h.clientCode || "").toLowerCase().includes(s) ||
      (h.hotelName || "").toLowerCase().includes(s) ||
      (h.city || "").toLowerCase().includes(s) ||
      (h.confirmationNr || "").toLowerCase().includes(s) ||
      (h.invoiceNumber || "").toLowerCase().includes(s) ||
      (h.supplierName || "").toLowerCase().includes(s) ||
      (h.guests || []).some((g) => (g.name || "").toLowerCase().includes(s))
    );
  });

  const openDetails = (row, index) => {
    setSelected(row);
    setCurrentIndex(index);
    hydrateForm(row);
    setMode("view");
    setActiveTab("details");
  };

  const goFirst = () => { if (filtered.length) openDetails(filtered[0], 0); };
  const goPrev = () => { if (currentIndex > 0) openDetails(filtered[currentIndex - 1], currentIndex - 1); };
  const goNext = () => { if (currentIndex < filtered.length - 1) openDetails(filtered[currentIndex + 1], currentIndex + 1); };
  const goLast = () => { if (filtered.length) openDetails(filtered[filtered.length - 1], filtered.length - 1); };

  const startAdd = async () => {
    const salesmanCode = userData?.name?.split(" ").map((w) => w[0]).join("").toUpperCase() || "";
    const defaultBranch = activeBranch && activeBranch !== "ALL" ? activeBranch : (myBranches[0] || branchesList[0]?.code || "1");
    setMode("add");
    setSelected(null);
    setForm({
      ...EMPTY_FORM,
      branch: defaultBranch,
      salesman: salesmanCode,
      salesmanName: userData?.name || "",
      issueDate: new Date().toISOString().slice(0, 10),
      roomLines: [{ ...EMPTY_ROOM, guests: [{ ...EMPTY_ROOM_GUEST }] }],
    });
    setActiveTab("details");
    // Show a PREVIEW of the next Reg Nr immediately, without reserving it —
    // the real number is only assigned (and the sequence advanced) when the
    // booking is actually saved, so cancelling never leaves a gap.
    try {
      const regNr = await peekNextRegNumber("hotels", "H", defaultBranch);
      setForm((prev) => (prev.regNr ? prev : { ...prev, regNr }));
    } catch {}
  };

  // Refresh the Reg Nr preview when the branch changes while adding, since
  // Reg Nr sequences are scoped per branch (still just a preview — nothing
  // is reserved until save).
  const handleAddBranchChange = async (newBranch) => {
    setForm((prev) => ({ ...prev, branch: newBranch, regNr: "" }));
    try {
      const regNr = await peekNextRegNumber("hotels", "H", newBranch);
      setForm((prev) => (prev.branch === newBranch ? { ...prev, regNr } : prev));
    } catch {}
  };

  const startEdit = () => {
    if (!selected) return;
    if (selected.invoiceIssued && !isAdmin && !selected.editUnlocked) {
      toast.error("Locked — invoice already issued");
      return;
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

  // Room-line helpers — each line is one physical room, with its own type,
  // room number, meal plan, rate, check-in/check-out/nights, and its own
  // list of occupant names.
  const updateRoomLine = (idx, patch) => {
    const roomLines = [...(form.roomLines || [])];
    roomLines[idx] = { ...roomLines[idx], ...patch };
    setForm({ ...form, roomLines });
  };
  const updateRoomDates = (idx, field, value) => {
    const roomLines = [...(form.roomLines || [])];
    const room = { ...roomLines[idx], [field]: value };
    room.nights = nightsBetween(
      field === "checkIn" ? value : room.checkIn,
      field === "checkOut" ? value : room.checkOut
    );
    roomLines[idx] = room;
    setForm({ ...form, roomLines });
  };
  const addRoomLine = () => {
    const last = (form.roomLines || [])[form.roomLines.length - 1];
    setForm({
      ...form,
      roomLines: [
        ...(form.roomLines || []),
        { ...EMPTY_ROOM, checkIn: last?.checkIn || "", checkOut: last?.checkOut || "", nights: last?.nights || 1, guests: [{ ...EMPTY_ROOM_GUEST }] },
      ],
    });
  };
  const removeRoomLine = (idx) => {
    const roomLines = (form.roomLines || []).filter((_, i) => i !== idx);
    setForm({ ...form, roomLines: roomLines.length ? roomLines : [{ ...EMPTY_ROOM }] });
  };

  // Per-room guest (occupant) helpers.
  const addRoomGuest = (roomIdx) => {
    const roomLines = [...(form.roomLines || [])];
    const guests = [...(roomLines[roomIdx].guests || []), { ...EMPTY_ROOM_GUEST }];
    roomLines[roomIdx] = { ...roomLines[roomIdx], guests };
    setForm({ ...form, roomLines });
  };
  const removeRoomGuest = (roomIdx, guestIdx) => {
    const roomLines = [...(form.roomLines || [])];
    const guests = (roomLines[roomIdx].guests || []).filter((_, i) => i !== guestIdx);
    roomLines[roomIdx] = { ...roomLines[roomIdx], guests: guests.length ? guests : [{ ...EMPTY_ROOM_GUEST }] };
    setForm({ ...form, roomLines });
  };
  const updateRoomGuestName = (roomIdx, guestIdx, name) => {
    const roomLines = [...(form.roomLines || [])];
    const guests = [...(roomLines[roomIdx].guests || [])];
    guests[guestIdx] = { ...guests[guestIdx], name };
    roomLines[roomIdx] = { ...roomLines[roomIdx], guests };
    setForm({ ...form, roomLines });
  };

  // Buy/Sell Price on each room is entered as a rate PER NIGHT — the
  // room's amount is that rate multiplied by ITS OWN nights (each room can
  // have a different check-in/check-out from the others). Every room is
  // its own card with its own type, room number, meal plan, dates, rate
  // and occupants, so a booking with rooms on different date ranges is
  // priced correctly, and totals are the sum across all rooms.
  const roomLinesForCalc = (form.roomLines || []).length ? form.roomLines : [{ ...EMPTY_ROOM }];
  const roomNightsOf = (l) => Math.max(1, parseInt(l.nights) || nightsBetween(l.checkIn, l.checkOut) || 1);
  const totalRooms = roomLinesForCalc.length;
  const totalRoomNights = roomLinesForCalc.reduce((sum, l) => sum + roomNightsOf(l), 0);
  const totalPax = roomLinesForCalc.reduce((sum, l) => sum + Math.max(1, (l.guests || []).length), 0);
  const units = totalRoomNights;
  const totalBuyAmount = roomLinesForCalc.reduce(
    (sum, l) => sum + parseNum(l.buyPrice) * roomNightsOf(l), 0
  );
  const totalSellAmount = roomLinesForCalc.reduce(
    (sum, l) => sum + parseNum(l.sellPrice) * roomNightsOf(l), 0
  );
  const profit = totalSellAmount - totalBuyAmount;
  const roomCheckIns = roomLinesForCalc.map((l) => l.checkIn).filter(Boolean).sort();
  const roomCheckOuts = roomLinesForCalc.map((l) => l.checkOut).filter(Boolean).sort();
  const overallCheckIn = roomCheckIns[0] || form.checkIn || "";
  const overallCheckOut = roomCheckOuts[roomCheckOuts.length - 1] || form.checkOut || "";
  const overallNights = overallCheckIn && overallCheckOut
    ? nightsBetween(overallCheckIn, overallCheckOut)
    : Math.max(1, ...roomLinesForCalc.map(roomNightsOf));
  const foreignCurrency = form.sellCurrency !== "EGP" ? form.sellCurrency : form.buyCurrency !== "EGP" ? form.buyCurrency : null;
  const buyRate = parseNum(form.buyExchangeRate) || 1;
  const sellRate = parseNum(form.sellExchangeRate) || 1;
  const sellEGP = form.sellCurrency !== "EGP" ? totalSellAmount * sellRate : null;
  const buyEGP = form.buyCurrency !== "EGP" ? totalBuyAmount * buyRate : null;
  const profitEGP = (sellEGP ?? totalSellAmount) - (buyEGP ?? totalBuyAmount);

  const handleSave = async () => {
    try {
      if (!form.hotelName && !form.supplierName) {
        toast.error("Hotel / supplier name is required");
        return;
      }
      const cleanRoomLines = roomLinesForCalc.map((l) => {
        const nights = roomNightsOf(l);
        const guests = (l.guests || [])
          .filter((g) => (g.name || "").trim() !== "")
          .map((g) => ({ name: g.name.trim() }));
        return {
          roomType: l.roomType || "Standard",
          roomNr: l.roomNr || "",
          mealPlan: l.mealPlan || "BB",
          buyPrice: parseNum(l.buyPrice),
          sellPrice: parseNum(l.sellPrice),
          checkIn: l.checkIn || "",
          checkOut: l.checkOut || "",
          nights,
          guests,
        };
      });
      // `rooms`/`roomType`/`buyPrice`/`sellPrice`/`checkIn`/`checkOut`/
      // `nights`/`pax`/`adt`/`guests` stay on the document too — derived
      // summaries (total room count, "Single x1, Double x1", earliest
      // check-in / latest check-out across all rooms, total occupants, a
      // flattened name list, and a blended per-room-night rate) so other
      // screens that only read those top-level fields (dashboard, accounts,
      // list view, reports) still show something sane, even though each
      // room now carries its own dates and occupants as the source of truth.
      const roomTypeCounts = cleanRoomLines.reduce((acc, l) => {
        acc[l.roomType] = (acc[l.roomType] || 0) + 1;
        return acc;
      }, {});
      const flatGuests = cleanRoomLines.flatMap((r) => r.guests.map((g) => ({ ...g, roomNr: r.roomNr || "" })));
      const totalPaxVal = flatGuests.length || totalPax || 1;
      const payload = {
        ...form,
        adt: totalPaxVal,
        chd: 0,
        inf: 0,
        pax: totalPaxVal,
        roomLines: cleanRoomLines,
        rooms: cleanRoomLines.length,
        roomType: Object.entries(roomTypeCounts).map(([t, n]) => `${t} x${n}`).join(", "),
        mealPlan: cleanRoomLines[0]?.mealPlan || "BB",
        checkIn: overallCheckIn,
        checkOut: overallCheckOut,
        nights: overallNights,
        buyPrice: units ? totalBuyAmount / units : 0,
        sellPrice: units ? totalSellAmount / units : 0,
        serviceFee: parseNum(form.serviceFee),
        totalBuy: totalBuyAmount,
        totalSell: totalSellAmount,
        totalProfit: profit,
        guests: flatGuests,
        updatedAt: serverTimestamp(),
      };
      delete payload.id;
      // Exchange rates are fixed the moment a booking is first created and
      // must never be touched again on subsequent edits.
      if (mode === "edit" && selected) {
        payload.buyExchangeRate = selected.buyExchangeRate || selected.exchangeRate || 1;
        payload.sellExchangeRate = selected.sellExchangeRate || selected.exchangeRate || 1;
        payload.exchangeRate = selected.exchangeRate || 1;
        // An admin unlock is a one-time grant, not a permanent state — clear
        // it on save so the booking re-locks, same as Flights.
        payload.editUnlocked = false;
        payload.editUnlockedBy = null;
        payload.editUnlockedAt = null;
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
        payload.regNr = await generateRegNumber("hotels", "H", form.branch);
        const ref = await addDoc(collection(db, "hotels"), payload);
        toast.success("Hotel booking saved");
        setMode("view");
        setSelected({ id: ref.id, ...payload });
        setActiveTab("list");
      } else if (mode === "edit" && selected?.id) {
        await updateDoc(doc(db, "hotels", selected.id), payload);
        toast.success("Hotel booking updated");
        setMode("view");
        setSelected({ ...selected, ...payload });
        setActiveTab("list");
      }
    } catch (e) {
      console.error(e);
      toast.error("Save failed: " + (e.message || ""));
    }
  };

  const handleDelete = async () => {
    if (!selected?.id) return;
    if (selected.invoiceIssued) {
      toast.error("Cannot delete — invoice already issued");
      return;
    }
    if (!confirm("Delete this hotel booking?")) return;
    try {
      await deleteDoc(doc(db, "hotels", selected.id));
      toast.success("Deleted");
      setSelected(null);
      setCurrentIndex(-1);
      setForm(EMPTY_FORM);
      setActiveTab("list");
      setMode("view");
    } catch (e) {
      toast.error("Delete failed: " + (e.message || ""));
    }
  };

  const handlePrint = () => {
    if (!selected) return;
    const rooms = selected.roomLines || [];
    const roomsRows = rooms.length
      ? rooms.map((r) => `<tr><td>${r.roomType || ""}</td><td>${r.roomNr || ""}</td><td>${r.mealPlan || ""}</td><td>${r.checkIn || ""}</td><td>${r.checkOut || ""}</td><td>${r.nights || ""}</td></tr>`).join("")
      : `<tr><td colspan="6" style="text-align:center;color:#94a3b8">-</td></tr>`;
    const guests = rooms.flatMap((r) => (r.guests || []).map((g) => ({ ...g, roomNr: r.roomNr })));
    const guestRows = guests.length
      ? guests.map((g, i) => `<tr><td>${i + 1}</td><td>${g.name || ""}</td><td>${g.roomNr || ""}</td></tr>`).join("")
      : `<tr><td colspan="3" style="text-align:center;color:#94a3b8">-</td></tr>`;
    const body = `
      <h2>${selected.hotelName || "Hotel Booking"}</h2>
      <div class="sub">Reg Nr ${selected.regNr || "-"} ${selected.invoiceNumber ? "· Invoice " + selected.invoiceNumber : ""}</div>
      <div class="grid2">
        <div><span class="lbl">Client</span><br/>${selected.clientName || "-"}</div>
        <div><span class="lbl">Supplier</span><br/>${selected.supplierName || "-"}</div>
        <div><span class="lbl">City / Country</span><br/>${selected.city || "-"}${selected.country ? ", " + selected.country : ""}</div>
        <div><span class="lbl">Confirmation Nr</span><br/>${selected.confirmationNr || "-"}</div>
      </div>
      <table><thead><tr><th>Room Type</th><th>Room Nr</th><th>Meal</th><th>Check-In</th><th>Check-Out</th><th>Nights</th></tr></thead><tbody>${roomsRows}</tbody></table>
      <table><thead><tr><th>#</th><th>Guest Name</th><th>Room Nr</th></tr></thead><tbody>${guestRows}</tbody></table>
    `;
    openPrintWindow(`${selected.hotelName || "Hotel"} - ${selected.regNr || ""}`, body);
  };

  // Opens the invoice document screen instead of stamping a number straight
  // onto this one booking — from there the user can add the client's other
  // open hotels services onto the SAME invoice (see InvoiceIssueModal).
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);

  const handleIssueInvoice = () => {
    if (!selected?.id) return;
    if (selected.invoiceIssued) {
      toast.error("Invoice already issued: " + (selected.invoiceNumber || ""));
      return;
    }
    setInvoiceModalOpen(true);
  };

  const handleInvoiceIssued = (inv) => {
    setSelected((prev) =>
      prev ? { ...prev, invoiceIssued: true, invoiceNumber: inv.fullNumber } : prev
    );
    setForm((prev) => ({ ...prev, invoiceIssued: true, invoiceNumber: inv.fullNumber }));
  };

  // Clients and Corporates share the "Client" field across bookings
  // (Corporates use the 30.01.00.XXXX sub-range), so the picker searches
  // both together.
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
    return (s.code || "").toLowerCase().includes(q) || (s.name || "").toLowerCase().includes(q) || (s.symbol || "").toLowerCase().includes(q);
  });

  const inputCls = "w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500";
  const labelCls = "text-[10px] font-semibold text-slate-500 uppercase tracking-wide";

  // Section header dashboard — Sales / Cost / Profit / Bookings across
  // every hotel booking currently loaded.
  const sectionStats = useMemo(() => {
    let totalSell = 0, totalBuy = 0, totalProfit = 0;
    hotels.forEach((row) => {
      const t = getHotelTotals(row);
      totalSell += t.totalSell;
      totalBuy += t.totalBuy;
      totalProfit += t.totalProfit;
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
      { label: "Total Bookings", value: hotels.length.toLocaleString("en-US"), icon: Briefcase, color: "bg-indigo-500" },
    ];
  }, [hotels]);

  return (
    <div className="flex flex-col h-[calc(100vh-0px)]">
      <Navbar title={"Hotels" || "Hotels"} />
      <SectionStats stats={sectionStats} />

      <div className="bg-white border-b px-3 py-1.5 flex flex-wrap items-center gap-1.5 text-xs">
        <button onClick={goFirst} className="tb-btn" title="First"><ChevronFirst size={14} /></button>
        <button onClick={goPrev} className="tb-btn" title="Prior"><ChevronLeft size={14} /></button>
        <button onClick={goNext} className="tb-btn" title="Next"><ChevronRight size={14} /></button>
        <button onClick={goLast} className="tb-btn" title="Last"><ChevronLast size={14} /></button>
        <div className="w-px h-5 bg-slate-200 mx-1" />
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-6 pr-2 py-1 border border-slate-300 rounded text-xs w-40 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="w-px h-5 bg-slate-200 mx-1" />
        <button onClick={startAdd} disabled={!canWrite} className="tb-btn-blue" title={!canWrite ? "View only — you don't have write access to this page" : undefined}><Plus size={14} /> New</button>
        <button onClick={startEdit} disabled={!canWrite || !selected || isEditing} className="tb-btn" title={!canWrite ? "View only — you don't have write access to this page" : undefined}><Pencil size={14} /> Edit</button>
        <button onClick={handleDelete} disabled={!selected || isEditing || selected?.invoiceIssued || !isAdmin} className="tb-btn text-red-600" title={!isAdmin ? "Admin / General Manager only" : undefined}><Trash2 size={14} /> Delete</button>
        {isEditing && (
          <>
            <button onClick={handleSave} className="tb-btn-blue"><Save size={14} /> Save</button>
            <button onClick={cancelEdit} className="tb-btn"><X size={14} /> Cancel</button>
          </>
        )}
        <div className="ml-auto text-[11px] text-slate-500">
          {filtered.length ? `${Math.min(currentIndex + 1, filtered.length)} / ${filtered.length}` : "0 / 0"}
        </div>
        <div className="w-px h-5 bg-slate-200 mx-1" />
        <button onClick={cancelEdit} className="tb-btn" title="Exit — back to the list"><LogOut size={14} /> Exit</button>
      </div>

      {/* ACTION BAR */}
      {!isEditing && (
        <div className="bg-slate-50 border-b border-slate-200 px-3 py-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <AssignToFileButton type="hotels" row={selected} disabled={!selected} />
          {selected && (
            <button onClick={handlePrint} className="tb-btn" title="Print"><Printer size={14} /> Print</button>
          )}
          {selected && !selected.invoiceIssued && (
            <button onClick={handleIssueInvoice} className="tb-btn"><FileText size={14} /> Invoice</button>
          )}
        </div>
      )}

      <div className="bg-white border-b px-3 flex gap-0 text-xs">
        {["list", "details"].map((tab) => (
          <button
            key={tab}
            onClick={() => !isEditing && setActiveTab(tab)}
            className={`px-4 py-2 font-medium border-b-2 capitalize ${
              activeTab === tab || (isEditing && tab === "details")
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
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
            {activeTab === "list" && !isEditing && (
              <div className="p-2">
                <div ref={listRef} className="bg-white border border-slate-300 rounded overflow-auto" style={{ height: "calc(100vh - 200px)", minHeight: "260px" }}>
                  <table className="w-full text-[10px] border-collapse">
                    <thead className="bg-slate-100 sticky top-0 z-10">
                      <tr>
                        <th className="th border border-slate-300">Reg Nr</th>
                        <th className="th border border-slate-300">Invoice</th>
                        <th className="th border border-slate-300">Client</th>
                        <th className="th border border-slate-300">Hotel</th>
                        <th className="th border border-slate-300">City</th>
                        <th className="th border border-slate-300">Check-In</th>
                        <th className="th border border-slate-300">Check-Out</th>
                        <th className="th text-center border border-slate-300">Nights</th>
                        <th className="th text-center border border-slate-300">Rooms</th>
                        <th className="th text-center border border-slate-300">Pax</th>
                        <th className="th border border-slate-300">Room</th>
                        <th className="th border border-slate-300">Meal</th>
                        <th className="th text-right border border-slate-300">Buy</th>
                        <th className="th text-right border border-slate-300">Sell</th>
                        <th className="th text-right border border-slate-300">Profit</th>
                        <th className="th text-center border border-slate-300">Status</th>
                        <th className="th border border-slate-300">Supplier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={17} className="px-4 py-10 text-center text-gray-400">
                            No records. Click New to create.
                          </td>
                        </tr>
                      ) : (
                        filtered.map((h, idx) => {
                          const hTotals = getHotelTotals(h);
                          const buy = hTotals.totalBuy;
                          const sell = hTotals.totalSell;
                          const prof = hTotals.totalProfit;
                          const isCancelled = String(h.status || "").toLowerCase() === "cancelled";
                          const isSel = selected?.id === h.id;
                          return (
                            <tr
                              key={h.id}
                              onClick={() => openDetails(h, idx)}
                              onDoubleClick={() => openDetails(h, idx)}
                              title={isCancelled ? "CANCELLED — ignored in all totals and reports" : undefined}
                              className={`cursor-pointer border-b border-slate-200 hover:bg-blue-50 ${isCancelled ? "opacity-40 grayscale text-slate-400" : ""} ${isSel ? "bg-blue-100" : ""}`}
                            >
                              <td className="td border border-slate-200 font-mono text-center">{h.regNr || "-"}</td>
                              <td className="td border border-slate-200 font-mono">{h.invoiceNumber || "-"}</td>
                              <td className="td border border-slate-200">
                                <div className="font-medium">{h.clientName || "-"}</div>
                                <div className="text-[9px] text-slate-400">{h.clientCode}</div>
                              </td>
                              <td className="td border border-slate-200 font-medium">{h.hotelName || "-"}</td>
                              <td className="td border border-slate-200">{h.city || "-"}</td>
                              <td className="td border border-slate-200 whitespace-nowrap">{h.checkIn || "-"}</td>
                              <td className="td border border-slate-200 whitespace-nowrap">{h.checkOut || "-"}</td>
                              <td className="td border border-slate-200 text-center">{h.nights || "-"}</td>
                              <td className="td border border-slate-200 text-center">{h.rooms || 1}</td>
                              <td className="td border border-slate-200 text-center">
                                {(h.adt || 0) + (h.chd || 0) + (h.inf || 0) || h.pax || 1}
                              </td>
                              <td className="td border border-slate-200">{h.roomType || "-"}</td>
                              <td className="td border border-slate-200 text-center">{h.mealPlan || "-"}</td>
                              <td className="td border border-slate-200 text-right">{fmt(buy)}</td>
                              <td className="td border border-slate-200 text-right font-medium">{fmt(sell)}</td>
                              <td className={`td border border-slate-200 text-right font-medium ${prof >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {fmt(prof)}
                              </td>
                              <td className="td border border-slate-200 text-center">
                                <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                  String(h.status).toLowerCase() === "confirmed"
                                    ? "bg-green-50 text-green-700 border-green-200"
                                    : String(h.status).toLowerCase() === "pending"
                                      ? "bg-amber-50 text-amber-700 border-amber-200"
                                      : String(h.status).toLowerCase().includes("cancel")
                                        ? "bg-red-50 text-red-600 border-red-200"
                                        : "bg-slate-50 text-slate-600 border-slate-200"
                                }`}>
                                  {h.status || "-"}
                                </span>
                              </td>
                              <td className="td border border-slate-200">{h.supplierName || h.supplierCode || "-"}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {selected && (
                  <div className="bg-blue-50 border border-blue-200 rounded overflow-hidden flex flex-col mt-2" style={{ height: "20vh", minHeight: "140px" }}>
                    <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-blue-200 flex-1 overflow-auto">
                      {/* LEFT - rooms */}
                      <div className="overflow-auto">
                        <table className="w-full text-[11px] border-collapse bg-blue-50">
                          <thead>
                            <tr className="bg-blue-100 border-b border-blue-200">
                              <th className="th border-r border-blue-200">Room Type</th>
                              <th className="th border-r border-blue-200">Room Nr</th>
                              <th className="th border-r border-blue-200">Meal</th>
                              <th className="th border-r border-blue-200">Check-In</th>
                              <th className="th border-r border-blue-200">Check-Out</th>
                              <th className="th border-r border-blue-200">Nights</th>
                              <th className="th text-right">Sell</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(selected.roomLines || []).length === 0 ? (
                              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-[11px]">-</td></tr>
                            ) : (
                              selected.roomLines.map((r, idx) => (
                                <tr key={idx} className="border-t border-slate-200">
                                  <td className="td border-r border-slate-100">{r.roomType || ""}</td>
                                  <td className="td border-r border-slate-100">{r.roomNr || ""}</td>
                                  <td className="td border-r border-slate-100">{r.mealPlan || ""}</td>
                                  <td className="td border-r border-slate-100">{r.checkIn || ""}</td>
                                  <td className="td border-r border-slate-100">{r.checkOut || ""}</td>
                                  <td className="td border-r border-slate-100">{r.nights || ""}</td>
                                  <td className="td text-right">{r.sellPrice ? fmt(r.sellPrice) : ""}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                      {/* RIGHT - guests */}
                      <div className="overflow-auto">
                        <table className="w-full text-[11px] border-collapse bg-blue-50">
                          <thead>
                            <tr className="bg-blue-100 border-b border-blue-200">
                              <th className="th w-8 border-r border-blue-200 text-center"></th>
                              <th className="th border-r border-blue-200">Guest Name</th>
                              <th className="th text-center">Room Nr</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(selected.roomLines || []).flatMap((r) => (r.guests || []).map((g) => ({ ...g, roomNr: r.roomNr }))).length === 0 ? (
                              <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400 text-[11px]">-</td></tr>
                            ) : (
                              selected.roomLines.flatMap((r) => (r.guests || []).map((g) => ({ ...g, roomNr: r.roomNr }))).map((g, idx) => (
                                <tr key={idx} className="border-t border-slate-200">
                                  <td className="td text-center border-r border-slate-100 text-gray-600">{idx + 1}</td>
                                  <td className="td border-r border-slate-100">{g.name || ""}</td>
                                  <td className="td text-center">{g.roomNr || ""}</td>
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

            {(activeTab === "details" || isEditing) && (
              <div className="p-3 max-w-6xl mx-auto space-y-3">
                <div className="bg-white border border-slate-300 rounded p-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  <div>
                    <div className={labelCls}>Issue Date</div>
                    <input type="date" disabled={!isEditing} value={form.issueDate || ""} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <div className={labelCls}>Status</div>
                    <select disabled={!isEditing} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className={labelCls}>Invoice No</div>
                    <input disabled value={form.invoiceNumber || ""} className={inputCls + " bg-slate-50"} placeholder="—" />
                  </div>
                  <div>
                    <div className={labelCls}>Reg Nr</div>
                    <input disabled value={form.regNr || ""} className={inputCls + " bg-slate-50"} placeholder="—" />
                  </div>
                  <div>
                    <div className={labelCls}>Confirmation Nr</div>
                    <input disabled={!isEditing} value={form.confirmationNr || ""} onChange={(e) => setForm({ ...form, confirmationNr: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <div className={labelCls}>Voucher Nr</div>
                    <input disabled={!isEditing} value={form.voucherNr || ""} onChange={(e) => setForm({ ...form, voucherNr: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <div className={labelCls}>Salesman</div>
                    <input disabled={!isEditing} value={form.salesmanName || form.salesman || ""} onChange={(e) => setForm({ ...form, salesmanName: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <div className={labelCls}>Branch</div>
                    {mode === "add" && (isAdmin ? branchesList : branchesList.filter((b) => myBranches.includes(b.code))).length > 1 ? (
                      <select value={form.branch} onChange={(e) => handleAddBranchChange(e.target.value)} className={inputCls}>
                        {(isAdmin ? branchesList : branchesList.filter((b) => myBranches.includes(b.code))).map((b) => (
                          <option key={b.code} value={b.code}>{b.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input disabled value={branchesList.find((b) => b.code === form.branch)?.name || form.branch || ""} className={inputCls + " bg-slate-50"} />
                    )}
                  </div>
                </div>

                <div className="bg-white border border-slate-300 rounded p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <div className={labelCls}>Client Code</div>
                    <input disabled={!isEditing} value={form.clientCode || ""} onChange={(e) => setForm({ ...form, clientCode: e.target.value })} className={inputCls} />
                    <div className={labelCls}>Client Name (F5)</div>
                    <input
                      disabled={!isEditing}
                      value={form.clientName || ""}
                      onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "F5") { e.preventDefault(); setShowClientPicker(true); } }}
                      onDoubleClick={() => isEditing && setShowClientPicker(true)}
                      placeholder="Press F5 to select"
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className={labelCls}>Supplier Code</div>
                    <input disabled={!isEditing} value={form.supplierCode || ""} onChange={(e) => setForm({ ...form, supplierCode: e.target.value })} className={inputCls} />
                    <div className={labelCls}>Supplier Name (F5)</div>
                    <input
                      disabled={!isEditing}
                      value={form.supplierName || ""}
                      onChange={(e) => setForm({ ...form, supplierName: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "F5") { e.preventDefault(); setShowSupplierPicker(true); } }}
                      onDoubleClick={() => isEditing && setShowSupplierPicker(true)}
                      placeholder="Press F5 to select"
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className={labelCls}>Hotel Name</div>
                    <input disabled={!isEditing} value={form.hotelName || ""} onChange={(e) => setForm({ ...form, hotelName: e.target.value })} className={inputCls} />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className={labelCls}>City</div>
                        <input disabled={!isEditing} value={form.city || ""} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputCls} />
                      </div>
                      <div>
                        <div className={labelCls}>Country</div>
                        <input disabled={!isEditing} value={form.country || ""} onChange={(e) => setForm({ ...form, country: e.target.value })} className={inputCls} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-slate-300 rounded p-3 grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div>
                    <div className={labelCls}>Check-In (earliest)</div>
                    <input disabled value={overallCheckIn || "-"} className={inputCls + " bg-slate-50"} />
                  </div>
                  <div>
                    <div className={labelCls}>Check-Out (latest)</div>
                    <input disabled value={overallCheckOut || "-"} className={inputCls + " bg-slate-50"} />
                  </div>
                  <div>
                    <div className={labelCls}>Nights (span)</div>
                    <input disabled value={overallNights} className={inputCls + " bg-slate-50"} />
                  </div>
                  <div>
                    <div className={labelCls}>Rooms</div>
                    <input disabled value={totalRooms} className={inputCls + " bg-slate-50"} />
                  </div>
                  <div>
                    <div className={labelCls}>Total Pax</div>
                    <input disabled value={totalPax} className={inputCls + " bg-slate-50"} />
                  </div>
                  <div className="col-span-2 md:col-span-5 text-[10px] text-slate-400">
                    Set each room's own check-in/check-out and occupants below.
                  </div>
                </div>

                <div className="bg-white border border-slate-300 rounded overflow-hidden">
                  <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-600 flex items-center justify-between">
                    <span>Rooms ({totalRooms} room{totalRooms === 1 ? "" : "s"}, {totalPax} pax total)</span>
                    {isEditing && (
                      <button type="button" onClick={addRoomLine} className="tb-btn-blue px-1.5">
                        <Plus size={12} /> Add Room
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-slate-200">
                    {roomLinesForCalc.map((line, idx) => {
                      const lineNights = roomNightsOf(line);
                      const lineBuy = parseNum(line.buyPrice) * lineNights;
                      const lineSell = parseNum(line.sellPrice) * lineNights;
                      return (
                        <div key={idx} className="p-2.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-slate-500">Room {idx + 1}</span>
                            {isEditing && (
                              <button
                                type="button"
                                disabled={roomLinesForCalc.length <= 1}
                                onClick={() => removeRoomLine(idx)}
                                title="Remove Room"
                                className="tb-btn px-1 text-red-600"
                              >
                                <Trash2 size={12} /> Remove Room
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                            <div>
                              <div className={labelCls}>Room Type</div>
                              <select
                                disabled={!isEditing}
                                value={line.roomType || "Standard"}
                                onChange={(e) => updateRoomLine(idx, { roomType: e.target.value })}
                                className={inputCls}
                              >
                                {ROOM_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                              </select>
                            </div>
                            <div>
                              <div className={labelCls}>Room Nr</div>
                              <input
                                disabled={!isEditing}
                                value={line.roomNr || ""}
                                onChange={(e) => updateRoomLine(idx, { roomNr: e.target.value })}
                                className={inputCls}
                              />
                            </div>
                            <div>
                              <div className={labelCls}>Meal Plan</div>
                              <select
                                disabled={!isEditing}
                                value={line.mealPlan || "BB"}
                                onChange={(e) => updateRoomLine(idx, { mealPlan: e.target.value })}
                                className={inputCls}
                              >
                                {MEAL_PLANS.map((m) => <option key={m.v} value={m.v}>{m.v}</option>)}
                              </select>
                            </div>
                            <div>
                              <div className={labelCls}>Buy/Night</div>
                              <input
                                disabled={!isEditing}
                                value={line.buyPrice}
                                onChange={(e) => updateRoomLine(idx, { buyPrice: e.target.value })}
                                className={inputCls + " text-right"}
                              />
                            </div>
                            <div>
                              <div className={labelCls}>Sell/Night</div>
                              <input
                                disabled={!isEditing}
                                value={line.sellPrice}
                                onChange={(e) => updateRoomLine(idx, { sellPrice: e.target.value })}
                                className={inputCls + " text-right"}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                            <div>
                              <div className={labelCls}>Check-In</div>
                              <input
                                type="date"
                                disabled={!isEditing}
                                value={line.checkIn || ""}
                                onChange={(e) => updateRoomDates(idx, "checkIn", e.target.value)}
                                className={inputCls}
                              />
                            </div>
                            <div>
                              <div className={labelCls}>Check-Out</div>
                              <input
                                type="date"
                                disabled={!isEditing}
                                value={line.checkOut || ""}
                                onChange={(e) => updateRoomDates(idx, "checkOut", e.target.value)}
                                className={inputCls}
                              />
                            </div>
                            <div>
                              <div className={labelCls}>Nights</div>
                              <input disabled value={lineNights} className={inputCls + " bg-slate-50"} />
                            </div>
                            <div>
                              <div className={labelCls}>Buy Total</div>
                              <input disabled value={fmt(lineBuy)} className={inputCls + " text-right bg-slate-50"} />
                            </div>
                            <div>
                              <div className={labelCls}>Sell Total</div>
                              <input disabled value={fmt(lineSell)} className={inputCls + " text-right bg-slate-50"} />
                            </div>
                          </div>

                          <div className="border border-slate-200 rounded overflow-hidden">
                            <div className="bg-slate-50 border-b border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wide flex items-center justify-between">
                              <span>Guests ({(line.guests || []).length})</span>
                              {isEditing && (
                                <button type="button" onClick={() => addRoomGuest(idx)} className="tb-btn px-1">
                                  <Plus size={11} /> Add Guest
                                </button>
                              )}
                            </div>
                            <div className="p-2 space-y-1">
                              {(line.guests || []).map((g, gIdx) => (
                                <div key={gIdx} className="flex items-center gap-1">
                                  <span className="text-[10px] text-gray-400 w-4 text-center">{gIdx + 1}</span>
                                  <input
                                    disabled={!isEditing}
                                    value={g.name || ""}
                                    onChange={(e) => updateRoomGuestName(idx, gIdx, e.target.value)}
                                    className={inputCls}
                                    placeholder="LAST/FIRST"
                                  />
                                  {isEditing && (
                                    <button
                                      type="button"
                                      disabled={(line.guests || []).length <= 1}
                                      onClick={() => removeRoomGuest(idx, gIdx)}
                                      title="Remove Guest"
                                      className="tb-btn px-1 text-red-600"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-white border border-slate-300 rounded p-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  <div>
                    <div className={labelCls}>Buy Currency</div>
                    <select disabled={!isEditing} value={form.buyCurrency || "EGP"} onChange={(e) => setForm({ ...form, buyCurrency: e.target.value, currency: e.target.value })} className={inputCls}>
                      <option value="EGP">EGP</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                  <div>
                    <div className={labelCls}>Sell Currency</div>
                    <select disabled={!isEditing} value={form.sellCurrency || "EGP"} onChange={(e) => setForm({ ...form, sellCurrency: e.target.value })} className={inputCls}>
                      <option value="EGP">EGP</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                  <div>
                    <div className={labelCls}>Buy Amount ({totalRoomNights} room-nights)</div>
                    <input disabled value={fmt(totalBuyAmount)} className={inputCls + " text-right bg-slate-50"} />
                  </div>
                  <div>
                    <div className={labelCls}>Sell Amount ({totalRoomNights} room-nights)</div>
                    <input disabled value={fmt(totalSellAmount)} className={inputCls + " text-right bg-slate-50"} />
                  </div>
                  <div>
                    <div className={labelCls}>Net Profit</div>
                    <input disabled value={fmt(profit)} className={inputCls + ` text-right font-semibold ${profit >= 0 ? "text-emerald-600" : "text-red-600"} bg-slate-50`} />
                  </div>
                  {form.buyCurrency !== "EGP" && (
                    <div>
                      <div className={labelCls}>Buy Rate ({form.buyCurrency}→EGP)</div>
                      <div className={inputCls + " text-right bg-slate-50 flex items-center justify-end gap-2"}>
                        {fetchingBuyRate && mode === "add" ? (
                          <>
                            <RefreshCw size={13} className="animate-spin text-slate-400" />
                            <span className="text-slate-400">fetching…</span>
                          </>
                        ) : (
                          <span>{fmt(form.buyExchangeRate)}</span>
                        )}
                      </div>
                    </div>
                  )}
                  {form.sellCurrency !== "EGP" && (
                    <div>
                      <div className={labelCls}>Sell Rate ({form.sellCurrency}→EGP)</div>
                      <div className={inputCls + " text-right bg-slate-50 flex items-center justify-end gap-2"}>
                        {fetchingSellRate && mode === "add" ? (
                          <>
                            <RefreshCw size={13} className="animate-spin text-slate-400" />
                            <span className="text-slate-400">fetching…</span>
                          </>
                        ) : (
                          <span>{fmt(form.sellExchangeRate)}</span>
                        )}
                      </div>
                    </div>
                  )}
                  {foreignCurrency && (
                    <div className="col-span-2">
                      <div className={labelCls}>EGP Equivalent</div>
                      <div className="text-xs text-slate-600 flex flex-col justify-center h-[38px] leading-tight">
                        {buyEGP !== null && <span>Buy ≈ {fmt(buyEGP)} EGP</span>}
                        {sellEGP !== null && <span>Sell ≈ {fmt(sellEGP)} EGP</span>}
                        <span className={profitEGP >= 0 ? "text-emerald-700 font-semibold" : "text-red-600 font-semibold"}>
                          Profit ≈ {fmt(profitEGP)} EGP
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="col-span-2 md:col-span-4 lg:col-span-6">
                    <div className={labelCls}>Remarks</div>
                    <input disabled={!isEditing} value={form.remarks || ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className={inputCls} />
                  </div>
                </div>

                <div className="bg-slate-100 border border-slate-300 rounded px-3 py-2 text-[11px] flex flex-wrap gap-4">
                  <span>Nights: <b>{overallNights}</b></span>
                  <span>Rooms: <b>{totalRooms}</b></span>
                  <span>Pax: <b>{totalPax}</b></span>
                  <span>Buy: <b>{fmt(totalBuyAmount)} {form.buyCurrency}</b></span>
                  <span>Sell: <b>{fmt(totalSellAmount)} {form.sellCurrency}</b></span>
                  <span className={profit >= 0 ? "text-emerald-700" : "text-red-600"}>
                    Profit: <b>{fmt(profit)}</b>
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showClientPicker && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-modal-backdrop" onClick={() => setShowClientPicker(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[70vh] flex flex-col animate-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-2 border-b font-semibold text-sm">Select Client</div>
            <div className="p-2">
              <input autoFocus value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder="Search code or name..." className={inputCls} />
            </div>
            <div className="overflow-auto flex-1">
              {filteredClients.map((c) => (
                <button
                  key={c.id}
                  className="w-full text-left px-4 py-2 text-xs hover:bg-blue-50 border-b border-slate-100"
                  onClick={() => {
                    setForm({ ...form, clientCode: c.code || "", clientName: c.name || "" });
                    setShowClientPicker(false);
                    setClientSearch("");
                  }}
                >
                  <span className="font-mono text-slate-500 mr-2">{c.code}</span>
                  {c.kind === "corporate" && <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 mr-1.5">Corp</span>}
                  {c.name}
                </button>
              ))}
            </div>
            <div className="p-2 border-t text-right">
              <button onClick={() => setShowClientPicker(false)} className="tb-btn">Close</button>
            </div>
          </div>
        </div>
      )}

      {showSupplierPicker && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-modal-backdrop" onClick={() => setShowSupplierPicker(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[70vh] flex flex-col animate-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-2 border-b font-semibold text-sm">Select Supplier</div>
            <div className="p-2">
              <input autoFocus value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} placeholder="Search code or name..." className={inputCls} />
            </div>
            <div className="overflow-auto flex-1">
              {filteredSuppliers.map((s) => (
                <button
                  key={s.id}
                  className="w-full text-left px-4 py-2 text-xs hover:bg-blue-50 border-b border-slate-100"
                  onClick={() => {
                    setForm({
                      ...form,
                      supplierCode: s.code || "",
                      supplierName: s.name || "",
                      hotelName: form.hotelName || s.name || "",
                    });
                    setShowSupplierPicker(false);
                    setSupplierSearch("");
                  }}
                >
                  <span className="font-mono text-slate-500 mr-2">{s.code}</span>
                  {s.name} {s.symbol ? `(${s.symbol})` : ""}
                </button>
              ))}
            </div>
            <div className="p-2 border-t text-right">
              <button onClick={() => setShowSupplierPicker(false)} className="tb-btn">Close</button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .tb-btn {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 4px 10px; border: 1px solid #cbd5e1; border-radius: 6px;
          background: #fff; font-size: 12px; cursor: pointer;
        }
        .tb-btn:hover:not(:disabled) { background: #f1f5f9; }
        .tb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .tb-btn-blue {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 4px 10px; border-radius: 6px;
          background: #2563eb; color: #fff; font-size: 12px; border: none; cursor: pointer;
        }
        .tb-btn-blue:hover { background: #1d4ed8; }
        .th { padding: 6px 8px; font-weight: 600; text-align: left; white-space: nowrap; }
        .td { padding: 5px 8px; }
      `}</style>

      <InvoiceIssueModal
        open={invoiceModalOpen}
        section="hotels"
        record={selected}
        onClose={() => setInvoiceModalOpen(false)}
        onIssued={handleInvoiceIssued}
      />
    </div>
  );
}
