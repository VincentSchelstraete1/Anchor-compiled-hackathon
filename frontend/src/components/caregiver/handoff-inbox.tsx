"use client";

import { CheckCircle2, Clock3, Inbox, Send, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Handoff, HandoffStatus, Person } from "@/lib/api/types";
import { caregiverApi } from "./api";
import { HandoffReplyForm } from "./handoff-reply-form";
import { EmptyState, ErrorState, formatDateTime, LoadingState, Notice, PageHeader } from "./ui";

const statusMeta: Record<HandoffStatus, { label: string; detail: string; icon: typeof Clock3; style: string }> = {
  pending: { label: "Needs your reply", detail: "Anchor is waiting for a trusted answer.", icon: Clock3, style: "bg-[#f6e5c7] text-[#7b582f]" },
  answered: { label: "Ready to deliver", detail: "Your answer is saved and waiting for the companion to speak it.", icon: CheckCircle2, style: "bg-[#dfe6d9] text-[#59705e]" },
  delivered: { label: "Delivered", detail: "The companion has spoken your answer.", icon: Send, style: "bg-secondary text-secondary-foreground" },
  cancelled: { label: "Cancelled", detail: "This question no longer needs a response.", icon: XCircle, style: "bg-muted text-muted-foreground" },
};

type InboxView = "pending" | "answered" | "delivered" | "all";

export function HandoffInbox({ compact = false }: { compact?: boolean }) {
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<InboxView>("pending");
  const names = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [handoffData, peopleData] = await Promise.all([caregiverApi.handoffs.list(), caregiverApi.people.list()]);
      setHandoffs(handoffData.items);
      setPeople(peopleData.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load questions.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function answer(id: number, response: string) {
    const saved = await caregiverApi.handoffs.answer(id, { response });
    setHandoffs((items) => items.map((item) => item.id === saved.id ? saved : item));
    setNotice("Answer saved. Anchor will deliver it through the companion.");
  }

  const counts = {
    pending: handoffs.filter(({ status }) => status === "pending").length,
    answered: handoffs.filter(({ status }) => status === "answered").length,
    delivered: handoffs.filter(({ status }) => status === "delivered").length,
  };
  const visible = compact ? handoffs.filter(({ status }) => status === "pending").slice(0, 3) : handoffs.filter((handoff) => view === "all" || handoff.status === view);

  return (
    <div className="space-y-8">
      {!compact && <PageHeader eyebrow="Questions" title="A quiet line back to you" description="When Anchor doesn’t know a personal detail, your answer keeps the conversation honest and caring." />}
      <Notice message={notice} />
      {!compact && !loading && !error && <div className="grid gap-3 sm:grid-cols-3"><InboxCount label="Needs reply" value={counts.pending} icon={<Clock3 />} tone="terracotta" /><InboxCount label="Ready to deliver" value={counts.answered} icon={<CheckCircle2 />} tone="sage" /><InboxCount label="Delivered" value={counts.delivered} icon={<Send />} tone="neutral" /></div>}
      {!compact && !loading && !error && <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1" role="tablist" aria-label="Question status">{(["pending", "answered", "delivered", "all"] as InboxView[]).map((item) => <button key={item} role="tab" aria-selected={view === item} onClick={() => setView(item)} className={`min-w-28 rounded-lg px-4 py-2.5 text-sm font-medium capitalize transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === item ? "bg-[#728a76] text-white" : "text-muted-foreground hover:bg-muted"}`}>{item === "pending" ? "Needs reply" : item}</button>)}</div>}
      {loading ? <LoadingState label="Opening inbox" /> : error ? <ErrorState message={error} retry={load} /> : visible.length === 0 ? <EmptyState icon={<Inbox />} title={compact ? "No questions need a reply" : view === "pending" ? "You’re all caught up" : `No ${view} questions`} description={view === "pending" || compact ? "Anchor will ask only when stored memories don’t support a safe answer." : "Questions will appear here as they move through delivery."} /> : <div className="space-y-4">{visible.map((handoff) => { const meta = statusMeta[handoff.status]; const StatusIcon = meta.icon; return <article key={handoff.id} className={`rounded-[1.25rem] border bg-card p-5 shadow-sm sm:p-6 ${handoff.status === "pending" ? "border-l-4 border-l-[#b9684f]" : ""}`}><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="max-w-3xl"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Asked {formatDateTime(handoff.created_at)}</p><h2 className="mt-3 font-serif text-xl font-semibold leading-snug sm:text-2xl">“{handoff.question}”</h2><p className="mt-3 text-sm text-muted-foreground">Routed to <strong className="font-medium text-foreground">{names.get(handoff.caregiver_person_id) ?? "the selected caregiver"}</strong>. No answer was inferred from missing information.</p></div><span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${meta.style}`}><StatusIcon className="size-3.5" />{meta.label}</span></div><p className="mt-4 rounded-xl bg-muted/60 px-4 py-3 text-xs leading-5 text-muted-foreground">{meta.detail}</p>{handoff.status === "pending" ? <HandoffReplyForm onSubmit={(response) => answer(handoff.id, response)} /> : handoff.response && <div className="mt-4 rounded-xl border bg-[#fffdf8] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#728a76]">Your answer</p><p className="mt-2 text-sm leading-6">{handoff.response}</p>{handoff.answered_at && <p className="mt-3 text-xs text-muted-foreground">Answered {formatDateTime(handoff.answered_at)}{handoff.delivered_at ? ` · Delivered ${formatDateTime(handoff.delivered_at)}` : " · Waiting for companion delivery"}</p>}</div>}</article>; })}</div>}
    </div>
  );
}

function InboxCount({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: "terracotta" | "sage" | "neutral" }) {
  const style = tone === "terracotta" ? "bg-[#f3ddd5] text-[#9a5844]" : tone === "sage" ? "bg-[#dfe6d9] text-[#59705e]" : "bg-secondary text-secondary-foreground";
  return <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm"><span className={`grid size-10 place-items-center rounded-xl ${style}`}>{icon}</span><span><strong className="block text-xl">{value}</strong><span className="text-xs text-muted-foreground">{label}</span></span></div>;
}
