"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { canManageLicense } from "@/lib/license";
import LicensePanel from "@/components/LicensePanel";
import toast from "react-hot-toast";
import { Lock, ShieldCheck, LogOut } from "lucide-react";

// Not linked from Sidebar/Navbar anywhere on purpose — reachable only by
// typing the URL directly. Real protection comes from Firestore rules
// (only an account flagged `isSuperAdmin: true`, or an account with
// `role == "Admin"`, can ever write to the license doc) — this page is
// just a UI for it. A company's own Admin can also just use the
// "License" tab in Settings instead of this hidden route.
export default function LicenseControlPage() {
  const { user, userData, loading, login, verify2FA, pending2FA, logout } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [busy, setBusy] = useState(false);

  const canManage = canManageLicense(userData);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error("Enter username and password");
      return;
    }
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      toast.error(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify2FA = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const ok = await verify2FA(totpCode);
      if (!ok) toast.error("Invalid code");
    } catch (err) {
      toast.error(err.message || "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-400 text-sm">
        Loading...
      </div>
    );
  }

  // --- Not signed in ---
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
        <form
          onSubmit={pending2FA ? handleVerify2FA : handleLogin}
          className="max-w-sm w-full bg-gray-900 border border-gray-800 rounded-2xl p-8"
        >
          <div className="w-12 h-12 rounded-full bg-gray-800 text-gray-300 flex items-center justify-center mb-5">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="text-gray-100 font-semibold mb-1">License Control</h1>
          <p className="text-gray-500 text-sm mb-6">Restricted access.</p>

          {!pending2FA ? (
            <>
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full mb-3 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-gray-500"
                autoComplete="username"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full mb-4 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-gray-500"
                autoComplete="current-password"
              />
            </>
          ) : (
            <input
              type="text"
              placeholder="6-digit code"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              className="w-full mb-4 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm tracking-widest focus:outline-none focus:border-gray-500"
              maxLength={6}
            />
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2 rounded-lg bg-gray-100 text-gray-900 text-sm font-medium hover:bg-white disabled:opacity-50"
          >
            {busy ? "..." : pending2FA ? "Verify" : "Sign In"}
          </button>
        </form>
      </div>
    );
  }

  // --- Signed in, but this account can't manage the license ---
  if (!canManage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
        <div className="max-w-sm w-full bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
          <p className="text-gray-300 text-sm mb-4">
            Signed in as <span className="text-gray-100">@{userData?.username}</span> — this account is not
            authorized for this page.
          </p>
          <button
            onClick={logout}
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </div>
    );
  }

  // --- Authorized: the control panel ---
  return (
    <div className="min-h-screen bg-gray-950 px-4 py-10">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2 text-gray-100">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h1 className="font-semibold">License Control</h1>
          </div>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>

        <LicensePanel variant="dark" />
      </div>
    </div>
  );
}
