"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

/**
 * Code-based filter picker.
 *
 * Replaces a plain <select> (which only shows names) with a small combobox
 * that shows the underlying CODE for every option up front — the way the
 * legacy report screens do it — instead of forcing the user to open a
 * dropdown and hunt by name. Typing narrows the list by code OR name.
 *
 * options: [{ code, name, tag? }]   tag is an optional short badge (e.g. "Corp")
 */
export default function CodeFilterPicker({ label, options, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef(null);

  const selected = useMemo(() => options.find((o) => o.code === value) || null, [options, value]);

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q
      ? options
      : options.filter(
          (o) =>
            (o.code || "").toLowerCase().includes(q) ||
            (o.name || "").toLowerCase().includes(q)
        );
    return list.slice(0, 200);
  }, [options, query]);

  return (
    <div ref={boxRef} className="relative">
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-w-[190px] px-3 py-2 border rounded-lg text-sm bg-white flex items-center justify-between gap-2 hover:border-blue-400 focus:ring-2 focus:ring-blue-500 outline-none"
      >
        {selected ? (
          <span className="flex flex-col items-start overflow-hidden text-left">
            <span className="font-mono text-[11px] font-semibold text-blue-700 truncate w-full">{selected.code}</span>
            <span className="text-[11px] text-gray-500 truncate w-full">{selected.name}</span>
          </span>
        ) : (
          <span className="text-gray-400">{placeholder || "All"}</span>
        )}
        <span className="flex items-center gap-1 flex-shrink-0">
          {selected && (
            <X
              size={13}
              className="text-gray-400 hover:text-red-500"
              onClick={(e) => {
                e.stopPropagation();
                onChange("all");
                setQuery("");
              }}
            />
          )}
          <ChevronDown size={14} className="text-gray-400" />
        </span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a code or name…"
            className="w-full px-3 py-2 text-sm border-b outline-none"
          />
          <div
            className="px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 cursor-pointer border-b"
            onClick={() => {
              onChange("all");
              setQuery("");
              setOpen(false);
            }}
          >
            All {label}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400 text-center">No matches.</div>
            ) : (
              filtered.map((o) => (
                <div
                  key={o.code}
                  onClick={() => {
                    onChange(o.code);
                    setQuery("");
                    setOpen(false);
                  }}
                  className={`px-3 py-1.5 text-xs cursor-pointer hover:bg-blue-50 flex items-center gap-2 ${
                    o.code === value ? "bg-blue-50" : ""
                  }`}
                >
                  <span className="font-mono font-semibold text-blue-700 w-28 flex-shrink-0 truncate">{o.code}</span>
                  <span className="text-gray-700 truncate flex-1">{o.name}</span>
                  {o.tag && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 flex-shrink-0">
                      {o.tag}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
