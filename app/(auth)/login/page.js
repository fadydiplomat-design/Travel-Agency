"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import toast from "react-hot-toast";
import { Plane, Eye, EyeOff, ShieldCheck, ArrowLeft } from "lucide-react";

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // 2FA step state
  const [step, setStep] = useState("login"); // 'login' | '2fa'
  const [totpCode, setTotpCode] = useState("");
  const [pendingSecret, setPendingSecret] = useState(null);

  const { loginWithUsernameOrEmail, login, register, verify2FA, verifyTOTP, pending2FA, logout } = useAuth();
  const router = useRouter();

  // Check if any users exist — i.e. has the app ever been set up. Reads
  // the tiny, non-sensitive system/bootstrap marker doc's mere EXISTENCE
  // rather than querying /users: a userless query used to hand this signed
  // -out page one arbitrary employee's entire profile — totpSecret and
  // all — before anyone had even tried to log in. See the Firestore rule.
  useEffect(() => {
    const checkUsers = async () => {
      try {
        const snap = await getDoc(doc(db, "system", "bootstrap"));
        setIsFirstTime(!snap.exists());
      } catch (error) {
        console.log("Could not check bootstrap status, assuming first time setup");
        setIsFirstTime(true);
      } finally {
        setChecking(false);
      }
    };
    checkUsers();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      toast.error("Please enter username and password");
      return;
    }
    setLoading(true);
    try {
      const result = await loginWithUsernameOrEmail(identifier.trim(), password);
      if (result.needs2FA) {
        setPendingSecret(result.secret);
        setStep("2fa");
        toast("2FA required - enter code from Google Authenticator", { icon: "🔐" });
      } else {
        toast.success("Logged in successfully");
        router.replace("/");
      }
    } catch (error) {
      console.error(error);
      const msg = error.message || "";
      if (msg.includes("Username not found")) toast.error("Username not found");
      else if (msg.includes("auth/invalid-credential") || msg.includes("auth/wrong-password") || msg.includes("auth/user-not-found") || msg.includes("auth/invalid-email")) toast.error("Invalid email or password");
      else toast.error(msg || "Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2FA = async (e) => {
    e.preventDefault();
    if (!totpCode || totpCode.length !== 6) {
      toast.error("Enter 6-digit code");
      return;
    }
    setLoading(true);
    try {
      // Use context verify2FA which checks pendingSecret
      const ok = await verify2FA(totpCode);
      // Fallback direct verify if needed
      // const ok = verifyTOTP(totpCode, pendingSecret);
      if (ok) {
        toast.success("2FA verified - welcome!");
        router.replace("/");
      } else {
        toast.error("Invalid code - try again");
      }
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = async () => {
    setStep("login");
    setTotpCode("");
    setPendingSecret(null);
    try {
      await logout();
    } catch {}
  };

  const handleCreateAdmin = async (e) => {
    e.preventDefault();
    if (!username.trim() || username.length < 3) {
      toast.error("Username required (3-20 chars)");
      return;
    }
    if (!/^[a-z0-9_.]{3,20}$/.test(username.toLowerCase())) {
      toast.error("Username: 3-20 chars, letters/numbers/_ . only");
      return;
    }
    setLoading(true);
    try {
      // No email is collected from the user — Firebase Auth still needs
      // *some* email internally, so we derive an internal placeholder from
      // the username. It's never shown anywhere in the app.
      const generatedEmail = `${username.trim().toLowerCase()}@noemail.local`;
      await register({ email: generatedEmail, password, name: name.trim(), username: username.trim(), role: "Admin" });
      toast.success("Admin account created successfully!");
      router.replace("/");
    } catch (error) {
      console.error(error);
      if (error.code === "auth/weak-password") {
        toast.error("Password should be at least 6 characters");
      } else if (error.message?.includes("Username")) {
        toast.error(error.message);
      } else {
        toast.error(error.message || "Failed to create account");
      }
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Plane className="text-white" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{"Travel Agency Management"}</h1>
          <p className="text-gray-500 mt-1">
            {isFirstTime ? "Create your Admin account" : step === "2fa" ? "Two-Factor Authentication" : "Sign in to your account"}
          </p>
        </div>

        {isFirstTime ? (
          /* ========== FIRST TIME: Create Admin ========== */
          <form onSubmit={handleCreateAdmin} className="space-y-5">
            <div className="bg-blue-50 text-blue-800 text-sm p-3 rounded-lg mb-2">
              First time setup — Create the Admin account to get started.
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                placeholder="Admin Name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                required
                pattern="[a-z0-9_.]{3,20}"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                placeholder="admin_user"
              />
              <p className="text-xs text-gray-400 mt-1">3-20 chars, letters/numbers/_ . only, stored lowercase</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{"Password"}</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition pr-10"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Loading..." : "Create Admin Account"}
            </button>
          </form>
        ) : step === "2fa" ? (
          /* ========== 2FA STEP ========== */
          <form onSubmit={handleVerify2FA} className="space-y-5">
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3 rounded-lg flex items-start gap-2">
              <ShieldCheck size={18} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Google Authenticator code required</p>
                <p className="text-xs mt-1 text-amber-700">Open Google Authenticator and enter the 6-digit code for TravelAgency.</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">6-digit code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                autoFocus
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-center text-xl tracking-[0.5em] font-mono"
                placeholder="000000"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Loading..." : "Verify"}
            </button>

            <button
              type="button"
              onClick={handleBackToLogin}
              className="w-full flex items-center justify-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 rounded-lg transition"
            >
              <ArrowLeft size={16} /> Back to login
            </button>
          </form>
        ) : (
          /* ========== NORMAL LOGIN ========== */
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoComplete="username"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                placeholder="username"
              />
              <p className="text-xs text-gray-400 mt-1">Login with Google Authenticator code if 2FA is enabled</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{"Password"}</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition pr-10"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Loading..." : "Sign In"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
