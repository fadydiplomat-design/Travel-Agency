"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import OtpSetupPrompt from "@/components/OtpSetupPrompt";
import { moduleKeyForPath, canAccessAnyModule, CRM_ROUTE_KEYS, SETTINGS_ROUTE_KEYS } from "@/lib/permissions";

export default function DashboardLayout({ children }) {
  const { user, userData, loading, pending2FA, canAccessModule, isAdmin, appFeatures } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    } else if (!loading && user && pending2FA) {
      router.replace("/login");
    }
  }, [user, loading, pending2FA, router]);

  // Manual/URL access guard: even if someone types a page's URL directly,
  // they're bounced back to the dashboard unless their role or their
  // manually-set permissions (Settings > Employees > Permissions) allow it.
  useEffect(() => {
    if (loading || !user || pending2FA || !userData) return;
    if (pathname === "/") return; // dashboard itself is the safe landing page
    // /crm and /settings each host more than one permission as tabs (see
    // CRM_ROUTE_KEYS / SETTINGS_ROUTE_KEYS) — allowed in if the user can
    // access at least one of the tabs behind that route.
    if (pathname === "/crm" || pathname.startsWith("/crm")) {
      if (!canAccessAnyModule(userData, CRM_ROUTE_KEYS, isAdmin, appFeatures)) router.replace("/");
      return;
    }
    if (pathname === "/settings" || pathname.startsWith("/settings")) {
      if (!isAdmin && !canAccessAnyModule(userData, SETTINGS_ROUTE_KEYS, isAdmin, appFeatures)) router.replace("/");
      return;
    }
    const moduleKey = moduleKeyForPath(pathname);
    if (moduleKey && !canAccessModule(moduleKey)) {
      router.replace("/");
    }
  }, [loading, user, pending2FA, userData, pathname, canAccessModule, isAdmin, appFeatures, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;
  if (pending2FA) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="ml-64 min-h-screen">
        {children}
      </main>
      <OtpSetupPrompt />
    </div>
  );
}
