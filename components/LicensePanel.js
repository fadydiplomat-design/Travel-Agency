"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { KeyRound, ShieldCheck, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useLicense, saveLicense, canManageLicense } from "@/lib/license";

// `variant="light"` matches the rest of the dashboard (used inside Settings).
// `variant="dark"` matches the standalone /license-control page.
export default function LicensePanel({ variant = "light" }) {
  const { userData } = useAuth();
  const { loading: licenseLoading, data: licenseData } = useLicense();
  const canEdit = canManageLicense(userData);
  const [busy, setBusy] = useState(false);

  // Each field is `null` until touched — until then it's derived straight
  // from the live Firestore doc, so the form always reflects the current
  // license without needing an effect to "sync" local state to it.
  const [statusOverride, setStatusOverride] = useState(null);
  const [hasExpiryOverride, setHasExpiryOverride] = useState(null);
  const [expiresAtOverride, setExpiresAtOverride] = useState(null);
  const [messageOverride, setMessageOverride] = useState(null);

  const status = statusOverride ?? (licenseData?.status === "suspended" ? "suspended" : "active");
  const hasExpiry = hasExpiryOverride ?? !!licenseData?.expiresAt;
  const expiresAt =
    expiresAtOverride ?? (licenseData?.expiresAt ? licenseData.expiresAt.slice(0, 10) : "");
  const message = messageOverride ?? (licenseData?.message || "");

  const dark = variant === "dark";

  const handleSave = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await saveLicense({
        status,
        expiresAt: hasExpiry && expiresAt ? new Date(expiresAt).toISOString() : null,
        message,
      });
      toast.success("License updated");
    } catch (err) {
      console.error(err);
      if (err.code === "permission-denied") {
        toast.error("Permission denied — this account isn't authorized to manage the license.");
      } else {
        toast.error(err.message || "Failed to save");
      }
    } finally {
      setBusy(false);
    }
  };

  if (licenseLoading) {
    return <p className={dark ? "text-gray-500 text-sm" : "text-gray-400 text-sm"}>Loading...</p>;
  }

  // --- Read-only: General Manager can see status, not change it ---
  if (!canEdit) {
    const isActive = status === "active";
    return (
      <div className={dark ? "bg-gray-900 border border-gray-800 rounded-2xl p-6" : "bg-white rounded-xl border border-gray-200 p-6"}>
        <div className="flex items-center gap-2 mb-4">
          {isActive ? (
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-red-500" />
          )}
          <span className={`font-medium ${dark ? "text-gray-100" : "text-gray-800"}`}>
            License is {isActive ? "Active" : "Suspended"}
          </span>
        </div>
        {expiresAt && (
          <p className={`text-sm mb-1 ${dark ? "text-gray-400" : "text-gray-500"}`}>Expires: {expiresAt}</p>
        )}
        {message && (
          <p className={`text-sm ${dark ? "text-gray-400" : "text-gray-500"}`}>{message}</p>
        )}
        <p className={`text-xs mt-4 ${dark ? "text-gray-600" : "text-gray-400"}`}>
          You can view the license status but only an Admin can change it.
        </p>
      </div>
    );
  }

  // --- Editable: Super Admin or company Admin ---
  return (
    <form
      onSubmit={handleSave}
      className={dark ? "bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5" : "bg-white rounded-xl border border-gray-200 p-6 space-y-5"}
    >
      <div>
        <label className={`block text-xs mb-2 ${dark ? "text-gray-500" : "text-gray-500"}`}>Status</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStatusOverride("active")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
              status === "active"
                ? "bg-emerald-500/10 border-emerald-500 text-emerald-600"
                : dark
                ? "border-gray-700 text-gray-400"
                : "border-gray-200 text-gray-500"
            }`}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => setStatusOverride("suspended")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
              status === "suspended"
                ? "bg-red-500/10 border-red-500 text-red-600"
                : dark
                ? "border-gray-700 text-gray-400"
                : "border-gray-200 text-gray-500"
            }`}
          >
            Suspended
          </button>
        </div>
      </div>

      <div>
        <label className={`flex items-center gap-2 text-xs mb-2 ${dark ? "text-gray-500" : "text-gray-500"}`}>
          <input
            type="checkbox"
            checked={hasExpiry}
            onChange={(e) => setHasExpiryOverride(e.target.checked)}
          />
          Set an expiry date
        </label>
        {hasExpiry && (
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAtOverride(e.target.value)}
            className={
              dark
                ? "w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-gray-500"
                : "w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            }
          />
        )}
      </div>

      <div>
        <label className={`block text-xs mb-2 ${dark ? "text-gray-500" : "text-gray-500"}`}>
          Message shown when blocked (optional)
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessageOverride(e.target.value)}
          rows={3}
          placeholder="e.g. Please contact us to renew your subscription."
          className={
            dark
              ? "w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-gray-500 resize-none"
              : "w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
          }
        />
      </div>

      <button
        type="submit"
        disabled={busy}
        className={
          dark
            ? "w-full py-2.5 rounded-lg bg-gray-100 text-gray-900 text-sm font-medium hover:bg-white disabled:opacity-50 inline-flex items-center justify-center gap-2"
            : "w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        }
      >
        <KeyRound className="w-4 h-4" />
        {busy ? "Saving..." : "Save"}
      </button>

      {licenseData?.updatedAt?.toDate && (
        <p className={`text-center text-[11px] ${dark ? "text-gray-600" : "text-gray-400"}`}>
          Last updated {licenseData.updatedAt.toDate().toLocaleString()}
        </p>
      )}
    </form>
  );
}
