"use client";

import { ArrowLeft, CalendarDays, Clock3, Heart, Pencil, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Event, Memory, Person, PersonCreate } from "@/lib/api/types";
import { resolvePhotoUrl } from "@/lib/api/photos";
import { caregiverApi } from "./api";
import { PersonForm } from "./person-form";
import { isDemoPerson } from "./demo";
import { EmptyState, ErrorState, formatDateTime, LoadingState, Modal, Notice, Surface } from "./ui";

export function PersonProfile() {
  const params = useParams<{ person_id: string }>();
  const personId = Number(params.person_id);
  const [person, setPerson] = useState<Person | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!Number.isInteger(personId) || personId < 1) throw new Error("This person profile is not valid.");
      const from = new Date().toISOString();
      const [personData, memoryData, eventData] = await Promise.all([
        caregiverApi.people.get(personId),
        caregiverApi.memories.list({ person_id: personId }),
        caregiverApi.events.list(`?from=${encodeURIComponent(from)}&status=scheduled`),
      ]);
      setPerson(personData);
      setMemories(memoryData.items);
      setEvents(eventData.items.filter((event) => event.person_id === personId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load this profile.");
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(data: PersonCreate) {
    const saved = await caregiverApi.people.update(personId, data);
    setPerson(saved);
    setEditing(false);
    setNotice("Profile updated.");
  }

  if (loading) return <LoadingState label="Opening profile" />;
  if (error || !person) return <div className="space-y-5"><Button asChild variant="ghost"><Link href="/caregiver/people"><ArrowLeft /> Back to people</Link></Button><ErrorState message={error ?? "Person not found."} retry={load} /></div>;

  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" className="-ml-3"><Link href="/caregiver/people"><ArrowLeft /> All people</Link></Button>
      <Notice message={notice} />
      <section className="overflow-hidden rounded-[1.75rem] border bg-card shadow-sm">
        <div className="grid md:grid-cols-[minmax(17rem,0.8fr)_1.2fr]">
          <div className="relative min-h-72 bg-[#dfe6d9] md:min-h-[28rem]">
            {person.photo_url ? <Image src={resolvePhotoUrl(person.photo_url)} alt={`Portrait of ${person.name}`} fill sizes="(min-width: 768px) 40vw, 100vw" className="object-cover" unoptimized priority /> : <div className="grid h-full min-h-72 place-items-center text-[#728a76]"><UserRound className="size-24" /></div>}
          </div>
          <div className="flex flex-col justify-center p-7 sm:p-10 lg:p-14">
            <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#b9684f]">{person.relationship}</p>{isDemoPerson(person) && <span className="rounded-full bg-[#f6e5c7] px-2.5 py-1 text-xs font-semibold text-[#7b582f]">Fictional demo profile</span>}</div>
            <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tight sm:text-5xl">{person.name}</h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">{person.description || "Add a few details that make this person feel familiar."}</p>
            <div className="mt-8 flex flex-wrap gap-3"><Button onClick={() => setEditing(true)}><Pencil /> Edit profile</Button><Button asChild variant="outline"><Link href={`/caregiver/memories?person_id=${person.id}`}>Add a memory</Link></Button></div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <Surface>
          <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-semibold text-[#b9684f]">Scrapbook</p><h2 className="mt-1 font-serif text-2xl font-semibold">Shared memories</h2></div><Heart className="text-[#b9684f]" /></div>
          {memories.length === 0 ? <EmptyState icon={<Heart />} title="No shared memories yet" description={`Add a story, favorite, or detail that Anchor can connect with ${person.name}.`} action={<Button asChild><Link href={`/caregiver/memories?person_id=${person.id}`}>Add a memory</Link></Button>} /> : <div className="mt-5 columns-1 gap-4 sm:columns-2">{memories.map((memory) => <article key={memory.id} className="mb-4 break-inside-avoid rounded-2xl border bg-[#fffdf8] p-5"><span className="text-xs font-semibold uppercase tracking-wider text-[#728a76]">{memory.category}</span><h3 className="mt-2 font-serif text-xl font-semibold">{memory.title}</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{memory.content}</p><p className="mt-4 text-xs text-muted-foreground">Saved {formatDateTime(memory.created_at)}</p></article>)}</div>}
        </Surface>
        <Surface>
          <div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-[#728a76]">Time together</p><h2 className="mt-1 font-serif text-2xl font-semibold">Upcoming visits</h2></div><CalendarDays className="text-[#728a76]" /></div>
          {events.length === 0 ? <p className="mt-6 rounded-xl bg-muted p-5 text-sm leading-6 text-muted-foreground">No upcoming visit is scheduled with {person.name}.</p> : <ol className="mt-6 space-y-5">{events.map((event) => <li key={event.id} className="relative border-l-2 border-[#d8c7b7] pl-5"><span className="absolute -left-[7px] top-1 size-3 rounded-full border-2 border-card bg-[#b9684f]" /><h3 className="font-medium">{event.title}</h3><p className="mt-1 text-sm text-muted-foreground">{formatDateTime(event.start_time)}</p><p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3.5" /> Reminder set</p></li>)}</ol>}
          <Button asChild variant="outline" className="mt-6 w-full"><Link href={`/caregiver/schedule?person_id=${person.id}`}>Schedule a visit</Link></Button>
        </Surface>
      </div>
      {editing && <Modal title="Edit profile" description="Keep this portrait warm, familiar, and accurate." onClose={() => setEditing(false)}><PersonForm person={person} onSubmit={save} onCancel={() => setEditing(false)} /></Modal>}
    </div>
  );
}
