"use client";

import { LifeBuoy, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { AssistanceRequest, AssistanceRequestStatus } from "@/lib/api/types";
import { caregiverApi } from "./api";
import { AssistanceRequestCard } from "./assistance-request-card";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "./ui";

type View = "all" | AssistanceRequestStatus;

export function AssistanceRequests() {
  const [requests, setRequests] = useState<AssistanceRequest[]>([]);
  const [view, setView] = useState<View>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await caregiverApi.assistanceRequests.list();
      setRequests(data.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load assistance requests.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visible = requests.filter((request) => view === "all" || request.status === view);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Assistance requests"
        title="Requests Anchor has prepared"
        description="Review proposed communication and simulated assistance. Anchor does not place real calls, send real texts, or contact emergency services."
        action={<Button variant="outline" onClick={() => void load(true)} disabled={refreshing}><RefreshCw className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} /> Refresh</Button>}
      />
      {!loading && !error && <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1" role="tablist" aria-label="Assistance request status">{(["all", "proposed", "confirmed", "simulated", "cancelled"] as View[]).map((item) => <button key={item} role="tab" aria-selected={view === item} onClick={() => setView(item)} className={`min-w-28 rounded-lg px-4 py-2.5 text-sm font-medium capitalize transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === item ? "bg-[#728a76] text-white" : "text-muted-foreground hover:bg-muted"}`}>{item}</button>)}</div>}
      {loading ? <LoadingState label="Loading assistance requests" /> : error ? <ErrorState message={error} retry={load} /> : visible.length === 0 ? <EmptyState icon={<LifeBuoy />} title={view === "all" ? "No assistance requests yet" : `No ${view} requests`} description={view === "all" ? "Requests Margaret confirms in the companion will appear here after the backend saves them." : "Nothing currently has this status."} /> : <div className="space-y-4">{visible.map((request) => <AssistanceRequestCard key={request.id} request={request} />)}</div>}
    </div>
  );
}
