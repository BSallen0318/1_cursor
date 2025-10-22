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

// 최근 검색어 타입
interface RecentSearch {
  query: string;
  mode: 'title' | 'content';
}

export default function SearchPage() {
  const [titleQuery, setTitleQuery] = useState(''); // 문서 제목 검색
  const [contentQuery, setContentQuery] = useState(''); // 내용 찾기 검색
  const [ask, setAsk] = useState('');
  const [data, setData] = useState<{ items: DocItem[]; total: number } | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<any>({ source: 'all' });
  const [aiAnswer, setAiAnswer] = useState<{ question: string; answer: string } | null>(null);
  const [page, setPage] = useState(1);
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const handleFiltersChange = useCallback((f: any) => setFilters(f), []);
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSearchMode, setLastSearchMode] = useState<'title' | 'content' | 'both'>('title'); // 마지막 검색 모드

  const onSearch = async () => {
    // 🚨 검색어 유효성 검사
    const hasTitleQuery = titleQuery.trim().length > 0;
    const hasContentQuery = contentQuery.trim().length > 0;
    
    if (!hasTitleQuery && !hasContentQuery) {
      setError('문서 제목 또는 내용 찾기 중 하나는 입력해주세요.');
      return;
    }
    
    setLoading(true);
    setError(null);
    setData(null); // 이전 검색 결과 즉시 제거
    
    // 검색 모드 결정
    let searchMode: 'title' | 'content' | 'both' = 'title';
    if (hasTitleQuery && hasContentQuery) {
      searchMode = 'both';
    } else if (hasContentQuery) {
      searchMode = 'content';
    }
    setLastSearchMode(searchMode);
    
    try {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      
      // 🎯 검색 모드에 따라 size 결정
      // - 제목만: 페이지네이션 (10개)
      // - 내용/둘 다: AI 분석 (상위 10개 고정)
      const searchSize = searchMode === 'title' ? 10 : 10;
      
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          titleQuery: titleQuery.trim() || undefined, 
          contentQuery: contentQuery.trim() || undefined,
          page, 
          size: searchSize, 
          filters, 
          sort: filters?.sort || 'relevance'
        }),
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
      
      // 최근 검색어 저장 (제목/내용 구분)
      const searchTerm = titleQuery.trim() || contentQuery.trim();
      if (searchTerm) {
        const searchItem: RecentSearch = {
          query: searchTerm,
          mode: searchMode === 'title' ? 'title' : 'content'
        };
        // 중복 제거 (같은 query가 있으면 제거)
        const next = [searchItem, ...recent.filter((r) => r.query !== searchTerm)].slice(0, 10);
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
    if (titleQuery.trim().length > 0 || contentQuery.trim().length > 0) onSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filters]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('recentSearches') || '[]');
      if (Array.isArray(saved)) {
        // 하위 호환성: string[] → RecentSearch[]
        const converted: RecentSearch[] = saved.map((item: any) => {
          if (typeof item === 'string') {
            return { query: item, mode: 'title' as const };
          }
          return item;
        });
        setRecent(converted.slice(0, 10));
      }
    } catch {}
  }, []);

  const removeRecent = (query: string) => {
    setRecent((prev) => {
      const next = prev.filter((x) => x.query !== query);
      try { localStorage.setItem('recentSearches', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* 타이틀 */}
        <div className="text-center py-4">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
            VX archive
          </h1>
        </div>
        
        {/* 검색창 - 맨 위 (2단 구조) */}
        <div className="bg-white dark:bg-zinc-950 rounded-2xl shadow-lg border border-zinc-200 dark:border-zinc-800 p-6">
          <div className="space-y-4">
            {/* 첫 번째 검색창: 문서 제목 */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 px-1">
                📋 문서 제목
                <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  (제목에 포함된 키워드로 빠르게 검색)
                </span>
              </label>
              <input 
                value={titleQuery} 
                onChange={(e) => setTitleQuery(e.target.value)} 
                onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); onSearch(); } }} 
                placeholder="문서 이름에 포함된 키워드를 입력해주세요" 
                className="w-full border-2 border-zinc-200 dark:border-zinc-700 rounded-xl px-5 h-12 text-base focus:border-blue-500 focus:outline-none transition-colors" 
              />
            </div>
            
            {/* 두 번째 검색창: 내용 찾기 */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 px-1">
                🔍 내용 찾기
                <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  (AI가 문서 내용을 분석하여 유사한 상위 10개 검색)
                </span>
              </label>
              <div className="flex items-center gap-3">
                <input 
                  value={contentQuery} 
                  onChange={(e) => setContentQuery(e.target.value)} 
                  onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); onSearch(); } }} 
                  placeholder="예: 비밀번호 찾기 기능이 설명된 문서" 
                  className="flex-1 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl px-5 h-12 text-base focus:border-green-500 focus:outline-none transition-colors" 
                />
                <button 
                  className={`h-12 px-8 rounded-xl font-semibold transition-colors shadow-md ${
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
            <span className="text-xl">💡</span>
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              <strong>제목만 입력:</strong> 빠른 검색 | <strong>내용 찾기만 입력:</strong> AI가 전체 문서 분석 | <strong>둘 다 입력:</strong> 제목으로 필터링 후 AI가 상위 10개 선택
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
                  const item = recent[idx];
                  return (
                    <li 
                      key={idx} 
                      className={`flex items-center justify-between gap-2 py-2 px-3 rounded-lg ${
                        item ? 'hover:bg-zinc-50 dark:hover:bg-zinc-900' : 'text-zinc-300 dark:text-zinc-700'
                      }`}
                      style={{ minHeight: '40px' }}
                    >
                      {item ? (
                        <>
                          <button 
                            className="flex-1 text-left text-sm hover:text-green-600 dark:hover:text-green-400 transition-colors truncate flex items-center gap-2" 
                            onClick={() => { 
                              if (item.mode === 'title') {
                                setTitleQuery(item.query);
                                setContentQuery('');
                              } else {
                                setContentQuery(item.query);
                                setTitleQuery('');
                              }
                              setPage(1); 
                            }}
                          >
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              item.mode === 'title' 
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' 
                                : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            }`}>
                              {item.mode === 'title' ? '제목' : '내용'}
                            </span>
                            <span>{idx + 1}. {item.query}</span>
                          </button>
                          <button 
                            aria-label="remove" 
                            className="p-1 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-colors text-lg font-bold" 
                            onClick={() => removeRecent(item.query)}
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
                {loading && <LoadingIndicator label={
                  lastSearchMode === 'title' 
                    ? "문서 제목을 검색하고 있습니다..." 
                    : "AI가 문서 내용을 분석하고 있습니다... (약 10초 소요)"
                } />}
                {error && <div className="text-red-500 bg-red-50 dark:bg-red-950/20 p-4 rounded-xl border border-red-200 dark:border-red-800">{error}</div>}
                {!loading && !titleQuery && !contentQuery && (!data || data.items.length === 0) && (
                  <div className="flex flex-col items-center justify-center py-32 text-center">
                    <span className="text-6xl mb-4">🔍</span>
                    <div className="text-zinc-400 dark:text-zinc-600 text-xl">문서 제목 또는 내용 찾기를 입력해주세요</div>
                  </div>
                )}
                {!loading && (titleQuery || contentQuery) && data && (
                  <>
                    {/* 검색 모드 안내 */}
                    {(data as any)?.debug?.searchMode && (
                      <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 rounded-xl border-2 border-blue-200 dark:border-blue-800">
                        <div className="flex items-start gap-3">
                          <span className="text-2xl">
                            {(data as any).debug.searchMode === 'title' && '⚡'}
                            {(data as any).debug.searchMode === 'content' && '🧠'}
                            {(data as any).debug.searchMode === 'both' && '🎯'}
                          </span>
                          <div>
                            <div className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
                              {(data as any).debug.searchMode === 'title' && '빠른 제목 검색'}
                              {(data as any).debug.searchMode === 'content' && 'AI 내용 분석 검색'}
                              {(data as any).debug.searchMode === 'both' && '제목 필터 + AI 내용 분석'}
                            </div>
                            <div className="text-sm text-blue-700 dark:text-blue-300">
                              {(data as any).debug.searchMode === 'title' && '문서 제목에서 키워드를 빠르게 찾았습니다'}
                              {(data as any).debug.searchMode === 'content' && 'AI가 전체 문서 내용을 분석하여 상위 10개를 선택했습니다'}
                              {(data as any).debug.searchMode === 'both' && '제목으로 필터링한 후 AI가 내용을 분석하여 상위 10개를 선택했습니다'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <ResultsList items={data.items} activeId={selectedId || undefined} onSelect={async (id: string) => {
                      setSelectedId(id);
                      setSelected({ loading: true });
                      const queryParam = titleQuery || contentQuery;
                      const r = await fetch(`/api/docs/${id}?q=${encodeURIComponent(queryParam)}`, { credentials: 'include' });
                      const payload = await r.json();
                      setSelected(payload);
                    }} searchContent={lastSearchMode !== 'title'} query={titleQuery || contentQuery} keywords={(data as any)?.debug?.extractedKeywords} />
                  </>
                )}
                {!loading && data && lastSearchMode === 'title' && (
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
                {!loading && data && lastSearchMode !== 'title' && (
                  <div className="text-center mt-6 text-sm text-zinc-500">
                    💡 AI 내용 분석 사용 시 상위 10개만 표시됩니다
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


