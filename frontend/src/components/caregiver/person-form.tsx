"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Person, PersonCreate } from "@/lib/api/types";
import { Field, inputClass } from "./ui";
import { PhotoUploader } from "./photo-uploader";

export function PersonForm({ person, onSubmit, onCancel }: {
  person?: Person;
  onSubmit: (data: PersonCreate) => Promise<void>;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(person?.photo_url ?? null);

  async function submit(formData: FormData) {
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: String(formData.get("name") ?? "").trim(),
        relationship: String(formData.get("relationship") ?? "").trim(),
        description: String(formData.get("description") ?? "").trim(),
        photo_url: photoUrl,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save this person.");
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name"><input id="name" name="name" required maxLength={120} defaultValue={person?.name} className={inputClass} autoFocus /></Field>
        <Field label="Relationship" htmlFor="relationship"><input id="relationship" name="relationship" required maxLength={120} defaultValue={person?.relationship} className={inputClass} placeholder="Daughter, neighbor…" /></Field>
      </div>
      <fieldset><legend className="mb-1.5 text-sm font-medium">Photograph</legend><PhotoUploader value={photoUrl} onChange={setPhotoUrl} onUploadingChange={setUploading} /></fieldset>
      <Field label="About them" htmlFor="description"><textarea id="description" name="description" rows={4} maxLength={2000} defaultValue={person?.description} className={inputClass} placeholder="A few helpful details about this person" /></Field>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex justify-end gap-3 pt-2"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={saving || uploading}>{saving && <LoaderCircle className="animate-spin motion-reduce:animate-none" />} {uploading ? "Uploading photo…" : person ? "Save changes" : "Add person"}</Button></div>
    </form>
  );
}
