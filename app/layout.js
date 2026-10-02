import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
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
        <AuthProvider>
          <Suspense fallback={null}>
            <TopLoader />
          </Suspense>
          <LicenseGate>{children}</LicenseGate>
          <Toaster position="top-right" />
        </AuthProvider>
      </body>
    </html>
  );
}
