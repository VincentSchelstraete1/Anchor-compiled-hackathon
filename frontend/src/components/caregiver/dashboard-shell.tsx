"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Anchor, CalendarDays, CircleHelp, Heart, Home, Menu, Users, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Overview", href: "/caregiver", icon: Home },
  { label: "People", href: "/caregiver/people", icon: Users },
  { label: "Memories", href: "/caregiver/memories", icon: Heart },
  { label: "Schedule", href: "/caregiver/schedule", icon: CalendarDays },
  { label: "Questions", href: "/caregiver/questions", icon: CircleHelp },
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
        <Link href="/caregiver" className="flex items-center gap-2 font-semibold"><Anchor className="size-6 text-primary" /> Anchor</Link>
        <Button size="icon" variant="ghost" onClick={() => setOpen((value) => !value)} aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open}>
          {open ? <X /> : <Menu />}
        </Button>
      </header>
      <aside className={cn("fixed inset-y-0 left-0 z-30 w-64 border-r bg-card p-5 transition-transform motion-reduce:transition-none md:translate-x-0", open ? "translate-x-0 top-16" : "-translate-x-full md:top-0")}>
        <Link href="/caregiver" className="hidden items-center gap-3 px-2 py-3 md:flex">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Anchor className="size-5" /></span>
          <span><span className="block text-lg font-semibold">Anchor</span><span className="block text-xs text-muted-foreground">Caregiver dashboard</span></span>
        </Link>
        <nav className="mt-4 space-y-1" aria-label="Caregiver dashboard">
          {navigation.map(({ label, href, icon: Icon }) => {
            const active = href === "/caregiver" ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <Icon className="size-5" aria-hidden="true" />{label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute inset-x-5 bottom-6 rounded-xl bg-secondary p-4">
          <p className="text-sm font-medium">Care with confidence</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Updates here keep the companion grounded in what matters.</p>
        </div>
      </aside>
      {open && <button className="fixed inset-0 top-16 z-20 bg-foreground/20 md:hidden" aria-label="Close navigation" onClick={() => setOpen(false)} />}
      <main className="px-4 py-8 sm:px-6 md:ml-64 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
