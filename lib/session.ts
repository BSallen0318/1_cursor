type Role = 'admin' | 'member' | 'viewer';

interface SessionUser { id: string; name: string; role: Role }

declare global {
  // eslint-disable-next-line no-var
  var __WM_SESSION__: SessionUser | null | undefined;
}

export function getSession(): SessionUser | null {
  return globalThis.__WM_SESSION__ ?? null;
}

export function setSession(user: SessionUser | null) {
  globalThis.__WM_SESSION__ = user;
}


