"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import toast from "react-hot-toast";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { ShieldCheck, QrCode, X } from "lucide-react";

// Shown exactly once — right after an employee's first login — to nudge
// them into setting up Google Authenticator (TOTP/OTP) 2FA. Whether they
// set it up or skip it, `otpPromptShown` is flipped to true on their user
// doc so this never appears again. They can still turn 2FA on/off anytime
// from Settings > My Account.
export default function OtpSetupPrompt() {
  const { user, userData, generateTOTPSecret, verifyTOTP, enable2FA, updateUser } = useAuth();
  const [step, setStep] = useState("prompt"); // 'prompt' | 'setup'
  const [data, setData] = useState(null); // { secret, url, qr }
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const shouldShow = !!userData && !userData.totpEnabled && !userData.otpPromptShown;
  if (!shouldShow) return null;

  const markSeen = async () => {
    if (!user) return;
    try {
      await updateUser(user.uid, { otpPromptShown: true });
    } catch (err) {
      console.error(err);
    }
  };

  const handleSkip = async () => {
    setDismissing(true);
    await markSeen();
    setDismissing(false);
  };

  const handleStartSetup = async () => {
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
      setData({ secret, url, qr });
      setCode("");
      setStep("setup");
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate QR");
    }
  };

  const handleConfirm = async (e) => {
    e.preventDefault();
    if (code.length !== 6) {
      toast.error("Enter 6-digit code");
      return;
    }
    const valid = verifyTOTP(code, data.secret);
    if (!valid) {
      toast.error("Invalid code");
      return;
    }
    setLoading(true);
    try {
      await enable2FA(data.secret);
      await markSeen();
      toast.success("2FA enabled for your account!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to enable 2FA");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-backdrop">
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl animate-modal-panel">
        {step === "prompt" ? (
          <>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <ShieldCheck size={18} className="text-blue-600" /> Secure Your Account
              </h3>
              <button onClick={handleSkip} disabled={dismissing} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Welcome! To help keep your account safe, we recommend setting up two-factor
                authentication (OTP) using an app like Google Authenticator.
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={dismissing}
                  className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 disabled:opacity-60"
                >
                  Skip for now
                </button>
                <button
                  type="button"
                  onClick={handleStartSetup}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                >
                  Set up now
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <QrCode size={18} /> Setup Google Authenticator
              </h3>
              <button onClick={handleSkip} disabled={dismissing} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleConfirm} className="p-6 space-y-4">
              <p className="text-sm text-gray-600">Scan this QR with Google Authenticator, then enter the code to verify.</p>
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
                  name="otp-setup-code"
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                  placeholder="000000"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-center text-xl tracking-[0.5em] font-mono"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={handleSkip} disabled={dismissing} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
                  Skip for now
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-60"
                >
                  {loading ? "Verifying..." : "Verify & Enable"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
