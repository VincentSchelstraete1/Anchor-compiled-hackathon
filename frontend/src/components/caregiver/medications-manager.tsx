"use client";

import { CalendarClock, MapPin, Pencil, Pill, Plus, Trash2, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Medication, MedicationCreate, Person } from "@/lib/api/types";
import { caregiverApi } from "./api";
import { EmptyState, ErrorState, LoadingState, Modal, Notice, PageHeader } from "./ui";
import { MedicationForm } from "./medication-form";

type View = "active" | "all";

export function MedicationsManager() {
  const [medications, setMedications] = useState<Medication[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Medication | null | undefined>();
  const [view, setView] = useState<View>("active");
  const [today, setToday] = useState("");
  const names = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);
  const visible = medications.filter((medication) => view === "all" || medication.active);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [medicationData, peopleData] = await Promise.all([caregiverApi.medications.list(), caregiverApi.people.list()]);
      setMedications(medicationData.items);
      setPeople(peopleData.items);
      setToday(new Date().toISOString().slice(0, 10));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load medicines.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function save(data: MedicationCreate) {
    const saved = editing ? await caregiverApi.medications.update(editing.id, data) : await caregiverApi.medications.create(data);
    setMedications((items) => (editing ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]).sort(compareMedications));
    setEditing(undefined);
    setNotice(editing ? "Medicine details updated." : "Medicine added.");
  }

  async function remove(medication: Medication) {
    if (!window.confirm(`Permanently remove ${medication.name}?`)) return;
    try {
      await caregiverApi.medications.remove(medication.id);
      setMedications((items) => items.filter(({ id }) => id !== medication.id));
      setNotice("Medicine removed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to remove this medicine.");
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Medicines" title="Medicine details in one trusted place" description="Record what each medicine is, where it is kept, how often it is taken, and when a refill is needed." action={<Button onClick={() => setEditing(null)}><Plus /> Add medicine</Button>} />
      <div className="rounded-xl border border-[#dbc6a5] bg-[#fbf3e4] px-4 py-3 text-sm leading-6 text-muted-foreground"><strong className="text-foreground">Caregiver-entered information:</strong> always check the prescription label or speak with a qualified clinician before making medication decisions.</div>
      <Notice message={notice} />
      {loading ? <LoadingState label="Loading medicines" /> : error ? <ErrorState message={error} retry={load} /> : <>
        <div className="flex gap-1 rounded-xl border bg-card p-1" role="tablist" aria-label="Medicine status"><button role="tab" aria-selected={view === "active"} onClick={() => setView("active")} className={`rounded-lg px-4 py-2.5 text-sm font-medium ${view === "active" ? "bg-[#728a76] text-white" : "text-muted-foreground hover:bg-muted"}`}>Currently taken</button><button role="tab" aria-selected={view === "all"} onClick={() => setView("all")} className={`rounded-lg px-4 py-2.5 text-sm font-medium ${view === "all" ? "bg-[#728a76] text-white" : "text-muted-foreground hover:bg-muted"}`}>All medicines</button></div>
        {visible.length === 0 ? <EmptyState icon={<Pill />} title={view === "active" ? "No current medicines recorded" : "No medicines recorded"} description="Add caregiver-verified details from the current prescription label or packaging." action={<Button onClick={() => setEditing(null)}><Plus /> Add medicine</Button>} /> : <div className="grid gap-5 lg:grid-cols-2">{visible.map((medication) => { const refill = refillStatus(medication.refill_date, today); return <article key={medication.id} className={`rounded-[1.25rem] border bg-card p-6 shadow-sm ${medication.active ? "" : "opacity-70"}`}><div className="flex items-start justify-between gap-4"><div className="flex gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#dfe6d9] text-[#59705e]"><Pill /></span><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-serif text-2xl font-semibold">{medication.name}</h2>{!medication.active && <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">Inactive</span>}</div><p className="mt-1 text-sm text-muted-foreground">{medication.purpose || "No purpose recorded"}</p></div></div><div className="flex"><Button size="icon" variant="ghost" onClick={() => setEditing(medication)} aria-label={`Edit ${medication.name}`}><Pencil /></Button><Button size="icon" variant="ghost" className="text-destructive" onClick={() => void remove(medication)} aria-label={`Remove ${medication.name}`}><Trash2 /></Button></div></div><dl className="mt-5 grid gap-4 rounded-xl bg-[#fbf8f0] p-4 sm:grid-cols-2"><div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dose</dt><dd className="mt-1 font-medium">{medication.dosage}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How often</dt><dd className="mt-1 font-medium">{medication.frequency}</dd></div></dl><div className="mt-4 space-y-3 text-sm"><p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-[#b9684f]" /><span><strong>Kept:</strong> {medication.location}</span></p><p className="flex items-start gap-2"><CalendarClock className="mt-0.5 size-4 shrink-0 text-[#b9684f]" /><span><strong>Refill:</strong> {refill.label}</span></p><p className="flex items-start gap-2 text-muted-foreground"><UserRound className="mt-0.5 size-4 shrink-0" />For {names.get(medication.person_id) ?? "linked person"}</p></div>{medication.notes && <p className="mt-4 border-t pt-4 text-sm leading-6 text-muted-foreground">{medication.notes}</p>}</article>; })}</div>}
      </>}
      {editing !== undefined && <Modal title={editing ? "Edit medicine" : "Add a medicine"} description="Copy details carefully from a caregiver-approved source." onClose={() => setEditing(undefined)}><MedicationForm medication={editing ?? undefined} people={people} onSubmit={save} onCancel={() => setEditing(undefined)} /></Modal>}
    </div>
  );
}

function compareMedications(a: Medication, b: Medication) {
  if (a.active !== b.active) return a.active ? -1 : 1;
  if (a.refill_date && b.refill_date) return a.refill_date.localeCompare(b.refill_date);
  if (a.refill_date) return -1;
  if (b.refill_date) return 1;
  return a.name.localeCompare(b.name);
}

function refillStatus(refillDate: string | null, today: string) {
  if (!refillDate) return { label: "No refill date recorded" };
  const formatted = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${refillDate}T00:00:00Z`));
  if (today && refillDate < today) return { label: `Overdue since ${formatted}` };
  const soon = today ? new Date(`${today}T00:00:00Z`) : null;
  if (soon) soon.setUTCDate(soon.getUTCDate() + 14);
  if (soon && refillDate <= soon.toISOString().slice(0, 10)) return { label: `Needed soon · ${formatted}` };
  return { label: formatted };
}
