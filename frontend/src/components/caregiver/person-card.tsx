import { ArrowRight, Pencil, Trash2, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { Person } from "@/lib/api/types";
import { resolvePhotoUrl } from "@/lib/api/photos";
import { isDemoPerson } from "./demo";

export function PersonCard({ person, onEdit, onDelete }: { person: Person; onEdit: () => void; onDelete: () => void }) {
  return (
    <article className="group overflow-hidden rounded-[1.25rem] border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none">
      <div className="relative aspect-[4/3] bg-secondary">
        {person.photo_url ? <Image src={resolvePhotoUrl(person.photo_url)} alt={`Portrait of ${person.name}`} fill sizes="(min-width: 1280px) 30vw, (min-width: 640px) 45vw, 100vw" className="object-cover" unoptimized /> : <div className="grid h-full place-items-center text-primary"><UserRound className="size-16" aria-hidden="true" /><span className="sr-only">No photograph</span></div>}
      </div>
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2"><p className="text-xs font-semibold uppercase tracking-wider text-primary">{person.relationship}</p>{isDemoPerson(person) && <span className="rounded-full bg-[#f6e5c7] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[#7b582f]">Fictional demo</span>}</div>
        <h2 className="mt-1 text-xl font-semibold">{person.name}</h2>
        <p className="mt-2 min-h-10 text-sm leading-relaxed text-muted-foreground">{person.description || "No additional details yet."}</p>
        <div className="mt-5 flex flex-wrap gap-2"><Button asChild size="sm"><Link href={`/caregiver/people/${person.id}`}>View profile <ArrowRight /></Link></Button><Button variant="outline" size="sm" onClick={onEdit}><Pencil /> Edit</Button><Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete}><Trash2 /> Remove</Button></div>
      </div>
    </article>
  );
}
