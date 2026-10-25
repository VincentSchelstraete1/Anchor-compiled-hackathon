/** A caregiver-configured daily check-in. `time` is local "HH:MM"; `days` are 0-6 (Sunday = 0), empty/absent = every day. */
export interface CheckIn {
  id: string | number;
  time: string;
  message?: string;
  days?: number[];
}

const LATE_MS = 90 * 60_000;

export function parseCheckIns(value: unknown): CheckIn[] {
  const items = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items) ? (value as { items: unknown[] }).items : [];
  const out: CheckIn[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if ((typeof r.id !== "string" && typeof r.id !== "number") || typeof r.time !== "string" || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(r.time)) continue;
    out.push({
      id: r.id,
      time: r.time,
      message: typeof r.message === "string" && r.message.trim() ? r.message.trim().slice(0, 500) : undefined,
      days: Array.isArray(r.days) ? r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6) : undefined,
    });
  }
  return out;
}

export function checkInKey(c: CheckIn, now: Date): string {
  return `checkin:${c.id}@${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** The earliest check-in whose time has passed today (within 90 minutes) and that hasn't been handled today. */
export function dueCheckIn(list: CheckIn[], now: Date, handled: (key: string) => boolean): CheckIn | null {
  const due = list
    .filter((c) => !c.days || c.days.length === 0 || c.days.includes(now.getDay()))
    .filter((c) => {
      const [h, m] = c.time.split(":").map(Number);
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
      return now.getTime() >= at && now.getTime() - at <= LATE_MS;
    })
    .filter((c) => !handled(checkInKey(c, now)))
    .sort((a, b) => a.time.localeCompare(b.time));
  return due[0] ?? null;
}
