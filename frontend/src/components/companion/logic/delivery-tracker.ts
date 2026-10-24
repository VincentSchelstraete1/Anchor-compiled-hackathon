// Tracks caregiver replies through "spoken" -> "delivered" so a reply is read aloud once, marked delivered only
// after speech completed, and a failed delivery request is retried without re-reading the reply.

export type DeliveryPlan = "speak" | "deliver" | "skip";

export interface DeliveryTracker {
  plan(id: number): DeliveryPlan;
  beginSpeak(id: number): void;
  spoke(id: number, completed: boolean): void;
  delivered(id: number): void;
}

export function createDeliveryTracker(maxSpeakAttempts = 3): DeliveryTracker {
  const state = new Map<number, { attempts: number; spoken: boolean; delivered: boolean }>();
  const get = (id: number) => {
    let s = state.get(id);
    if (!s) state.set(id, (s = { attempts: 0, spoken: false, delivered: false }));
    return s;
  };
  return {
    plan(id) {
      const s = get(id);
      if (s.delivered) return "skip";
      if (s.spoken) return "deliver";
      return s.attempts >= maxSpeakAttempts ? "skip" : "speak";
    },
    beginSpeak: (id) => void get(id).attempts++,
    spoke(id, completed) {
      if (completed) get(id).spoken = true;
    },
    delivered: (id) => void (get(id).delivered = true),
  };
}
