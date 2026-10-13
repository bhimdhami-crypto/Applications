'use client';

import { useEffect, useState } from 'react';
import { apiBlob } from '@/lib/api';

/** Profile photo loaded with the sign-in token, falling back to initials. */
export function Avatar({ employeeId, name, hasPhoto, size = 40, version = 0 }: { employeeId: string; name: string; hasPhoto: boolean; size?: number; version?: number }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPhoto) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    apiBlob(`/employees/${employeeId}/photo`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employeeId, hasPhoto, version]);

  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const style = { width: size, height: size, fontSize: size * 0.38 };
  return url ? (
    <img className="avatar" src={url} alt={name} style={style} />
  ) : (
    <span className="avatar initials" style={style} aria-label={name}>
      {initials}
    </span>
  );
}
