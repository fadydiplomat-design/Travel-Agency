"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import SectionStats from "@/components/SectionStats";
import { useAuth, ADMIN_LEVEL_ROLES } from "@/lib/auth";
import {
  collection,
  getDocs,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { generateCode } from "@/lib/helpers";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import { Plus, ArrowLeft, Pencil, Trash2, Search, Plane, Download, Upload, Store, CheckCircle, Building2 } from "lucide-react";

/* ── Airline codes used only to generate the downloadable Excel template —
   the actual import now reads whatever file the user prepares and uploads. ── */
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
  "534": { carrier: "SM", name: "Air Cairo", gds: "1A" },
  "856": { carrier: "NE", name: "Nesma Airlines", gds: "1A" },
  "570": { carrier: "E5", name: "Air Arabia Egypt", gds: "1A" },
  "745": { carrier: "W9", name: "Wizz Air UK", gds: "1A" },
  "378": { carrier: "9P", name: "Flynas", gds: "1A" },
};

const EMPTY_FORM = {
  code: "",
  name: "",
  symbol: "",
  category: "Airline",
  country: "",
  city: "",
  phone: "",
  email: "",
  contactPerson: "",
  currency: "EGP",
  paymentMethod: "Cash",
  notes: "",
  status: "Active",
};

const CATEGORIES = ["Airline", "Hotel", "Transport", "Visa", "General"];
const CURRENCIES = ["EGP", "USD", "EUR"];
const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Credit"];
const STATUSES = ["Active", "Inactive"];

export default function SuppliersSection({ canWrite = true }) {
  const { userData } = useAuth();
  const isAdmin = ADMIN_LEVEL_ROLES.includes(userData?.role);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const importFileRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "suppliers"),
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.code || "").localeCompare(b.code || ""));
        setSuppliers(data);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        toast.error("Failed to load suppliers");
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const openAdd = () => {
    if (!canWrite) return;
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const openEdit = (row) => {
    if (!canWrite) return;
    setEditing(row);
    setForm({
      code: row.code || "",
      name: row.name || "",
      symbol: (row.symbol || "").toUpperCase(),
      category: row.category || "Airline",
      country: row.country || "",
      city: row.city || "",
      phone: row.phone || "",
      email: row.email || "",
      contactPerson: row.contactPerson || "",
      currency: row.currency || "EGP",
      paymentMethod: row.paymentMethod || "Cash",
      notes: row.notes || "",
      status: row.status || "Active",
    });
    setShowModal(true);
  };

  const validate = () => {
    if (!form.name.trim()) {
      toast.error("Supplier name is required");
      return false;
    }
    // supplier code validation - only when editing (code is editable)
    if (editing) {
      const codeVal = (form.code || "").trim();
      if (!codeVal) {
        toast.error("Supplier code is required");
        return false;
      }
      if (!/^50\.00\.00\.\d{4}$/.test(codeVal)) {
        toast.error("Supplier code must be in format 50.00.00.XXXX (e.g. 50.00.00.0001)");
        return false;
      }
      const duplicateCode = suppliers.find((s) => (s.code || "").trim() === codeVal && s.id !== editing?.id);
      if (duplicateCode) {
        toast.error(`Code "${codeVal}" already exists for ${duplicateCode.name} (${duplicateCode.symbol || ""})`);
        return false;
      }
    }
    const sym = form.symbol.trim().toUpperCase();
    const isAirline = form.category === "Airline";
    if (isAirline && !sym) {
      toast.error("Symbol is required for airline suppliers");
      return false;
    }
    if (sym && (sym.length < 2 || sym.length > 5)) {
      toast.error("Symbol must be 2-5 characters");
      return false;
    }
    if (sym && !/^[A-Z0-9]+$/.test(sym)) {
      toast.error("Symbol must be uppercase letters/numbers only");
      return false;
    }
    if (!form.category) {
      toast.error("Category is required");
      return false;
    }
    // unique check locally
    const duplicate = sym
      ? suppliers.find((s) => (s.symbol || "").toUpperCase() === sym && s.id !== editing?.id)
      : null;
    if (duplicate) {
      toast.error(`Symbol "${sym}" already exists for ${duplicate.name} (${duplicate.code})`);
      return false;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      toast.error("Invalid email format");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        symbol: form.symbol.trim().toUpperCase(),
        category: form.category,
        country: form.country.trim(),
        city: form.city.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        contactPerson: form.contactPerson.trim(),
        currency: form.currency,
        paymentMethod: form.paymentMethod,
        notes: form.notes.trim(),
        status: form.status,
        updatedAt: serverTimestamp(),
      };

      if (editing) {
        const editPayload = { ...payload, code: (form.code || "").trim() };
        await updateDoc(doc(db, "suppliers", editing.id), editPayload);
        toast.success(`Supplier updated • ${editPayload.code} • ${editPayload.symbol}`);
      } else {
        const code = await generateCode("suppliers");
        await addDoc(collection(db, "suppliers"), {
          ...payload,
          code,
          status: payload.status || "Active",
          createdAt: serverTimestamp(),
        });
        toast.success(`Supplier added • ${code} • ${payload.symbol}`);
      }
      setShowModal(false);
      setEditing(null);
      setForm({ ...EMPTY_FORM });
      // onSnapshot auto-updates
    } catch (error) {
      console.error(error);
      toast.error("Operation failed: " + (error.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!canWrite) return;
    if (!confirm(`${"Are you sure you want to delete this item?" || "Are you sure?"} \n${row.code} - ${row.name} (${row.symbol || ""})`)) return;
    try {
      await deleteDoc(doc(db, "suppliers", row.id));
      toast.success("Supplier deleted");
    } catch (error) {
      console.error(error);
      toast.error("Delete failed");
    }
  };

  // Reads the admin's own prepared Excel file and imports each row as an
  // Airline supplier (50.00.00.XXXX). Expected columns (header names are
  // matched flexibly, case-insensitive): Prefix (the 3-digit ticket
  // prefix), Symbol (carrier code, e.g. MS), Name (airline name), and
  // optionally GDS. Any row missing Prefix or Symbol is skipped.
  const handleImportAirlinesFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;

    setSeeding(true);
    try {
      const buf = await file.arrayBuffer();
      const workbook = XLSX.read(buf, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (!rows.length) {
        toast.error("The file has no rows");
        return;
      }

      const pick = (row, ...keys) => {
        for (const k of keys) {
          const foundKey = Object.keys(row).find((rk) => rk.trim().toLowerCase() === k);
          if (foundKey && String(row[foundKey]).trim()) return String(row[foundKey]).trim();
        }
        return "";
      };

      const snapshot = await getDocs(collection(db, "suppliers"));
      const existing = snapshot.docs.map((d) => d.data());
      const existingCodes = new Set(existing.map((s) => (s.code || "").trim()));
      const existingSymbols = new Set(
        existing.filter((s) => (s.category || "Airline") === "Airline").map((s) => (s.symbol || "").toUpperCase().trim()).filter(Boolean)
      );

      let added = 0;
      let skipped = 0;
      let invalid = 0;

      for (const row of rows) {
        const prefix = pick(row, "prefix", "code", "ticket prefix");
        const symbol = pick(row, "symbol", "carrier", "iata").toUpperCase();
        const name = pick(row, "name", "airline", "airline name") || symbol;
        const gds = pick(row, "gds");

        if (!prefix || !symbol) {
          invalid++;
          continue;
        }

        const paddedCode = prefix.padStart(4, "0");
        const fullCode = `50.00.00.${paddedCode}`;
        const codeExists = existingCodes.has(fullCode);
        const symbolExists = existingSymbols.has(symbol);
        if (codeExists || symbolExists) {
          skipped++;
          continue;
        }

        await addDoc(collection(db, "suppliers"), {
          code: fullCode,
          symbol,
          name,
          category: "Airline",
          country: "",
          city: "",
          phone: "",
          email: "",
          contactPerson: "",
          currency: "EGP",
          paymentMethod: "Bank Transfer",
          notes: gds ? `Airline ticketing - GDS: ${gds} - Prefix: ${prefix}` : `Airline ticketing - Prefix: ${prefix}`,
          status: "Active",
          gds,
          ticketPrefix: prefix,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        existingCodes.add(fullCode);
        existingSymbols.add(symbol);
        added++;
      }

      const parts = [`Added ${added}`];
      if (skipped) parts.push(`skipped ${skipped} existing`);
      if (invalid) parts.push(`${invalid} rows missing Prefix/Symbol`);
      toast.success(parts.join(", "));
    } catch (error) {
      console.error(error);
      toast.error("Import failed: " + (error.message || ""));
    } finally {
      setSeeding(false);
    }
  };

  // Optional starter file so whoever prepares the real import knows the
  // expected column names — pre-filled with the airlines this project used
  // to ship with, purely as an example.
  const handleDownloadTemplate = () => {
    const rows = Object.entries(AIRLINE_CODES).map(([prefix, info]) => ({
      Prefix: prefix,
      Symbol: info.carrier,
      Name: info.name,
      GDS: info.gds || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Airlines");
    XLSX.writeFile(wb, "airlines-import-template.xlsx");
  };

  const handleMigrateCodes = async () => {
    const toMigrate = suppliers.filter((s) => (s.code || "").startsWith("70.00.00."));
    if (toMigrate.length === 0) {
      toast.success("No suppliers with 70.00.00. prefix found");
      return;
    }
    if (!confirm(`Convert ${toMigrate.length} suppliers from 70.00.00.XXXX to 50.00.00.XXXX. Continue?`)) return;
    setMigrating(true);
    try {
      const existing50Codes = new Set(suppliers.filter((s) => (s.code || "").startsWith("50.00.00.")).map((s) => (s.code || "").trim()));
      let migrated = 0;
      let skipped = 0;
      for (const sup of toMigrate) {
        const suffix = (sup.code || "").split(".").pop();
        const newCode = `50.00.00.${suffix}`;
        if (existing50Codes.has(newCode)) {
          skipped++;
          continue;
        }
        await updateDoc(doc(db, "suppliers", sup.id), { code: newCode, updatedAt: serverTimestamp() });
        existing50Codes.add(newCode);
        migrated++;
      }
      toast.success(`Converted ${migrated} to 50.00.00.XXXX${skipped ? `, skipped ${skipped} due to code conflict` : ""}`);
    } catch (error) {
      console.error(error);
      toast.error("Migration failed: " + (error.message || ""));
    } finally {
      setMigrating(false);
    }
  };

  const legacyCount = suppliers.filter((s) => (s.code || "").startsWith("70.00.00.")).length;

  const filtered = suppliers.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (s.code || "").toLowerCase().includes(q) ||
      (s.symbol || "").toLowerCase().includes(q) ||
      (s.name || "").toLowerCase().includes(q) ||
      (s.category || "").toLowerCase().includes(q) ||
      (s.city || "").toLowerCase().includes(q) ||
      (s.country || "").toLowerCase().includes(q)
    );
  });

  // Section header dashboard — Total / Active / Airlines counts across
  // every supplier currently loaded.
  const sectionStats = useMemo(() => {
    const total = suppliers.length;
    const active = suppliers.filter((s) => (s.status || "Active") === "Active").length;
    const airlines = suppliers.filter((s) => (s.category || "Airline") === "Airline").length;
    return [
      { label: "Total Suppliers", value: total.toLocaleString("en-US"), icon: Store, color: "bg-indigo-500" },
      { label: "Active", value: active.toLocaleString("en-US"), icon: CheckCircle, color: "bg-emerald-600" },
      { label: "Airlines", value: airlines.toLocaleString("en-US"), icon: Plane, color: "bg-orange-500" },
      { label: "Other Categories", value: (total - airlines).toLocaleString("en-US"), icon: Building2, color: "bg-purple-500" },
    ];
  }, [suppliers]);

  if (showModal && canWrite) {
    return (
      <div>
        <div className="px-6 pt-4 pb-3 flex items-center gap-3 border-b border-gray-200">
          <button
            onClick={() => setShowModal(false)}
            className="p-2 -ml-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
            title="Back to list"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h3 className="font-semibold text-lg">{editing ? "Edit Supplier" : "Add Supplier"}</h3>
            {editing && <p className="text-xs font-mono text-gray-500">{editing.code}</p>}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 max-w-3xl space-y-4">
          {/* Code editable when editing, hint when adding */}
          {editing ? (
            <div>
              <label className="block text-sm font-medium mb-1">Supplier Code <span className="text-red-500">*</span></label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="50.00.00.0001"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
              />
              <p className="text-[11px] text-gray-400 mt-1">Format: 50.00.00.XXXX - must be unique</p>
            </div>
          ) : (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700">
              Code will be auto-generated as <span className="font-mono font-bold">50.00.00.XXXX</span> on save
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium mb-1">
                Supplier Name <span className="text-red-500">*</span>
              </label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. EgyptAir"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Symbol {form.category === "Airline" && <span className="text-red-500">*</span>}
              </label>
              <input
                required={form.category === "Airline"}
                value={form.symbol}
                onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                placeholder="MS"
                maxLength={5}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono font-bold text-blue-700 uppercase placeholder:font-normal placeholder:text-gray-400"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                {form.category === "Airline"
                  ? "Required for airlines. 2-5 chars, A-Z0-9, uppercase auto. Shown in Flights Ticket column."
                  : "Optional. 2-5 chars, A-Z0-9, uppercase auto."}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Category <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Country</label>
              <input
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                placeholder="Egypt"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">City</label>
              <input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                placeholder="Cairo"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+20 ..."
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="supplier@example.com"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Contact Person</label>
              <input
                value={form.contactPerson}
                onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                placeholder="John Doe"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Currency</label>
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Payment Method</label>
              <select
                value={form.paymentMethod}
                onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                {PAYMENT_METHODS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder="Optional notes..."
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      <SectionStats stats={sectionStats} />

      <div className="p-6">
        {/* Header: search + add */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <p className="text-sm text-gray-500">
              {suppliers.length} {"Suppliers"?.toLowerCase() || "suppliers"}
              {search && ` • ${filtered.length} filtered`}
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code / symbol / name / category..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
              />
            </div>
            {isAdmin && legacyCount > 0 && (
              <button
                onClick={handleMigrateCodes}
                disabled={migrating}
                className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap disabled:opacity-50"
                title="Convert all 70.00.00.XXXX to 50.00.00.XXXX"
              >
                <Download size={18} />
                {migrating ? "Converting..." : `Convert 70 to 50 (${legacyCount})`}
              </button>
            )}
            {isAdmin && (
              <button
                onClick={handleDownloadTemplate}
                className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap"
                title="Download an .xlsx template with the expected columns (Prefix, Symbol, Name, GDS)"
              >
                <Download size={18} />
                Template
              </button>
            )}
            {canWrite && (
              <>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleImportAirlinesFile}
                />
                <button
                  onClick={() => importFileRef.current?.click()}
                  disabled={seeding}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap disabled:opacity-50"
                  title="Import airlines from an .xlsx file — columns: Prefix, Symbol, Name, GDS"
                >
                  <Upload size={18} />
                  {seeding ? "Importing..." : "Import Airlines (Excel)"}
                </button>
              </>
            )}
            {canWrite && (
              <button
                onClick={openAdd}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap"
              >
                <Plus size={18} />
                {"Add Supplier" || "Add Supplier"}
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          {loading ? (
            <div className="p-12 text-center">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-gray-500 text-sm">{"Loading..." || "Loading..."}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-gray-500 text-sm">
              {suppliers.length === 0 ? "No data found" || "No suppliers yet. Click Add Supplier." : "No matching suppliers"}
            </div>
          ) : (
            <div className="overflow-auto" style={{ height: "68vh", minHeight: "260px" }}>
              <table className="w-full">
                <thead className="bg-slate-100 sticky top-0 z-10">
                  <tr>
                    <th>Code</th>
                    <th>Symbol</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>City</th>
                    <th>Country</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th>{"Actions" || "Actions"}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="font-mono text-xs text-gray-600 whitespace-nowrap">{row.code || "-"}</td>
                      <td>
                        {row.symbol ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            {row.symbol.toUpperCase()}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">-</span>
                        )}
                      </td>
                      <td className="font-medium whitespace-nowrap">{row.name || "-"}</td>
                      <td>
                        <span className="inline-flex px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700 border">
                          {row.category || "-"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">{row.city || "-"}</td>
                      <td className="whitespace-nowrap">{row.country || "-"}</td>
                      <td className="font-mono text-xs whitespace-nowrap">{row.phone || "-"}</td>
                      <td className="text-xs whitespace-nowrap">{row.email || "-"}</td>
                      <td>
                        <span className={`badge ${row.status === "Active" ? "badge-green" : "badge-gray"}`}>
                          {row.status || "Active"}
                        </span>
                      </td>
                      <td>
                        {canWrite ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openEdit(row)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                              title={"Edit" || "Edit"}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete(row)}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
                              title={"Delete" || "Delete"}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-[11px] text-gray-400 mt-2">
          Ticket column in Flights shows <span className="font-mono font-bold text-blue-600">Symbol</span> — e.g. MS, TK, EK — instead of 50.00.00.xxxx. If symbol missing, falls back to code.
        </p>
      </div>
    </div>
  );
}
