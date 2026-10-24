"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
}

const minuteSnapshot = () => Math.floor(Date.now() / 60000);
const serverSnapshot = () => 0;

/** Current time, refreshed each minute. Null during server render and hydration. */
export function useNow(): Date | null {
  const minute = useSyncExternalStore(subscribe, minuteSnapshot, serverSnapshot);
  return minute === 0 ? null : new Date(minute * 60000);
}
