"use client";

/**
 * Settings → Company Profile.
 *
 * Whatever is saved here is stamped automatically at the top (and bottom)
 * of EVERY printed document in the app — invoices, refund notes, reports,
 * everything that goes through lib/helpers.js's openPrintWindow(), plus
 * the invoice print-preview and exported report PDFs. There is nothing
 * else to wire up per-document: this is the single place that controls it.
 */

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Building2, Image as ImageIcon, Loader2, Trash2, UploadCloud } from "lucide-react";
import {
  subscribeCompanyProfile,
  saveCompanyProfile,
  uploadCompanyLogo,
  removeCompanyLogo,
} from "@/lib/companyProfile";

const EMPTY = {
  name: "",
  nameAr: "",
  logoUrl: "",
  address: "",
  phone: "",
  email: "",
  taxCardNr: "",
  crNr: "",
  footerNote: "",
};

export default function CompanyProfileTab() {
  const [form, setForm] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const fileInputRef = useRef(null);

  // Company profile is already cached module-wide (AuthProvider started the
  // listener at app load); subscribe here too so this form re-syncs its
  // fields the moment a snapshot arrives (including this component's own
  // saves, and any change made from another tab/device).
  useEffect(() => {
    const unsub = subscribeCompanyProfile((p) => {
      setForm({
        name: p.name,
        nameAr: p.nameAr,
        logoUrl: p.logoUrl,
        address: p.address,
        phone: p.phone,
        email: p.email,
        taxCardNr: p.taxCardNr,
        crNr: p.crNr,
        footerNote: p.footerNote,
      });
      setLoaded(true);
    });
    return unsub;
  }, []);

  const handleField = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }));

  const handleLogoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2MB");
      return;
    }
    setUploading(true);
    setUploadPct(0);
    try {
      const url = await uploadCompanyLogo(file, setUploadPct);
      setForm((p) => ({ ...p, logoUrl: url }));
      await saveCompanyProfile({ logoUrl: url });
      toast.success("Logo updated");
    } catch (err) {
      toast.error("Could not save the logo: " + (err.message || "unknown error"));
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  };

  const handleRemoveLogo = async () => {
    if (!confirm("Remove the logo from all printouts?")) return;
    const old = form.logoUrl;
    setForm((p) => ({ ...p, logoUrl: "" }));
    try {
      await saveCompanyProfile({ logoUrl: "" });
      await removeCompanyLogo(old);
      toast.success("Logo removed");
    } catch {
      toast.error("Could not remove the logo");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await saveCompanyProfile({
        name: form.name.trim(),
        nameAr: form.nameAr.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        taxCardNr: form.taxCardNr.trim(),
        crNr: form.crNr.trim(),
        footerNote: form.footerNote.trim(),
      });
      toast.success("Company Profile saved");
    } catch (err) {
      toast.error("Could not save: " + (err.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500";
  const labelCls = "block text-xs font-medium text-gray-500 mb-1";

  return (
    <div className="bg-white rounded-xl border border-gray-200 max-w-2xl">
      <div className="px-6 py-4 border-b">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Building2 size={16} /> Company Profile
        </h3>
        <p className="text-sm text-gray-500">
          Your logo and company details appear automatically at the top of every invoice, refund
          note and printed report — nothing to set per document.
        </p>
      </div>

      <form onSubmit={handleSave} className="p-6 space-y-5">
        {/* Logo */}
        <div>
          <span className={labelCls}>Logo</span>
          <div className="flex items-center gap-4">
            <div className="h-16 w-32 border border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-50 overflow-hidden shrink-0">
              {uploading ? (
                <div className="flex flex-col items-center gap-1 text-gray-400">
                  <Loader2 size={18} className="animate-spin" />
                  <span className="text-[10px] tabular-nums">{uploadPct}%</span>
                </div>
              ) : form.logoUrl ? (
                <img src={form.logoUrl} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <ImageIcon size={20} className="text-gray-300" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  <UploadCloud size={13} /> {form.logoUrl ? "Replace logo" : "Upload logo"}
                </button>
                {form.logoUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-400">
                PNG or JPG, under 2MB. Compressed and saved directly — free, no paid Storage plan
                needed.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoPick}
              className="hidden"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Company Name (English)</label>
            <input
              value={form.name}
              onChange={handleField("name")}
              placeholder="e.g. Toka Travel"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Company Name (Arabic)</label>
            <input
              value={form.nameAr}
              onChange={handleField("nameAr")}
              dir="rtl"
              placeholder="مثال: توكة للسياحة"
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Address</label>
          <input value={form.address} onChange={handleField("address")} className={inputCls} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Phone</label>
            <input value={form.phone} onChange={handleField("phone")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input value={form.email} onChange={handleField("email")} className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Tax Card No. (البطاقة الضريبية)</label>
            <input value={form.taxCardNr} onChange={handleField("taxCardNr")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Commercial Registration No. (السجل التجاري)</label>
            <input value={form.crNr} onChange={handleField("crNr")} className={inputCls} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Footer note (printed at the bottom of every document)</label>
          <input
            value={form.footerNote}
            onChange={handleField("footerNote")}
            placeholder="e.g. Thank you for booking with us · Bank transfer details ..."
            className={inputCls}
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving || !loaded}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Saving..." : "Save Company Profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
