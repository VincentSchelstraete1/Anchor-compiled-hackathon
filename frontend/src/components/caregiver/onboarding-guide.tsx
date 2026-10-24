"use client";

import { ArrowRight, CalendarDays, Check, Heart, MonitorPlay, Sparkles, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { caregiverApi } from "./api";
import { ErrorState, LoadingState, PageHeader } from "./ui";

const steps = [
  { title: "Add a familiar person", description: "Start with a name, relationship, photograph, and a few words about them.", href: "/caregiver/people?new=1", action: "Add a person", icon: UserPlus },
  { title: "Save a meaningful memory", description: "Capture one specific story or preference Anchor can safely recall.", href: "/caregiver/memories?new=1", action: "Add a memory", icon: Heart },
  { title: "Schedule a visit", description: "Give the day something warm and concrete to look forward to.", href: "/caregiver/schedule?new=1", action: "Schedule a visit", icon: CalendarDays },
  { title: "Open the companion display", description: "Move to the calm, voice-first experience when the essentials are ready.", href: "/companion", action: "Open companion", icon: MonitorPlay },
] as const;

export function OnboardingGuide() {
  const [complete, setComplete] = useState([false, false, false, false]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [people, memories, events] = await Promise.all([caregiverApi.people.list(), caregiverApi.memories.list(), caregiverApi.events.list("?status=scheduled")]);
      setComplete([people.items.length > 0, memories.items.length > 0, events.items.some((event) => new Date(event.start_time) >= new Date()), false]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to check setup progress.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  if (loading) return <LoadingState label="Checking your setup" />;
  if (error) return <div className="space-y-8"><PageHeader eyebrow="Getting started" title="Create a warm first experience" description="Four small steps are enough to begin." /><ErrorState message={error} retry={load} /></div>;
  const completedCount = complete.slice(0, 3).filter(Boolean).length;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Getting started" title="Create a warm first experience" description="Build just enough trusted context for the companion to feel familiar and useful." />
      <section className="overflow-hidden rounded-[1.75rem] border bg-[#728a76] p-7 text-white shadow-sm sm:p-9"><div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2 text-sm font-medium text-white/80"><Sparkles className="size-4" /> Setup progress</div><p className="mt-3 font-serif text-3xl font-semibold">{completedCount} of 3 essentials ready</p><p className="mt-2 max-w-xl text-sm leading-6 text-white/75">Your saved data stays in the same people, memories, and schedule screens—this guide simply points the way.</p></div><div className="grid size-24 shrink-0 place-items-center rounded-full border-8 border-white/20 bg-white/10 font-serif text-2xl font-semibold">{Math.round((completedCount / 3) * 100)}%</div></div></section>
      <ol className="grid gap-4">{steps.map((step, index) => { const Icon = step.icon; const done = complete[index]; const available = index === 3 || index === 0 || complete[index - 1]; return <li key={step.title} className={`grid gap-4 rounded-[1.25rem] border bg-card p-5 shadow-sm sm:grid-cols-[auto_1fr_auto] sm:items-center ${!available ? "opacity-65" : ""}`}><span className={`grid size-12 place-items-center rounded-full ${done ? "bg-[#728a76] text-white" : "bg-[#f3eadc] text-[#b9684f]"}`}>{done ? <Check /> : <Icon />}</span><div><div className="flex items-center gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step {index + 1}</span>{done && <span className="text-xs font-medium text-[#59705e]">Complete</span>}</div><h2 className="mt-1 font-serif text-xl font-semibold">{step.title}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{step.description}</p></div><Button asChild variant={done ? "outline" : "default"}><Link href={step.href} target={index === 3 ? "_blank" : undefined}>{done ? "Review" : step.action} <ArrowRight /></Link></Button></li>; })}</ol>
    </div>
  );
}
