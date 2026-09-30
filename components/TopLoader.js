"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A minimal top-of-page loading bar, shown on every client-side route
 * change. No dependency — the App Router doesn't expose real "navigation
 * start/end" events, so this approximates one: the moment `pathname` (or
 * the query string) changes, we know a navigation just completed, so we
 * play a quick "catch-up" sweep to 100% and fade out. It's a feedback cue
 * ("something happened"), not a literal progress measurement.
 */
export default function TopLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timers = useRef([]);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];

    setVisible(true);
    setWidth(30);
    timers.current.push(setTimeout(() => setWidth(75), 80));
    timers.current.push(
      setTimeout(() => {
        setWidth(100);
        timers.current.push(
          setTimeout(() => {
            setVisible(false);
            timers.current.push(setTimeout(() => setWidth(0), 200));
          }, 150)
        );
      }, 220)
    );

    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  return (
    <div
      className="top-loader-bar"
      style={{ width: `${width}%`, opacity: visible ? 1 : 0 }}
    />
  );
}
