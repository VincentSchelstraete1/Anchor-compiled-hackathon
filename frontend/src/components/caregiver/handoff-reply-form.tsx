"use client";

import { LoaderCircle, Send } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, inputClass } from "./ui";

export function HandoffReplyForm({ onSubmit }: { onSubmit: (response: string) => Promise<void> }) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) { setSaving(true); setError(null); try { await onSubmit(String(formData.get("response") ?? "").trim()); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to send this response."); setSaving(false); } }
  return <form action={submit} className="mt-4 space-y-3 border-t pt-4"><Field label="Your reply" htmlFor="response"><textarea id="response" name="response" rows={3} required maxLength={2000} className={inputClass} placeholder="Write a short, clear answer…" /></Field>{error && <p className="text-sm text-destructive" role="alert">{error}</p>}<div className="flex justify-end"><Button disabled={saving}>{saving ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Send />} Send answer</Button></div></form>;
}
