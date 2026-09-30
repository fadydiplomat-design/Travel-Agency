"use client";

/**
 * Small KPI card row meant to sit directly under a section's <Navbar>,
 * giving that section its own mini-dashboard — same visual language as
 * the main dashboard's "Primary KPIs" row.
 *
 * stats: [{ label, value, suffix?, icon, color, valueClass? }]
 */
export default function SectionStats({ stats }) {
  if (!stats || stats.length === 0) return null;

  return (
    <div className="bg-slate-50 border-b border-gray-200 px-4 py-3">
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3 shadow-sm"
            >
              {Icon && (
                <div className={`w-9 h-9 ${stat.color || "bg-blue-500"} rounded-md flex items-center justify-center flex-shrink-0`}>
                  <Icon className="text-white" size={16} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-500 truncate">{stat.label}</p>
                <p className={`text-base font-bold truncate ${stat.valueClass || "text-gray-900"}`}>
                  {stat.value}
                  {stat.suffix || ""}
                </p>
                {stat.sub && <p className="text-[10px] text-gray-400 truncate">{stat.sub}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
