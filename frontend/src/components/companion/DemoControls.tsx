"use client";

import { useEffect, useState } from "react";

const FLAG = "anchor.demo";

export interface DemoActions {
  checkIn: () => void;
  visitor: () => void;
  personCard: () => void;
  briefing: () => void;
  reset: () => void;
}

/**
 * Development-only. Never rendered in a production build. Hidden until switched on with ?demo=1 or Ctrl+Shift+D,
 * so the person using Anchor never sees it. Each button drives the real reminder / chat / display pipeline.
 */
export function DemoControls({ actions }: { actions: DemoActions }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const id = setTimeout(() => {
      try {
        if (new URLSearchParams(window.location.search).get("demo") === "1") window.localStorage.setItem(FLAG, "1");
        setOpen(window.localStorage.getItem(FLAG) === "1");
      } catch {
        // Storage blocked: stay hidden.
      }
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "d") {
        setOpen((value) => {
          const next = !value;
          try {
            window.localStorage.setItem(FLAG, next ? "1" : "0");
          } catch {
            // ignore
          }
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (process.env.NODE_ENV === "production" || !open) return null;
  const b = "rounded-lg border border-[var(--a-border)] bg-[var(--a-card)] px-3 py-1.5 text-sm font-medium";
  return (
    <aside aria-label="Developer demo controls" data-testid="demo-controls" className="fixed bottom-2 left-2 z-50 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--a-border)] bg-[var(--a-bg)]/90 p-2 opacity-80 hover:opacity-100">
      <span className="text-xs uppercase tracking-wider text-[var(--a-muted)]">Demo</span>
      <button type="button" className={b} onClick={actions.checkIn}>Check-in</button>
      <button type="button" className={b} onClick={actions.visitor}>Visitor reminder</button>
      <button type="button" className={b} onClick={actions.personCard}>Person card</button>
      <button type="button" className={b} onClick={actions.briefing}>Daily briefing</button>
      <button type="button" className={b} onClick={actions.reset}>Reset acks</button>
    </aside>
  );
}
