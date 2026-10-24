"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Medication, MedicationCreate, Person } from "@/lib/api/types";
import { Field, inputClass } from "./ui";

export function MedicationForm({ medication, people, onSubmit, onCancel }: {
  medication?: Medication;
  people: Person[];
  onSubmit: (data: MedicationCreate) => Promise<void>;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        person_id: Number(formData.get("person_id")),
        name: String(formData.get("name") ?? "").trim(),
        purpose: String(formData.get("purpose") ?? "").trim(),
        dosage: String(formData.get("dosage") ?? "").trim(),
        frequency: String(formData.get("frequency") ?? "").trim(),
        location: String(formData.get("location") ?? "").trim(),
        refill_date: String(formData.get("refill_date") ?? "") || null,
        notes: String(formData.get("notes") ?? "").trim(),
        active: formData.get("active") === "true",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save this medicine.");
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="space-y-4">
      <div className="rounded-xl border border-[#dbc6a5] bg-[#fbf3e4] p-3 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Check the label:</strong> Record exactly what the prescription or packaging says. Anchor does not provide medical advice.</div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Medicine name" htmlFor="medication_name"><input id="medication_name" name="name" required maxLength={120} defaultValue={medication?.name} className={inputClass} autoFocus /></Field><Field label="For whom" htmlFor="medication_person"><select id="medication_person" name="person_id" required defaultValue={medication?.person_id ?? ""} className={inputClass}><option value="" disabled>Select a person</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field></div>
      <Field label="What it is for" htmlFor="medication_purpose"><input id="medication_purpose" name="purpose" maxLength={500} defaultValue={medication?.purpose} className={inputClass} placeholder="Copy the caregiver-approved purpose" /></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Dose" htmlFor="medication_dosage"><input id="medication_dosage" name="dosage" required maxLength={120} defaultValue={medication?.dosage} className={inputClass} placeholder="Exactly as written on the label" /></Field><Field label="How often" htmlFor="medication_frequency"><input id="medication_frequency" name="frequency" required maxLength={240} defaultValue={medication?.frequency} className={inputClass} placeholder="For example, once each morning" /></Field></div>
      <Field label="Where it is kept" htmlFor="medication_location"><textarea id="medication_location" name="location" required rows={3} maxLength={500} defaultValue={medication?.location} className={inputClass} placeholder="A clear, specific location" /></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Refill needed by" htmlFor="medication_refill"><input id="medication_refill" name="refill_date" type="date" defaultValue={medication?.refill_date ?? ""} className={inputClass} /></Field><Field label="Status" htmlFor="medication_active"><select id="medication_active" name="active" defaultValue={String(medication?.active ?? true)} className={inputClass}><option value="true">Currently taken</option><option value="false">Inactive / stopped</option></select></Field></div>
      <Field label="Caregiver notes" htmlFor="medication_notes"><textarea id="medication_notes" name="notes" rows={3} maxLength={2000} defaultValue={medication?.notes} className={inputClass} placeholder="Optional label or refill details" /></Field>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={saving}>{saving && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}{medication ? "Save changes" : "Add medicine"}</Button></div>
    </form>
  );
}
