"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { useLicense } from "@/lib/license";
import { useAuth } from "@/lib/auth";
import { canManageLicense } from "@/lib/license";

// The hidden control panel, and the normal login page, must never be
// blocked by the license lock screen — otherwise nobody could ever sign in
// to reactivate a suspended license in the first place.
const EXCLUDED_PATHS = ["/license-control", "/login"];

export default function LicenseGate({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, isValid, data } = useLicense();
  const { user, userData, loading: authLoading, logout } = useAuth();

  const readyToEvaluate = !loading && !authLoading;
  // If the license is suspended and nobody is signed in yet, there is no
  // way to know whether this visitor is the Admin who needs to reactivate
  // it — so instead of dead-ending on the block screen (which has no way
  // out), send them straight to /login. Once they sign in we can properly
  // decide: Admin gets through, anyone else sees the real block screen.
  useEffect(() => {
    if (readyToEvaluate && !isValid && !user && !EXCLUDED_PATHS.includes(pathname)) {
      router.replace("/login");
    }
  }, [readyToEvaluate, isValid, user, pathname, router]);

  if (EXCLUDED_PATHS.includes(pathname)) return children;
  if (!readyToEvaluate) return null;
  if (!isValid && !user) return null; // redirect effect above is sending them to /login

  // An Admin (or the flagged super-admin) is always let through, even while
  // suspended — otherwise nobody could ever reach Settings > License to
  // turn it back on. Everyone else still sees the full block screen below,
  // so no real work happens app-wide until the license is active again.
  const canBypass = canManageLicense(userData);

  if (!isValid && !canBypass) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center bg-white border border-gray-200 rounded-2xl shadow-sm p-8">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900 mb-2">
            Service Unavailable
          </h1>
          <p className="text-gray-500 text-sm leading-relaxed whitespace-pre-line mb-5">
            {data?.message ||
              "Access to this system has been temporarily suspended. Please contact your service provider."}
          </p>
          {user && (
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Sign out and try another account
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!isValid && canBypass) {
    return (
      <>
        <div className="bg-red-600 text-white text-xs sm:text-sm font-medium px-4 py-2 text-center sticky top-0 z-[100]">
          ⚠ License is currently suspended — other users cannot use the system. Go to Settings → License to reactivate.
        </div>
        {children}
      </>
    );
  }

  return children;
}
