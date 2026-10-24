import type { PhotoUpload } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function resolvePhotoUrl(photoUrl: string): string {
  if (photoUrl.startsWith("/uploads/")) return `${API_URL}${photoUrl}`;
  return photoUrl;
}

export async function uploadPersonPhoto(file: File): Promise<PhotoUpload> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(`${API_URL}/uploads/person-photo`, { method: "POST", body });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? "We couldn’t upload this photo. Please try again.");
  }
  return response.json() as Promise<PhotoUpload>;
}
