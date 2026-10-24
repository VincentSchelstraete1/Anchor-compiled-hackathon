"use client";

import { AlarmClock, Coffee, Heart, Pencil, Plus, Sparkles, Star } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Memory, MemoryCreate, Person } from "@/lib/api/types";
import { caregiverApi } from "./api";
import { MemoryForm } from "./memory-form";
import { EmptyState, ErrorState, LoadingState, Modal, Notice, PageHeader } from "./ui";

const groups = [
  { category: "Daily routine", label: "Daily routines", description: "The familiar rhythm of an ordinary day.", icon: Coffee, color: "bg-[#dfe6d9] text-[#59705e]" },
  { category: "Favorite activity", label: "Favorite activities", description: "Things that bring comfort, energy, or joy.", icon: Star, color: "bg-[#f6e5c7] text-[#8b633c]" },
  { category: "Important preference", label: "Important preferences", description: "Small choices that help care feel personal.", icon: Heart, color: "bg-[#f3ddd5] text-[#9a5844]" },
] as const;

export function RoutinesManager() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Memory | null | undefined>();
  const [newCategory, setNewCategory] = useState<string>(groups[0].category);
  const [notice, setNotice] = useState<string | null>(null);
  const relevantMemories = useMemo(() => memories.filter((memory) => groups.some(({ category }) => category === memory.category)), [memories]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [memoryData, peopleData] = await Promise.all([caregiverApi.memories.list(), caregiverApi.people.list()]);
      setMemories(memoryData.items);
      setPeople(peopleData.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load care notes.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function save(data: MemoryCreate) {
    const saved = editing ? await caregiverApi.memories.update(editing.id, data) : await caregiverApi.memories.create(data);
    setMemories((items) => editing ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items]);
    setEditing(undefined);
    setNotice(editing ? "Care note updated." : "Care note saved.");
  }

  function add(category: string) {
    setNewCategory(category);
    setEditing(null);
  }

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Routines & preferences" title="The details that make a day feel right" description="Save trusted care notes as memories so Anchor can speak about them naturally." action={<Button onClick={() => add(groups[0].category)}><Plus /> Add care note</Button>} />
      <Notice message={notice} />
      {loading ? <LoadingState label="Loading care notes" /> : error ? <ErrorState message={error} retry={load} /> : <>
        <div className="grid gap-5 lg:grid-cols-3">{groups.map(({ category, label, description, icon: Icon, color }) => { const items = relevantMemories.filter((memory) => memory.category === category); return <section key={category} className="rounded-[1.25rem] border bg-card p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><span className={`grid size-11 place-items-center rounded-xl ${color}`}><Icon /></span><Button variant="ghost" size="sm" onClick={() => add(category)}><Plus /> Add</Button></div><h2 className="mt-5 font-serif text-2xl font-semibold">{label}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>{items.length === 0 ? <p className="mt-6 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing saved here yet.</p> : <ul className="mt-6 space-y-3">{items.map((memory) => <li key={memory.id} className="group rounded-xl bg-[#fbf8f0] p-4"><div className="flex items-start justify-between gap-2"><div><h3 className="font-medium">{memory.title}</h3><p className="mt-1 line-clamp-3 text-sm leading-5 text-muted-foreground">{memory.content}</p></div><Button variant="ghost" size="icon" className="shrink-0" onClick={() => setEditing(memory)} aria-label={`Edit ${memory.title}`}><Pencil /></Button></div></li>)}</ul>}</section>; })}</div>
        {relevantMemories.length === 0 && <EmptyState icon={<Sparkles />} title="Start with one familiar detail" description="Morning coffee, a favorite walk, preferred music, or another concrete detail can help Anchor feel personal." />}
        <section className="flex flex-col gap-4 rounded-2xl border border-[#d9cbbb] bg-[#f7eee1] p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-[#b9684f]"><AlarmClock /></span><div><h2 className="font-medium">Recurring reminders need backend support</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">The current event API schedules one date and time only. You can create a one-time reminder today.</p></div></div><Button asChild variant="outline" className="shrink-0"><Link href="/caregiver/schedule">Open schedule</Link></Button></section>
      </>}
      {editing !== undefined && <Modal title={editing ? "Edit care note" : `Add ${newCategory.toLocaleLowerCase()}`} description="Save a concrete detail Anchor can rely on." onClose={() => setEditing(undefined)}><MemoryForm memory={editing ?? undefined} people={people} initialCategory={editing?.category ?? newCategory} onSubmit={save} onCancel={() => setEditing(undefined)} /></Modal>}
    </div>
  );
}
