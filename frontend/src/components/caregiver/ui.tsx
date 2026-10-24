import type { ReactNode } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const inputClass =
  "min-h-11 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted";

export function PageHeader({ eyebrow, title, description, action }: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#b9684f]">{eyebrow}</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl leading-6 text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function Surface({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-[1.25rem] border bg-card p-5 shadow-sm sm:p-6", className)}>{children}</section>;
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center gap-3 text-muted-foreground" role="status">
      <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-5" role="alert">
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div>
          <p className="font-medium">We couldn’t load this information.</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          <Button className="mt-4" variant="outline" size="sm" onClick={retry}>Try again</Button>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/30 p-8 text-center">
      <div className="mb-4 rounded-full bg-secondary p-3 text-primary">{icon}</div>
      <h2 className="font-serif text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Field({ label, htmlFor, hint, children }: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Notice({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary" role="status">{message}</p>;
}

export function Modal({ title, description, children, onClose }: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-foreground/35 p-4 backdrop-blur-sm" role="presentation">
      <div className="flex min-h-full items-center justify-center">
        <section className="w-full max-w-xl rounded-[1.5rem] border bg-[#fbf8f0] p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="dialog-title" className="font-serif text-2xl font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">Close</Button>
          </div>
          <div className="mt-6">{children}</div>
        </section>
      </div>
    </div>
  );
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function toLocalInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
