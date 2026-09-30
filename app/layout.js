import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { LanguageProvider } from "@/lib/i18n";
import { Toaster } from "react-hot-toast";
import LicenseGate from "@/components/LicenseGate";
import TopLoader from "@/components/TopLoader";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata = {
  title: "Travel Agency Management",
  description: "Complete Travel Agency CRM, Booking & Accounting System",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased bg-gray-50 text-gray-900`}>
        {/* LanguageProvider was defined in lib/i18n.js but never mounted
            anywhere — every page calling useLanguage() (clients,
            corporates, suppliers) was throwing "useLanguage must be used
            within a LanguageProvider" and crashing on render. This is the
            fix. Placed outside AuthProvider so the language/RTL direction
            is available even on the (auth)/login screen, before anyone
            is signed in. */}
        <LanguageProvider>
          <AuthProvider>
            <Suspense fallback={null}>
              <TopLoader />
            </Suspense>
            <LicenseGate>{children}</LicenseGate>
            <Toaster position="top-right" />
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
