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
5. Copy `.env.local.example` to `.env.local` and fill in your credentials:

```bash
cp .env.local.example .env.local
```

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 4. One-time: repair data added before these fixes (existing deployments only)

If you're upgrading a deployment that already has employee accounts and
bookings, sign in as an Admin, go to **Settings → Employees**, and run
these two buttons once (safe to run more than once; a brand-new
deployment with no data yet doesn't need either):

- **Repair Username Logins** — backfills the `/usernames/{username}`
  lookup doc (see `firestore.rules` and `findEmailByUsername` in
  `lib/auth.js`) for every account created before that lookup existed.
  Skipping it locks existing employees out of signing in by username
  until they change their username or email.
- **Repair Booking Ownership** — fills in the real `salesmanUid` on
  bookings created before it existed, wherever the salesman's name
  unambiguously matches one current employee. Needed for "Only see my
  own bookings" (Settings → Employees → Permissions) to work precisely
  on old records instead of falling back to a name-based approximation.

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

## Deployment on Vercel

1. Push to GitHub
2. Import project in Vercel
3. Add the same environment variables
4. Deploy
