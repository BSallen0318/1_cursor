import { create } from 'zustand';

interface SessionState {
  user?: { id: string; name: string; role: 'admin' | 'member' | 'viewer' } | null;
  setUser: (u: SessionState['user']) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  setUser: (u) => set({ user: u })
}));


