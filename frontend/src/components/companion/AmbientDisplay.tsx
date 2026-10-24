import type { CSSProperties, ReactNode } from "react";
import type { TimeOfDay } from "./logic/home-context";

// Warm ivory, sage and terracotta; evening and night soften and dim. All text pairs meet WCAG AA (see PALETTES notes).
const PALETTES: Record<TimeOfDay, Record<string, string>> = {
  morning: { bg: "#F7F1E5", fg: "#2B2620", muted: "#5A5145", card: "#FFFBF3", border: "#DDD1BB", sage: "#3F6652", sageSoft: "#DDE7DC", terra: "#A5482C", terraSoft: "#F3DFD3", onAccent: "#FFFBF3" },
  afternoon: { bg: "#F4ECDA", fg: "#2B2620", muted: "#574E42", card: "#FFFAF0", border: "#D9CCB2", sage: "#3F6652", sageSoft: "#D9E4D8", terra: "#A5482C", terraSoft: "#F1DACB", onAccent: "#FFFAF0" },
  evening: { bg: "#E9DCC6", fg: "#271F19", muted: "#4F4438", card: "#F6ECD9", border: "#CDBD9F", sage: "#385C49", sageSoft: "#D3DFD0", terra: "#97401F", terraSoft: "#EDD3BF", onAccent: "#F6ECD9" },
  night: { bg: "#1E1A16", fg: "#F3EBDC", muted: "#CDC1AC", card: "#2A2520", border: "#4A4136", sage: "#A8C8B3", sageSoft: "#2B3A31", terra: "#E6A088", terraSoft: "#3B2A23", onAccent: "#1E1A16" },
};

const CSS = `
@keyframes anchor-breathe { 0%,100% { transform: scale(1); opacity: .55 } 50% { transform: scale(1.28); opacity: 0 } }
@keyframes anchor-speak { 0%,100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
@media (prefers-reduced-motion: no-preference) {
  .anchor-ring { animation: anchor-breathe 2.8s ease-out infinite }
  .anchor-ring-2 { animation-delay: 1.4s }
  .anchor-bar { animation: anchor-speak 1.1s ease-in-out infinite }
}
`;

export function AmbientDisplay({ tod, stateName, children }: { tod: TimeOfDay; stateName: string; children: ReactNode }) {
  const p = PALETTES[tod];
  const vars = {
    "--a-bg": p.bg, "--a-fg": p.fg, "--a-muted": p.muted, "--a-card": p.card, "--a-border": p.border,
    "--a-sage": p.sage, "--a-sage-soft": p.sageSoft, "--a-terra": p.terra, "--a-terra-soft": p.terraSoft, "--a-on-accent": p.onAccent,
    background: p.bg, color: p.fg, transition: "background-color 2s ease, color 2s ease",
  } as CSSProperties;
  return (
    <main
      data-tod={tod}
      data-state={stateName}
      style={vars}
      className="grid min-h-dvh gap-8 p-6 sm:p-8 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:p-12 [font-family:Arial,Helvetica,sans-serif]"
    >
      <style>{CSS}</style>
      {children}
    </main>
  );
}

/** Serif face for names and numerals, from system fonts (no network font loading). */
export const SERIF = "[font-family:'Iowan_Old_Style','Palatino_Linotype',Palatino,Georgia,serif]";
