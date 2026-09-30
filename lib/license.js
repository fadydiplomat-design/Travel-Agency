"use client";

// ---------------------------------------------------------------------------
// License / kill-switch system.
//
// Three tiers of access (see canManageLicense / canViewLicenseStatus below):
// - The developer's own account, flagged `isSuperAdmin: true` manually in
//   the Firebase Console (never through the app's UI) — full control.
// - The travel agency's own "Admin" role — full control too, from the
//   normal Settings page. A company can manage their own license this way.
// - "General Manager" role — can see the current status but cannot change
//   it, even though they otherwise have every other Admin-level permission.
//
// Whatever the UI shows, the real enforcement is Firestore security rules:
// only a user whose own `users/{uid}` doc has `isSuperAdmin: true` OR
// `role == "Admin"` may write to `system/license`. Nobody else — including
// General Manager — can succeed even if they somehow bypass the UI.
//
// See README-LICENSE.md for the one-time setup (Firestore doc + rules).
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

const LICENSE_DOC_PATH = ["system", "license"];

export function licenseDocRef() {
  return doc(db, ...LICENSE_DOC_PATH);
}

/**
 * Pure function so it's easy to reason about / test.
 * Fail-open when the doc doesn't exist yet, so a fresh deployment never
 * locks itself out before the developer has created the license doc.
 */
export function evaluateLicense(data) {
  if (!data) return { isValid: true, reason: null };
  if (data.status === "suspended") return { isValid: false, reason: "suspended" };
  if (data.expiresAt) {
    const exp = new Date(data.expiresAt);
    if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
      return { isValid: false, reason: "expired" };
    }
  }
  return { isValid: true, reason: null };
}

export function useLicense() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(
      licenseDocRef(),
      (snap) => {
        setData(snap.exists() ? snap.data() : null);
        setLoading(false);
      },
      () => {
        // Permission errors etc. -> fail open rather than locking everyone out.
        setData(null);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const { isValid, reason } = evaluateLicense(data);
  return { loading, data, isValid, reason };
}

/**
 * Writes are only accepted by Firestore for the super-admin account —
 * everyone else gets a permission-denied error, which the caller should
 * catch and surface.
 */
export async function saveLicense({ status, expiresAt, message }) {
  await setDoc(
    licenseDocRef(),
    {
      status: status === "suspended" ? "suspended" : "active",
      expiresAt: expiresAt || null,
      message: message || "",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// ---------------------------------------------------------------------------
// Who can do what:
// - Manage (activate/suspend/set expiry/message): the developer's flagged
//   `isSuperAdmin` account, AND the travel agency's own "Admin" role.
// - View only (see current status, can't change it): "General Manager" role
//   — they get every other Admin-level permission in the app except this one.
// Both checks mirror the Firestore rule for `system/license`, which is the
// real enforcement layer — these are just for the UI.
// ---------------------------------------------------------------------------
export function canManageLicense(userData) {
  if (!userData) return false;
  return userData.isSuperAdmin === true || userData.role === "Admin";
}

export function canViewLicenseStatus(userData) {
  if (!userData) return false;
  return canManageLicense(userData) || userData.role === "General Manager";
}
