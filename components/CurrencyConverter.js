"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, X, RefreshCw, Banknote } from "lucide-react";

// Free, no-API-key exchange rate service.
const RATE_API_URL = "https://open.er-api.com/v6/latest/USD";
const CACHE_KEY = "usd_egp_rate_cache_v1";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const CURRENCIES = ["USD", "EGP", "EUR", "GBP", "SAR", "AED"];

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(rates) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rates, fetchedAt: Date.now() }));
  } catch {}
}

export default function CurrencyConverter({ variant = "navbar" }) {
  const [open, setOpen] = useState(false);
  const [rates, setRates] = useState(null); // { USD: 1, EGP: 48.x, ... } base USD
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [amount, setAmount] = useState("1");
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("EGP");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fetchRates = useCallback(async (force = false) => {
    if (!force) {
      const cached = loadCache();
      if (cached) {
        setRates(cached.rates);
        setFetchedAt(cached.fetchedAt);
        return;
      }
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(RATE_API_URL);
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      if (!data?.rates) throw new Error("no rates");
      setRates(data.rates);
      setFetchedAt(Date.now());
      saveCache(data.rates);
    } catch (err) {
      console.error(err);
      setError("Couldn't refresh exchange rate, please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchRates(false);
  }, [open, fetchRates]);

  const converted = (() => {
    const amt = parseFloat(amount);
    if (!rates || isNaN(amt)) return null;
    // rates are relative to USD base. value_in_usd = amt / rates[from]; result = value_in_usd * rates[to]
    const usdValue = amt / (rates[from] || 1);
    return usdValue * (rates[to] || 1);
  })();

  const rateLine = (() => {
    if (!rates) return null;
    const oneFromInTo = (1 / (rates[from] || 1)) * (rates[to] || 1);
    return `1 ${from} = ${oneFromInTo.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${to}`;
  })();

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <>
      {variant === "sidebar" ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
        >
          <Banknote size={18} />
          <span>Currency Converter</span>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          title="Currency Converter"
        >
          <Banknote size={16} />
          <span className="font-medium hidden sm:inline">Currency</span>
        </button>
      )}

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl animate-modal-panel">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Banknote size={18} /> Currency Converter
              </h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Amount</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="0.00"
                />
              </div>

              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">From</label>
                  <select
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={swap}
                  className="mb-1 p-2 border rounded-lg hover:bg-gray-50 transition"
                  title="Swap"
                >
                  <ArrowLeftRight size={16} />
                </button>

                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">To</label>
                  <select
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 text-center">
                {loading ? (
                  <p className="text-sm text-gray-500">Fetching rate...</p>
                ) : error ? (
                  <p className="text-sm text-red-600">{error}</p>
                ) : converted !== null ? (
                  <>
                    <p className="text-2xl font-bold text-gray-900">
                      {converted.toLocaleString("en-US", { maximumFractionDigits: 2 })} {to}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{rateLine}</p>
                    {fetchedAt && (
                      <p className="text-[11px] text-gray-400 mt-1">
                        Updated: {new Date(fetchedAt).toLocaleTimeString("en-US")}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-500">Enter an amount</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => fetchRates(true)}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition disabled:opacity-60"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                Refresh Rate
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
