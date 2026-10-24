"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Memory, MemoryCreate, Person } from "@/lib/api/types";
import { Field, inputClass } from "./ui";

const suggestedCategories = ["Family story", "Favorite activity", "Important preference", "Daily routine", "Milestone", "Place"];

export function MemoryForm({ memory, people, initialCategory, initialPersonId, onSubmit, onCancel }: { memory?: Memory; people: Person[]; initialCategory?: string; initialPersonId?: number | null; onSubmit: (data: MemoryCreate) => Promise<void>; onCancel: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    setSaving(true); setError(null);
    try { await onSubmit({ title: String(formData.get("title") ?? "").trim(), content: String(formData.get("content") ?? "").trim(), category: String(formData.get("category") ?? "").trim(), person_id: formData.get("person_id") ? Number(formData.get("person_id")) : null }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save this memory."); setSaving(false); }
  }
  return <form action={submit} className="space-y-4">
    <Field label="Meaningful title" htmlFor="title" hint="A short phrase that will help you recognize this memory later."><input id="title" name="title" required maxLength={120} defaultValue={memory?.title} className={inputClass} placeholder="Sunday mornings in the garden" autoFocus /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Category" htmlFor="category"><input id="category" name="category" list="memory-categories" required maxLength={120} defaultValue={memory?.category ?? initialCategory} className={inputClass} placeholder="Choose or type a category" /><datalist id="memory-categories">{suggestedCategories.map((category) => <option key={category} value={category} />)}</datalist></Field><Field label="Associated person" htmlFor="person_id"><select id="person_id" name="person_id" defaultValue={memory?.person_id ?? initialPersonId ?? ""} className={inputClass}><option value="">Shared family memory</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field></div>
    <Field label="Tell the story" htmlFor="content" hint="Include concrete details and familiar language. Anchor uses this text as trusted context."><textarea id="content" name="content" required rows={7} maxLength={4000} defaultValue={memory?.content} className={inputClass} placeholder="What happened? Who was there? Why does it matter?" /></Field>
    <div className="rounded-xl border border-[#d9cbbb] bg-[#fbf4e8] p-3 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">About photographs:</strong> the current memory API does not support an image. Add a photograph to the associated person’s profile instead.</div>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={saving}>{saving && <LoaderCircle className="animate-spin motion-reduce:animate-none" />} {memory ? "Save changes" : "Save memory"}</Button></div>
  </form>;
}
