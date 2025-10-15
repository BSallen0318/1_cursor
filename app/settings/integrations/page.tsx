'use client';

import { useEffect, useState } from 'react';

type Provider = 'drive' | 'jira' | 'figma';
const providers: Provider[] = ['drive', 'jira', 'figma'];

const providerLabels: Record<Provider, string> = {
  drive: 'Drive',
  jira: 'Jira',
  figma: 'Figma'
};

export default function IntegrationsPage() {
  const [states, setStates] = useState<Record<string, { connected: boolean; scopes: string[] }>>({});
  const [indexStatus, setIndexStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);

  const load = async () => {
    const entries = await Promise.all(
      providers.map(async (p) => {
        const r = await fetch(`/api/integrations/${p}/connect`, { credentials: 'include' });
        return [p, await r.json()] as const;
      })
    );
    setStates(Object.fromEntries(entries));
  };

  const loadIndexStatus = async () => {
    try {
      const res = await fetch('/api/index/sync', { credentials: 'include' });
      const data = await res.json();
      setIndexStatus(data);
    } catch (e) {
      console.error('색인 상태 조회 실패:', e);
    }
  };

  useEffect(() => { 
    load();
    loadIndexStatus();
  }, []);

  const toggle = async (p: Provider) => {
    const r = await fetch(`/api/integrations/${p}/connect`, { method: 'POST', credentials: 'include' });
    const json = await r.json();
    setStates((s) => ({ ...s, [p]: json }));
  };

  const startSync = async (platforms: string[]) => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/index/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ platforms })
      });
      const data = await res.json();
      setSyncResult(data);
      await loadIndexStatus();
    } catch (e: any) {
      setSyncResult({
        success: false,
        error: e?.message || '색인 실패'
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main className="p-6 max-w-7xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">연동 설정</h1>
      
      {/* 안내 문구 */}
      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-xl">💡</span>
          <span className="text-sm font-medium text-blue-900 dark:text-blue-300">
            OAuth를 눌러서 연동하고 전체 색인을 진행해주세요.
          </span>
        </div>
      </div>
      
      {/* 연동 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
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

                  {/* OAuth 버튼 또는 설정 안내 */}
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
                  {p === 'jira' && (
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      <a 
                        href="/JIRA_SETUP.md" 
                        target="_blank"
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        📖 연결 가이드 보기
                      </a>
                      <div className="mt-2">
                        .env.local에 설정 필요
                      </div>
                    </div>
                  )}
            </div>
          );
        })}
      </div>

      {/* 색인 관리 섹션 */}
      <div className="border-t pt-8">
        <h2 className="text-2xl font-bold mb-6">🗂️ 검색 색인 관리</h2>
        
        {/* 색인 상태 */}
        <div className="bg-white dark:bg-zinc-950 rounded-2xl border-2 border-zinc-200 dark:border-zinc-800 p-6 shadow-md mb-6">
          <h3 className="text-lg font-bold mb-4">📊 현재 색인 상태</h3>
          {indexStatus ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/30 p-4 rounded-xl border border-blue-200 dark:border-blue-800">
                <div className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-1">전체 문서</div>
                <div className="text-3xl font-bold text-blue-900 dark:text-blue-100">{indexStatus.total?.toLocaleString() || 0}</div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/30 dark:to-green-900/30 p-4 rounded-xl border border-green-200 dark:border-green-800">
                <div className="text-sm text-green-600 dark:text-green-400 font-medium mb-1">📊 Drive</div>
                <div className="text-3xl font-bold text-green-900 dark:text-green-100">{indexStatus.platforms?.drive?.count?.toLocaleString() || 0}</div>
                <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                  {indexStatus.platforms?.drive?.lastSync 
                    ? `${new Date(indexStatus.platforms.drive.lastSync).toLocaleString()}`
                    : '미동기화'
                  }
                </div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/30 dark:to-purple-900/30 p-4 rounded-xl border border-purple-200 dark:border-purple-800">
                <div className="text-sm text-purple-600 dark:text-purple-400 font-medium mb-1">🎨 Figma</div>
                <div className="text-3xl font-bold text-purple-900 dark:text-purple-100">{indexStatus.platforms?.figma?.count?.toLocaleString() || 0}</div>
                <div className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                  {indexStatus.platforms?.figma?.lastSync 
                    ? `${new Date(indexStatus.platforms.figma.lastSync).toLocaleString()}`
                    : '미동기화'
                  }
                </div>
              </div>
              <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950/30 dark:to-orange-900/30 p-4 rounded-xl border border-orange-200 dark:border-orange-800">
                <div className="text-sm text-orange-600 dark:text-orange-400 font-medium mb-1">📋 Jira</div>
                <div className="text-3xl font-bold text-orange-900 dark:text-orange-100">{indexStatus.platforms?.jira?.count?.toLocaleString() || 0}</div>
                <div className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                  {indexStatus.platforms?.jira?.lastSync 
                    ? `${new Date(indexStatus.platforms.jira.lastSync).toLocaleString()}`
                    : '미동기화'
                  }
                </div>
              </div>
            </div>
          ) : (
            <div className="text-zinc-500">로딩 중...</div>
          )}
        </div>

        {/* 색인 실행 */}
        <div className="bg-white dark:bg-zinc-950 rounded-2xl border-2 border-zinc-200 dark:border-zinc-800 p-6 shadow-md">
          <h3 className="text-lg font-bold mb-4">🚀 색인 실행</h3>
          
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-xl border border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-3">
                <span className="text-2xl">💡</span>
                <div className="flex-1 text-sm text-blue-700 dark:text-blue-300">
                  색인을 실행하면 모든 문서가 데이터베이스에 저장되어 <strong>검색 속도가 100배 빨라집니다!</strong>
                  <br />⏱️ 소요 시간: 약 30초 ~ 2분
                </div>
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              <button
                onClick={() => startSync(['drive', 'figma', 'jira'])}
                disabled={syncing}
                className="flex-1 min-w-[200px] h-14 px-6 rounded-xl bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 text-white font-bold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {syncing ? '⏳ 색인 중...' : '🔄 전체 색인 (Drive + Figma + Jira)'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => startSync(['drive'])}
                disabled={syncing}
                className="h-12 px-4 rounded-xl border-2 border-green-500 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/20 font-semibold transition-all disabled:opacity-50"
              >
                📊 Drive만
              </button>
              <button
                onClick={() => startSync(['figma'])}
                disabled={syncing}
                className="h-12 px-4 rounded-xl border-2 border-purple-500 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/20 font-semibold transition-all disabled:opacity-50"
              >
                🎨 Figma만
              </button>
              <button
                onClick={() => startSync(['jira'])}
                disabled={syncing}
                className="h-12 px-4 rounded-xl border-2 border-orange-500 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/20 font-semibold transition-all disabled:opacity-50"
              >
                📋 Jira만
              </button>
            </div>
          </div>

          {/* 색인 결과 */}
          {syncResult && (
            <div className="mt-6 p-4 rounded-xl border-2">
              <div className="font-bold mb-2">
                {syncResult.success ? '✅ 색인 완료' : '❌ 색인 실패'}
              </div>
              {syncResult.duration && (
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
                  ⏱️ 소요 시간: {(syncResult.duration / 1000).toFixed(1)}초
                </div>
              )}
              {syncResult.platforms && Object.entries(syncResult.platforms).map(([platform, data]: [string, any]) => (
                <div 
                  key={platform}
                  className={`p-3 rounded-lg mb-2 ${
                    data.success 
                      ? 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300' 
                      : 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300'
                  }`}
                >
                  <span className="font-semibold capitalize">{platform}: </span>
                  {data.success ? data.message : data.error}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}


