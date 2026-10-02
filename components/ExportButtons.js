"use client";

/**
 * Drop this next to any report's toolbar. Pass a `targetRef` pointing at
 * the container that wraps the report's <table> — it exports whatever
 * table is currently rendered inside it (so it automatically respects
 * whatever filters/date-range are active).
 */

import { useState } from "react";
import { FileSpreadsheet, FileDown, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { exportTableToExcel, exportTableToPDF } from "@/lib/exportUtils";

export default function ExportButtons({ targetRef, filename = "report", title = "", className = "" }) {
  const [busy, setBusy] = useState(null); // "excel" | "pdf" | null

  const handleExcel = async () => {
    setBusy("excel");
    try {
      const ok = await exportTableToExcel(targetRef.current, filename);
      if (!ok) toast.error("No table to export in this view");
    } catch (err) {
      console.error(err);
      toast.error("Excel export failed");
    } finally {
      setBusy(null);
    }
  };

  const handlePDF = async () => {
    setBusy("pdf");
    try {
      const ok = await exportTableToPDF(targetRef.current, filename, title);
      if (!ok) toast.error("No table to export in this view");
    } catch (err) {
      console.error(err);
      toast.error("PDF export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={handleExcel}
        disabled={busy !== null}
        title="Export to Excel"
        className="flex items-center gap-1.5 text-xs font-medium border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 px-3 py-2 rounded-lg"
      >
        {busy === "excel" ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
        Excel
      </button>
      <button
        type="button"
        onClick={handlePDF}
        disabled={busy !== null}
        title="Export to PDF"
        className="flex items-center gap-1.5 text-xs font-medium border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 px-3 py-2 rounded-lg"
      >
        {busy === "pdf" ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
        PDF
      </button>
    </div>
  );
}
