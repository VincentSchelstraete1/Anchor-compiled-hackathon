"use client";

import { CalendarDays, CheckCircle2, Clock3, Pencil, Plus, Trash2, UserRound, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CheckInSettings, Event, EventCreate, EventStatus, Person } from "@/lib/api/types";
import { caregiverApi } from "./api";
import { EventForm } from "./event-form";
import { EmptyState, ErrorState, formatDateTime, LoadingState, Modal, Notice, PageHeader } from "./ui";

const statusMeta: Record<EventStatus, { label: string; icon: typeof Clock3; style: string }> = {
  scheduled: { label: "Scheduled", icon: Clock3, style: "bg-[#dfe6d9] text-[#59705e]" },
  completed: { label: "Completed", icon: CheckCircle2, style: "bg-secondary text-secondary-foreground" },
  cancelled: { label: "Cancelled", icon: XCircle, style: "bg-[#f3ddd5] text-[#9a5844]" },
};

type View = "upcoming" | "past" | "cancelled";

export function ScheduleManager() {
  const [events, setEvents] = useState<Event[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [checkIns, setCheckIns] = useState<CheckInSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Event | null | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<View>("upcoming");
  const [initialPersonId, setInitialPersonId] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const names = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);
  const visibleEvents = events.filter((event) => view === "upcoming" ? event.status === "scheduled" && new Date(event.start_time).getTime() >= now : view === "cancelled" ? event.status === "cancelled" : event.status === "completed" || (event.status === "scheduled" && new Date(event.start_time).getTime() < now));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventData, peopleData, settingsData] = await Promise.all([caregiverApi.events.list(), caregiverApi.people.list(), caregiverApi.checkIns.get()]);
      setEvents(eventData.items);
      setPeople(peopleData.items);
      setCheckIns(settingsData);
      setNow(Date.now());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the schedule.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const searchParams = new URLSearchParams(window.location.search);
      const requested = Number(searchParams.get("person_id"));
      if (Number.isInteger(requested) && requested > 0) setInitialPersonId(requested);
      if (searchParams.get("new") === "1" || (Number.isInteger(requested) && requested > 0)) setEditing(null);
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(data: EventCreate) {
    const saved = editing ? await caregiverApi.events.update(editing.id, data) : await caregiverApi.events.create(data);
    setEvents((items) => (editing ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]).sort((a, b) => a.start_time.localeCompare(b.start_time)));
    setEditing(undefined);
    setNotice(editing ? "Event updated." : "Visit scheduled.");
  }

  async function cancel(event: Event) {
    if (!window.confirm(`Cancel “${event.title}”? Anchor will no longer announce this reminder.`)) return;
    try {
      const saved = await caregiverApi.events.update(event.id, { status: "cancelled" });
      setEvents((items) => items.map((item) => item.id === saved.id ? saved : item));
      setNotice("Event cancelled.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to cancel this event.");
    }
  }

  async function remove(event: Event) {
    if (!window.confirm(`Permanently delete “${event.title}”?`)) return;
    try {
      await caregiverApi.events.remove(event.id);
      setEvents((items) => items.filter(({ id }) => id !== event.id));
      setNotice("Event deleted.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete this event.");
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Schedule" title="Visits and moments to look forward to" description="Plan what’s coming up and choose when Anchor should offer a gentle reminder." action={<Button onClick={() => setEditing(null)}><Plus /> Schedule visit</Button>} />
      <Notice message={notice} />
      {loading ? <LoadingState label="Opening schedule" /> : error ? <ErrorState message={error} retry={load} /> : <>
        <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1" role="tablist" aria-label="Schedule views">{(["upcoming", "past", "cancelled"] as View[]).map((item) => <button key={item} role="tab" aria-selected={view === item} onClick={() => setView(item)} className={`min-w-28 rounded-lg px-4 py-2.5 text-sm font-medium capitalize transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === item ? "bg-[#728a76] text-white" : "text-muted-foreground hover:bg-muted"}`}>{item}</button>)}</div>
        {visibleEvents.length === 0 ? <EmptyState icon={<CalendarDays />} title={view === "upcoming" ? "Nothing on the horizon" : `No ${view} events`} description={view === "upcoming" ? "Schedule a visit, appointment, or meaningful occasion." : "Events will appear here when their status changes."} action={view === "upcoming" ? <Button onClick={() => setEditing(null)}><Plus /> Schedule a visit</Button> : undefined} /> : <ol className="relative space-y-5 before:absolute before:bottom-6 before:left-[2.15rem] before:top-6 before:w-px before:bg-border">{visibleEvents.map((event) => { const meta = statusMeta[event.status]; const StatusIcon = meta.icon; return <li key={event.id} className="relative grid gap-4 rounded-[1.25rem] border bg-card p-5 shadow-sm sm:grid-cols-[3.25rem_1fr_auto]"><div className="z-10 grid size-12 place-items-center rounded-full border-4 border-card bg-[#f0e7d9] text-[#b9684f]"><CalendarDays className="size-5" /></div><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-serif text-xl font-semibold">{event.title}</h2><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.style}`}><StatusIcon className="size-3.5" />{meta.label}</span>{event.status === "scheduled" && <span className="text-xs text-muted-foreground">Planned · arrival not confirmed</span>}</div><p className="mt-2 font-medium">{formatDateTime(event.start_time)}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><span className="flex items-center gap-1"><Clock3 className="size-4" /> {event.reminder_enabled === false ? "Reminders off" : reminderLabel(event.reminder_minutes)}</span>{event.person_id && <span className="flex items-center gap-1"><UserRound className="size-4" /> {names.get(event.person_id) ?? "Linked person"}</span>}</div>{event.description && <p className="mt-3 text-sm leading-6 text-muted-foreground">{event.description}</p>}</div><div className="flex sm:justify-end"><Button size="icon" variant="ghost" onClick={() => setEditing(event)} aria-label={`Edit ${event.title}`}><Pencil /></Button>{event.status === "scheduled" ? <Button size="icon" variant="ghost" className="text-destructive" onClick={() => void cancel(event)} aria-label={`Cancel ${event.title}`}><XCircle /></Button> : <Button size="icon" variant="ghost" className="text-destructive" onClick={() => void remove(event)} aria-label={`Delete ${event.title}`}><Trash2 /></Button>}</div></li>; })}</ol>}
      </>}
      {editing !== undefined && <Modal title={editing ? "Edit event" : "Schedule a visit or event"} description="Dates display in your local timezone. New events begin as scheduled." onClose={() => setEditing(undefined)}><EventForm event={editing ?? undefined} people={people} initialPersonId={initialPersonId} defaultReminderMinutes={checkIns?.reminder_lead_minutes} onSubmit={save} onCancel={() => setEditing(undefined)} /></Modal>}
    </div>
  );
}

function reminderLabel(minutes: number) {
  if (minutes === 0) return "Reminder at start time";
  if (minutes % 1440 === 0) return `Reminder ${minutes / 1440} ${minutes === 1440 ? "day" : "days"} before`;
  if (minutes % 60 === 0) return `Reminder ${minutes / 60} ${minutes === 60 ? "hour" : "hours"} before`;
  return `Reminder ${minutes} minutes before`;
}
