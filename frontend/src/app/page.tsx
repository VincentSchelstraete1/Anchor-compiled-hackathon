import { Anchor } from "lucide-react";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <section className="max-w-xl text-center">
        <Anchor aria-hidden="true" className="mx-auto mb-6 size-12 text-primary" />
        <h1 className="text-5xl font-semibold tracking-tight">Anchor</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          A voice-first companion for the people and moments that matter.
        </p>
      </section>
    </main>
  );
}
