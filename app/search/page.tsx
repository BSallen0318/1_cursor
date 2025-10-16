'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { DocItem } from '@/types/platform';
import { FiltersPanel } from '@/components/search/FiltersPanel';
import { ResultsList } from '@/components/search/ResultsList';
import { PreviewPane } from '@/components/preview/PreviewPane';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { Hero } from '@/components/common/Hero';
import { LoadingIndicator } from '@/components/common/LoadingIndicator';

// 문서 종류 버튼 컴포넌트
function SourceButton({ source, active, onClick, icon, label }: { source: string; active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-2 px-6 py-3 rounded-xl border-2 transition-all ${
        active 
          ? 'border-green-500 bg-green-50 dark:bg-green-950/20' 
          : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
      }`}
    >
      <span className="text-2xl">{icon}</span>
      <span className={`text-sm font-medium ${active ? 'text-green-600 dark:text-green-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
        {label}
      </span>
    </button>
  );
}

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [ask, setAsk] = useState('');
  const [data, setData] = useState<{ items: DocItem[]; total: number } | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<any>({ source: 'all' });
  const [aiAnswer, setAiAnswer] = useState<{ question: string; answer: string } | null>(null);
  const [page, setPage] = useState(1);
  const [recent, setRecent] = useState<string[]>([]);
  const handleFiltersChange = useCallback((f: any) => setFilters(f), []);
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchContent, setSearchContent] = useState(false); // 내용 찾기 체크박스
  const [lastSearchUsedContent, setLastSearchUsedContent] = useState(false); // 마지막 검색이 내용 찾기를 사용했는지

  const onSearch = async () => {
    setLoading(true);
    setError(null);
    setData(null); // 이전 검색 결과 즉시 제거
    setLastSearchUsedContent(searchContent); // 현재 검색이 내용 찾기를 사용하는지 저장
    try {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      
      // 내용 찾기 체크 시 size=10으로 고정
      const searchSize = searchContent ? 10 : 10;
      
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ q, page, size: searchSize, filters, sort: filters?.sort || 'relevance', fast: !searchContent }),
        signal: controller.signal
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (!res.ok) {
        setError((json && (json.error || json.message)) || text || '검색 실패');
        setData({ items: [], total: 0 });
        return;
      }
      setData(json || { items: [], total: 0 });
      if (json?.debug) {
        console.log('search-debug', json.debug);
      }
      const term = q.trim();
      if (term) {
        const next = [term, ...recent.filter((t) => t !== term)].slice(0, 10);
        setRecent(next);
        try { localStorage.setItem('recentSearches', JSON.stringify(next)); } catch {}
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // 취소된 경우: 에러 표시 안 함
        console.log('검색 취소됨');
      } else {
        setError(e?.message || '검색 실패');
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  useEffect(() => {
    if (q.trim().length > 0) onSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filters]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('recentSearches') || '[]');
      if (Array.isArray(saved)) setRecent(saved.slice(0, 10));
    } catch {}
  }, []);

  const removeRecent = (t: string) => {
    setRecent((prev) => {
      const next = prev.filter((x) => x !== t);
      try { localStorage.setItem('recentSearches', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* 검색창 - 맨 위 */}
        <div className="bg-white dark:bg-zinc-950 rounded-2xl shadow-lg border border-zinc-200 dark:border-zinc-800 p-6">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <input 
                value={q} 
                onChange={(e) => setQ(e.target.value)} 
                onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); onSearch(); } }} 
                placeholder="찾는 기획서에 관련된 정보를 입력해주세요" 
                className="flex-1 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl px-5 h-14 text-lg focus:border-green-500 focus:outline-none transition-colors" 
              />
            <button 
              className={`h-14 px-8 rounded-xl font-semibold transition-colors shadow-md ${
                loading 
                  ? 'bg-red-500 hover:bg-red-600 text-white' 
                  : 'bg-green-500 hover:bg-green-600 text-white'
              }`}
              onClick={() => { 
                if (loading) {
                  if (abortRef.current) abortRef.current.abort();
                } else {
                  setPage(1); 
                  onSearch(); 
                }
              }}
            >
              {loading ? '취소' : '검색'}
            </button>
            </div>
            
            {/* 내용 찾기 체크박스 */}
            <div className="flex items-center gap-2 px-2">
              <input 
                type="checkbox" 
                id="searchContent" 
                checked={searchContent} 
                onChange={(e) => setSearchContent(e.target.checked)}
                className="w-4 h-4 text-green-500 border-zinc-300 rounded focus:ring-green-500" 
              />
              <label htmlFor="searchContent" className="text-sm font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer select-none">
                📄 내용 찾기 (문서 안의 내용을 찾으려면 체크하고 검색하세요)
              </label>
            </div>
          </div>
        </div>

        {/* 문서 종류 필터 - 검색창 바로 밑 */}
        <div className="bg-white dark:bg-zinc-950 rounded-2xl shadow-md border border-zinc-200 dark:border-zinc-800 p-6">
          <div className="flex items-center gap-4 flex-wrap justify-between">
            <div className="flex items-center gap-4 flex-wrap">
              <SourceButton 
                source="all"
                active={!filters.source || filters.source === 'all'}
                onClick={() => setFilters((f: any) => ({ ...f, source: 'all' }))}
                icon="📁"
                label="전체"
              />
              <SourceButton 
                source="drive"
                active={filters.source === 'drive'}
                onClick={() => setFilters((f: any) => ({ ...f, source: 'drive' }))}
                icon="📊"
                label="구글드라이브"
              />
              <SourceButton 
                source="figma"
                active={filters.source === 'figma'}
                onClick={() => setFilters((f: any) => ({ ...f, source: 'figma' }))}
                icon="🎨"
                label="피그마"
              />
              <SourceButton 
                source="jira"
                active={filters.source === 'jira'}
                onClick={() => setFilters((f: any) => ({ ...f, source: 'jira' }))}
                icon="📋"
                label="지라"
              />
            </div>
            
            {/* 연동 설정 버튼 */}
            <Link 
              href="/settings/integrations?drive=connected"
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-medium transition-colors shadow-md"
            >
              🔗 연동 설정
            </Link>
          </div>
        </div>

        {/* 공지사항 - 1줄 */}
        <div className="bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-950/20 dark:to-green-950/20 rounded-xl border border-blue-200 dark:border-blue-800 px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-xl">📢</span>
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              문서의 제목 혹은 특정 내용을 입력해보세요. 개선 문의는 와니에게 슬랙 주세요.
            </span>
          </div>
        </div>

        {/* 메인 컨텐츠 영역 */}
        <div className="grid lg:grid-cols-[280px_1fr] gap-6">
          {/* 왼쪽: 최근 검색어 (최대 10개) */}
          <aside className="hidden lg:block">
            <div className="sticky top-6 bg-white dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-md">
              <div className="text-base font-bold mb-4 flex items-center gap-2">
                <span>🔍</span>
                <span>최근 검색어</span>
              </div>
              <ul className="space-y-2">
                {Array.from({ length: 10 }).map((_, idx) => {
                  const term = recent[idx];
                  return (
                    <li 
                      key={idx} 
                      className={`flex items-center justify-between gap-2 py-2 px-3 rounded-lg ${
                        term ? 'hover:bg-zinc-50 dark:hover:bg-zinc-900' : 'text-zinc-300 dark:text-zinc-700'
                      }`}
                      style={{ minHeight: '40px' }}
                    >
                      {term ? (
                        <>
                          <button 
                            className="flex-1 text-left text-sm hover:text-green-600 dark:hover:text-green-400 transition-colors truncate" 
                            onClick={() => { setQ(term); setPage(1); }}
                          >
                            {idx + 1}. {term}
                          </button>
                          <button 
                            aria-label="remove" 
                            className="p-1 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-colors text-lg font-bold" 
                            onClick={() => removeRecent(term)}
                          >
                            ×
                          </button>
                        </>
                      ) : (
                        <span className="text-sm">{idx + 1}. -</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>

          {/* 오른쪽: 검색 결과 + 미리보기 */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-[400px]">
              <div className="lg:col-span-2">
                {loading && <LoadingIndicator label="문서를 찾고 있습니다. 제목만 찾는 경우 내용 찾기 체크박스를 해제하면 훨씬 빨라요." />}
                {error && <div className="text-red-500 bg-red-50 dark:bg-red-950/20 p-4 rounded-xl border border-red-200 dark:border-red-800">{error}</div>}
                {!loading && !q && (!data || data.items.length === 0) && (
                  <div className="flex flex-col items-center justify-center py-32 text-center">
                    <span className="text-6xl mb-4">🔍</span>
                    <div className="text-zinc-400 dark:text-zinc-600 text-xl">찾을 문서를 입력해주세요</div>
                  </div>
                )}
                {!loading && q && data && (
                  <ResultsList items={data.items} activeId={selectedId || undefined} onSelect={async (id: string) => {
                    setSelectedId(id);
                    setSelected({ loading: true });
                    const r = await fetch(`/api/docs/${id}?q=${encodeURIComponent(q)}`, { credentials: 'include' });
                    const payload = await r.json();
                    setSelected(payload);
                  }} searchContent={lastSearchUsedContent} query={q} />
                )}
                {!loading && data && !lastSearchUsedContent && (
                  <div className="flex items-center gap-3 mt-6 justify-center">
                    <button 
                      disabled={page <= 1} 
                      onClick={() => setPage((p) => Math.max(1, p - 1))} 
                      className="px-5 h-10 rounded-lg border-2 border-zinc-300 dark:border-zinc-700 disabled:opacity-30 hover:bg-zinc-50 dark:hover:bg-zinc-900 font-medium transition-colors"
                    >
                      ← 이전
                    </button>
                    <div className="px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 font-semibold">
                      {page}
                    </div>
                    <button 
                      disabled={(data.items?.length || 0) < 10} 
                      onClick={() => setPage((p) => p + 1)} 
                      className="px-5 h-10 rounded-lg border-2 border-zinc-300 dark:border-zinc-700 disabled:opacity-30 hover:bg-zinc-50 dark:hover:bg-zinc-900 font-medium transition-colors"
                    >
                      다음 →
                    </button>
                  </div>
                )}
                {!loading && data && lastSearchUsedContent && (
                  <div className="text-center mt-6 text-sm text-zinc-500">
                    💡 내용 찾기 사용 시 상위 10개만 표시됩니다
                  </div>
                )}
              </div>
              <div className="grid gap-4">
                <PreviewPane data={selected} answer={aiAnswer} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}


