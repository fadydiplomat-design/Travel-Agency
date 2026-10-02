"use client";

import React, { useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  BACKUP_COLLECTIONS,
  createBackup,
  downloadBackupFile,
  parseBackupFile,
  restoreBackupMerge,
} from "@/lib/backupUtils";
import {
  DownloadCloud, UploadCloud, ShieldCheck, Loader2, FileJson2, AlertTriangle, CheckCircle2,
} from "lucide-react";

const LABELS = {
  clients: "Clients",
  suppliers: "Suppliers",
  corporates: "Corporates",
  branches: "Branches",
  fiscalYears: "Fiscal Years",
  flights: "Flights",
  hotels: "Hotels",
  visa: "Visa",
  transportation: "Transportation",
  files: "Files",
  invoices: "Invoices",
  journalEntries: "Journal Entries",
  bankBook: "Bank Book",
  users: "Employees / Users",
};

export default function BackupRestoreTab() {
  const [selected, setSelected] = useState(() => new Set(BACKUP_COLLECTIONS));
  const [backingUp, setBackingUp] = useState(false);
  const [backupProgress, setBackupProgress] = useState(null);

  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(null);
  const [restoreSummary, setRestoreSummary] = useState(null);
  const fileInputRef = useRef(null);

  const toggle = (name) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const handleBackup = async () => {
    if (selected.size === 0) {
      toast.error("Select at least one collection to back up");
      return;
    }
    setBackingUp(true);
    setBackupProgress({});
    try {
      const backup = await createBackup(Array.from(selected), (name, count) => {
        setBackupProgress((p) => ({ ...p, [name]: count }));
      });
      downloadBackupFile(backup);
      const total = Object.values(backup.collections).reduce((s, arr) => s + arr.length, 0);
      toast.success(`Backup ready — ${total} documents exported`);
    } catch (err) {
      console.error(err);
      toast.error("Backup failed");
    } finally {
      setBackingUp(false);
    }
  };

  const handleFilePicked = async (e) => {
    const f = e.target.files?.[0];
    setRestoreSummary(null);
    if (!f) return;
    try {
      const text = await f.text();
      const data = parseBackupFile(text);
      setFile(f);
      setParsed(data);
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Couldn't read this file");
      setFile(null);
      setParsed(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRestore = async () => {
    if (!parsed) return;
    const totalDocs = Object.values(parsed.collections).reduce((s, arr) => s + arr.length, 0);
    const ok = confirm(
      `Restore from this backup?\n\n` +
      `This will ONLY add documents that don't already exist — nothing currently in the app will be changed or deleted. ` +
      `Up to ${totalDocs} documents will be checked.`
    );
    if (!ok) return;

    setRestoring(true);
    setRestoreProgress({});
    try {
      const summary = await restoreBackupMerge(parsed, (name, s) => {
        setRestoreProgress((p) => ({ ...p, [name]: s }));
      });
      setRestoreSummary(summary);
      const restoredTotal = Object.values(summary).reduce((s, v) => s + v.restored, 0);
      toast.success(restoredTotal > 0 ? `Restored ${restoredTotal} missing documents` : "Nothing to restore — everything already exists");
    } catch (err) {
      console.error(err);
      toast.error("Restore failed");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Backup */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b flex items-center gap-2">
          <DownloadCloud size={18} className="text-blue-600" />
          <div>
            <h3 className="font-semibold text-gray-900">Backup</h3>
            <p className="text-sm text-gray-500">Download every record as one JSON file you can keep safe.</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {BACKUP_COLLECTIONS.map((name) => (
              <label key={name} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={selected.has(name)} onChange={() => toggle(name)} />
                {LABELS[name] || name}
                {backupProgress && backupProgress[name] !== undefined && (
                  <span className="text-xs text-gray-400">({backupProgress[name]})</span>
                )}
              </label>
            ))}
          </div>
          <button
            onClick={handleBackup}
            disabled={backingUp}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {backingUp ? <Loader2 size={16} className="animate-spin" /> : <DownloadCloud size={16} />}
            {backingUp ? "Preparing backup..." : "Create & Download Backup"}
          </button>
        </div>
      </div>

      {/* Restore */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b flex items-center gap-2">
          <UploadCloud size={18} className="text-emerald-600" />
          <div>
            <h3 className="font-semibold text-gray-900">Restore</h3>
            <p className="text-sm text-gray-500">Merge a backup file back in — safe by design.</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg p-3">
            <ShieldCheck size={16} className="flex-shrink-0 mt-0.5" />
            <span>
              Restoring only <b>adds documents that are missing</b>. Anything already in the app — including data
              added after this backup was taken — is never changed or deleted.
            </span>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFilePicked}
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
            />
          </div>

          {parsed && (
            <div className="border border-gray-200 rounded-lg p-3 text-sm space-y-1">
              <div className="flex items-center gap-2 text-gray-700 font-medium">
                <FileJson2 size={15} /> {file?.name}
              </div>
              <div className="text-xs text-gray-500">
                Exported: {parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString() : "—"}
              </div>
              <div className="text-xs text-gray-500">
                {Object.entries(parsed.collections).map(([n, arr]) => `${LABELS[n] || n}: ${arr.length}`).join(" · ")}
              </div>
            </div>
          )}

          <button
            onClick={handleRestore}
            disabled={!parsed || restoring}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {restoring ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
            {restoring ? "Restoring..." : "Restore (Merge)"}
          </button>

          {restoring && parsed && (
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 text-xs">
              {Object.keys(parsed.collections).map((name) => {
                const done = restoreProgress && restoreProgress[name];
                return (
                  <div key={name} className="flex items-center justify-between px-3 py-1.5">
                    <span className={done ? "text-gray-700" : "text-gray-400"}>{LABELS[name] || name}</span>
                    {done ? (
                      <span className="flex items-center gap-1 text-emerald-700 font-medium">
                        <CheckCircle2 size={12} />
                        {done.restored > 0 ? `${done.restored} restored` : "already up to date"}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-gray-400">
                        <Loader2 size={11} className="animate-spin" /> checking...
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {restoreSummary && (
            <div className="border border-gray-200 rounded-lg overflow-hidden mt-2">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2">Collection</th>
                    <th className="text-right px-3 py-2">In Backup</th>
                    <th className="text-right px-3 py-2">Already Present</th>
                    <th className="text-right px-3 py-2">Restored</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(restoreSummary).map(([name, s]) => (
                    <tr key={name} className="border-t border-gray-100">
                      <td className="px-3 py-1.5">{LABELS[name] || name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{s.inBackup}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-400">{s.alreadyPresent}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-emerald-700">
                        {s.restored > 0 ? <span className="flex items-center justify-end gap-1"><CheckCircle2 size={12} /> {s.restored}</span> : 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-gray-400">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            Backup files include employee/login metadata — keep the downloaded file somewhere secure.
          </div>
        </div>
      </div>
    </div>
  );
}
