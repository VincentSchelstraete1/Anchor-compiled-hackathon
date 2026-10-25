"use client";

import { BellRing, Clock3, LoaderCircle, MoonStar, Volume2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CheckInSettings, CheckInSettingsUpdate } from "@/lib/api/types";
import { caregiverApi } from "./api";
import { ErrorState, Field, inputClass, LoadingState, Notice, PageHeader } from "./ui";

export function CheckInSettingsManager() {
  const [settings, setSettings] = useState<CheckInSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSettings(await caregiverApi.checkIns.get());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load check-in settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(formData: FormData) {
    setSaving(true);
    setError(null);
    setNotice(null);
    const data: CheckInSettingsUpdate = {
      proactive_enabled: formData.get("proactive_enabled") === "on",
      morning_time: String(formData.get("morning_time")),
      afternoon_time: String(formData.get("afternoon_time")),
      evening_time: String(formData.get("evening_time")),
      quiet_hours_start: String(formData.get("quiet_hours_start")),
      quiet_hours_end: String(formData.get("quiet_hours_end")),
      reminder_lead_minutes: Number(formData.get("reminder_lead_minutes")),
      spoken_reminders_enabled: formData.get("spoken_reminders_enabled") === "on",
    };
    try {
      setSettings(await caregiverApi.checkIns.update(data));
      setNotice("Check-in settings saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save check-in settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Check-ins"
        title="A gentle rhythm for the day"
        description="Choose when Anchor may check in and when the home should stay quiet. Times use the display device’s local timezone."
      />
      <Notice message={notice} />
      {loading ? (
        <LoadingState label="Opening check-in settings" />
      ) : error && !settings ? (
        <ErrorState message={error} retry={load} />
      ) : settings ? (
        <form action={save} className="space-y-6">
          <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <SettingToggle
              name="proactive_enabled"
              defaultChecked={settings.proactive_enabled}
              icon={<BellRing />}
              title="Proactive check-ins"
              description="Allow Anchor to offer a friendly morning, afternoon, and evening check-in."
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <Field label="Morning" htmlFor="morning_time"><input className={inputClass} id="morning_time" name="morning_time" type="time" required defaultValue={settings.morning_time} /></Field>
              <Field label="Afternoon" htmlFor="afternoon_time"><input className={inputClass} id="afternoon_time" name="afternoon_time" type="time" required defaultValue={settings.afternoon_time} /></Field>
              <Field label="Evening" htmlFor="evening_time"><input className={inputClass} id="evening_time" name="evening_time" type="time" required defaultValue={settings.evening_time} /></Field>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#f0e7d9] text-[#b9684f]"><MoonStar /></span><div><h2 className="font-serif text-xl font-semibold">Quiet hours</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Keep proactive prompts silent overnight.</p></div></div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field label="Quiet time begins" htmlFor="quiet_hours_start"><input className={inputClass} id="quiet_hours_start" name="quiet_hours_start" type="time" required defaultValue={settings.quiet_hours_start} /></Field>
              <Field label="Quiet time ends" htmlFor="quiet_hours_end"><input className={inputClass} id="quiet_hours_end" name="quiet_hours_end" type="time" required defaultValue={settings.quiet_hours_end} /></Field>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#dfe6d9] text-[#59705e]"><Clock3 /></span><div><h2 className="font-serif text-xl font-semibold">Event reminders</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">This lead time is selected automatically for new events. You can change it on any event.</p></div></div>
            <div className="mt-6 max-w-md"><Field label="Default reminder lead time" htmlFor="reminder_lead_minutes"><select className={inputClass} id="reminder_lead_minutes" name="reminder_lead_minutes" defaultValue={settings.reminder_lead_minutes}><option value="0">At event time</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></Field></div>
            <div className="mt-6 border-t pt-6"><SettingToggle name="spoken_reminders_enabled" defaultChecked={settings.spoken_reminders_enabled} icon={<Volume2 />} title="Spoken reminders" description="Allow enabled event reminders to be read aloud by the companion display." /></div>
          </section>

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex justify-end"><Button disabled={saving}>{saving && <LoaderCircle className="animate-spin motion-reduce:animate-none" />} Save settings</Button></div>
        </form>
      ) : null}
    </div>
  );
}

function SettingToggle({ name, defaultChecked, icon, title, description }: { name: string; defaultChecked: boolean; icon: React.ReactNode; title: string; description: string }) {
  return <label className="flex cursor-pointer items-start justify-between gap-4"><span className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#dfe6d9] text-[#59705e]">{icon}</span><span><span className="block font-serif text-xl font-semibold">{title}</span><span className="mt-1 block text-sm leading-6 text-muted-foreground">{description}</span></span></span><input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-3 size-5 shrink-0 accent-[#728a76]" /></label>;
}
