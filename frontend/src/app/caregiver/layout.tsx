import type { ReactNode } from "react";

import { DashboardShell } from "@/components/caregiver/dashboard-shell";

export default function CaregiverLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
