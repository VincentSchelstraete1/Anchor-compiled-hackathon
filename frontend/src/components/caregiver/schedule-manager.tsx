"use client";

import { CalendarDays, Clock3, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Event, EventCreate, Person } from "@/lib/api/types";
import { caregiverApi } from "./api";
import { EventForm } from "./event-form";
import { EmptyState, ErrorState, formatDateTime, LoadingState, Modal, Notice, PageHeader } from "./ui";

const statusStyle = { scheduled: "bg-primary/10 text-primary", completed: "bg-secondary text-secondary-foreground", cancelled: "bg-destructive/10 text-destructive" };

export function ScheduleManager() {
  const [events, setEvents] = useState<Event[]>([]); const [people, setPeople] = useState<Person[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [editing, setEditing] = useState<Event | null | undefined>(); const [notice, setNotice] = useState<string | null>(null);
  const names = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);
  const load = useCallback(async () => { setLoading(true); setError(null); try { const [eventData, peopleData] = await Promise.all([caregiverApi.events.list(), caregiverApi.people.list()]); setEvents(eventData.items); setPeople(peopleData.items); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load the schedule."); } finally { setLoading(false); } }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function save(data: EventCreate) { const saved = editing ? await caregiverApi.events.update(editing.id, data) : await caregiverApi.events.create(data); setEvents((items) => (editing ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]).sort((a, b) => a.start_time.localeCompare(b.start_time))); setEditing(undefined); setNotice(editing ? "Event updated." : "Event scheduled."); }
  async function remove(event: Event) { if (!window.confirm(`Delete “${event.title}”?`)) return; try { await caregiverApi.events.remove(event.id); setEvents((items) => items.filter(({ id }) => id !== event.id)); setNotice("Event deleted."); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to delete this event."); } }
  return <div className="space-y-8"><PageHeader eyebrow="Schedule" title="Visits and events" description="Plan what’s coming up and choose when Anchor should give a reminder." action={<Button onClick={() => setEditing(null)}><Plus /> Schedule event</Button>} /><Notice message={notice} />
    {loading ? <LoadingState label="Loading schedule" /> : error ? <ErrorState message={error} retry={load} /> : events.length === 0 ? <EmptyState icon={<CalendarDays />} title="Nothing scheduled" description="Add an appointment, visit, or meaningful occasion." action={<Button onClick={() => setEditing(null)}><Plus /> Schedule an event</Button>} /> : <div className="space-y-3">{events.map((event) => <article key={event.id} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-[auto_1fr_auto] sm:items-center"><div className="grid size-12 place-items-center rounded-xl bg-secondary text-primary"><CalendarDays /></div><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{event.title}</h2><span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusStyle[event.status]}`}>{event.status}</span></div><p className="mt-1 text-sm font-medium">{formatDateTime(event.start_time)}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Clock3 className="size-3.5" /> Reminder {event.reminder_minutes === 0 ? "at start" : `${event.reminder_minutes} minutes before`}</span>{event.person_id && <span className="flex items-center gap-1"><UserRound className="size-3.5" /> {names.get(event.person_id) ?? "Linked person"}</span>}</div>{event.description && <p className="mt-2 text-sm text-muted-foreground">{event.description}</p>}</div><div className="flex sm:justify-end"><Button size="icon" variant="ghost" onClick={() => setEditing(event)} aria-label={`Edit ${event.title}`}><Pencil /></Button><Button size="icon" variant="ghost" className="text-destructive" onClick={() => void remove(event)} aria-label={`Delete ${event.title}`}><Trash2 /></Button></div></article>)}</div>}
    {editing !== undefined && <Modal title={editing ? "Edit event" : "Schedule an event"} description="Dates display in your local timezone." onClose={() => setEditing(undefined)}><EventForm event={editing ?? undefined} people={people} onSubmit={save} onCancel={() => setEditing(undefined)} /></Modal>}
  </div>;
}
