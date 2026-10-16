'use client';

import { useEffect, useState } from 'react';
import { apiBlob } from '@/lib/api';

/**
 * An employee's photo, or the avatar the API draws for people without one.
 * Fetched with the access token, since a plain <img src> cannot send it.
 */
export function Avatar({ employmentId, name, size = 36, version = 0 }: { employmentId: string; name: string; size?: number; version?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    apiBlob(`/employees/${employmentId}/photo`)
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
  }, [employmentId, version]);
  const initials = name
    .split(/\s+/)
    .map((p) => [...p][0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return url ? (
    <img className="avatar" src={url} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span className="avatar placeholder" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </span>
  );
}
