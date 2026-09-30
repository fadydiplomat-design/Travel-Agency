"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { subscribeCompanyProfile } from "@/lib/companyProfile";
import { canAccessAnyModule, CRM_ROUTE_KEYS, SETTINGS_ROUTE_KEYS } from "@/lib/permissions";
import CurrencyConverter from "@/components/CurrencyConverter";
import {
  LayoutDashboard,
  Users,
  FileText,
  Plane,
  Hotel,
  FileCheck,
  Car,
  FolderOpen,
  Calculator,
  BarChart3,
  Settings,
  LogOut,
  CalendarClock,
} from "lucide-react";
const menuItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, key: "dashboard" },
  { href: "/crm", label: "CRM", icon: Users, key: "crm" },
  { href: "/invoices", label: "Invoices", icon: FileText, key: "invoices" },
  { href: "/flights", label: "Air Ticket", icon: Plane, key: "flights" },
  { href: "/hotels", label: "Hotels", icon: Hotel, key: "hotels" },
  { href: "/visa", label: "Visa", icon: FileCheck, key: "visa" },
  { href: "/transportation", label: "Transportation", icon: Car, key: "transportation" },
  { href: "/files", label: "Files", icon: FolderOpen, key: "files" },
  { href: "/accounts", label: "Accounts", icon: Calculator, key: "accounts" },
  { href: "/fiscal-year", label: "Fiscal Year", icon: CalendarClock, key: "fiscalYear" },
  { href: "/analysis", label: "Data Analysis", icon: BarChart3, key: "analysis" },
  { href: "/settings", label: "Settings", icon: Settings, key: "settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { userData, logout, canAccessModule, isAdmin, appFeatures } = useAuth();

  // Company name + logo come from Settings -> Company Profile, so each
  // company that deploys this app sees its own branding.
  const [brand, setBrand] = useState({ name: "", logoUrl: "" });
  useEffect(() => {
    const unsub = subscribeCompanyProfile((p) => setBrand({ name: p.name || "", logoUrl: p.logoUrl || "" }));
    return () => unsub();
  }, []);

  // First letter of the first two words of the employee's name — "Fady
  // Habib" -> "FH". Falls back to "TA" if no name is available yet (e.g.
  // still loading, or an older account with no `name` field).
  const initials = (userData?.name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "TA";

  return (
    <aside className="fixed top-0 left-0 z-40 w-64 h-screen bg-slate-800 text-white flex flex-col">
      {/* Brand logo — the company's own logo from Settings -> Company Profile
          (nothing is shown until one has been uploaded). */}
      {brand.logoUrl ? (
        <div className="flex justify-center pt-5 pb-1 px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brand.logoUrl}
            alt={brand.name || "Company logo"}
            className="w-full max-w-[170px] max-h-[110px] h-auto object-contain"
          />
        </div>
      ) : null}

      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-700">
        <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-lg">
          {initials}
        </div>
        <div>
          <h1 className="font-semibold text-sm leading-tight">{brand.name || "Travel Agency Management"}</h1>
          {userData?.role && userData.role !== "Employee" ? (
            <p className="text-xs text-slate-400">{userData.role}</p>
          ) : null}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        <ul className="space-y-1">
          {menuItems.map((item) => {
            if (item.key === "crm") {
              if (!canAccessAnyModule(userData, CRM_ROUTE_KEYS, isAdmin, appFeatures)) return null;
            } else if (item.key === "settings") {
              // Admin-level roles always keep the Settings link. Without this
              // check, a true Admin who switched Reports AND Backup off in
              // Settings > App Features would lose the link entirely (both
              // SETTINGS_ROUTE_KEYS return false once appFeatures says so) —
              // locking themselves out of the very screen that turns them
              // back on. The layout route guard already lets admins in.
              if (!isAdmin && !canAccessAnyModule(userData, SETTINGS_ROUTE_KEYS, isAdmin, appFeatures)) return null;
            } else if (!canAccessModule(item.key)) {
              return null;
            }

            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-slate-300 hover:bg-slate-700 hover:text-white"
                  }`}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Currency Converter + Logout */}
      <div className="p-4 border-t border-slate-700 space-y-1">
        <CurrencyConverter variant="sidebar" />
        <button
          onClick={logout}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
        >
          <LogOut size={18} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
