"use client";

import { CheckCircle2, CircleHelp, Clock3, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Handoff, HandoffStatus, Person } from "@/lib/api/types";
import { caregiverApi } from "./api";
import { HandoffReplyForm } from "./handoff-reply-form";
import { EmptyState, ErrorState, formatDateTime, LoadingState, Notice, PageHeader } from "./ui";

const statusMeta: Record<HandoffStatus, { label: string; icon: typeof Clock3; style: string }> = {
  pending: { label: "Needs reply", icon: Clock3, style: "bg-accent text-accent-foreground" }, answered: { label: "Answered", icon: CheckCircle2, style: "bg-primary/10 text-primary" }, delivered: { label: "Delivered", icon: Send, style: "bg-secondary text-secondary-foreground" }, cancelled: { label: "Cancelled", icon: CircleHelp, style: "bg-muted text-muted-foreground" },
};

export function HandoffInbox({ compact = false }: { compact?: boolean }) {
  const [handoffs, setHandoffs] = useState<Handoff[]>([]); const [people, setPeople] = useState<Person[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const names = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);
  const load = useCallback(async () => { setLoading(true); setError(null); try { const [handoffData, peopleData] = await Promise.all([caregiverApi.handoffs.list(), caregiverApi.people.list()]); setHandoffs(handoffData.items); setPeople(peopleData.items); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load questions."); } finally { setLoading(false); } }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function answer(id: number, response: string) { const saved = await caregiverApi.handoffs.answer(id, { response }); setHandoffs((items) => items.map((item) => item.id === saved.id ? saved : item)); setNotice("Answer sent. Anchor will share it with the companion."); }
  const visible = compact ? handoffs.filter(({ status }) => status === "pending").slice(0, 3) : handoffs;
  return <div className="space-y-8">{!compact && <PageHeader eyebrow="Questions" title="Caregiver inbox" description="Answer what Anchor couldn’t safely determine from stored memories." />}<Notice message={notice} />
    {loading ? <LoadingState label="Loading questions" /> : error ? <ErrorState message={error} retry={load} /> : visible.length === 0 ? <EmptyState icon={<CircleHelp />} title={compact ? "No questions need a reply" : "The inbox is clear"} description="When the companion asks for help with an unknown personal detail, it will appear here." /> : <div className="space-y-4">{visible.map((handoff) => { const meta = statusMeta[handoff.status]; const StatusIcon = meta.icon; return <article key={handoff.id} className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs text-muted-foreground">Asked {formatDateTime(handoff.created_at)} · For {names.get(handoff.caregiver_person_id) ?? "caregiver"}</p><h2 className="mt-2 text-lg font-semibold leading-snug">{handoff.question}</h2></div><span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.style}`}><StatusIcon className="size-3.5" />{meta.label}</span></div>{handoff.status === "pending" ? <HandoffReplyForm onSubmit={(response) => answer(handoff.id, response)} /> : handoff.response && <div className="mt-4 rounded-xl bg-muted p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your answer</p><p className="mt-1 text-sm leading-relaxed">{handoff.response}</p>{handoff.answered_at && <p className="mt-2 text-xs text-muted-foreground">Answered {formatDateTime(handoff.answered_at)}{handoff.delivered_at ? ` · Delivered ${formatDateTime(handoff.delivered_at)}` : " · Waiting to be delivered"}</p>}</div>}</article>; })}</div>}
  </div>;
}
