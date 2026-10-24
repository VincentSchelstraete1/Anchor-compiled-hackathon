import { Suspense, type ReactNode } from "react";

import { DashboardShell } from "@/components/caregiver/dashboard-shell";

export default function CaregiverLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fbf8f0]" />}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}
