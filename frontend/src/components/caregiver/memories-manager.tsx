"use client";

import { BookHeart, Calendar, Pencil, Plus, Search, Trash2, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Memory, MemoryCreate, Person } from "@/lib/api/types";
import { caregiverApi } from "./api";
import { MemoryForm } from "./memory-form";
import { EmptyState, ErrorState, formatDateTime, inputClass, LoadingState, Modal, Notice, PageHeader } from "./ui";

export function MemoriesManager() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Memory | null | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const names = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);
  const categories = useMemo(() => [...new Set(memories.map(({ category }) => category))].sort(), [memories]);
  const visibleMemories = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return memories.filter((memory) => {
      const matchesText = !query || `${memory.title} ${memory.content} ${memory.category}`.toLocaleLowerCase().includes(query);
      return matchesText && (!personFilter || String(memory.person_id ?? "") === personFilter) && (!categoryFilter || memory.category === categoryFilter);
    });
  }, [categoryFilter, memories, personFilter, search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [memoryData, peopleData] = await Promise.all([caregiverApi.memories.list(), caregiverApi.people.list()]);
      setMemories(memoryData.items);
      setPeople(peopleData.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load memories.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const searchParams = new URLSearchParams(window.location.search);
      setPersonFilter(searchParams.get("person_id") ?? "");
      if (searchParams.get("new") === "1" || searchParams.has("person_id")) setEditing(null);
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(data: MemoryCreate) {
    const saved = editing ? await caregiverApi.memories.update(editing.id, data) : await caregiverApi.memories.create(data);
    setMemories((items) => editing ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items]);
    setEditing(undefined);
    setNotice(editing ? "Memory updated." : "Memory saved to Anchor.");
  }

  async function remove(memory: Memory) {
    if (!window.confirm(`Delete “${memory.title}”?`)) return;
    try {
      await caregiverApi.memories.remove(memory.id);
      setMemories((items) => items.filter(({ id }) => id !== memory.id));
      setNotice("Memory deleted.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete this memory.");
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Memories" title="Stories worth keeping" description="A living scrapbook of the people, places, and details that make life familiar." action={<Button onClick={() => setEditing(null)}><Plus /> Add memory</Button>} />
      <Notice message={notice} />
      {loading ? <LoadingState label="Opening the memory box" /> : error ? <ErrorState message={error} retry={load} /> : memories.length === 0 ? <EmptyState icon={<BookHeart />} title="Your memory box is ready" description="Begin with one vivid, meaningful detail Anchor can safely return to in conversation." action={<Button onClick={() => setEditing(null)}><Plus /> Add the first memory</Button>} /> : <>
        <section className="grid gap-3 rounded-2xl border bg-card p-4 shadow-sm md:grid-cols-[1fr_12rem_12rem]" aria-label="Filter memories">
          <label className="relative"><span className="sr-only">Search memories</span><Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} className={`${inputClass} pl-10`} placeholder="Search titles and stories" /></label>
          <label><span className="sr-only">Filter by person</span><select value={personFilter} onChange={(event) => setPersonFilter(event.target.value)} className={inputClass}><option value="">All people</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label><span className="sr-only">Filter by category</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={inputClass}><option value="">All categories</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
        </section>
        {visibleMemories.length === 0 ? <EmptyState icon={<Search />} title="No memories match" description="Try a different word, person, or category." action={<Button variant="outline" onClick={() => { setSearch(""); setPersonFilter(""); setCategoryFilter(""); }}>Clear filters</Button>} /> : <div className="grid gap-5 lg:grid-cols-2">{visibleMemories.map((memory, index) => <article key={memory.id} className="relative overflow-hidden rounded-[1.25rem] border bg-card p-6 shadow-sm"><div className={`absolute inset-y-0 left-0 w-1.5 ${index % 2 === 0 ? "bg-[#728a76]" : "bg-[#b9684f]"}`} /><div className="flex items-start justify-between gap-4"><div><span className="rounded-full bg-[#f3eadc] px-3 py-1 text-xs font-semibold text-[#755a48]">{memory.category}</span><h2 className="mt-4 font-serif text-2xl font-semibold">{memory.title}</h2></div><div className="flex"><Button size="icon" variant="ghost" onClick={() => setEditing(memory)} aria-label={`Edit ${memory.title}`}><Pencil /></Button><Button size="icon" variant="ghost" className="text-destructive" onClick={() => void remove(memory)} aria-label={`Delete ${memory.title}`}><Trash2 /></Button></div></div><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{memory.content}</p><footer className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Calendar className="size-3.5" />{formatDateTime(memory.created_at)}</span>{memory.person_id && <span className="flex items-center gap-1"><UserRound className="size-3.5" /> {names.get(memory.person_id) ?? "Linked person"}</span>}</footer></article>)}</div>}
      </>}
      {editing !== undefined && <Modal title={editing ? "Edit this memory" : "Add a meaningful memory"} description="A clear story helps Anchor answer with warmth and accuracy." onClose={() => setEditing(undefined)}><MemoryForm memory={editing ?? undefined} people={people} initialPersonId={personFilter ? Number(personFilter) : null} onSubmit={save} onCancel={() => setEditing(undefined)} /></Modal>}
    </div>
  );
}
