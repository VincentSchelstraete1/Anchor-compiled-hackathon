import { Heart } from "lucide-react";
import type { Memory, Person } from "@/lib/api/types";
import { SERIF } from "./AmbientDisplay";

export function MemorySpotlight({ memory, person, optional }: { memory: Memory; person: Person | null; optional?: boolean }) {
  return (
    <section aria-label="A memory" className={`${optional ? "anchor-optional" : ""} rounded-3xl bg-[var(--a-sage-soft)] p-5`}>
      <h3 className="flex items-center gap-3 text-xl font-semibold uppercase tracking-wider text-[var(--a-sage)]">
        <Heart aria-hidden="true" className="size-6" />
        {person ? `A memory with ${person.name}` : "A memory"}
      </h3>
      <p className={`${SERIF} mt-2 ${optional ? "line-clamp-2" : "line-clamp-3"} text-[clamp(1.375rem,3.2vh,1.875rem)] leading-snug`}>{memory.content}</p>
      <p className="mt-1 text-xl text-[var(--a-muted)]">{memory.title}</p>
    </section>
  );
}
