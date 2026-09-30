"use client";

import { useState, useEffect, useMemo } from "react";
import Navbar from "@/components/Navbar";
import ClientsSection from "@/components/crm/ClientsSection";
import CorporatesSection from "@/components/crm/CorporatesSection";
import SuppliersSection from "@/components/crm/SuppliersSection";
import { useAuth, ADMIN_LEVEL_ROLES } from "@/lib/auth";
import { canWriteModule } from "@/lib/permissions";
import { Users, Building2, Truck } from "lucide-react";

const ALL_TABS = [
  { key: "clients", label: "Clients", icon: Users },
  { key: "corporates", label: "Corporates", icon: Building2 },
  { key: "suppliers", label: "Suppliers", icon: Truck },
];

export default function CRMPage() {
  const { userData, canAccessModule, appFeatures } = useAuth();
  const isAdmin = ADMIN_LEVEL_ROLES.includes(userData?.role);

  // Each tab is its own permission now (clients / corporates / suppliers),
  // so only show — and only allow switching to — the ones this user
  // actually has. An employee with just "suppliers" granted sees a single
  // tab, not three with two that go nowhere on click.
  const tabs = useMemo(() => ALL_TABS.filter((t) => canAccessModule(t.key)), [canAccessModule]);

  const [activeTab, setActiveTab] = useState(tabs[0]?.key || "clients");

  // If the accessible set changes (e.g. permissions edited while this page
  // is open) and the current tab is no longer in it, fall back to the
  // first tab still available instead of showing a blank pane.
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.key === activeTab)) {
      setActiveTab(tabs[0].key);
    }
  }, [tabs, activeTab]);

  const canWrite = canWriteModule(userData, activeTab, isAdmin, appFeatures);

  return (
    <div>
      <Navbar title="CRM" />

      <div className="px-6 pt-4">
        <div className="border-b border-gray-200 flex gap-6">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition ${
                  activeTab === t.key
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cross-fades on tab switch — key forces a remount so the CSS
          entrance animation replays each time. */}
      <div key={activeTab} className="animate-tab-fade">
        {activeTab === "clients" && <ClientsSection canWrite={canWrite} />}
        {activeTab === "corporates" && <CorporatesSection canWrite={canWrite} />}
        {activeTab === "suppliers" && <SuppliersSection canWrite={canWrite} />}
      </div>
    </div>
  );
}
