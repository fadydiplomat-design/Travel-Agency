# License / Kill-Switch System

Lets the license of any deployment be activated / suspended / set to expire,
completely separate from ordinary business permissions like editing
invoices or bookings. There are three tiers:

| Who                                   | Can manage the license? | How |
|----------------------------------------|:---:|-----|
| **You** (developer), flagged `isSuperAdmin: true` | ✅ | Hidden page `/license-control`, or the Settings → License tab if that account also has a normal user doc |
| The travel agency's own **Admin** role | ✅ | Settings → License tab (normal login) |
| **General Manager** role               | 👁 view only | Settings → License tab, read-only |
| Manager / Accountant / Employee        | 🚫 no access | License tab isn't shown to them |

General Manager otherwise has every other Admin-level permission in the app
(branches, invoices, employees, everything) — this is the one exception.

## How it works

- A single document `system/license` in Firestore holds `{ status, expiresAt, message }`.
- Every page (`components/LicenseGate.js`) subscribes to that document. If
  `status` is `"suspended"`, or `expiresAt` is in the past, the entire app
  is replaced with a "Service Unavailable" screen — for everyone, no
  exceptions, until it's reactivated.
- The real enforcement is **Firestore rules**, not the app's UI: only a
  user whose own `users/{uid}` doc has `isSuperAdmin: true` OR
  `role == "Admin"` may write to `system/license`. A General Manager (or
  anyone else) who somehow reached the form would still have their write
  rejected server-side.

## One-time setup (per Firebase project / per client deployment)

1. **Create the license document** so the app has something to read —
   Firestore Console → create collection `system` → document id `license`:
   ```
   status: "active"
   expiresAt: null
   message: ""
   ```
   (Optional at first — a missing doc is treated as active, so the app
   won't lock itself out before you've set this up.)

2. **Add this to your Firestore Rules** (Firebase Console → Firestore →
   Rules), merging it into whatever rules you already have — don't paste
   over your existing rules wholesale:

   ```
   match /system/license {
     allow read: if true;
     allow write: if request.auth != null && (
       get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isSuperAdmin == true ||
       get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "Admin"
     );
   }
   ```

3. **(Optional) Flag your own developer account** if you want a way to
   control the license that's independent of the agency's own Admin
   accounts (e.g. even if they ever remove/change their own Admin user) —
   Firestore → your user doc → add field `isSuperAdmin: true` (boolean).
   Never expose a way to set this from the app itself.

That's it for setup — the agency's own Admin already gets a **License** tab
in Settings automatically, no extra configuration needed for them.

## Day to day use

- **As the agency's Admin**: Settings → License tab → toggle Active /
  Suspended, optionally set an expiry date or a custom message → Save.
- **As you (developer)**, if you flagged a super-admin account: same tab if
  that account has a normal user doc, or the hidden `/license-control` URL.
- **General Manager**: sees the same tab, read-only — status, expiry, and
  message, but no way to change them.
- **Expiry instead of a manual suspend**: check "Set an expiry date" — the
  app locks itself automatically once that date passes.
- **Custom message**: shown on the lock screen everyone sees while
  suspended/expired (e.g. "Please renew your subscription — contact us at ...").
