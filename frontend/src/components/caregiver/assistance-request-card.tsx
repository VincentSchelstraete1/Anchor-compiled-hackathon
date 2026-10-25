import { ArrowRight, LifeBuoy, MessageSquareText, Phone, Siren } from "lucide-react";
import Link from "next/link";

import type { AssistanceRequest, AssistanceRequestStatus, AssistanceRequestType } from "@/lib/api/types";
import { formatDateTime } from "./ui";

const typeMeta: Record<AssistanceRequestType, { label: string; icon: typeof Phone; style: string }> = {
  text: { label: "Text", icon: MessageSquareText, style: "bg-[#dfe6d9] text-[#59705e]" },
  call: { label: "Call", icon: Phone, style: "bg-[#e8e2d5] text-[#655f54]" },
  caregiver_assistance: { label: "Caregiver assistance", icon: LifeBuoy, style: "bg-[#f6e5c7] text-[#7b582f]" },
  urgent_help: { label: "Urgent help", icon: Siren, style: "bg-[#f3ddd5] text-[#9a5844]" },
};

const statusMeta: Record<AssistanceRequestStatus, { label: string; style: string; detail: string }> = {
  proposed: { label: "Proposed", style: "bg-[#f6e5c7] text-[#7b582f]", detail: "Waiting for confirmation. Nothing has been simulated." },
  confirmed: { label: "Confirmed", style: "bg-[#dfe6d9] text-[#59705e]", detail: "Approved for simulation. No real-world contact has occurred." },
  simulated: { label: "Simulated", style: "bg-secondary text-secondary-foreground", detail: "Anchor recorded a simulation only. No real-world contact occurred." },
  cancelled: { label: "Cancelled", style: "bg-muted text-muted-foreground", detail: "This request was cancelled without real-world contact." },
};

export function AssistanceRequestCard({ request }: { request: AssistanceRequest }) {
  const type = typeMeta[request.request_type];
  const status = statusMeta[request.status];
  const TypeIcon = type.icon;
  return (
    <article className={`rounded-[1.25rem] border bg-card p-5 shadow-sm sm:p-6 ${request.request_type === "urgent_help" ? "border-l-4 border-l-[#b9684f]" : ""}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${type.style}`}><TypeIcon className="size-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{type.label}</span><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.style}`}>{status.label}</span></div>
            <h2 className="mt-2 font-serif text-xl font-semibold">For {request.intended_recipient}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Proposed {formatDateTime(request.created_at)}</p>
          </div>
        </div>
        <Link href={`/caregiver/assistance/${request.id}`} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View details <ArrowRight className="size-4" /></Link>
      </div>
      <dl className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-2">
        <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reason</dt><dd className="mt-1 line-clamp-3 text-sm leading-6">{request.reason}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Proposed content</dt><dd className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-6">{request.proposed_content}</dd></div>
      </dl>
      <p className="mt-5 rounded-xl bg-muted/60 px-4 py-3 text-xs leading-5 text-muted-foreground">{status.detail}</p>
    </article>
  );
}

export function requestTypeLabel(type: AssistanceRequestType) {
  return typeMeta[type].label;
}

export function requestStatusMeta(status: AssistanceRequestStatus) {
  return statusMeta[status];
}

export function confirmationLabel(status: AssistanceRequestStatus) {
  if (status === "proposed") return "Awaiting confirmation";
  if (status === "cancelled") return "Cancelled";
  return "Confirmed";
}

export function simulationLabel(status: AssistanceRequestStatus) {
  if (status === "simulated") return "Simulation recorded";
  if (status === "cancelled") return "Cancelled before simulation";
  return "Not simulated";
}
