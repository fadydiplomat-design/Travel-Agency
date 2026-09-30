"use client";

import React, { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  History,
  LogIn,
  LogOut,
  UserPlus,
  UserMinus,
  UserCog,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  ShieldAlert,
  Activity,
} from "lucide-react";

const ACTION_META = {
  login: { label: "Signed in", icon: LogIn, color: "text-emerald-600 bg-emerald-50" },
  logout: { label: "Signed out", icon: LogOut, color: "text-slate-500 bg-slate-100" },
  force_logout: { label: "Force-signed out an employee", icon: ShieldAlert, color: "text-orange-600 bg-orange-50" },
  employee_created: { label: "Created an employee", icon: UserPlus, color: "text-blue-600 bg-blue-50" },
  employee_updated: { label: "Updated an employee", icon: UserCog, color: "text-indigo-600 bg-indigo-50" },
  employee_deleted: { label: "Deleted an employee", icon: UserMinus, color: "text-red-600 bg-red-50" },
  password_reset: { label: "Reset a password", icon: KeyRound, color: "text-amber-600 bg-amber-50" },
  "2fa_enabled": { label: "Enabled 2FA for an employee", icon: ShieldCheck, color: "text-emerald-600 bg-emerald-50" },
  "2fa_disabled": { label: "Disabled 2FA for an employee", icon: ShieldOff, color: "text-gray-500 bg-gray-100" },
};

function metaFor(action) {
  return ACTION_META[action] || { label: action || "Activity", icon: Activity, color: "text-gray-500 bg-gray-100" };
}

function describe(entry) {
  const target = entry.meta?.targetName;
  switch (entry.action) {
    case "login":
      return "Signed in";
    case "logout":
      return "Signed out";
    case "force_logout":
      return target ? `Force-signed out ${target}` : "Force-signed out an employee";
    case "employee_created":
      return target ? `Created employee "${target}"` : "Created an employee";
    case "employee_updated":
      return target ? `Updated employee "${target}"` : "Updated an employee";
    case "employee_deleted":
      return target ? `Deleted employee "${target}"` : "Deleted an employee";
    case "password_reset":
      return target ? `Reset password for "${target}"` : "Reset a password";
    case "2fa_enabled":
      return target ? `Enabled 2FA for "${target}"` : "Enabled 2FA";
    case "2fa_disabled":
      return target ? `Disabled 2FA for "${target}"` : "Disabled 2FA";
    default:
      return entry.action || "Activity";
  }
}

function formatWhen(ts) {
  const millis = ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : null;
  if (!millis) return { relative: "-", absolute: "-" };
  const diffMs = Date.now() - millis;
  const diffMin = Math.floor(diffMs / 60000);
  let relative;
  if (diffMin < 1) relative = "just now";
  else if (diffMin < 60) relative = `${diffMin}m ago`;
  else if (diffMin < 60 * 24) relative = `${Math.floor(diffMin / 60)}h ago`;
  else relative = `${Math.floor(diffMin / (60 * 24))}d ago`;
  const absolute = new Date(millis).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return { relative, absolute };
}

export default function HistoryTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "activityLog"), orderBy("createdAt", "desc"), limit(300));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const uniqueUsers = useMemo(() => {
    const names = new Set(entries.map((e) => e.name || e.username).filter(Boolean));
    return Array.from(names).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (userFilter !== "all" && (e.name || e.username) !== userFilter) return false;
      return true;
    });
  }, [entries, actionFilter, userFilter]);

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="p-5 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <History size={18} className="text-gray-400" />
          <div>
            <h3 className="font-semibold text-gray-900">Activity History</h3>
            <p className="text-sm text-gray-500">{filtered.length} of {entries.length} recent events</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All employees</option>
            {uniqueUsers.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All actions</option>
            {Object.keys(ACTION_META).map((a) => (
              <option key={a} value={a}>{metaFor(a).label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-gray-400">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          Loading activity...
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center text-gray-500">No activity yet</div>
      ) : (
        <div className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
          {filtered.map((entry) => {
            const meta = metaFor(entry.action);
            const Icon = meta.icon;
            const when = formatWhen(entry.createdAt);
            return (
              <div key={entry.id} className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${meta.color}`}>
                  <Icon size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900">
                    <span className="font-medium">{entry.name || entry.username || "Unknown"}</span>{" "}
                    <span className="text-gray-600">{describe(entry)}</span>
                  </p>
                </div>
                <div className="text-right flex-shrink-0" title={when.absolute}>
                  <span className="text-xs text-gray-400 whitespace-nowrap">{when.relative}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
