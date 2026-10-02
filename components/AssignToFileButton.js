"use client";

/**
 * Reusable "Add to File" action, dropped into the toolbar of each service
 * page (Flights / Hotels / Visa / Transportation) next to Edit / Delete.
 *
 * It lets the user link the currently SELECTED booking to a client File —
 * either an existing one or a brand-new one created on the spot — without
 * ever leaving the section they're working in.
 *
 * Accounting/data design (unchanged from the Files page):
 * - Only a lightweight pointer { type, id, addedAt } is written into the
 *   File document's `services` array. No amounts are copied.
 * - This component only ever writes to the FILE document — the booking
 *   document passed in via `row` is never modified here.
 */

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, addDoc, updateDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { generateRegNumber, isBranchVisible } from "@/lib/helpers";
import { useAuth } from "@/lib/auth";
import toast from "react-hot-toast";
import { FolderPlus, X, Search, Link2, Plus, CheckCircle2 } from "lucide-react";

export default function AssignToFileButton({ type, row, disabled, className }) {
  const { userData, hasPermission, activeBranch, myBranches } = useAuth();
  const isAdmin = hasPermission ? hasPermission(["Admin"]) : userData?.role === "Admin";

  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "files"),
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setFiles(data);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [open]);

  const visibleFiles = useMemo(() => {
    const ctx = { isAdmin, activeBranch, myBranches };
    let list = files.filter((f) => isBranchVisible(f.branch, ctx));
    // Same-client files float to the top — usually what the agent wants.
    list = [...list].sort((a, b) => {
      const aMatch = row?.clientCode && a.clientCode === row.clientCode ? 0 : 1;
      const bMatch = row?.clientCode && b.clientCode === row.clientCode ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      const ta = a.createdAt?.toDate?.() || a.createdAt || 0;
      const tb = b.createdAt?.toDate?.() || b.createdAt || 0;
      return new Date(tb) - new Date(ta);
    });
    const s = search.toLowerCase();
    if (s) {
      list = list.filter(
        (f) =>
          (f.regNr || "").toLowerCase().includes(s) ||
          (f.title || "").toLowerCase().includes(s) ||
          (f.clientName || "").toLowerCase().includes(s)
      );
    }
    return list;
  }, [files, search, row, isAdmin, activeBranch, myBranches]);

  if (!row) {
    return (
      <button disabled className={className || "tb-btn"} title="Select a record first">
        <FolderPlus size={14} /> Add to File
      </button>
    );
  }

  const isLinked = (file) => (file.services || []).some((s) => s.type === type && s.id === row.id);

  const assignTo = async (file) => {
    if (isLinked(file)) {
      toast("Already linked to this file");
      return;
    }
    try {
      const next = [...(file.services || []), { type, id: row.id, addedAt: new Date().toISOString() }];
      await updateDoc(doc(db, "files", file.id), { services: next, updatedAt: serverTimestamp() });
      toast.success(`Added to file ${file.regNr}`);
      setOpen(false);
      setSearch("");
    } catch (err) {
      console.error(err);
      toast.error("Failed to add to file");
    }
  };

  const createAndAssign = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      toast.error("Enter a file title");
      return;
    }
    try {
      const branch = row.branch || (activeBranch && activeBranch !== "ALL" ? activeBranch : "1");
      const regNr = await generateRegNumber("files", "F", branch);
      await addDoc(collection(db, "files"), {
        title: newTitle.trim(),
        clientCode: row.clientCode || "",
        clientName: row.clientName || "",
        branch,
        status: "Open",
        remarks: "",
        regNr,
        services: [{ type, id: row.id, addedAt: new Date().toISOString() }],
        createdAt: serverTimestamp(),
      });
      toast.success(`File ${regNr} created and linked`);
      setOpen(false);
      setCreating(false);
      setNewTitle("");
    } catch (err) {
      console.error(err);
      toast.error("Failed to create file");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={className || "tb-btn"}
        title="Add this booking to a client file"
      >
        <FolderPlus size={14} /> Add to File
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-[80] flex items-center justify-center p-4 animate-modal-backdrop" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[75vh] flex flex-col animate-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <FolderPlus size={16} className="text-blue-600" /> Add to File
              </h4>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            {!creating ? (
              <>
                <div className="px-4 pt-3">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search files by reg nr, title or client..."
                      className="w-full pl-8 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-auto px-4 py-3 space-y-2">
                  {loading && <div className="text-center text-sm text-gray-400 py-6">Loading files...</div>}
                  {!loading && visibleFiles.length === 0 && (
                    <div className="text-center text-sm text-gray-400 py-6">No files yet — create one below.</div>
                  )}
                  {!loading &&
                    visibleFiles.map((f) => {
                      const linked = isLinked(f);
                      return (
                        <button
                          key={f.id}
                          onClick={() => assignTo(f)}
                          disabled={linked}
                          className={`w-full text-left flex items-center justify-between border rounded-lg px-3 py-2 transition ${
                            linked ? "border-emerald-200 bg-emerald-50 cursor-default" : "border-gray-200 hover:bg-blue-50"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">
                              <span className="font-mono text-xs text-gray-500 mr-1.5">{f.regNr}</span>
                              {f.title}
                            </p>
                            <p className="text-[11px] text-gray-400 truncate">{f.clientName || "—"}</p>
                          </div>
                          {linked ? (
                            <span className="flex items-center gap-1 text-[11px] text-emerald-600 flex-shrink-0">
                              <CheckCircle2 size={13} /> Linked
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[11px] text-blue-600 flex-shrink-0">
                              <Link2 size={13} /> Add
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>

                <div className="p-3 border-t">
                  <button
                    onClick={() => { setCreating(true); setNewTitle(row.clientName ? `${row.clientName} trip` : ""); }}
                    className="w-full flex items-center justify-center gap-1.5 text-sm font-medium text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-lg py-2"
                  >
                    <Plus size={15} /> New file
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={createAndAssign} className="p-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1 text-gray-600">File Title</label>
                  <input
                    autoFocus
                    required
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="e.g. Family trip to Istanbul"
                  />
                </div>
                <p className="text-[11px] text-gray-400">
                  Client: {row.clientName || "—"} · This booking will be linked automatically.
                </p>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setCreating(false)} className="px-3 py-1.5 border rounded-lg text-xs hover:bg-gray-50">
                    Back
                  </button>
                  <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700">
                    Create & Link
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
