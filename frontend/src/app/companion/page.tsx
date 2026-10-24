import type { Metadata } from "next";
import { CompanionScreen } from "@/components/companion/CompanionScreen";

export const metadata: Metadata = { title: "Anchor Companion" };

export default function CompanionPage() {
  return <CompanionScreen />;
}
