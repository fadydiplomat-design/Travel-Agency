import { collection, getDocs, doc, writeBatch, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Every collection the app writes to. Keep this in sync if a new module
// adds its own Firestore collection.
export const BACKUP_COLLECTIONS = [
  "clients",
  "suppliers",
  "corporates",
  "branches",
  "fiscalYears",
  "flights",
  "hotels",
  "visa",
  "transportation",
  "files",
  "invoices",
  "journalEntries",
  "bankBook",
  "users",
];

// Firestore Timestamp objects aren't JSON-serializable as-is, so we walk
// every value recursively and swap them for a plain, round-trippable shape.
function serializeValue(v) {
  if (v instanceof Timestamp) return { __ts: true, iso: v.toDate().toISOString() };
  if (Array.isArray(v)) return v.map(serializeValue);
  if (v && typeof v === "object") {
    if (typeof v.toDate === "function" && typeof v.seconds === "number") {
      return { __ts: true, iso: v.toDate().toISOString() };
    }
    const out = {};
    for (const k of Object.keys(v)) out[k] = serializeValue(v[k]);
    return out;
  }
  return v;
}

function deserializeValue(v) {
  if (v && typeof v === "object") {
    if (v.__ts && v.iso) return Timestamp.fromDate(new Date(v.iso));
    if (Array.isArray(v)) return v.map(deserializeValue);
    const out = {};
    for (const k of Object.keys(v)) out[k] = deserializeValue(v[k]);
    return out;
  }
  return v;
}

/** Reads every document from the given collections into one JSON-safe object. */
export async function createBackup(collectionsToInclude = BACKUP_COLLECTIONS, onProgress) {
  const result = { exportedAt: new Date().toISOString(), collections: {} };
  for (const name of collectionsToInclude) {
    const snap = await getDocs(collection(db, name));
    result.collections[name] = snap.docs.map((d) => ({ id: d.id, data: serializeValue(d.data()) }));
    onProgress?.(name, result.collections[name].length);
  }
  return result;
}

export function downloadBackupFile(backup) {
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `travel-agency-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function parseBackupFile(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || !data.collections) {
    throw new Error("This doesn't look like a valid backup file.");
  }
  return data;
}

/**
 * Merge-restore — never deletes, never overwrites an existing document.
 * For every collection in the backup, only documents whose ID does NOT
 * currently exist get written back. Anything created or edited after the
 * backup was taken is left completely untouched, so restoring can never
 * wipe out newer data — it only fills in what's missing.
 */
export async function restoreBackupMerge(backup, onProgress) {
  const summary = {};
  const names = Object.keys(backup.collections || {});
  for (const name of names) {
    const docsInBackup = backup.collections[name] || [];
    const existingSnap = await getDocs(collection(db, name));
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));
    const missing = docsInBackup.filter((d) => !existingIds.has(d.id));

    let written = 0;
    for (let i = 0; i < missing.length; i += 400) {
      const chunk = missing.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const d of chunk) {
        batch.set(doc(db, name, d.id), deserializeValue(d.data));
      }
      await batch.commit();
      written += chunk.length;
    }

    summary[name] = {
      inBackup: docsInBackup.length,
      alreadyPresent: docsInBackup.length - missing.length,
      restored: written,
    };
    onProgress?.(name, summary[name]);
  }
  return summary;
}
