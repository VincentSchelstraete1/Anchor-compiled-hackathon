"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Event, EventCreate, EventStatus, Person } from "@/lib/api/types";
import { Field, inputClass, toLocalInput } from "./ui";

export function EventForm({ event, people, initialPersonId, defaultReminderMinutes = 30, onSubmit, onCancel }: { event?: Event; people: Person[]; initialPersonId?: number | null; defaultReminderMinutes?: number; onSubmit: (data: EventCreate) => Promise<void>; onCancel: () => void }) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    setSaving(true); setError(null);
    try { await onSubmit({ title: String(formData.get("title") ?? "").trim(), description: String(formData.get("description") ?? "").trim(), start_time: new Date(String(formData.get("start_time"))).toISOString(), person_id: formData.get("person_id") ? Number(formData.get("person_id")) : null, reminder_minutes: Number(formData.get("reminder_minutes")), reminder_enabled: formData.get("reminder_enabled") === "on", status: String(formData.get("status")) as EventStatus }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save this event."); setSaving(false); }
  }
  return <form action={submit} className="space-y-4">
    <Field label="Event title" htmlFor="title"><input id="title" name="title" required maxLength={120} defaultValue={event?.title} className={inputClass} autoFocus /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Date and time" htmlFor="start_time"><input id="start_time" name="start_time" type="datetime-local" required defaultValue={toLocalInput(event?.start_time)} className={inputClass} /></Field><Field label="Associated person" htmlFor="person_id"><select id="person_id" name="person_id" defaultValue={event?.person_id ?? initialPersonId ?? ""} className={inputClass}><option value="">No person linked</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Reminder" htmlFor="reminder_minutes"><select id="reminder_minutes" name="reminder_minutes" defaultValue={event?.reminder_minutes ?? defaultReminderMinutes} className={inputClass}><option value="0">At event time</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option><option value="2880">2 days before</option><option value="10080">1 week before</option></select></Field>{event ? <Field label="Status" htmlFor="status" hint="Scheduled means planned, not a confirmed arrival."><select id="status" name="status" defaultValue={event.status} className={inputClass}><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></Field> : <input type="hidden" name="status" value="scheduled" />}</div>
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-muted/35 p-4"><input type="checkbox" name="reminder_enabled" defaultChecked={event?.reminder_enabled ?? true} className="mt-1 size-4 accent-[#728a76]" /><span><span className="block font-medium">Remind Margaret about this event</span><span className="mt-1 block text-sm text-muted-foreground">Anchor can announce the reminder at the time chosen above.</span></span></label>
    <Field label="Notes" htmlFor="description"><textarea id="description" name="description" rows={4} maxLength={2000} defaultValue={event?.description} className={inputClass} placeholder="Anything helpful to know" /></Field>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}<div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={saving}>{saving && <LoaderCircle className="animate-spin motion-reduce:animate-none" />} {event ? "Save changes" : "Schedule event"}</Button></div>
  </form>;
}
