import { Heart } from "lucide-react";
import type { Memory, Person } from "@/lib/api/types";
import { SERIF } from "./AmbientDisplay";

export function MemorySpotlight({ memory, person }: { memory: Memory; person: Person | null }) {
  return (
    <section aria-label="A memory" className="rounded-3xl bg-[var(--a-sage-soft)] p-7">
      <h3 className="flex items-center gap-3 text-xl font-semibold uppercase tracking-wider text-[var(--a-sage)]">
        <Heart aria-hidden="true" className="size-6" />
        {person ? `A memory with ${person.name}` : "A memory"}
      </h3>
      <p className={`${SERIF} mt-3 line-clamp-4 text-3xl leading-snug`}>{memory.content}</p>
      <p className="mt-2 text-xl text-[var(--a-muted)]">{memory.title}</p>
    </section>
  );
}
