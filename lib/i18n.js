"use client";

import { createContext, useContext, useState, useEffect } from "react";
import en from "@/locales/en.json";
import ar from "@/locales/ar.json";

const translations = { en, ar };

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  // Always start in English by default. The language switcher still lets
  // the user change to Arabic for the current session, but that choice is
  // not restored on the next visit — every fresh load starts in English.
  const [locale, setLocale] = useState("en");

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const t = (key) => {
    const keys = key.split(".");
    let value = translations[locale];
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) return key;
    }
    return value;
  };

  const toggleLanguage = () => {
    setLocale((prev) => (prev === "en" ? "ar" : "en"));
  };

  const changeLanguage = (lang) => {
    if (lang === "en" || lang === "ar") {
      setLocale(lang);
    }
  };

  return (
    <LanguageContext.Provider value={{ locale, t, toggleLanguage, changeLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
