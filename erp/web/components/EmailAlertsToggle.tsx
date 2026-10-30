'use client';

import { Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';

interface Alerts {
  emailAlerts: boolean;
  configured: boolean;
}

/** The signed-in person's own switch for approval emails */
export function EmailAlertsToggle() {
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Alerts>('/me/email-alerts')
      .then(setAlerts)
      .catch((e) => setError(errorText(e)));
  }, []);

  async function change(emailAlerts: boolean) {
    if (!alerts) return;
    const before = alerts;
    setError('');
    // Show the new setting at once; put it back if the server refuses it
    setAlerts({ ...alerts, emailAlerts });
    try {
      setAlerts(await api<Alerts>('/me/email-alerts', { method: 'PUT', body: { emailAlerts } }));
    } catch (e) {
      setAlerts(before);
      setError(errorText(e));
    }
  }

  if (error) return <span className="muted">{error}</span>;
  if (!alerts) return null;
  return (
    <label className="check" title="Email when something waits for your approval, when your vouchers are rejected or posted, and a reminder each weekday morning">
      <Mail size={15} />
      <input type="checkbox" checked={alerts.emailAlerts} onChange={(e) => change(e.target.checked)} />
      Email me
      {!alerts.configured && <span className="muted">(email is not set up on the server yet)</span>}
    </label>
  );
}
