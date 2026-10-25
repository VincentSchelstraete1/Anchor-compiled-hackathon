"use client";

import type { Person } from "@/lib/api/types";
import { SERIF } from "./AmbientDisplay";
import { resolveMediaUrl } from "./companion-api";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function PersonAvatar({ person, className = "size-16" }: { person: Person; className?: string }) {
  const photo = resolveMediaUrl(person.photo_url);
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--a-sage-soft)] ${className}`}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt={`${person.name}, your ${person.relationship.toLowerCase()}`} className="absolute inset-0 size-full object-cover" />
      ) : (
        <span aria-hidden="true" className={`${SERIF} text-2xl text-[var(--a-sage)]`}>
          {initials(person.name)}
        </span>
      )}
    </span>
  );
}
