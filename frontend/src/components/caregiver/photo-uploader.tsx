"use client";

import { ImagePlus, LoaderCircle, RefreshCw, Trash2, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { resolvePhotoUrl, uploadPersonPhoto } from "@/lib/api/photos";
import { cn } from "@/lib/utils";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function PhotoUploader({ value, onChange, onUploadingChange }: {
  value: string | null;
  onChange: (photoUrl: string | null) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<string | null>(value ? resolvePhotoUrl(value) : null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  function setUploadState(next: boolean) {
    setUploading(next);
    onUploadingChange?.(next);
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!ACCEPTED_TYPES.has(file.type)) {
      setError("Choose a JPEG, PNG, or WebP photo.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("This photo is too large. Choose one that is 5 MB or smaller.");
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(file);
    setPreview(objectUrlRef.current);
    setUploadState(true);
    try {
      const uploaded = await uploadPersonPhoto(file);
      onChange(uploaded.photo_url);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
      setPreview(resolvePhotoUrl(uploaded.photo_url));
    } catch (caught) {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
      setPreview(value ? resolvePhotoUrl(value) : null);
      setError(caught instanceof Error ? caught.message : "We couldn’t upload this photo. Please try again.");
    } finally {
      setUploadState(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove() {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setPreview(null);
    setError(null);
    onChange(null);
  }

  return (
    <div className="space-y-3">
      <div
        className={cn("relative overflow-hidden rounded-2xl border-2 border-dashed bg-white transition", dragging ? "border-primary bg-primary/5" : "border-input", preview ? "aspect-[4/3]" : "min-h-44")}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void choose(event.dataTransfer.files[0]); }}
      >
        {preview ? <>
          {/* Blob previews and caregiver-provided references are intentionally rendered without optimization. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Selected person preview" className="absolute inset-0 size-full object-cover" />
          {uploading && <div className="absolute inset-0 grid place-items-center bg-foreground/45 text-white" role="status"><span className="flex items-center gap-2 rounded-full bg-foreground/70 px-4 py-2 text-sm"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> Uploading photo…</span></div>}
        </> : <button type="button" className="flex min-h-44 w-full flex-col items-center justify-center p-6 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => inputRef.current?.click()}><span className="grid size-12 place-items-center rounded-full bg-secondary text-primary"><ImagePlus /></span><span className="mt-3 font-medium">Add a familiar photo</span><span className="mt-1 text-sm text-muted-foreground">Drop it here or tap to choose</span><span className="mt-2 text-xs text-muted-foreground">JPEG, PNG, or WebP · up to 5 MB</span></button>}
      </div>
      <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void choose(event.target.files?.[0])} aria-label="Choose a person photo" />
      {preview && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}><RefreshCw /> Replace photo</Button><Button type="button" variant="ghost" size="sm" disabled={uploading} className="text-destructive" onClick={remove}><Trash2 /> Remove photo</Button></div>}
      {error && <p className="flex items-start gap-2 text-sm text-destructive" role="alert"><UserRound className="mt-0.5 size-4 shrink-0" />{error}</p>}
    </div>
  );
}
