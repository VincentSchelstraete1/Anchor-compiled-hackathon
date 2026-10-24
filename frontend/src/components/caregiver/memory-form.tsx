"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Memory, MemoryCreate, Person } from "@/lib/api/types";
import { Field, inputClass } from "./ui";

export function MemoryForm({ memory, people, onSubmit, onCancel }: { memory?: Memory; people: Person[]; onSubmit: (data: MemoryCreate) => Promise<void>; onCancel: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    setSaving(true); setError(null);
    try { await onSubmit({ title: String(formData.get("title") ?? "").trim(), content: String(formData.get("content") ?? "").trim(), category: String(formData.get("category") ?? "").trim(), person_id: formData.get("person_id") ? Number(formData.get("person_id")) : null }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save this memory."); setSaving(false); }
  }
  return <form action={submit} className="space-y-4">
    <Field label="Memory title" htmlFor="title"><input id="title" name="title" required maxLength={120} defaultValue={memory?.title} className={inputClass} autoFocus /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Category" htmlFor="category"><input id="category" name="category" required maxLength={120} defaultValue={memory?.category} className={inputClass} placeholder="Family story, favorite…" /></Field><Field label="Connected person" htmlFor="person_id"><select id="person_id" name="person_id" defaultValue={memory?.person_id ?? ""} className={inputClass}><option value="">No specific person</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field></div>
    <Field label="What should Anchor remember?" htmlFor="content" hint="Stick to concrete details. Anchor uses this text to answer personal questions."><textarea id="content" name="content" required rows={6} maxLength={4000} defaultValue={memory?.content} className={inputClass} /></Field>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={saving}>{saving && <LoaderCircle className="animate-spin motion-reduce:animate-none" />} {memory ? "Save changes" : "Save memory"}</Button></div>
  </form>;
}
