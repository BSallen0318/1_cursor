'use client';

import { useEffect, useState } from 'react';
import { useSessionStore } from './store';

export function useAuth() {
  const { user, setUser } = useSessionStore();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          mounted && setUser(json.user);
        } else {
          mounted && setUser(null);
        }
      } catch {
        mounted && setUser(null);
      }
    })();
    return () => { mounted = false; };
  }, [setUser]);

  const signIn = async () => {
    setLoading(true);
    try {
      await fetch('/api/auth/google', { method: 'POST' });
      const r = await fetch('/api/auth/session');
      if (r.ok) {
        const j = await r.json();
        setUser(j.user);
      }
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    setUser(null);
  };

  return { user, role: user?.role ?? 'viewer', loading, signIn, signOut } as const;
}


