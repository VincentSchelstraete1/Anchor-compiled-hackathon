export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Entry { ack?: number; spoken?: number }
const KEY = "anchor.reminder_state";
const KEEP_MS = 36 * 3600_000;

/** Remembers which reminders were spoken and which were acknowledged, across page reloads. Fails soft. */
export function createAckStore(storage: StorageLike | null, now: () => number = Date.now) {
  const read = (): Record<string, Entry> => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "{}");
      return parsed && typeof parsed === "object" ? (parsed as Record<string, Entry>) : {};
    } catch {
      return {};
    }
  };
  const memory: Record<string, Entry> = {};
  const write = (key: string, patch: Entry) => {
    memory[key] = { ...memory[key], ...patch };
    try {
      const all = { ...read(), [key]: { ...read()[key], ...patch } };
      for (const [k, v] of Object.entries(all)) {
        if (now() - Math.max(v.ack ?? 0, v.spoken ?? 0) > KEEP_MS) delete all[k];
      }
      storage?.setItem(KEY, JSON.stringify(all));
    } catch {
      // Storage unavailable: the in-memory copy still prevents repeats in this session.
    }
  };
  const get = (key: string): Entry => ({ ...read()[key], ...memory[key] });
  return {
    acknowledge: (key: string) => write(key, { ack: now() }),
    markSpoken: (key: string) => write(key, { spoken: now() }),
    isAcknowledged: (key: string) => get(key).ack !== undefined,
    wasSpoken: (key: string) => get(key).spoken !== undefined,
    clear() {
      for (const k of Object.keys(memory)) delete memory[k];
      try {
        storage?.setItem(KEY, "{}");
      } catch {
        // ignore
      }
    },
  };
}
export type AckStore = ReturnType<typeof createAckStore>;
