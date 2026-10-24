import type { CSSProperties, ReactNode } from "react";
import type { TimeOfDay } from "./logic/home-context";

// Warm ivory, sage and terracotta; evening and night soften and dim. All text pairs meet WCAG AA (see PALETTES notes).
const PALETTES: Record<TimeOfDay, Record<string, string>> = {
  morning: { bg: "#F7F1E5", fg: "#2B2620", muted: "#5A5145", card: "#FFFBF3", border: "#DDD1BB", sage: "#3F6652", sageSoft: "#DDE7DC", terra: "#A5482C", terraSoft: "#F3DFD3", onAccent: "#FFFBF3" },
  afternoon: { bg: "#F4ECDA", fg: "#2B2620", muted: "#574E42", card: "#FFFAF0", border: "#D9CCB2", sage: "#3F6652", sageSoft: "#D9E4D8", terra: "#A5482C", terraSoft: "#F7E6DB", onAccent: "#FFFAF0" },
  evening: { bg: "#E9DCC6", fg: "#271F19", muted: "#4F4438", card: "#F6ECD9", border: "#CDBD9F", sage: "#385C49", sageSoft: "#D3DFD0", terra: "#97401F", terraSoft: "#EDD3BF", onAccent: "#F6ECD9" },
  night: { bg: "#1E1A16", fg: "#F3EBDC", muted: "#CDC1AC", card: "#2A2520", border: "#4A4136", sage: "#A8C8B3", sageSoft: "#2B3A31", terra: "#E6A088", terraSoft: "#3B2A23", onAccent: "#1E1A16" },
};

const CSS = `
@keyframes anchor-breathe { 0%,100% { transform: scale(1); opacity: .55 } 50% { transform: scale(1.28); opacity: 0 } }
@keyframes anchor-speak { 0%,100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
.anchor-photo { aspect-ratio: 4 / 3 }
.anchor-clock { font-size: clamp(3rem, min(13vh, 16cqw), 9rem); white-space: nowrap; line-height: 1 }
/* Desktop and tablet-landscape: the whole experience fits one viewport, so nothing scrolls. */
@media (min-width: 1024px) and (min-height: 620px) {
  .anchor-shell { height: 100dvh; overflow: hidden; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) }
  .anchor-photo { aspect-ratio: auto; flex: 1 1 0; min-height: 0 }
  .anchor-col { min-height: 0 }
  .anchor-panel { flex: 1 1 0; min-height: 0; overflow-y: auto }
  .anchor-clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden }
}
/* Home-screen extras that give way when the viewport is short, so nothing has to scroll. */
@media (min-width: 1024px) and (max-height: 840px) {
  .anchor-optional { display: none }
  .anchor-col { gap: 0.5rem }
  .anchor-clock { font-size: clamp(3rem, min(12vh, 16cqw), 9rem) }
  .anchor-clamp { -webkit-line-clamp: 2 }
}
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
      className="anchor-shell grid min-h-dvh gap-5 p-4 sm:p-6 lg:gap-8 lg:p-8 [font-family:Arial,Helvetica,sans-serif]"
    >
      <style>{CSS}</style>
      {children}
    </main>
  );
}

/** Serif face for names and numerals, from system fonts (no network font loading). */
export const SERIF = "[font-family:'Iowan_Old_Style','Palatino_Linotype',Palatino,Georgia,serif]";
