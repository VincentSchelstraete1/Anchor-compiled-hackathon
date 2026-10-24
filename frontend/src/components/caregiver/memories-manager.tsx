"use client";

import { BookHeart, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Memory, MemoryCreate, Person } from "@/lib/api/types";
import { caregiverApi } from "./api";
import { MemoryForm } from "./memory-form";
import { EmptyState, ErrorState, formatDateTime, LoadingState, Modal, Notice, PageHeader } from "./ui";

export function MemoriesManager() {
  const [memories, setMemories] = useState<Memory[]>([]); const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [editing, setEditing] = useState<Memory | null | undefined>(); const [notice, setNotice] = useState<string | null>(null);
  const names = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);
  const load = useCallback(async () => { setLoading(true); setError(null); try { const [memoryData, peopleData] = await Promise.all([caregiverApi.memories.list(), caregiverApi.people.list()]); setMemories(memoryData.items); setPeople(peopleData.items); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load memories."); } finally { setLoading(false); } }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function save(data: MemoryCreate) { const saved = editing ? await caregiverApi.memories.update(editing.id, data) : await caregiverApi.memories.create(data); setMemories((items) => editing ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items]); setEditing(undefined); setNotice(editing ? "Memory updated." : "Memory saved."); }
  async function remove(memory: Memory) { if (!window.confirm(`Delete “${memory.title}”?`)) return; try { await caregiverApi.memories.remove(memory.id); setMemories((items) => items.filter(({ id }) => id !== memory.id)); setNotice("Memory deleted."); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to delete this memory."); } }
  return <div className="space-y-8"><PageHeader eyebrow="Memories" title="Stories worth keeping" description="Capture trusted details the companion can return to in conversation." action={<Button onClick={() => setEditing(null)}><Plus /> Add memory</Button>} /><Notice message={notice} />
    {loading ? <LoadingState label="Loading memories" /> : error ? <ErrorState message={error} retry={load} /> : memories.length === 0 ? <EmptyState icon={<BookHeart />} title="No memories saved yet" description="Create the first memory to give Anchor a reliable piece of personal context." action={<Button onClick={() => setEditing(null)}><Plus /> Add a memory</Button>} /> : <div className="grid gap-4 lg:grid-cols-2">{memories.map((memory) => <article key={memory.id} className="rounded-2xl border bg-card p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">{memory.category}</span><h2 className="mt-3 text-lg font-semibold">{memory.title}</h2></div><div className="flex"><Button size="icon" variant="ghost" onClick={() => setEditing(memory)} aria-label={`Edit ${memory.title}`}><Pencil /></Button><Button size="icon" variant="ghost" className="text-destructive" onClick={() => void remove(memory)} aria-label={`Delete ${memory.title}`}><Trash2 /></Button></div></div><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{memory.content}</p><footer className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-4 text-xs text-muted-foreground"><span>{formatDateTime(memory.created_at)}</span>{memory.person_id && <span className="flex items-center gap-1"><UserRound className="size-3.5" /> {names.get(memory.person_id) ?? "Linked person"}</span>}</footer></article>)}</div>}
    {editing !== undefined && <Modal title={editing ? "Edit memory" : "Add a memory"} description="Write a specific, factual detail in familiar language." onClose={() => setEditing(undefined)}><MemoryForm memory={editing ?? undefined} people={people} onSubmit={save} onCancel={() => setEditing(undefined)} /></Modal>}
  </div>;
}
