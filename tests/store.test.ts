import { describe, it, expect } from 'vitest';
import { useSessionStore } from '@/lib/store';

describe('session store', () => {
  it('sets user', () => {
    const { setUser } = useSessionStore.getState();
    setUser({ id: 'u', name: 'U', role: 'viewer' });
    expect(useSessionStore.getState().user?.id).toBe('u');
  });
});

