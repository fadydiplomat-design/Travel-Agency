# Travel Agency Management

Complete Travel Agency CRM, Booking, Invoicing, Accounting & Data Analysis System.

## Features

- **CRM**: Clients, Corporates, Suppliers with auto-generated codes
  - Clients → `30.00.00.xxxx`
  - Corporates → `50.00.00.xxxx`
  - Suppliers → `50.00.00.xxxx`
- **Invoicing** with smart numbering:
  - `INTE26 1` – Ticket invoices (EGP)
  - `INTF26 1` – Ticket invoices (Foreign)
  - `INSE26 1` – Service invoices (EGP)
  - `INSF26 1` – Service invoices (Foreign)
- **Bookings**: Flights, Hotels, Visa, Transportation
- **Files** management
- **Full Accounting** module
- **Data Analysis** & reports
- **Multi-user** with roles (Admin / Manager / Accountant / Employee)
- **Bilingual** (English default + Arabic) with RTL support
- **Browser-friendly** navigation (Back / Forward works)

## Tech Stack

- Next.js 16 (App Router)
- Firebase (Auth + Firestore + Storage)
- Tailwind CSS
- Lucide Icons

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Firebase

1. Create a project at [Firebase Console](https://console.firebase.google.com)
2. Enable **Authentication** (Email/Password)
3. Create a **Firestore** database
4. Enable **Storage**
5. Copy `.env.local.example` to `.env.local` and fill in your credentials (required):

```bash
cp .env.local.example .env.local
```

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 4. Username logins (no manual step needed)

Login is by username. The lookup entry `/usernames/{username}` is created
together with every account, and — if it is ever missing (e.g. an account
created before the lookup existed) — `lib/auth.js` falls back to the account's
internal email and re-creates the entry automatically after a successful
sign-in (see `findEmailByUsername` / `ensureUsernameMirror`, and the matching
`/usernames` rule in `firestore.rules`). The old "Repair Username Logins" and
"Repair Booking Ownership" buttons were removed from Settings → Employees.

## Project Structure

```
app/
  (auth)/login/          → Login page
  (dashboard)/
    page.js              → Dashboard
    clients/             → Clients CRM
    corporates/          → Corporates
    suppliers/           → Suppliers
    invoices/            → Invoices
    flights/             → Flights
    hotels/              → Hotels
    visa/                → Visa
    transportation/      → Transportation
    files/               → Files
    accounts/            → Accounting
    analysis/            → Data Analysis
    settings/            → Settings
components/              → Shared UI components
lib/                     → Firebase, Auth, i18n, Helpers
locales/                 → en.json + ar.json
```

## Deploying for a new company

Each company gets **its own Firebase project** and its own Vercel deployment;
the code itself is never edited per client. The Firebase config is read only
from `NEXT_PUBLIC_FIREBASE_*` environment variables (there is no hardcoded
fallback project, and the build fails with a clear message if one is missing).
Step-by-step checklist (Arabic): [DEPLOY-NEW-COMPANY.md](./DEPLOY-NEW-COMPANY.md).

## Deployment on Vercel

1. Push to GitHub
2. Import project in Vercel (Framework Preset: Next.js, leave Output Directory empty)
3. Add the `NEXT_PUBLIC_FIREBASE_*` environment variables from `.env.local.example`
4. Deploy
