"use client";

import type { Person } from "@/lib/api/types";
import { resolvePhotoUrl } from "@/lib/api/photos";
import { SERIF } from "./AmbientDisplay";
import { Fade } from "./Fade";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function PersonSpotlight({ person }: { person: Person | null }) {
  if (!person) {
    return (
      <section aria-label="Familiar faces" className="flex min-h-60 items-center justify-center rounded-[2rem] border border-[var(--a-border)] bg-[var(--a-card)] p-10 text-center">
        <p className="text-2xl text-[var(--a-muted)]">Family photos will appear here.</p>
      </section>
    );
  }
  return (
    <section aria-label="Familiar faces" className="flex min-h-0 flex-col rounded-[2rem] border border-[var(--a-border)] bg-[var(--a-card)] p-3 shadow-sm sm:p-4">
      <Fade id={person.id} duration={1400} className="anchor-photo relative w-full overflow-hidden rounded-3xl bg-[var(--a-sage-soft)]">
        {person.photo_url ? (
          // Photos come from arbitrary caregiver-supplied URLs, so next/image optimization does not apply.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resolvePhotoUrl(person.photo_url)} alt={`${person.name}, your ${person.relationship.toLowerCase()}`} className="absolute inset-0 size-full object-cover" />
        ) : (
          <div aria-hidden="true" className={`${SERIF} absolute inset-0 flex items-center justify-center text-[clamp(5rem,20vh,10rem)] text-[var(--a-sage)] opacity-60`}>
            {initials(person.name)}
          </div>
        )}
      </Fade>
      <Fade id={`label-${person.id}`} className="px-2 pt-3">
        <h2 className={`${SERIF} text-[clamp(2.25rem,6vh,3.75rem)] font-medium leading-tight`}>{person.name}</h2>
        <p className="text-[clamp(1.5rem,3.6vh,1.875rem)] text-[var(--a-terra)]">{person.relationship}</p>
        {person.description ? <p className="text-[clamp(1.25rem,2.8vh,1.5rem)] text-[var(--a-muted)]">{person.description}</p> : null}
      </Fade>
    </section>
  );
}
