// Firebase configuration
import { initializeApp, getApps } from "firebase/app";
import { getAuth, setPersistence, browserSessionPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Every deployment (= every client company) must supply its OWN Firebase
// project through NEXT_PUBLIC_FIREBASE_* environment variables — in
// .env.local for local development, or Vercel -> Settings -> Environment
// Variables for a hosted deployment. See .env.local.example and
// DEPLOY-NEW-COMPANY.md.
//
// There is deliberately NO hardcoded fallback project: a deployment that
// forgot to set these would otherwise silently connect to somebody else's
// database and mix their data with the new company's. Failing loudly at
// build/start time is the safe behaviour.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  // Optional (Google Analytics only) — not needed for the app to work.
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const REQUIRED_KEYS = {
  apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
  authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
};
const missingEnv = Object.entries(REQUIRED_KEYS)
  .filter(([key]) => !firebaseConfig[key])
  .map(([, envName]) => envName);
if (missingEnv.length > 0) {
  throw new Error(
    "Firebase is not configured. Missing environment variable(s): " +
      missingEnv.join(", ") +
      ". Copy .env.local.example to .env.local (local) or add them in Vercel -> Settings -> Environment Variables, then rebuild. See DEPLOY-NEW-COMPANY.md."
  );
}

// Initialize Firebase only once
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
// Session-only persistence: the signed-in state lives only in this tab.
// Closing the tab (or the browser) signs the user out automatically —
// reopening the app always lands back on the login screen. Guarded for
// the server-render pass, where sessionStorage doesn't exist.
if (typeof window !== "undefined") {
  setPersistence(auth, browserSessionPersistence).catch(() => {});
}
export const db = getFirestore(app);
export const storage = getStorage(app);
// Exported so other modules (e.g. lib/auth.js's secondary-app trick for
// creating employees without signing the admin out) always initialize
// against the SAME project as everything else, instead of keeping their
// own separate copy that can silently go stale after a project switch.
export { firebaseConfig };

export default app;
