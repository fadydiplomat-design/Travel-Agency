"use client";
import Navbar from "@/components/Navbar";
import { useLanguage } from "@/lib/i18n";
export default function Page() {
  const { t } = useLanguage();
  return (
    <div>
      <Navbar title={t("common.corporates") || "corporates"} />
      <div className="p-6">
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
          This section is under construction. Coming soon.
        </div>
      </div>
    </div>
  );
}
