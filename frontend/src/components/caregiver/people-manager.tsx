"use client";

import { Plus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Person, PersonCreate } from "@/lib/api/types";
import { caregiverApi } from "./api";
import { PersonCard } from "./person-card";
import { PersonForm } from "./person-form";
import { EmptyState, ErrorState, LoadingState, Modal, Notice, PageHeader } from "./ui";

export function PeopleManager() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Person | null | undefined>();
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setPeople((await caregiverApi.people.list()).items); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load people."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("new") === "1") setEditing(null);
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(data: PersonCreate) {
    const saved = editing ? await caregiverApi.people.update(editing.id, data) : await caregiverApi.people.create(data);
    setPeople((current) => editing ? current.map((person) => person.id === saved.id ? saved : person) : [...current, saved].sort((a, b) => a.name.localeCompare(b.name)));
    setEditing(undefined); setNotice(editing ? "Person updated." : "Person added.");
  }

  async function remove(person: Person) {
    if (!window.confirm(`Remove ${person.name}? This may fail if they are linked to memories or events.`)) return;
    try { await caregiverApi.people.remove(person.id); setPeople((items) => items.filter(({ id }) => id !== person.id)); setNotice("Person removed."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to remove this person."); }
  }

  return <div className="space-y-8">
    <PageHeader eyebrow="People" title="Familiar faces" description="Keep names, relationships, and photographs close at hand." action={<Button onClick={() => setEditing(null)}><Plus /> Add person</Button>} />
    <Notice message={notice} />
    {loading ? <LoadingState label="Loading people" /> : error ? <ErrorState message={error} retry={load} /> : people.length === 0 ? <EmptyState icon={<Users />} title="No people added yet" description="Add someone important so Anchor can recognize and talk about them accurately." action={<Button onClick={() => setEditing(null)}><Plus /> Add the first person</Button>} /> : <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{people.map((person) => <PersonCard key={person.id} person={person} onEdit={() => setEditing(person)} onDelete={() => void remove(person)} />)}</div>}
    {editing !== undefined && <Modal title={editing ? "Edit person" : "Add a familiar person"} description="Use only details you know are accurate." onClose={() => setEditing(undefined)}><PersonForm person={editing ?? undefined} onSubmit={save} onCancel={() => setEditing(undefined)} /></Modal>}
  </div>;
}
