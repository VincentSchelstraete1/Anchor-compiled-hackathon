"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Gently dissolves its content in whenever `id` changes. No animation under prefers-reduced-motion. */
export function Fade({ id, children, className, duration = 900 }: { id: string | number; children: ReactNode; className?: string; duration?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    ref.current?.animate({ opacity: [0, 1], transform: ["translateY(10px)", "translateY(0)"] }, { duration, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" });
  }, [id, duration]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
