"use client";

import { ArrowLeft, CalendarClock, CheckCircle2, CircleDashed, UserRound } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { AssistanceRequest } from "@/lib/api/types";
import { caregiverApi } from "./api";
import { confirmationLabel, requestStatusMeta, requestTypeLabel, simulationLabel } from "./assistance-request-card";
import { ErrorState, formatDateTime, LoadingState, Surface } from "./ui";

export function AssistanceRequestDetail() {
  const params = useParams<{ request_id: string }>();
  const requestId = Number(params.request_id);
  const [request, setRequest] = useState<AssistanceRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!Number.isInteger(requestId) || requestId < 1) throw new Error("This assistance request is not valid.");
      setRequest(await caregiverApi.assistanceRequests.get(requestId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load this assistance request.");
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading) return <LoadingState label="Opening assistance request" />;
  if (error || !request) return <div className="space-y-5"><Button asChild variant="ghost"><Link href="/caregiver/assistance"><ArrowLeft /> Back to requests</Link></Button><ErrorState message={error ?? "Assistance request not found."} retry={load} /></div>;

  const status = requestStatusMeta(request.status);
  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" className="-ml-3"><Link href="/caregiver/assistance"><ArrowLeft /> All assistance requests</Link></Button>
      <header className="rounded-[1.5rem] border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#b9684f]">{requestTypeLabel(request.request_type)}</p><h1 className="mt-2 font-serif text-3xl font-semibold sm:text-4xl">Request for {request.intended_recipient}</h1><p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><CalendarClock className="size-4" /> Proposed {formatDateTime(request.created_at)}</p></div><span className={`w-fit rounded-full px-3 py-1.5 text-sm font-semibold ${status.style}`}>{status.label}</span></div>
        <p className="mt-6 rounded-xl bg-muted/60 px-4 py-3 text-sm leading-6 text-muted-foreground">{status.detail}</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <Surface><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reason for the request</p><p className="mt-3 whitespace-pre-wrap leading-7">{request.reason}</p><div className="mt-7 border-t pt-6"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Proposed message or call purpose</p><p className="mt-3 whitespace-pre-wrap rounded-xl bg-[#fffdf8] p-4 leading-7">{request.proposed_content}</p></div></Surface>
        <div className="space-y-4">
          <StatusItem icon={<CheckCircle2 />} label="Confirmation status" value={confirmationLabel(request.status)} time={request.confirmed_at} />
          <StatusItem icon={<CircleDashed />} label="Simulation status" value={simulationLabel(request.status)} time={request.simulated_at ?? request.cancelled_at} />
          <Surface><div className="flex gap-3"><UserRound className="mt-0.5 size-5 text-[#728a76]" /><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Intended recipient</p><p className="mt-1 font-semibold">{request.intended_recipient}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">This identifies who the simulated communication was prepared for. It does not indicate that contact occurred.</p></div></div></Surface>
        </div>
      </div>
    </div>
  );
}

function StatusItem({ icon, label, value, time }: { icon: React.ReactNode; label: string; value: string; time: string | null }) {
  return <Surface><div className="flex gap-3"><span className="text-[#728a76]">{icon}</span><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p>{time && <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(time)}</p>}</div></div></Surface>;
}
