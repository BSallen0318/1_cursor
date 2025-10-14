'use client';

import { useEffect, useState } from 'react';

type Provider = 'drive' | 'jira' | 'github' | 'figma';
const providers: Provider[] = ['drive', 'jira', 'github', 'figma'];

const providerLabels: Record<Provider, string> = {
  drive: 'Drive',
  jira: 'Jira',
  github: 'Github',
  figma: 'Figma'
};

export default function IntegrationsPage() {
  const [states, setStates] = useState<Record<string, { connected: boolean; scopes: string[] }>>({});

  const load = async () => {
    const entries = await Promise.all(
      providers.map(async (p) => {
        const r = await fetch(`/api/integrations/${p}/connect`, { credentials: 'include' });
        return [p, await r.json()] as const;
      })
    );
    setStates(Object.fromEntries(entries));
  };

  useEffect(() => { load(); }, []);

  const toggle = async (p: Provider) => {
    const r = await fetch(`/api/integrations/${p}/connect`, { method: 'POST', credentials: 'include' });
    const json = await r.json();
    setStates((s) => ({ ...s, [p]: json }));
  };

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold mb-6">연동 설정</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {providers.map((p) => {
          const isConnected = states[p]?.connected;
          return (
            <div key={p} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-950 shadow-sm">
              <div className="font-semibold text-lg capitalize mb-3">{providerLabels[p]}</div>
              
              {/* 연결 상태 표시 */}
              <div className="flex items-center gap-2 mb-4">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                <div className={`text-sm font-medium ${isConnected ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
                  {isConnected ? '연결됨' : '연결 안됨'}
                </div>
              </div>

              {/* ON/OFF 토글 스위치 */}
              <div className="flex items-center gap-3 mb-4">
                <button
                  onClick={() => toggle(p)}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                    isConnected 
                      ? 'bg-green-500 focus:ring-green-500' 
                      : 'bg-gray-300 dark:bg-gray-700 focus:ring-gray-400'
                  }`}
                  aria-label="Toggle connection"
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform duration-300 ease-in-out ${
                      isConnected ? 'translate-x-8' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {isConnected ? 'ON' : 'OFF'}
                </span>
              </div>

              {/* OAuth 버튼 */}
              {p === 'drive' && (
                <a 
                  href="/api/integrations/drive/auth" 
                  className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-sm font-medium transition-colors"
                >
                  Google OAuth
                </a>
              )}
              {p === 'figma' && (
                <a 
                  href="/api/integrations/figma/auth" 
                  className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-sm font-medium transition-colors"
                >
                  Figma OAuth
                </a>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}


