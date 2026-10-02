/**
 * One-time seed script for airline suppliers
 * Usage: node --env-file=.env.local scripts/seedAirlines.js
 * Uses the same NEXT_PUBLIC_FIREBASE_* variables as the app (see
 * .env.local.example) — there is deliberately no hardcoded project, so it can
 * never seed the wrong company's database by accident. Plain `node`, unlike
 * `next dev`, does not auto-load .env.local, hence the --env-file flag.
 * Note: Firestore rules require authenticated writes in production. If an
 * unauthenticated write is blocked, use the UI "Import Airlines" button while
 * logged in as Admin (recommended).
 */

const { initializeApp, getApps } = require("firebase/app");
const { getFirestore, collection, getDocs, addDoc, serverTimestamp } = require("firebase/firestore");

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
  console.error("Missing NEXT_PUBLIC_FIREBASE_* variables. Run: node --env-file=.env.local scripts/seedAirlines.js");
  process.exit(1);
}

const AIRLINE_CODES = {
  "077": { carrier: "MS", name: "EgyptAir", gds: "1A" },
  "125": { carrier: "BA", name: "British Airways", gds: "1A" },
  "001": { carrier: "AA", name: "American Airlines", gds: "1S" },
  "006": { carrier: "DL", name: "Delta", gds: "1S" },
  "016": { carrier: "UA", name: "United", gds: "1G" },
  "047": { carrier: "TP", name: "TAP Portugal", gds: "1A" },
  "053": { carrier: "EI", name: "Aer Lingus", gds: "1A" },
  "055": { carrier: "AZ", name: "ITA Airways", gds: "1A" },
  "057": { carrier: "AF", name: "Air France", gds: "1A" },
  "064": { carrier: "OK", name: "Czech Airlines", gds: "1A" },
  "065": { carrier: "SV", name: "Saudia", gds: "1A" },
  "071": { carrier: "ET", name: "Ethiopian", gds: "1A" },
  "072": { carrier: "KL", name: "KLM", gds: "1A" },
  "074": { carrier: "KL", name: "KLM", gds: "1A" },
  "075": { carrier: "IB", name: "Iberia", gds: "1A" },
  "080": { carrier: "LO", name: "LOT Polish", gds: "1A" },
  "081": { carrier: "QF", name: "Qantas", gds: "1A" },
  "082": { carrier: "SN", name: "Brussels Airlines", gds: "1A" },
  "083": { carrier: "SA", name: "South African", gds: "1A" },
  "086": { carrier: "NZ", name: "Air New Zealand", gds: "1A" },
  "098": { carrier: "AI", name: "Air India", gds: "1A" },
  "105": { carrier: "AY", name: "Finnair", gds: "1A" },
  "114": { carrier: "LY", name: "El Al", gds: "1A" },
  "117": { carrier: "SK", name: "SAS", gds: "1A" },
  "131": { carrier: "JL", name: "Japan Airlines", gds: "1A" },
  "139": { carrier: "AB", name: "Air Berlin", gds: "1A" },
  "157": { carrier: "QR", name: "Qatar Airways", gds: "1A" },
  "160": { carrier: "CX", name: "Cathay Pacific", gds: "1A" },
  "163": { carrier: "TK", name: "Turkish Airlines", gds: "1A" },
  "172": { carrier: "KE", name: "Korean Air", gds: "1A" },
  "176": { carrier: "EK", name: "Emirates", gds: "1A" },
  "180": { carrier: "OL", name: "Olympic", gds: "1A" },
  "202": { carrier: "AC", name: "Air Canada", gds: "1A" },
  "205": { carrier: "NH", name: "ANA", gds: "1A" },
  "217": { carrier: "TG", name: "Thai Airways", gds: "1A" },
  "220": { carrier: "LH", name: "Lufthansa", gds: "1A" },
  "232": { carrier: "MH", name: "Malaysia Airlines", gds: "1A" },
  "235": { carrier: "TK", name: "Turkish Airlines", gds: "1A" },
  "257": { carrier: "A3", name: "Aegean", gds: "1A" },
  "297": { carrier: "CI", name: "China Airlines", gds: "1A" },
  "403": { carrier: "HY", name: "Uzbekistan Airways", gds: "1A" },
  "607": { carrier: "EY", name: "Etihad", gds: "1A" },
  "700": { carrier: "SQ", name: "Singapore Airlines", gds: "1A" },
  "724": { carrier: "SW", name: "Air Namibia", gds: "1A" },
  "774": { carrier: "GQ", name: "Sky Express", gds: "1A" },
  "871": { carrier: "A9", name: "Georgian Airways", gds: "1A" },
  "514": { carrier: "G9", name: "Air Arabia", gds: "1A" },
  "513": { carrier: "3O", name: "Air Arabia Maroc", gds: "1A" },
  "033": { carrier: "U2", name: "EasyJet", gds: "1A" },
  "224": { carrier: "FR", name: "Ryanair", gds: "1A" },
  "274": { carrier: "W6", name: "Wizz Air", gds: "1A" },
  "486": { carrier: "J9", name: "Jazeera Airways", gds: "1A" },
  "312": { carrier: "6E", name: "IndiGo", gds: "1A" },
  "328": { carrier: "DY", name: "Norwegian", gds: "1A" },
  "645": { carrier: "EW", name: "Eurowings", gds: "1A" },
  "030": { carrier: "VY", name: "Vueling", gds: "1A" },
  "129": { carrier: "HV", name: "Transavia", gds: "1A" },
  "775": { carrier: "SG", name: "SpiceJet", gds: "1A" },
  "807": { carrier: "AK", name: "AirAsia", gds: "1A" },
  "565": { carrier: "F3", name: "Flyadeal", gds: "1A" },
  "769": { carrier: "NP", name: "Nile Air", gds: "1A" },
  "534": { carrier: "SM", name: "Air Cairo", gds: "1A" },
  "856": { carrier: "NE", name: "Nesma Airlines", gds: "1A" },
  "570": { carrier: "E5", name: "Air Arabia Egypt", gds: "1A" },
  "745": { carrier: "W9", name: "Wizz Air UK", gds: "1A" },
  "378": { carrier: "9P", name: "Flynas", gds: "1A" },
};

async function main() {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  const db = getFirestore(app);

  console.log(`Seeding ${Object.keys(AIRLINE_CODES).length} airlines as suppliers (50.00.00.XXXX)...`);

  const snapshot = await getDocs(collection(db, "suppliers"));
  const existing = snapshot.docs.map((d) => d.data());
  const existingCodes = new Set(existing.map((s) => (s.code || "").trim()));
  const existingSymbols = new Set(
    existing
      .filter((s) => (s.category || "Airline") === "Airline")
      .map((s) => (s.symbol || "").toUpperCase().trim())
      .filter(Boolean)
  );

  let added = 0;
  let skipped = 0;

  for (const [key, info] of Object.entries(AIRLINE_CODES)) {
    const paddedCode = key.padStart(4, "0");
    const fullCode = `50.00.00.${paddedCode}`;
    const symbol = (info.carrier || "").toUpperCase().trim();
    const name = info.name || symbol;
    const gds = info.gds || "";

    const codeExists = existingCodes.has(fullCode);
    const symbolExists = symbol ? existingSymbols.has(symbol) : false;

    if (codeExists || symbolExists) {
      console.log(`  SKIP ${fullCode} ${symbol} ${name} (already exists)`);
      skipped++;
      continue;
    }

    try {
      await addDoc(collection(db, "suppliers"), {
        code: fullCode,
        symbol: symbol,
        name: name,
        category: "Airline",
        country: "",
        city: "",
        phone: "",
        email: "",
        contactPerson: "",
        currency: "EGP",
        paymentMethod: "Bank Transfer",
        notes: `Airline ticketing - GDS: ${gds} - Prefix: ${key}`,
        status: "Active",
        gds: gds,
        ticketPrefix: key,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      console.log(`  ADDED ${fullCode} ${symbol} ${name} (prefix ${key})`);
      existingCodes.add(fullCode);
      if (symbol) existingSymbols.add(symbol);
      added++;
    } catch (e) {
      console.error(`  FAILED ${fullCode} ${symbol}: ${e.message}`);
      // Likely Firestore rules – unauthenticated writes blocked
      if (e.message && e.message.includes("permission")) {
        console.error("\nFirestore rules blocked unauthenticated write. Use the UI button while logged in as Admin:");
        console.error("  Login as Admin → Suppliers page → click 'Import Airlines'");
        process.exit(1);
      }
      throw e;
    }
  }

  console.log(`\nDone. Added ${added}, skipped ${skipped} existing.`);
  // Keep process alive briefly for Firestore to flush, then exit
  setTimeout(() => process.exit(0), 1000);
}

main().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
