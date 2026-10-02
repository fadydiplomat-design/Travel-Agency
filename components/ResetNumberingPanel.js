"use client";

import React, { useState } from "react";
import toast from "react-hot-toast";
import { useAuth } from "@/lib/auth";
import { getRegCounterInfo, resetRegCounter } from "@/lib/helpers";
import { RotateCcw, Search, AlertTriangle, Loader2 } from "lucide-react";

const SECTIONS = [
  { key: "flights", label: "Flights", letter: "F" },
  { key: "hotels", label: "Hotels", letter: "H" },
  { key: "visa", label: "Visa", letter: "V" },
  { key: "transportation", label: "Transportation", letter: "T" },
  { key: "files", label: "Files", letter: "File" },
];

const inputCls = "px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm";

export default function ResetNumberingPanel() {
  const { branchesList } = useAuth();
  const [section, setSection] = useState("flights");
  const [branch, setBranch] = useState("1");
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState(null);
  const [resetting, setResetting] = useState(false);

  const branches = branchesList?.length > 0 ? branchesList : [{ code: "1", name: "Main" }];
  const sectionMeta = SECTIONS.find((s) => s.key === section);

  const check = async () => {
    setChecking(true);
    setInfo(null);
    try {
      const result = await getRegCounterInfo(section, branch);
      setInfo(result);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't read the counter");
    } finally {
      setChecking(false);
    }
  };

  const handleReset = async () => {
    if (!info) return;
    const willCollide = info.liveCount > 0;
    const ok = confirm(
      willCollide
        ? `⚠️ ${info.liveCount} record(s) still exist in ${sectionMeta.label} for this branch. ` +
          `Resetting is still safe — the next number will pick up right after the highest existing Reg Nr, not collide with anything. Continue?`
        : `This section/branch is empty. Resetting will make the NEXT ${sectionMeta.label} record start again from ${sectionMeta.letter}-0001. Continue?`
    );
    if (!ok) return;

    setResetting(true);
    try {
      await resetRegCounter(section, branch);
      toast.success("Counter reset");
      await check();
    } catch (err) {
      console.error(err);
      toast.error("Reset failed");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-6 py-4 border-b flex items-center gap-2">
        <RotateCcw size={18} className="text-amber-600" />
        <div>
          <h3 className="font-semibold text-gray-900">Reset Numbering Sequence</h3>
          <p className="text-sm text-gray-500">Reg numbers are never reused automatically — even after deleting every record, the next one keeps counting up. Use this if you genuinely want a section to start over.</p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Section</label>
            <select value={section} onChange={(e) => { setSection(e.target.value); setInfo(null); }} className={inputCls}>
              {SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Branch</label>
            <select value={branch} onChange={(e) => { setBranch(e.target.value); setInfo(null); }} className={inputCls}>
              {branches.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
          </div>
          <button
            onClick={check}
            disabled={checking}
            className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 disabled:opacity-60 px-4 py-2 rounded-lg text-sm font-medium"
          >
            {checking ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            Check Current Count
          </button>
        </div>

        {info && (
          <div className="border border-gray-200 rounded-lg p-3 text-sm space-y-1">
            <div>Counter is currently at: <b>{info.exists ? info.seq : "not set yet"}</b></div>
            <div>Records still in {sectionMeta.label} for this branch: <b>{info.liveCount}</b></div>
            {info.liveCount === 0 ? (
              <div className="text-emerald-600 text-xs">Safe to reset — the next record will start at {sectionMeta.letter}-0001.</div>
            ) : (
              <div className="flex items-center gap-1 text-amber-600 text-xs">
                <AlertTriangle size={13} /> There are still {info.liveCount} record(s) here — resetting is still safe (it won't collide), but it won't restart at 1 either.
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleReset}
          disabled={!info || resetting}
          className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          {resetting ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
          {resetting ? "Resetting..." : "Reset Counter"}
        </button>
      </div>
    </div>
  );
}
