// Company Profile — the agency's own branding (name + logo + contact
// details), set once in Settings → Company Profile and then stamped
// automatically at the top of every printed document: invoices, refund
// notes, reports, everything that goes through lib/helpers.js's
// openPrintWindow().
//
// Kept as a live, mutated-in-place object (not re-fetched per print) so
// that printing stays instant and synchronous — subscribeCompanyProfile()
// is started once, near app start, and every print just reads whatever is
// currently cached here.

import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export const COMPANY_PROFILE_DOC = "companyProfile";

export const companyProfile = {
  name: "",
  nameAr: "",
  logoUrl: "", // a data: URL, stored inline in the doc — no Storage/Blaze plan needed
  address: "",
  phone: "",
  email: "",
  taxCardNr: "", // البطاقة الضريبية
  crNr: "", // السجل التجاري
  footerNote: "",
  loaded: false, // true once the first Firestore snapshot has arrived
};

/** Call once near the app root (AuthProvider). Returns an unsubscribe fn.
 *  Pass onChange to also be notified (e.g. a settings form re-syncing its
 *  fields) — the shared `companyProfile` object is already updated by the
 *  time onChange fires. */
export function subscribeCompanyProfile(onChange) {
  return onSnapshot(doc(db, "settings", COMPANY_PROFILE_DOC), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    Object.assign(companyProfile, {
      name: data.name || "",
      nameAr: data.nameAr || "",
      logoUrl: data.logoUrl || "",
      address: data.address || "",
      phone: data.phone || "",
      email: data.email || "",
      taxCardNr: data.taxCardNr || data.taxNr || "", // taxNr = pre-split field, read once for migration
      crNr: data.crNr || "",
      footerNote: data.footerNote || "",
      loaded: true,
    });
    onChange?.(companyProfile);
  });
}

export async function saveCompanyProfile(fields) {
  await setDoc(doc(db, "settings", COMPANY_PROFILE_DOC), fields, { merge: true });
}

// Firestore caps a document at 1MiB total, and this doc is nothing but a
// handful of short text fields plus the logo — so the logo alone must stay
// comfortably under that. 220KB leaves very large headroom.
const MAX_LOGO_BYTES = 220 * 1024;

/** Resizes + re-encodes the picked image, shrinking further if needed
 *  until it's small enough to embed straight into the Firestore document.
 *  Returns a data: URL (never touches any Storage/paid product). */
async function compressLogoToDataUrl(file, onProgress) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Could not read that image — try a different file.");

  const attempts = [
    { maxDim: 480, quality: 0.9 },
    { maxDim: 360, quality: 0.85 },
    { maxDim: 280, quality: 0.75 },
    { maxDim: 200, quality: 0.65 },
    { maxDim: 140, quality: 0.6 },
  ];

  for (let i = 0; i < attempts.length; i++) {
    onProgress?.(Math.round(((i + 1) / attempts.length) * 90));
    const { maxDim, quality } = attempts[i];
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);

    // PNG only kept for the largest attempt (to preserve transparency);
    // every fallback re-encodes as JPEG, which compresses much harder.
    const mime = i === 0 && file.type === "image/png" ? "image/png" : "image/jpeg";
    const dataUrl = canvas.toDataURL(mime, quality);
    // Rough byte size of a data URL: base64 chars * 3/4.
    const approxBytes = (dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75;
    if (approxBytes <= MAX_LOGO_BYTES || i === attempts.length - 1) {
      onProgress?.(100);
      if (approxBytes > MAX_LOGO_BYTES) {
        throw new Error("This image is too complex to shrink small enough — try a simpler logo file (flat colors, no photo background).");
      }
      return dataUrl;
    }
  }
  throw new Error("Could not compress this image.");
}

/** Compresses the picked image and returns a data: URL ready to save on
 *  the companyProfile doc's logoUrl field. onProgress(percent 0-100)
 *  is optional — there's no network upload, so this just tracks the
 *  compression attempts. */
export async function uploadCompanyLogo(file, onProgress) {
  return compressLogoToDataUrl(file, onProgress);
}

/** Kept for API compatibility with older callers — there's nothing to
 *  delete anywhere else now that the logo lives inside the Firestore doc
 *  itself; clearing logoUrl (done by the caller's saveCompanyProfile
 *  call) is the entire removal. */
export async function removeCompanyLogo() {}

/** The <div> injected at the top of every print/PDF window. Empty string
 *  (no header at all) until a name or logo has actually been set, so
 *  un-branded installs keep printing exactly as before. */
export function letterheadHtml() {
  const p = companyProfile;
  if (!p.name && !p.nameAr && !p.logoUrl) return "";
  const contactLine = [p.address, p.phone, p.email].filter(Boolean).join(" · ");
  const regLine = [p.taxCardNr ? `Tax Card No. ${p.taxCardNr}` : "", p.crNr ? `C.R. No. ${p.crNr}` : ""]
    .filter(Boolean)
    .join(" · ");
  return `
    <div style="display:flex;align-items:center;gap:14px;padding-bottom:12px;margin-bottom:14px;border-bottom:2px solid #1e293b">
      ${p.logoUrl ? `<img src="${p.logoUrl}" style="height:56px;max-width:160px;object-fit:contain" />` : ""}
      <div>
        ${p.name ? `<div style="font-size:16px;font-weight:700;color:#1e293b">${escapeHtml(p.name)}</div>` : ""}
        ${p.nameAr ? `<div style="font-size:13px;font-weight:600;color:#334155" dir="rtl">${escapeHtml(p.nameAr)}</div>` : ""}
        ${contactLine ? `<div style="font-size:10px;color:#64748b;margin-top:2px">${escapeHtml(contactLine)}</div>` : ""}
        ${regLine ? `<div style="font-size:10px;color:#64748b">${escapeHtml(regLine)}</div>` : ""}
      </div>
    </div>`;
}

/** The line stamped at the very bottom of every print/PDF, if the company
 *  set one (e.g. terms, bank details, "Thank you for booking with us"). */
export function letterheadFooterHtml() {
  const note = companyProfile.footerNote;
  if (!note) return "";
  return `<div style="margin-top:18px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:10px;color:#64748b">${escapeHtml(
    note
  )}</div>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
