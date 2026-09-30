"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import toast from "react-hot-toast";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import CurrencyConverter from "@/components/CurrencyConverter";
import {
  User,
  Crown,
  Lock,
  ShieldCheck,
  ShieldOff,
  Eye,
  EyeOff,
  QrCode,
  X,
  LogOut,
  ChevronDown,
  Building2,
} from "lucide-react";

export default function Navbar({ title }) {
  const { user, userData, changePassword, generateTOTPSecret, enable2FA, disable2FA, verifyTOTP, logout, branchesList, activeBranch, setActiveBranch, myBranches, isAdmin } = useAuth();

  const [showDropdown, setShowDropdown] = useState(false);
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const branchMenuRef = useRef(null);
  const branchTriggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);

  // Change Password state
  const [showChangePw, setShowChangePw] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
  const [showPw1, setShowPw1] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [showPw3, setShowPw3] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  // Self 2FA state
  const [showSelf2FA, setShowSelf2FA] = useState(null); // {secret, url, qr}
  const [selfVerifyCode, setSelfVerifyCode] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    function handleClickOutside(e) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showDropdown]);

  // Close branch menu on outside click
  useEffect(() => {
    if (!showBranchMenu) return;
    function handleClickOutside(e) {
      if (
        branchMenuRef.current &&
        !branchMenuRef.current.contains(e.target) &&
        branchTriggerRef.current &&
        !branchTriggerRef.current.contains(e.target)
      ) {
        setShowBranchMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showBranchMenu]);

  // Branches this user can pick from in the switcher
  const switchableBranches = isAdmin ? branchesList.map((b) => b.code) : myBranches;
  const branchName = (code) => branchesList.find((b) => b.code === code)?.name || code;
  const showBranchSwitcher = isAdmin || switchableBranches.length > 1;

  const handleSelfChangePassword = async (e) => {
    e.preventDefault();
    if (pwForm.newPassword.length < 6) {
      toast.error("New password must be 6+ chars");
      return;
    }
    if (pwForm.newPassword !== pwForm.confirmNewPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setPwLoading(true);
    try {
      await changePassword(pwForm.currentPassword, pwForm.newPassword);
      toast.success("Password changed successfully");
      setShowChangePw(false);
      setPwForm({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
    } catch (err) {
      console.error(err);
      if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") toast.error("Current password incorrect");
      else if (err.code === "auth/weak-password") toast.error("Weak password");
      else toast.error(err.message || "Failed to change password");
    } finally {
      setPwLoading(false);
    }
  };

  const handleSelf2FAInit = async () => {
    setShowDropdown(false);
    if (userData?.totpEnabled) {
      if (!confirm("Disable 2FA for your account?")) return;
      try {
        await disable2FA();
        toast.success("2FA disabled for your account");
      } catch (err) {
        console.error(err);
        toast.error("Failed to disable 2FA");
      }
      return;
    }
    const secret = generateTOTPSecret();
    const label = userData?.username || "user";
    const totp = new OTPAuth.TOTP({
      issuer: "TravelAgency",
      label,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const url = totp.toString();
    try {
      const qr = await QRCode.toDataURL(url);
      setShowSelf2FA({ secret, url, qr });
      setSelfVerifyCode("");
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate QR");
    }
  };

  const handleConfirmSelf2FA = async (e) => {
    e.preventDefault();
    if (selfVerifyCode.length !== 6) {
      toast.error("Enter 6-digit code");
      return;
    }
    const valid = verifyTOTP(selfVerifyCode, showSelf2FA.secret);
    if (!valid) {
      toast.error("Invalid code");
      return;
    }
    setVerifyLoading(true);
    try {
      await enable2FA(showSelf2FA.secret);
      toast.success("2FA enabled for your account!");
      setShowSelf2FA(null);
      setSelfVerifyCode("");
    } catch (err) {
      console.error(err);
      toast.error("Failed to enable 2FA");
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleOpenChangePassword = () => {
    setShowDropdown(false);
    setShowChangePw(true);
  };

  return (
    <>
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">{title}</h2>

        <div className="flex items-center gap-4">
          {/* Branch Switcher */}
          {showBranchSwitcher && (
            <div className="relative">
              <button
                ref={branchTriggerRef}
                onClick={() => setShowBranchMenu(!showBranchMenu)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                title="Switch working branch"
              >
                <Building2 size={16} />
                <span className="font-medium">{activeBranch === "ALL" ? "All Branches" : branchName(activeBranch)}</span>
                <ChevronDown size={14} className={`text-gray-400 transition-transform ${showBranchMenu ? "rotate-180" : ""}`} />
              </button>
              {showBranchMenu && (
                <div
                  ref={branchMenuRef}
                  className="absolute left-0 top-full mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden py-1"
                >
                  {isAdmin && (
                    <button
                      onClick={() => { setActiveBranch("ALL"); setShowBranchMenu(false); }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${activeBranch === "ALL" ? "text-blue-600 font-medium" : "text-gray-700"}`}
                    >
                      All Branches (combined)
                    </button>
                  )}
                  {switchableBranches.map((code) => (
                    <button
                      key={code}
                      onClick={() => { setActiveBranch(code); setShowBranchMenu(false); }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${activeBranch === code ? "text-blue-600 font-medium" : "text-gray-700"}`}
                    >
                      {branchName(code)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!showBranchSwitcher && activeBranch && activeBranch !== "ALL" && (
            <span className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500">
              <Building2 size={14} /> {branchName(activeBranch)}
            </span>
          )}

          {/* User Info Dropdown Trigger */}
          <div className="relative">
            <button
              ref={triggerRef}
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:bg-gray-50 px-2 py-1.5 rounded-lg transition-colors"
            >
              <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center">
                <User size={16} />
              </div>
              <span className="hidden sm:inline font-medium">{userData?.name || userData?.username || "User"}</span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${showDropdown ? "rotate-180" : ""}`} />
            </button>

            {/* Dropdown */}
            {showDropdown && (
              <div
                ref={dropdownRef}
                className="absolute right-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden"
              >
                {/* Header section */}
                <div className="p-4 flex gap-3">
                  <div className="w-12 h-12 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center flex-shrink-0">
                    <User size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm flex items-center gap-1.5 flex-wrap">
                      <span className="truncate">{userData?.name || userData?.username || "User"}</span>
                      {userData?.role && userData.role !== "Employee" && (
                        <span className="inline-flex items-center gap-1 bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          <Crown size={10} /> {userData.role}
                        </span>
                      )}
                    </p>
                    {userData?.username && (
                      <p className="text-xs font-mono text-gray-500 truncate">@{userData.username}</p>
                    )}
                    <div className="mt-1.5">
                      {userData?.totpEnabled ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[11px] font-medium">
                          <ShieldCheck size={10} /> 2FA Enabled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full text-[11px]">
                          <ShieldOff size={10} /> 2FA Disabled
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="h-px bg-gray-200" />

                {/* Menu items */}
                <div className="p-2 space-y-1">
                  <button
                    onClick={handleOpenChangePassword}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition text-left"
                  >
                    <Lock size={16} className="text-gray-500" />
                    <span>Change Password</span>
                  </button>

                  <button
                    onClick={handleSelf2FAInit}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition text-left"
                  >
                    {userData?.totpEnabled ? (
                      <ShieldOff size={16} className="text-amber-600" />
                    ) : (
                      <ShieldCheck size={16} className="text-emerald-600" />
                    )}
                    <span className="flex-1">Google Authenticator</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${userData?.totpEnabled ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                      {userData?.totpEnabled ? "Enabled" : "Disabled"}
                    </span>
                  </button>

                  <div className="h-px bg-gray-200 my-1" />

                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition text-left"
                  >
                    <LogOut size={16} />
                    <span>Logout</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Change Password Modal */}
      {showChangePw && (
        <ChangePasswordModal
          pwForm={pwForm}
          setPwForm={setPwForm}
          onSubmit={handleSelfChangePassword}
          onClose={() => setShowChangePw(false)}
          loading={pwLoading}
          showPw1={showPw1}
          setShowPw1={setShowPw1}
          showPw2={showPw2}
          setShowPw2={setShowPw2}
          showPw3={showPw3}
          setShowPw3={setShowPw3}
        />
      )}

      {/* Self 2FA Modal */}
      {showSelf2FA && (
        <Self2FAModal
          data={showSelf2FA}
          code={selfVerifyCode}
          setCode={setSelfVerifyCode}
          onConfirm={handleConfirmSelf2FA}
          onClose={() => setShowSelf2FA(null)}
          loading={verifyLoading}
        />
      )}
    </>
  );
}

function ChangePasswordModal({ pwForm, setPwForm, onSubmit, onClose, loading, showPw1, setShowPw1, showPw2, setShowPw2, showPw3, setShowPw3 }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl animate-modal-panel">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Lock size={18} /> Change Password
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Current Password</label>
            <div className="relative">
              <input
                required
                type={showPw1 ? "text" : "password"}
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none pr-10"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPw1(!showPw1)} className="absolute right-3 top-2.5 text-gray-400">
                {showPw1 ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">New Password</label>
            <div className="relative">
              <input
                required
                type={showPw2 ? "text" : "password"}
                value={pwForm.newPassword}
                onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
                minLength={6}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none pr-10"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPw2(!showPw2)} className="absolute right-3 top-2.5 text-gray-400">
                {showPw2 ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Confirm New Password</label>
            <div className="relative">
              <input
                required
                type={showPw3 ? "text" : "password"}
                value={pwForm.confirmNewPassword}
                onChange={(e) => setPwForm({ ...pwForm, confirmNewPassword: e.target.value })}
                minLength={6}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none pr-10"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPw3(!showPw3)} className="absolute right-3 top-2.5 text-gray-400">
                {showPw3 ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60">
              {loading ? "Updating..." : "Update Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Self2FAModal({ data, code, setCode, onConfirm, onClose, loading }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl animate-modal-panel">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <QrCode size={18} /> Setup Google Authenticator
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={onConfirm} className="p-6 space-y-4">
          <p className="text-sm text-gray-600">Scan this QR with Google Authenticator, then enter code to verify.</p>
          <div className="flex justify-center bg-gray-50 p-4 rounded-xl">
            <img src={data.qr} alt="QR Code" className="w-48 h-48" />
          </div>
          <div className="bg-gray-50 p-3 rounded-lg text-center">
            <p className="text-xs text-gray-500">Secret</p>
            <p className="font-mono text-sm font-medium break-all select-all">{data.secret}</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">6-digit code</label>
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              placeholder="000000"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-center text-xl tracking-[0.5em] font-mono"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-60">
              {loading ? "Verifying..." : "Verify & Enable"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
