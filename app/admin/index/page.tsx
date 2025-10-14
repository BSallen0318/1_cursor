'use client';

import { useState, useEffect } from 'react';

export default function IndexManagementPage() {
  const [status, setStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/index/sync', { credentials: 'include' });
      const data = await res.json();
      setStatus(data);
    } catch (e: any) {
      console.error('상태 조회 실패:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const startSync = async (platforms: string[]) => {
    setSyncing(true);
    setResult(null);
    try {
      const res = await fetch('/api/index/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ platforms })
      });
      const data = await res.json();
      setResult(data);
      // 색인 완료 후 상태 갱신
      await loadStatus();
    } catch (e: any) {
      setResult({
        success: false,
        error: e?.message || '색인 실패'
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">🗂️ 검색 색인 관리</h1>
          <button
            onClick={loadStatus}
            disabled={loading}
            className="px-4 py-2 rounded-lg border-2 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
          >
            {loading ? '로딩 중...' : '🔄 새로고침'}
          </button>
        </div>

        {/* 색인 상태 */}
        <div className="bg-white dark:bg-zinc-950 rounded-2xl border-2 border-zinc-200 dark:border-zinc-800 p-6 shadow-lg">
          <h2 className="text-xl font-bold mb-4">📊 현재 색인 상태</h2>
          {loading ? (
            <div className="text-zinc-500">로딩 중...</div>
          ) : status ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/30 p-4 rounded-xl border border-blue-200 dark:border-blue-800">
                  <div className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-1">전체 문서</div>
                  <div className="text-3xl font-bold text-blue-900 dark:text-blue-100">{status.total?.toLocaleString() || 0}</div>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/30 dark:to-green-900/30 p-4 rounded-xl border border-green-200 dark:border-green-800">
                  <div className="text-sm text-green-600 dark:text-green-400 font-medium mb-1">Drive 문서</div>
                  <div className="text-3xl font-bold text-green-900 dark:text-green-100">{status.platforms?.drive?.count?.toLocaleString() || 0}</div>
                  <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                    {status.platforms?.drive?.lastSync 
                      ? `마지막 동기화: ${new Date(status.platforms.drive.lastSync).toLocaleString()}`
                      : '동기화 안됨'
                    }
                  </div>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/30 dark:to-purple-900/30 p-4 rounded-xl border border-purple-200 dark:border-purple-800">
                  <div className="text-sm text-purple-600 dark:text-purple-400 font-medium mb-1">Figma 문서</div>
                  <div className="text-3xl font-bold text-purple-900 dark:text-purple-100">{status.platforms?.figma?.count?.toLocaleString() || 0}</div>
                  <div className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                    {status.platforms?.figma?.lastSync 
                      ? `마지막 동기화: ${new Date(status.platforms.figma.lastSync).toLocaleString()}`
                      : '동기화 안됨'
                    }
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-red-500">상태를 불러올 수 없습니다.</div>
          )}
        </div>

        {/* 색인 실행 */}
        <div className="bg-white dark:bg-zinc-950 rounded-2xl border-2 border-zinc-200 dark:border-zinc-800 p-6 shadow-lg">
          <h2 className="text-xl font-bold mb-4">🚀 색인 실행</h2>
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-xl border border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-3">
                <span className="text-2xl">💡</span>
                <div className="flex-1">
                  <div className="font-semibold text-blue-900 dark:text-blue-100 mb-1">색인이란?</div>
                  <div className="text-sm text-blue-700 dark:text-blue-300">
                    모든 Drive/Figma 문서를 한 번에 수집해서 데이터베이스에 저장합니다. 
                    색인이 완료되면 <strong>검색 속도가 10~100배 빨라집니다!</strong>
                  </div>
                  <div className="text-sm text-blue-600 dark:text-blue-400 mt-2">
                    ⏱️ 소요 시간: 약 30초 ~ 2분 (문서 개수에 따라 다름)
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => startSync(['drive', 'figma'])}
                disabled={syncing}
                className="flex-1 h-14 px-6 rounded-xl bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 text-white font-bold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {syncing ? '⏳ 색인 중...' : '🔄 전체 색인 시작 (Drive + Figma)'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => startSync(['drive'])}
                disabled={syncing}
                className="h-12 px-4 rounded-xl border-2 border-green-500 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/20 font-semibold transition-all disabled:opacity-50"
              >
                📊 Drive만 색인
              </button>
              <button
                onClick={() => startSync(['figma'])}
                disabled={syncing}
                className="h-12 px-4 rounded-xl border-2 border-purple-500 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/20 font-semibold transition-all disabled:opacity-50"
              >
                🎨 Figma만 색인
              </button>
            </div>
          </div>
        </div>

        {/* 색인 결과 */}
        {result && (
          <div className="bg-white dark:bg-zinc-950 rounded-2xl border-2 border-zinc-200 dark:border-zinc-800 p-6 shadow-lg">
            <h2 className="text-xl font-bold mb-4">
              {result.success ? '✅ 색인 완료' : '❌ 색인 실패'}
            </h2>
            <div className="space-y-3">
              {result.duration && (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  ⏱️ 소요 시간: {(result.duration / 1000).toFixed(1)}초
                </div>
              )}
              
              {result.platforms && Object.entries(result.platforms).map(([platform, data]: [string, any]) => (
                <div 
                  key={platform}
                  className={`p-4 rounded-xl border ${
                    data.success 
                      ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800' 
                      : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold capitalize">
                        {platform === 'drive' ? '📊 Drive' : '🎨 Figma'}
                      </div>
                      {data.success ? (
                        <div className="text-sm text-green-700 dark:text-green-300">
                          {data.message || `${data.indexed}개 문서 색인 완료`}
                        </div>
                      ) : (
                        <div className="text-sm text-red-700 dark:text-red-300">
                          {data.error || '색인 실패'}
                        </div>
                      )}
                    </div>
                    <div className="text-3xl">
                      {data.success ? '✅' : '❌'}
                    </div>
                  </div>
                </div>
              ))}

              {result.error && (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
                  {result.error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 사용 안내 */}
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 rounded-2xl border border-amber-200 dark:border-amber-800 p-6">
          <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
            <span>📖</span>
            <span>사용 안내</span>
          </h3>
          <ul className="space-y-2 text-sm text-amber-900 dark:text-amber-100">
            <li className="flex items-start gap-2">
              <span className="mt-0.5">1️⃣</span>
              <span><strong>첫 사용 시:</strong> "전체 색인 시작" 버튼을 클릭하세요.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5">2️⃣</span>
              <span><strong>주기적 업데이트:</strong> 하루에 1~2번 정도 색인을 실행하면 최신 문서를 검색할 수 있습니다.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5">3️⃣</span>
              <span><strong>검색 속도:</strong> 색인 후에는 검색이 0.1초 안에 완료됩니다!</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5">4️⃣</span>
              <span><strong>자동화:</strong> 나중에 cron job을 설정하면 자동으로 업데이트됩니다.</span>
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}

