"use client";

import { ArrowRight, CalendarDays, CircleHelp, Heart, LoaderCircle, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Event, Handoff, Memory, Person } from "@/lib/api/types";
import { caregiverApi } from "./api";
import { isDemoProfile } from "./demo";
import { ErrorState, formatDateTime, LoadingState, Notice, PageHeader, Surface } from "./ui";

type OverviewData = { people: Person[]; memories: Memory[]; events: Event[]; handoffs: Handoff[] };

export function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [people, memories, events, handoffs] = await Promise.all([
        caregiverApi.people.list(),
        caregiverApi.memories.list(),
        caregiverApi.events.list("?status=scheduled"),
        caregiverApi.handoffs.list(),
      ]);
      setData({ people: people.items, memories: memories.items, events: events.items, handoffs: handoffs.items });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the overview.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function seedDemo() {
    setSeeding(true);
    setError(null);
    try {
      const result = await caregiverApi.demo.seed();
      await load();
      setNotice(result.seeded ? "Fictional Margaret demo data is ready." : "The fictional demo was already loaded—no duplicates were created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the fictional demo.");
    } finally {
      setSeeding(false);
    }
  }

  if (error && !data) return <div className="space-y-8"><PageHeader eyebrow="Overview" title="Care at a glance" description="What needs your attention today." /><ErrorState message={error} retry={load} /></div>;
  if (!data) return <LoadingState label="Loading dashboard" />;

  const pending = data.handoffs.filter(({ status }) => status === "pending");
  const today = new Date();
  const todaysEvents = data.events.filter((event) => {
    const date = new Date(event.start_time);
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  });
  const nextEvents = data.events.filter((event) => new Date(event.start_time) >= today).slice(0, 4);
  const demoProfile = data.people.find(isDemoProfile);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Overview" title="Care at a glance" description="The important people, plans, and questions that need your attention." />
      <Notice message={notice} />
      {error && <ErrorState message={error} retry={load} />}
      <Surface className="border-[#dbc6a5] bg-[#fbf3e4]">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#b9684f] text-white"><Sparkles /></span><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a5844]">Fictional hackathon data</p><h2 className="mt-1 font-serif text-xl font-semibold">{demoProfile ? `${demoProfile.name}'s demo profile is ready` : "Load Margaret's demo profile"}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{demoProfile ? "Sample people, routines, preferences, memories, medicines, visits, and reminders are stored in the backend and remain fully editable." : "Adds clearly labeled sample records without changing or replacing any existing people or memories."}</p></div></div>
          {demoProfile ? <Button asChild variant="outline"><Link href={`/caregiver/people/${demoProfile.id}`}>Open demo profile <ArrowRight /></Link></Button> : <Button onClick={() => void seedDemo()} disabled={seeding}>{seeding ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Sparkles />}{seeding ? "Loading demo…" : "Load fictional demo"}</Button>}
        </div>
      </Surface>
      <div className="grid gap-4 sm:grid-cols-3"><SummaryCard icon={<CircleHelp />} value={pending.length} label="questions need a reply" href="/caregiver/questions" /><SummaryCard icon={<CalendarDays />} value={todaysEvents.length} label="events today" href="/caregiver/schedule" /><SummaryCard icon={<Users />} value={data.people.length} label="familiar people" href="/caregiver/people" /></div>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <Surface><div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-primary">Needs attention</p><h2 className="mt-1 text-xl font-semibold">Pending questions</h2></div><Button asChild variant="ghost" size="sm"><Link href="/caregiver/questions">View inbox <ArrowRight /></Link></Button></div>{pending.length === 0 ? <p className="mt-8 rounded-xl bg-muted p-5 text-sm text-muted-foreground">No questions are waiting. You’re all caught up.</p> : <div className="mt-5 space-y-3">{pending.slice(0, 3).map((handoff) => <Link href="/caregiver/questions" key={handoff.id} className="block rounded-xl border p-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><p className="font-medium">{handoff.question}</p><p className="mt-1 text-xs text-muted-foreground">Asked {formatDateTime(handoff.created_at)}</p></Link>)}</div>}</Surface>
        <Surface><div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-primary">Coming up</p><h2 className="mt-1 text-xl font-semibold">Schedule</h2></div><Button asChild variant="ghost" size="sm"><Link href="/caregiver/schedule">View all <ArrowRight /></Link></Button></div>{nextEvents.length === 0 ? <p className="mt-8 rounded-xl bg-muted p-5 text-sm text-muted-foreground">Nothing upcoming. Add a visit or event when you’re ready.</p> : <ol className="mt-5 space-y-4">{nextEvents.map((event) => <li key={event.id} className="flex gap-3"><span className="mt-1 size-2 shrink-0 rounded-full bg-primary" /><div><p className="font-medium">{event.title}</p><p className="text-sm text-muted-foreground">{formatDateTime(event.start_time)}</p></div></li>)}</ol>}</Surface>
      </div>
      <Surface className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><div className="grid size-11 place-items-center rounded-xl bg-secondary text-primary"><Heart /></div><div><h2 className="font-semibold">A growing memory library</h2><p className="text-sm text-muted-foreground">{data.memories.length} {data.memories.length === 1 ? "memory" : "memories"} saved as trusted context.</p></div></div><Button asChild variant="outline"><Link href="/caregiver/memories">Manage memories</Link></Button></Surface>
    </div>
  );
}

function SummaryCard({ icon, value, label, href }: { icon: React.ReactNode; value: number; label: string; href: string }) {
  return <Link href={href} className="rounded-2xl border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">{icon}</span><span><strong className="block text-2xl">{value}</strong><span className="text-sm text-muted-foreground">{label}</span></span></div></Link>;
}
