"use client";

import { useEffect, useRef, useState } from "react";
import type { Person } from "@/lib/api/types";

const ROTATE_MS = 45000;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function PersonSpotlight({ people }: { people: Person[] }) {
  const [index, setIndex] = useState(0);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (people.length < 2) return;
    const id = setInterval(() => setIndex((i) => i + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, [people.length]);

  // Gentle dissolve between portraits; skipped for reduced-motion users.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    frame.current?.animate({ opacity: [0, 1] }, { duration: 1200, easing: "ease-out" });
  }, [index]);

  if (people.length === 0) {
    return (
      <section aria-label="Familiar faces" className="flex min-h-80 items-center justify-center rounded-3xl border bg-card p-10 text-center shadow-sm">
        <p className="text-2xl text-muted-foreground">Family photos will appear here.</p>
      </section>
    );
  }

  const person = people[index % people.length];

  return (
    <section aria-label="Familiar faces" className="flex min-h-0 flex-col rounded-3xl border bg-card p-4 shadow-sm sm:p-6">
      <div ref={frame} className="relative min-h-80 flex-1 overflow-hidden rounded-2xl bg-accent">
        {person.photo_url ? (
          // Photos come from arbitrary caregiver-supplied URLs, so next/image optimization does not apply.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={person.photo_url} alt={`${person.name}, your ${person.relationship}`} className="absolute inset-0 size-full object-cover" />
        ) : (
          <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-9xl font-semibold text-accent-foreground/60">
            {initials(person.name)}
          </div>
        )}
      </div>
      <div className="px-2 pt-5 text-center lg:text-left">
        <h2 className="text-4xl font-semibold sm:text-5xl">{person.name}</h2>
        <p className="mt-1 text-2xl text-primary">{person.relationship}</p>
        {person.description ? <p className="mt-2 text-2xl text-muted-foreground">{person.description}</p> : null}
      </div>
    </section>
  );
}
