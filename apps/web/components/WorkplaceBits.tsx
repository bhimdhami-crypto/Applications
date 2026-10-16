'use client';

import { useEffect, useState } from 'react';
import { apiBlob } from '@/lib/api';
import type { WorkMode } from '@/lib/types';

export const MODE_LABEL: Record<WorkMode, string> = { OFFICE: 'In the office', REMOTE: 'Remote', FIELD: 'At a client or on site' };

/** Initials in a circle, for chat and the community page (no photos are shared there) */
export function Initials({ name, size = 36, group = false }: { name: string; size?: number; group?: boolean }) {
  const letters = name
    .split(/\s+/)
    .map((p) => [...p][0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span className="avatar placeholder" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.38, ...(group ? { borderRadius: 10 } : {}) }}>
      {letters}
    </span>
  );
}

/** "14:05" today, "Mon 14:05" this week, else a date */
export function whenLabel(iso: string, lang = 'en') {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return `${d.toLocaleDateString(lang, { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export const hoursAndMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

/** Wall-clock time of a moment in the company's time zone, e.g. 08:05 */
export const timeIn = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** The moment a local date and time in a time zone happen, as an ISO string */
export function zonedIso(date: string, hhmm: string, timeZone: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const guess = Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60_000;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess - (shown - guess)).toISOString();
}

/** A protected file as an object URL for <img> or <video>, released when no longer shown */
export function useBlobUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    let made: string | null = null;
    apiBlob(path)
      .then((b) => {
        if (!live) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      })
      .catch(() => setUrl(null));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  return url;
}
