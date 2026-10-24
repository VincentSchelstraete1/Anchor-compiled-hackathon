"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Event, EventCreate, EventStatus, Person } from "@/lib/api/types";
import { Field, inputClass, toLocalInput } from "./ui";

export function EventForm({ event, people, onSubmit, onCancel }: { event?: Event; people: Person[]; onSubmit: (data: EventCreate) => Promise<void>; onCancel: () => void }) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    setSaving(true); setError(null);
    try { await onSubmit({ title: String(formData.get("title") ?? "").trim(), description: String(formData.get("description") ?? "").trim(), start_time: new Date(String(formData.get("start_time"))).toISOString(), person_id: formData.get("person_id") ? Number(formData.get("person_id")) : null, reminder_minutes: Number(formData.get("reminder_minutes")), status: String(formData.get("status")) as EventStatus }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save this event."); setSaving(false); }
  }
  return <form action={submit} className="space-y-4">
    <Field label="Event title" htmlFor="title"><input id="title" name="title" required maxLength={120} defaultValue={event?.title} className={inputClass} autoFocus /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Date and time" htmlFor="start_time"><input id="start_time" name="start_time" type="datetime-local" required defaultValue={toLocalInput(event?.start_time)} className={inputClass} /></Field><Field label="Person" htmlFor="person_id"><select id="person_id" name="person_id" defaultValue={event?.person_id ?? ""} className={inputClass}><option value="">No person linked</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Reminder" htmlFor="reminder_minutes"><select id="reminder_minutes" name="reminder_minutes" defaultValue={event?.reminder_minutes ?? 30} className={inputClass}><option value="0">At event time</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></Field><Field label="Status" htmlFor="status"><select id="status" name="status" defaultValue={event?.status ?? "scheduled"} className={inputClass}><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></Field></div>
    <Field label="Notes" htmlFor="description"><textarea id="description" name="description" rows={4} maxLength={2000} defaultValue={event?.description} className={inputClass} placeholder="Anything helpful to know" /></Field>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}<div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={saving}>{saving && <LoaderCircle className="animate-spin motion-reduce:animate-none" />} {event ? "Save changes" : "Schedule event"}</Button></div>
  </form>;
}
