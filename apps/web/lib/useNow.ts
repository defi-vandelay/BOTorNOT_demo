'use client';

import { useEffect, useState } from 'react';

/** Current time, refreshed on an interval, for countdowns. */
export function useNow(intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function secondsLeft(endsAt: number | undefined, now: number) {
  return endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;
}

export function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
