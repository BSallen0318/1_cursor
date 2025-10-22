import { NextResponse } from 'next/server';
import type { DocItem, Platform, DocKind } from '@/types/platform';
import { driveSearchAggregate, driveExportPlainText, driveSearchByFolderName, driveSearchSharedDrivesEx, driveSearchSharedWithMeByText, driveCrawlAllAccessibleFiles, driveResolvePaths } from '@/lib/drive';
import { figmaCollectTextNodes, figmaListProjectFiles, figmaListTeamProjects, figmaAutoDiscoverTeamProjectIds } from '@/lib/api';
import { embedTexts, cosineSimilarity, hasGemini, hasOpenAI, extractKeywords } from '@/lib/ai';
import { cacheGet, cacheSet } from '@/lib/utils';
import { searchDocumentsSimple, getDocumentCount, type DocRecord } from '@/lib/db';

function matchHighlight(text: string, q: string) {
  if (!q) return text;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(esc, 'gi'), (m) => `<mark>${m}</mark>`);
}

export async function POST(req: Request) {
  const headersMod = await import('next/headers');
  const cookieStore = headersMod.cookies();
  const driveTokenCookie = cookieStore.get('drive_tokens')?.value;
  const body = await req.json().catch(() => ({} as any));
  const {
    titleQuery = '',
    contentQuery = '',
    q = '', // 하위 호환성 유지
    filters = {},
    page = 1,
    size = 10,
    sort = 'relevance',
    fast = false,
    rerank = false,
    useIndex = true  // DB 인덱스 사용 여부
  }: {
    titleQuery?: string;
    contentQuery?: string;
    q?: string;
    filters?: { platform?: Platform[]; kind?: DocKind[]; ownerId?: string; tags?: string[]; period?: '7d'|'30d'|'any'; source?: 'all'|'drive'|'github'|'figma'|'jira' };
    page?: number;
    size?: number;
    sort?: 'relevance' | 'updatedAt';
    fast?: boolean;
    rerank?: boolean;
    useIndex?: boolean;
  } = body || {};
  
  // 🎯 검색 모드 결정
  const hasTitleQuery = titleQuery.trim().length > 0;
  const hasContentQuery = contentQuery.trim().length > 0;
  const searchMode: 'title' | 'content' | 'both' = hasTitleQuery && hasContentQuery ? 'both' : hasContentQuery ? 'content' : 'title';
  
  // 하위 호환성: q가 있으면 titleQuery로 사용
  const finalTitleQuery = titleQuery || q;
  const finalContentQuery = contentQuery;

  const src = (filters as any).source;
  const wantDrive = !src || src === 'all' || src === 'drive';
  const wantFigma = !src || src === 'all' || src === 'figma';
  let debug: any = {
    searchMode, // 검색 모드 추가
    titleQuery: finalTitleQuery,
    contentQuery: finalContentQuery
  };

  // 🚀 DB 인덱스 검색 (우선 시도)
  // 제목 또는 내용 찾기 중 하나라도 있으면 검색
  const hasQuery = finalTitleQuery.trim().length > 0 || finalContentQuery.trim().length > 0;
  
  if (useIndex && hasQuery) {
    try {
      const totalCount = await getDocumentCount();
      
      // DB에 충분한 데이터가 있으면 DB에서 검색
      if (totalCount > 50) {
        const startTime = Date.now();
        
        let platform: string | undefined = undefined;
        if (src && src !== 'all') {
          platform = src;
        }

        // 🎯 검색 모드에 따른 DB 검색
        // - title: finalTitleQuery로 빠른 검색
        // - content: 전체 문서 (content가 있는 것만, AI가 필터링)
        // - both: finalTitleQuery로 필터링
        let dbResults: DocRecord[] = [];
        
        if (searchMode === 'title' || searchMode === 'both') {
          // 제목 기반 검색
          dbResults = await searchDocumentsSimple(finalTitleQuery, {
            platform,
            limit: 10000, // 충분히 큰 수
            offset: 0
          });
        } else if (searchMode === 'content') {
          // 내용 찾기만: 최대한 많은 문서를 수집 (AI가 나중에 필터링)
          // 빈 문자열 검색은 모든 문서를 반환할 수 있으므로, 대신 1-2글자 단어로 검색
          const contentKeyword = finalContentQuery.split(/[\s,.\-_]+/).find(w => w.length >= 2) || ' ';
          dbResults = await searchDocumentsSimple(contentKeyword, {
            platform,
            limit: 10000,
            offset: 0
          });
        }

        debug.dbSearch = true;
        debug.dbCount = dbResults.length;
        debug.dbTime = Date.now() - startTime;
        debug.totalIndexed = totalCount;

        // DocRecord → DocItem 변환
        const items: DocItem[] = dbResults.map((doc: DocRecord) => {
          // content가 있으면 검색어 주변 텍스트를 snippet으로 사용
          let snippet = doc.snippet || '';
          const searchQuery = finalTitleQuery || finalContentQuery; // 검색어 결정
          if (doc.content && searchQuery) {
            const lowerContent = doc.content.toLowerCase();
            const lowerQuery = searchQuery.toLowerCase();
            const index = lowerContent.indexOf(lowerQuery);
            if (index >= 0) {
              // 검색어 주변 200자를 snippet으로
              const start = Math.max(0, index - 100);
              const end = Math.min(doc.content.length, index + lowerQuery.length + 100);
              snippet = (start > 0 ? '...' : '') + doc.content.slice(start, end) + (end < doc.content.length ? '...' : '');
            } else {
              // 검색어가 없으면 content 앞부분을 사용
              snippet = doc.content.slice(0, 200) + (doc.content.length > 200 ? '...' : '');
            }
          }
          
          return {
            id: doc.id,
            platform: doc.platform as Platform,
            kind: (doc.kind || 'file') as DocKind,
            title: doc.title,
            snippet,
            url: doc.url || '',
            path: doc.path || doc.title,
            owner: {
              id: doc.owner_id || 'unknown',
              name: doc.owner_name || 'unknown',
              email: doc.owner_email || '',
              role: 'member' as const
            },
            updatedAt: doc.updated_at || new Date().toISOString(),
            tags: [doc.platform],
            score: 1,
            content: doc.content  // Gemini 의미 검색용
          };
        });

        // 필터 적용
        let filtered = items;
        if (filters.kind?.length) {
          filtered = filtered.filter((d) => filters.kind!.includes(d.kind));
        }
        if (filters.ownerId) {
          filtered = filtered.filter((d) => d.owner.id === filters.ownerId);
        }
        if (filters && (filters as any).period && (filters as any).period !== 'any') {
          const now = Date.now();
          const days = (filters as any).period === '7d' ? 7 : 30;
          const cutoff = now - days * 24 * 60 * 60 * 1000;
          filtered = filtered.filter((d) => +new Date(d.updatedAt) >= cutoff);
        }

        // 검색어 관련성 점수 계산 및 정렬 (1/10로 낮춤)
        const computeTitleScore = (title: string, query: string): number => {
          if (!query) return 0;
          const lowerTitle = title.toLowerCase();
          const lowerQuery = query.toLowerCase();
          // 완전 일치 (100 → 10)
          if (lowerTitle === lowerQuery) return 10;
          // 시작 일치 (50 → 5)
          if (lowerTitle.startsWith(lowerQuery)) return 5;
          // 포함 (30 → 3)
          if (lowerTitle.includes(lowerQuery)) return 3;
          // 단어 매칭 (10 → 1)
          const tokens = lowerQuery.split(/\s+/).filter(Boolean);
          let matchCount = 0;
          for (const tok of tokens) {
            if (lowerTitle.includes(tok)) matchCount++;
          }
          return matchCount * 1;
        };

        const computeContentScore = (snippet: string, query: string): number => {
          if (!query || !snippet) return 0;
          const lowerSnippet = snippet.toLowerCase();
          const lowerQuery = query.toLowerCase();
          if (lowerSnippet.includes(lowerQuery)) return 1; // 10 → 1
          return 0;
        };

        // 🎯 제목 필터링: title 또는 both 모드에서 제목에 키워드가 포함되지 않은 문서 제외
        if ((searchMode === 'title' || searchMode === 'both') && finalTitleQuery.trim()) {
          const titleKeywords = finalTitleQuery.toLowerCase().split(/[\s,.\-_]+/).filter(w => w.length >= 2);
          const beforeTitleFilter = filtered.length;
          filtered = filtered.filter((d: any) => {
            const lowerTitle = d.title.toLowerCase();
            // 모든 키워드 중 하나라도 제목에 포함되어야 함
            return titleKeywords.some(kw => lowerTitle.includes(kw));
          });
          console.log(`🔍 제목 필터링 (mode: ${searchMode}): ${beforeTitleFilter}개 → ${filtered.length}개 (키워드: ${titleKeywords.join(', ')})`);
          debug.titleFilterApplied = true;
          debug.titleFilterKeywords = titleKeywords;
          debug.titleFilteredCount = filtered.length;
        }
        
        // 점수 계산
        filtered = filtered.map((d: any) => ({
          ...d,
          _titleScore: computeTitleScore(d.title, finalTitleQuery),
          _contentScore: computeContentScore(d.snippet, finalTitleQuery),
          _recency: new Date(d.updatedAt).getTime()
        }));

        // 🎯 2단계: AI 의미 검색
        // - title: AI 사용 안 함 (빠른 검색)
        // - content 또는 both: AI 사용
        
        const useAI = (searchMode === 'content' || searchMode === 'both') && (hasGemini() || hasOpenAI());
        
        if (useAI) {
          debug.semanticReason = `content_search (mode: ${searchMode})`;
          try {
            const semanticStartTime = Date.now();
            
            // 🎯 AI 분석용 쿼리
            // - content 모드: contentQuery
            // - both 모드: contentQuery (제목 필터링은 이미 적용됨)
            const aiQuery = searchMode === 'both' 
              ? finalContentQuery  // both 모드는 무조건 contentQuery 사용!
              : (finalContentQuery || finalTitleQuery);
            
            console.log(`🎯 AI 분석 쿼리 (${searchMode} 모드): "${aiQuery}"`);
            const [qv] = await embedTexts([aiQuery]);
            
            // RAG: 자연어 쿼리를 구조화된 형태로 파싱
            const words = aiQuery.trim().split(/[\s,.\-_]+/).filter(w => w.length >= 2);
            const isSimpleKeyword = words.length <= 2 && !/[찾아|알려|보여|주세요|해줘|관련|문서|언급|들어간]/.test(aiQuery);
            
            let structuredQuery: any;
            let keywords: string[];
            
            if (isSimpleKeyword) {
              // 단순 키워드: 원본 그대로 사용
              keywords = words;
              structuredQuery = { keywords, intent: aiQuery };
              console.log('🔍 단순 키워드 검색 (Gemini 건너뜀):', keywords);
              debug.keywordExtractionMethod = 'simple';
              debug.ragSkipped = true;
            } else {
              // 복잡한 자연어: Gemini RAG로 구조화
              console.log(`🧠 RAG 시작: "${aiQuery}"`);
              const { parseSearchQuery } = await import('@/lib/ai');
              structuredQuery = await parseSearchQuery(aiQuery);
              keywords = structuredQuery.keywords || [];
              console.log('🧠 RAG가 추출한 키워드:', keywords);
              console.log('🧠 RAG 전체 응답:', JSON.stringify(structuredQuery, null, 2));
              debug.keywordExtractionMethod = 'rag';
              debug.structuredQuery = structuredQuery;
              debug.ragOriginalKeywords = keywords; // RAG 원본 키워드 저장
            }
            
            // 🚨 원본 쿼리에서도 키워드 추출 (RAG가 놓칠 수 있는 핵심 단어 보존)
            const rawKeywords = aiQuery.toLowerCase()
              .split(/[\s,.\-_]+/)
              .map(w => w.replace(/[을를이가에서와과는도한줘를은]$/g, ''))
              .filter(w => w.length >= 2); // 일단 2글자 이상
            
            console.log(`🔍 원본 쿼리에서 추출한 키워드:`, rawKeywords);
            
            // RAG 키워드와 원본 키워드 병합
            const mergedKeywords = [...keywords, ...rawKeywords];
            console.log(`🔗 병합된 키워드 (RAG + 원본):`, mergedKeywords);
            
            // 🚨 키워드 재분리 및 필터링 (공백 제거 + 초고빈도 제거)
            // 🚨 "방"을 stopWords에서 제거 (사용자가 "비밀번호 방" 같은 검색을 할 수 있음)
            const highFreqStopWords = ['q', 'Q', '문서', '관련', '찾아', '알려', '보여', '주세요', '해줘', '언급', '들어간', '있는', '있어', '있나', '뭐', '어디', '어떻게', '파일', '내용'];
            
            // 1. 모든 키워드를 공백/특수문자로 재분리
            const resplitKeywords: string[] = [];
            for (const kw of mergedKeywords) {
              const parts = kw.split(/[\s,.\-_]+/).filter(p => p.length > 0);
              resplitKeywords.push(...parts);
            }
            
            console.log(`🔍 키워드 재분리 (공백 제거): ${mergedKeywords.length}개 → ${resplitKeywords.length}개`, resplitKeywords);
            
            // 2. 초고빈도 stopWords 제거 (길이 무관)
            const beforeFilter = resplitKeywords.length;
            keywords = resplitKeywords.filter(kw => {
              const lower = kw.toLowerCase();
              // 초고빈도 단어는 길이 무관하게 제외
              return !highFreqStopWords.includes(lower);
            });
            
            // 중복 제거
            keywords = [...new Set(keywords)];
            
            console.log(`🔍 최종 필터링 (초고빈도 제거): ${beforeFilter}개 → ${keywords.length}개`, keywords);
            
            // 🚨 키워드가 없으면 원본 쿼리에서 3글자 이상 단어 추출
            if (keywords.length === 0) {
              keywords = aiQuery.split(/[\s,.\-_]+/)
                .filter(w => w.length >= 3)
                .slice(0, 3);
              console.log('⚠️ 필터링 후 키워드 없음 → 원본에서 3글자 이상 추출:', keywords);
            }
            
            // 변형 키워드 추가 (스마트하게, 3글자 이상만)
            const expandedKeywords: string[] = [...keywords];
            for (const kw of keywords) {
              // 5글자 이상이면 앞 3글자도 추가 (예: "비밀번호" → "비밀")
              if (kw.length >= 5) {
                const prefix = kw.slice(0, 3);
                if (prefix.length >= 3) {  // 3글자 이상만
                  expandedKeywords.push(prefix);
                }
              }
            }
            keywords = [...new Set(expandedKeywords)].slice(0, 5);
            
            console.log('🔍 최종 키워드:', keywords);
            debug.extractedKeywords = keywords;
            
            // 🎯 BM25 스타일 키워드 매칭 점수 계산 (내용 중심)
            filtered = filtered.map((d: any) => {
              const title = (d.title || '').toLowerCase();
              const content = (d.content || '').toLowerCase();
              const snippet = (d.snippet || '').toLowerCase();
              
              let relevanceScore = 0;
              const keywordsFoundInTitle: string[] = [];
              const keywordsFoundInContent: string[] = []; // AND 검색용
              
              for (const keyword of keywords) {
                const kw = keyword.toLowerCase();
                
                // 제목 매칭: 5000점 * 매칭 횟수 (2000 → 5000, 더 강화)
                const titleMatches = (title.match(new RegExp(kw, 'g')) || []).length;
                relevanceScore += titleMatches * 5000;
                if (titleMatches > 0) {
                  keywordsFoundInTitle.push(kw);
                }
                
                // 스니펫 매칭: 1000점 * 매칭 횟수 (500 → 1000)
                const snippetMatches = (snippet.match(new RegExp(kw, 'g')) || []).length;
                relevanceScore += snippetMatches * 1000;
                
                // 내용 매칭: 1000점 * 매칭 횟수 (500 → 1000, 최대 20회)
                const contentMatches = Math.min(20, (content.match(new RegExp(kw, 'g')) || []).length);
                relevanceScore += contentMatches * 1000;
                
                // 내용에 키워드가 있으면 기록 (AND 검색용)
                if (contentMatches > 0 || titleMatches > 0) {
                  keywordsFoundInContent.push(kw);
                }
              }
              
              // 🎯 AND 검색 보너스: 모든 키워드가 제목+내용에 있으면 +50000점 (10000 → 50000, 대폭 강화)
              const allKeywordsInContent = keywords.length > 1 && 
                keywordsFoundInContent.length === keywords.length;
              
              if (allKeywordsInContent) {
                relevanceScore += 50000;
              }
              
              // 🚨 키워드가 하나라도 없으면 페널티 (임베딩만으로 상위에 오는 것 방지)
              const hasAnyKeyword = keywordsFoundInContent.length > 0;
              
              return {
                ...d,
                _relevance: relevanceScore,
                _allKeywordsMatch: allKeywordsInContent,
                _hasKeyword: hasAnyKeyword,
                _keywordMatchCount: keywordsFoundInContent.length
              };
            });
            
            console.log(`  🎯 BM25 키워드 점수 계산 완료 (제목 5000x, 스니펫 1000x, 내용 1000x, AND +50000)`);
            
            // 상위 5개 BM25 점수 로깅 (AND 매칭 포함)
            const topBM25 = [...filtered]
              .sort((a: any, b: any) => (b._relevance || 0) - (a._relevance || 0))
              .slice(0, 5)
              .map((d: any) => ({ 
                title: d.title.slice(0, 30), 
                bm25: d._relevance,
                allMatch: d._allKeywordsMatch ? '✅ AND' : ''
              }));
            console.log(`  📊 상위 BM25 점수:`, topBM25);
            
            // AND 매칭 문서 개수
            const andMatchCount = filtered.filter((d: any) => d._allKeywordsMatch).length;
            console.log(`  ✅ 모든 키워드 포함 문서: ${andMatchCount}개`);
            
            // RAG 필터링: titleMust, contentMust 조건 적용
            if (structuredQuery.titleMust && structuredQuery.titleMust.length > 0) {
              const beforeFilter = filtered.length;
              const titleMustKeywords: string[] = structuredQuery.titleMust;
              filtered = filtered.filter((d: any) => {
                const title = (d.title || '').toLowerCase();
                return titleMustKeywords.every((keyword) => 
                  title.includes(keyword.toLowerCase())
                );
              });
              console.log(`🎯 제목 필터 (${structuredQuery.titleMust.join(', ')}): ${beforeFilter}개 → ${filtered.length}개`);
              debug.titleFilterApplied = true;
              debug.titleFilterCount = filtered.length;
            }
            
            if (structuredQuery.contentMust && structuredQuery.contentMust.length > 0) {
              const beforeFilter = filtered.length;
              const contentMustKeywords: string[] = structuredQuery.contentMust;
              filtered = filtered.filter((d: any) => {
                const content = (d.content || '').toLowerCase();
                return contentMustKeywords.every((keyword) => 
                  content.includes(keyword.toLowerCase())
                );
              });
              console.log(`📝 내용 필터 (${structuredQuery.contentMust.join(', ')}): ${beforeFilter}개 → ${filtered.length}개`);
              debug.contentFilterApplied = true;
              debug.contentFilterCount = filtered.length;
            }
            
            // 숫자 조건 필터링
            if (structuredQuery.conditions && structuredQuery.conditions.length > 0) {
              const beforeFilter = filtered.length;
              filtered = filtered.filter((d: any) => {
                const fullText = `${d.title} ${d.content || ''}`.toLowerCase();
                return structuredQuery.conditions!.every((cond: any) => {
                  if (cond.type === 'contains') {
                    return fullText.includes(cond.value);
                  }
                  return true;
                });
              });
              console.log(`🔢 조건 필터 (${structuredQuery.conditions.map((c: any) => c.value).join(', ')}): ${beforeFilter}개 → ${filtered.length}개`);
              debug.conditionFilterApplied = true;
              debug.conditionFilterCount = filtered.length;
            }
            
            // 결과가 적으면 키워드 추출 후 확장 검색
            let pool = filtered;
            if (filtered.length < 20) {
              debug.semanticExpandedSearch = true;
              
              // 사용자 제안 방식: 메타데이터 OR 검색 → 상위 20개만 상세 분석
              
              console.log('🔍 키워드별 메타데이터 검색:', keywords);
              
              // 1단계: 각 키워드로 메타데이터에서 OR 검색 (빠름!)
              const docMap = new Map<string, DocRecord>();
              for (const keyword of keywords) {
                const docs = await searchDocumentsSimple(keyword, {
                  platform,
                  limit: 100,  // 키워드당 최대 100개 (메타데이터 검색은 빠름)
                  offset: 0
                });
                for (const doc of docs) {
                  docMap.set(doc.id, doc);
                }
              }
              
              let allDocs = Array.from(docMap.values());
              
              // 🚨 both 모드: 확장 검색에서도 제목 필터링 강제 적용!
              if (searchMode === 'both' && finalTitleQuery.trim()) {
                const titleKeywords = finalTitleQuery.toLowerCase().split(/[\s,.\-_]+/).filter(w => w.length >= 2);
                const beforeExpand = allDocs.length;
                allDocs = allDocs.filter(doc => {
                  const lowerTitle = doc.title.toLowerCase();
                  return titleKeywords.some(kw => lowerTitle.includes(kw));
                });
                console.log(`🚨 확장 검색 제목 필터링 (both 모드): ${beforeExpand}개 → ${allDocs.length}개`);
              }
              console.log(`📊 메타데이터 검색 결과: ${allDocs.length}개`);
              
              // 2단계: 키워드 관련도 점수 계산 (제목 완전 일치 우선)
              const docsWithScore = allDocs.map(doc => {
                const titleLower = doc.title.toLowerCase();
                const queryStr = keywords.join(' ').toLowerCase();
                
                // 제목 완전 일치: 1000점
                if (titleLower === queryStr || titleLower.includes(queryStr)) {
                  return { doc, score: 1000 };
                }
                
                // 제목 부분 일치: 키워드당 100점
                let score = 0;
                for (const kw of keywords) {
                  if (titleLower.includes(kw.toLowerCase())) {
                    score += 100;
                  }
                }
                return { doc, score };
              });
              
              // 점수 높은 순서대로 정렬
              docsWithScore.sort((a, b) => b.score - a.score);
              
              // content가 있는 문서만 필터링
              const docsWithContent = docsWithScore
                .filter(d => d.doc.content && d.doc.content.length > 50)
                .map(d => d.doc);
              
              console.log(`📝 content 있는 문서: ${docsWithContent.length}개`);
              debug.keywordFilteredCount = docsWithContent.length;
              
              // 3단계: 상위 20개만 Gemini 상세 분석
              const topDocs = docsWithContent.slice(0, 20);
              debug.semanticPoolSize = topDocs.length;
              debug.semanticPoolLimited = docsWithContent.length > 20;
              debug.semanticPoolTotal = docsWithContent.length;
              pool = topDocs.map((doc: DocRecord) => {
                let snippet = doc.snippet || '';
                if (doc.content) {
                  snippet = doc.content.slice(0, 200) + (doc.content.length > 200 ? '...' : '');
                }
                return {
                  id: doc.id,
                  platform: doc.platform as Platform,
                  kind: (doc.kind || 'file') as DocKind,
                  title: doc.title,
                  snippet,
                  url: doc.url || '',
                  path: doc.path || doc.title,
                  owner: {
                    id: doc.owner_id || 'unknown',
                    name: doc.owner_name || 'unknown',
                    email: doc.owner_email || '',
                    role: 'member' as const
                  },
                  updatedAt: doc.updated_at || new Date().toISOString(),
                  tags: [doc.platform],
                  score: 1,
                  content: doc.content,
                  _titleScore: 0,
                  _contentScore: 0,
                  _recency: new Date(doc.updated_at || 0).getTime()
                };
              });
            }
            
            // 🎯 멀티벡터 검색: 제목과 내용을 분리 임베딩
            console.log('🎯 멀티벡터 검색 시작 (제목 70% + 내용 30%)...');
            
            // 1. 제목만 임베딩
            const titles = pool.map((d: any) => d.title || 'Untitled');
            const titleEmbeddings = await embedTexts(titles);
            
            // 벡터 크기 확인 (디버깅)
            if (titleEmbeddings.length > 0 && titleEmbeddings[0]) {
              console.log(`  🔍 쿼리 벡터 크기: ${qv?.length || 0}, 제목 벡터 크기: ${titleEmbeddings[0].length}`);
              // 첫 3개 값만 출력
              console.log(`  🔍 쿼리 벡터 샘플: [${qv?.slice(0, 3).join(', ')}...]`);
              console.log(`  🔍 제목 벡터 샘플: [${titleEmbeddings[0].slice(0, 3).join(', ')}...]`);
            }
            
            // 2. 내용만 임베딩 (내용이 있는 문서만)
            const contentsForEmbed: string[] = [];
            const contentIndices: number[] = [];  // 어느 문서의 내용인지 추적
            
            for (let i = 0; i < pool.length; i++) {
              const content = (pool[i] as any).content;
              if (content && content.trim().length > 50) {
                contentsForEmbed.push(content.slice(0, 5000));  // 5000자로 제한 (빠른 처리)
                contentIndices.push(i);
              }
            }
            
            const contentEmbeddings = contentsForEmbed.length > 0 
              ? await embedTexts(contentsForEmbed) 
              : [];
            
            console.log(`  📊 제목 임베딩: ${titleEmbeddings.length}개`);
            console.log(`  📊 내용 임베딩: ${contentEmbeddings.length}개`);
            
            // 3. 각각 유사도 계산
            const titleSims: Record<string, number> = {};
            const contentSims: Record<string, number> = {};
            
            // 제목 유사도
            for (let i = 0; i < pool.length; i++) {
              const v = titleEmbeddings[i] || [];
              const sim = (qv?.length && v?.length) ? cosineSimilarity(qv, v) : 0;
              titleSims[pool[i].id] = sim;
              
              // 첫 5개만 로그 출력 (디버깅)
              if (i < 5) {
                console.log(`    📌 ${i+1}. "${pool[i].title.slice(0, 30)}" - 제목 유사도: ${sim.toFixed(4)}`);
              }
            }
            
            // 내용 유사도 (있는 것만)
            for (let i = 0; i < contentEmbeddings.length; i++) {
              const docIndex = contentIndices[i];
              const v = contentEmbeddings[i] || [];
              const sim = (qv?.length && v?.length) ? cosineSimilarity(qv, v) : 0;
              contentSims[pool[docIndex].id] = sim;
            }
            
            // 4. 가중치 적용: 제목 70%, 내용 30%
            const TITLE_WEIGHT = 0.7;
            const CONTENT_WEIGHT = 0.3;
            const SIMILARITY_THRESHOLD = 0.3;  // 0.3 미만은 관련 없음
            
            let filteredByThreshold = 0;
            
            for (const d of pool as any[]) {
              const titleScore = titleSims[d.id] || 0;
              const contentScore = contentSims[d.id] || 0;
              
              // 내용이 있으면 가중 평균, 없으면 제목만
              let finalScore = 0;
              if (contentScore > 0) {
                finalScore = (titleScore * TITLE_WEIGHT + contentScore * CONTENT_WEIGHT);
              } else {
                finalScore = titleScore;
              }
              
              // Threshold 적용: 0.3 미만은 0점 처리
              if (finalScore < SIMILARITY_THRESHOLD) {
                finalScore = 0;
                filteredByThreshold++;
              }
              
              // 🚨 키워드가 하나도 없으면 임베딩 점수 0 (임베딩만으로 상위에 오는 것 방지)
              const hasKeyword = d._hasKeyword !== false; // undefined면 true (하위 호환성)
              if (!hasKeyword) {
                finalScore = 0;
              }
              
              // 임베딩 점수를 100배로 낮춤 (BM25 우선을 위해)
              d._embedScore = finalScore * 100;  // 1000 → 100
              d._titleEmbedScore = titleScore * 100;
              d._contentEmbedScore = contentScore * 100;
            }
            
            console.log(`  ⚠️ Threshold (${SIMILARITY_THRESHOLD}) 미만 필터링: ${filteredByThreshold}개`);
            
            // 점수 높은 순으로 정렬
            pool.sort((a: any, b: any) => (b._embedScore || 0) - (a._embedScore || 0));
            
            // 상위 점수 로깅 (멀티벡터 점수 포함)
            const topScores = pool
              .slice(0, 10)
              .map((d: any) => ({ 
                title: d.title, 
                totalScore: ((d._embedScore || 0) / 100).toFixed(3),  // 1000 → 100
                titleScore: ((d._titleEmbedScore || 0) / 100).toFixed(3),
                contentScore: ((d._contentEmbedScore || 0) / 100).toFixed(3)
              }));
            debug.topSemanticScores = topScores;
            debug.multiVectorEnabled = true;
            
            // 모든 문서를 결과에 포함 (threshold 제거)
            const similarDocs = pool;
            
            // 기존 filtered와 병합 (멀티벡터 점수 포함)
            const mergedMap = new Map();
            for (const d of filtered) {
              const titleScore = titleSims[d.id] || 0;
              const contentScore = contentSims[d.id] || 0;
              let embedScore = contentScore > 0 
                ? (titleScore * TITLE_WEIGHT + contentScore * CONTENT_WEIGHT)
                : titleScore;
              
              // Threshold 적용
              if (embedScore < SIMILARITY_THRESHOLD) {
                embedScore = 0;
              }
              
              // 🚨 키워드가 하나도 없으면 임베딩 점수 0
              const hasKeyword = (d as any)._hasKeyword !== false;
              if (!hasKeyword) {
                embedScore = 0;
              }
              
              mergedMap.set(d.id, { 
                ...d, 
                _embedScore: embedScore * 100,  // 1000 → 100
                _titleEmbedScore: titleScore * 100,
                _contentEmbedScore: contentScore * 100
              });
            }
            for (const d of similarDocs) {
              if (!mergedMap.has(d.id)) {
                mergedMap.set(d.id, d);  // 이미 _embedScore 계산됨
              }
            }
            
            filtered = Array.from(mergedMap.values());
            
            debug.semanticApplied = true;
            debug.semanticTime = Date.now() - semanticStartTime;
            debug.semanticCount = Object.keys(titleSims).length;
            debug.semanticMatches = similarDocs.length;
            debug.extractedKeywords = keywords; // 프론트엔드로 키워드 전달
            debug.titleEmbedCount = Object.keys(titleSims).length;
            debug.contentEmbedCount = Object.keys(contentSims).length;
          } catch (e: any) {
            debug.semanticError = e?.message;
          }
        }

        // 🎯 파일 타입별 우선순위 점수 (점수에 직접 반영)
        const getFileTypePriorityScore = (item: any): number => {
          const mimeType = item.mime_type || '';
          const kind = item.kind || '';
          const title = item.title || '';
          
          // 🚨 최우선: 구글독스, 슬라이드, 시트 (1,000,000점 보너스)
          if (
            mimeType.includes('document') ||
            mimeType.includes('presentation') ||
            mimeType.includes('spreadsheet')
          ) {
            console.log(`  📋 구글 문서 우선순위: "${title.slice(0, 30)}"`);
            return 1000000;
          }
          
          // 피그마, 지라 (1,000,000점 보너스)
          if (
            kind === 'figma' ||
            kind === 'jira' ||
            item.platform === 'figma' ||
            item.platform === 'jira'
          ) {
            return 1000000;
          }
          
          // 기타 파일 (jpg, pdf, png 등): 0점
          console.log(`  📎 기타 파일 (우선순위 낮음): "${title.slice(0, 30)}" (${mimeType})`);
          return 0;
        };
        
        // 파일 타입 우선순위 점수를 Hybrid 점수에 추가
        filtered = filtered.map((d: any) => ({
          ...d,
          _fileTypePriorityScore: getFileTypePriorityScore(d),
          _totalScore: (d._relevance || 0) + (d._embedScore || 0) + getFileTypePriorityScore(d)
        }));
        
        // 정렬: 총점 (파일 타입 우선순위 포함) → 최종 수정 시간
        filtered.sort((a: any, b: any) => {
          // 1단계: 총점 (파일 타입 우선순위 + Hybrid 점수)
          const totalA = a._totalScore || 0;
          const totalB = b._totalScore || 0;
          
          if (totalB !== totalA) return totalB - totalA;
          
          // 2단계: 동점일 경우 최신순
          return b._recency - a._recency;
        });
        
        // 🎯 상위 10개 최종 점수 상세 로깅 (배점 이유 표시)
        console.log(`\n========================================`);
        console.log(`🏆 최종 검색 결과 (상위 10개)`);
        console.log(`검색 모드: ${searchMode}`);
        console.log(`제목 쿼리: "${finalTitleQuery}"`);
        console.log(`내용 쿼리: "${finalContentQuery}"`);
        if (debug.extractedKeywords) {
          console.log(`추출된 키워드: [${debug.extractedKeywords.join(', ')}]`);
        }
        console.log(`========================================\n`);
        
        filtered.slice(0, 10).forEach((d: any, idx: number) => {
          const bm25 = d._relevance || 0;
          const embedScore = d._embedScore || 0;
          const fileTypePriority = d._fileTypePriorityScore || 0;
          const totalScore = d._totalScore || 0;
          
          console.log(`\n📄 ${idx + 1}. "${d.title}"`);
          console.log(`   파일 타입: ${d.mime_type || d.kind || 'unknown'}`);
          console.log(`   플랫폼: ${d.platform}`);
          console.log(`   최종 수정: ${d.updatedAt}`);
          console.log(`   ───────────────────────────────────`);
          console.log(`   🏅 파일 타입 우선순위 점수: ${fileTypePriority.toLocaleString()}점`);
          console.log(`   📊 BM25 점수: ${bm25.toLocaleString()}점`);
          if (d._keywordMatchCount !== undefined) {
            const totalKeywords = debug.extractedKeywords ? debug.extractedKeywords.length : '?';
            console.log(`      ├─ 매칭된 키워드 수: ${d._keywordMatchCount}/${totalKeywords}`);
          }
          if (d._allKeywordsMatch) {
            console.log(`      ├─ ✅ 모든 키워드 매칭 보너스: +50,000점`);
          }
          console.log(`   🧠 임베딩 점수: ${Math.round(embedScore)}점`);
          if (d._titleEmbedScore !== undefined) {
            console.log(`      ├─ 제목 유사도: ${Math.round(d._titleEmbedScore)}점`);
          }
          if (d._contentEmbedScore !== undefined) {
            console.log(`      ├─ 내용 유사도: ${Math.round(d._contentEmbedScore)}점`);
          }
          if (!d._hasKeyword) {
            console.log(`      └─ ⚠️ 키워드 미포함 (임베딩 점수 0 처리)`);
          }
          console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          console.log(`   🎯 최종 총점: ${totalScore.toLocaleString()}점`);
          console.log(`      (파일타입 ${fileTypePriority.toLocaleString()} + BM25 ${bm25.toLocaleString()} + 임베딩 ${Math.round(embedScore)})`);
        });
        
        console.log(`\n========================================\n`);

        // 페이지네이션
        // 🎯 제목만 검색은 페이지네이션, 내용 찾기는 상위 10개만
        const total = filtered.length;
        const start = searchMode === 'title' ? Math.max(0, (page - 1) * size) : 0;
        const pageSize = searchMode === 'title' ? size : 10; // 내용 찾기는 상위 10개만
        
        const highlightQuery = finalTitleQuery || finalContentQuery; // 하이라이트용 쿼리
        const paged = filtered.slice(start, start + pageSize).map((d: any) => {
          const result: any = {
            ...d,
            highlight: {
              title: matchHighlight(d.title, highlightQuery),
              snippet: matchHighlight(d.snippet, highlightQuery)
            }
          };
          // content는 클라이언트에 보내지 않음 (용량 큰 데이터)
          delete result.content;
          return result;
        });

        debug.searchTime = Date.now() - startTime;
        debug.source = 'database_index';
        
        // RAG 정보 추가
        if (debug.structuredQuery) {
          debug.ragIntent = debug.structuredQuery.intent;
        }

        return NextResponse.json({
          items: paged,
          total,
          nextPageToken: undefined,
          debug
        });
      } else {
        debug.dbSearch = false;
        debug.dbReason = `색인 데이터 부족 (${totalCount}개). /api/index/sync 를 먼저 실행하세요.`;
      }
    } catch (e: any) {
      debug.dbSearchError = e?.message || 'DB 검색 실패';
      debug.fallbackToAPI = true;
    }
  }

  // 아래는 기존 API 기반 검색 로직 (폴백)
  let items: DocItem[] = [];
  let nextPageToken: string | undefined = undefined;
  let driveTokens: any = undefined;
  let figmaToken: string | undefined = undefined;
  if (wantDrive) {
    if (!driveTokenCookie) {
      return NextResponse.json({ items: [], total: 0, error: 'not connected to drive' }, { status: 401 });
    }
    try {
      const tokensParsed = JSON.parse(Buffer.from(driveTokenCookie, 'base64').toString('utf-8')) as any;
      driveTokens = tokensParsed;
      // 공유 드라이브(모든 드라이브를 드라이브 단위로 순회) + 나와 공유됨을 각각 수집 후 합산
      const limit = fast ? 120 : 300; // 빠른 모드에서는 수집량 축소
      const cacheKey = `swm:${Buffer.from(q).toString('base64')}`;
      let swm = cacheGet<any>(cacheKey);
      if (!swm) {
        swm = await driveSearchSharedWithMeByText(tokensParsed, q, Math.floor(limit * 0.5));
        cacheSet(cacheKey, swm, 60_000); // 60초 캐시
      }
      const sdx = await driveSearchSharedDrivesEx(tokensParsed, q, Math.floor(limit * 0.7));
      // allDrives 텍스트 검색 집계(드라이브 멤버가 아니어도 접근 가능한 항목 포함)
      const aggKey = `agg:${Buffer.from(q).toString('base64')}`;
      let rAgg = cacheGet<any>(aggKey);
      if (!rAgg) {
        rAgg = await driveSearchAggregate(tokensParsed, q, 'both', limit);
        cacheSet(aggKey, rAgg, 60_000);
      }
      // 폴더 전수 수집(보조): 빠른 모드에서는 즉시 결과만 반환하고, 백그라운드 예열
      const folderKey = `folder_all`;
      let rFolder = cacheGet<any>(folderKey);
      if (!rFolder) {
        if (!fast) {
          rFolder = await driveSearchByFolderName(tokensParsed, '', 400);
          cacheSet(folderKey, rFolder, 5 * 60_000); // 5분 캐시
        } else {
          (async () => {
            try {
              const rf = await driveSearchByFolderName(tokensParsed, '', 400);
              cacheSet(folderKey, rf, 5 * 60_000);
            } catch {}
          })();
          rFolder = { files: [], matchedFolders: 0 } as any;
        }
      }
      // 최후 안전망: 전체 접근 가능한 파일을 크롤링 후 서버에서 제목/경로 키워드 매칭으로 필터
      const crawlKey = `crawl_all`;
      let crawl = cacheGet<any>(crawlKey);
      if (!crawl) {
        if (!fast) {
          crawl = await driveCrawlAllAccessibleFiles(tokensParsed, 1200).catch(() => ({ files: [] } as any));
          cacheSet(crawlKey, crawl, 10 * 60_000); // 10분 캐시
        } else {
          (async () => {
            try {
              const cr = await driveCrawlAllAccessibleFiles(tokensParsed, 1200).catch(() => ({ files: [] } as any));
              cacheSet(crawlKey, cr, 10 * 60_000);
            } catch {}
          })();
          crawl = { files: [] } as any;
        }
      }
      // 추가 포함 대상 폴더(정책 폴더): '스크린 전략본부'는 항상 재귀 수집해 병합
      const extraFolderNames = ['스크린 전략본부'];
      const extraFolderResults: any[] = [];
      for (const nm of extraFolderNames) {
        try {
          const rf = await driveSearchByFolderName(tokensParsed, nm, 300);
          if (rf?.files?.length) extraFolderResults.push(...rf.files);
        } catch {}
      }
      // 합산 + 중복 제거
      const mergedMap = new Map<string, any>();
      for (const it of (swm.files || [])) if (it?.id) mergedMap.set(it.id, it);
      for (const it of (sdx.files || [])) if (it?.id && !mergedMap.has(it.id)) mergedMap.set(it.id, it);
      for (const it of (rAgg.files || [])) if (it?.id && !mergedMap.has(it.id)) mergedMap.set(it.id, it);
      for (const it of (rFolder.files || [])) if (it?.id && !mergedMap.has(it.id)) mergedMap.set(it.id, it);
      // 크롤링 결과는 제목에 키워드가 포함된 파일만 추가
      const qLower = (q || '').toLowerCase();
      for (const it of (crawl.files || [])) {
        if (!it?.id || mergedMap.has(it.id)) continue;
        const name = String(it.name || '').toLowerCase();
        if (qLower && name.includes(qLower)) mergedMap.set(it.id, it);
      }
      for (const it of extraFolderResults) if (it?.id && !mergedMap.has(it.id)) mergedMap.set(it.id, it);
      // 폴더는 제외하고 파일만 남깁니다
      const files: any[] = Array.from(mergedMap.values()).filter((f: any) => f.mimeType !== 'application/vnd.google-apps.folder');
      // 경로 보강: parents 체인을 따라 사람이 읽을 수 있는 경로를 구성
      try {
        const idToPath = await driveResolvePaths(tokensParsed, files.map((x: any) => ({ id: x.id, parents: x.parents })));
        for (const f of files) {
          const base = idToPath[f.id];
          if (base) (f as any)._resolvedPath = base;
        }
      } catch {}
      debug.driveCollected = (files || []).length;
      debug.driveSource = 'sharedWithMeByText + sharedDrivesEx + allDrivesAgg' + (fast ? '' : ' + folder-bfs') + ' + extraFolders + crawl';
      debug.sharedWithMeCount = swm?.files?.length || 0;
      debug.sharedDrivesCount = sdx?.files?.length || 0;
      debug.allDrivesAggCount = rAgg?.files?.length || 0;
      debug.folderMatched = rFolder?.matchedFolders || 0;
      debug.extraFolders = extraFolderNames;
      debug.crawlCount = crawl?.files?.length || 0;
      nextPageToken = undefined; // 합산 검색에서는 토큰 대신 클라이언트 페이징
      function mapMimeToKind(m: string): DocKind {
        if (!m) return 'file';
        if (m === 'application/vnd.google-apps.document') return 'doc';
        if (m === 'application/vnd.google-apps.spreadsheet') return 'sheet';
        if (m === 'application/vnd.google-apps.presentation') return 'slide';
        if (m === 'application/pdf') return 'pdf';
        if (m === 'application/vnd.google-apps.folder') return 'folder';
        if (m.startsWith('image/')) return 'image';
        return 'file';
      }
      items = files.map((f: any) => ({
        id: f.id,
        platform: 'drive',
        kind: mapMimeToKind(f.mimeType),
        title: f.name,
        snippet: (f as any)._folderMatchedName ? `in ${(f as any)._folderMatchedName}` : f.mimeType,
        url: f.webViewLink,
        path: (f as any)._resolvedPath ? `${(f as any)._resolvedPath} / ${f.name}` : ((f as any)._folderMatchedName ? `${(f as any)._folderMatchedName} / ${f.name}` : f.name),
        owner: { id: f.owners?.[0]?.permissionId || 'unknown', name: f.owners?.[0]?.displayName || 'unknown', email: '', role: 'member' },
        updatedAt: f.modifiedTime,
        tags: ['drive'],
        score: 1,
        _mimeType: f.mimeType
      }));
    } catch (e: any) {
      return NextResponse.json({ items: [], total: 0, error: e?.message || 'drive search failed' }, { status: 500 });
    }
  }

  // Figma 검색 통합: PAT 또는 OAuth 토큰이 있으면 텍스트 노드 기반 수집
  if (wantFigma) {
    try {
      const cookies = (await import('next/headers')).cookies();
      const pat = process.env.FIGMA_ACCESS_TOKEN || '';
      const figmaCookie = cookies.get('figma_tokens')?.value;
      if (figmaCookie) {
        const parsed = JSON.parse(Buffer.from(figmaCookie, 'base64').toString('utf-8')) as any;
        figmaToken = parsed?.access_token || pat;
      } else if (pat) {
        figmaToken = pat;
      }
      if (figmaToken) {
        // 입력 q에 파일 키 형식이 있으면 직접 수집
        const fileKey = (q.match(/[A-Za-z0-9]{10,}$/)?.[0]) || '';
        const collected: any[] = [];
        if (fileKey) {
          const r = await figmaCollectTextNodes(fileKey, figmaToken);
          const file = r.file;
          const texts: Array<{ id: string; name: string; text: string }> = r.texts || [];
          const joined = texts.map(t => t.text).join('\n').slice(0, 2000);
          collected.push({
            id: fileKey,
            platform: 'figma',
            kind: 'design',
            title: file?.name || 'Figma File',
            snippet: joined || (texts[0]?.text || ''),
            url: `https://www.figma.com/file/${fileKey}`,
            path: file?.name || 'Figma',
            owner: { id: 'figma', name: 'Figma', email: '', role: 'member' },
            updatedAt: file?.lastModified || new Date().toISOString(),
            tags: ['figma'],
            score: 1
          });
        }

        // 일반 키워드 매칭: 팀/프로젝트 목록을 이용해 파일명을 조회
        let teamIds = (process.env.FIGMA_TEAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
        let projectIds = (process.env.FIGMA_PROJECT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
        if (teamIds.length === 0 && projectIds.length === 0) {
          // Auto discovery when not configured
          const discovered = await figmaAutoDiscoverTeamProjectIds(figmaToken).catch(() => ({ teamIds: [], projectIds: [] }));
          teamIds = discovered.teamIds || [];
          projectIds = discovered.projectIds || [];
          debug.figmaAuto = { teams: teamIds.length, projects: projectIds.length };
        }
        const nameMatches: Array<{ key: string; name: string; last_modified: string }> = [];

        // 팀 → 프로젝트 목록 캐시 후 파일 수집
        for (const tid of teamIds) {
          const tKey = `figma:team:${tid}`;
          let teamProjects = cacheGet<any>(tKey);
          if (!teamProjects) {
            teamProjects = await figmaListTeamProjects(tid, figmaToken).catch(() => ({ projects: [] }));
            cacheSet(tKey, teamProjects, 5 * 60_000);
          }
          const projs: Array<{ id: string; name: string }> = teamProjects.projects || [];
          for (const p of projs) if (!projectIds.includes(p.id)) projectIds.push(p.id);
        }

        // 프로젝트 → 파일 목록
        for (const pid of projectIds) {
          const pKey = `figma:proj:${pid}`;
          let list = cacheGet<any>(pKey);
          if (!list) {
            list = await figmaListProjectFiles(pid, figmaToken).catch(() => ({ files: [] }));
            cacheSet(pKey, list, 2 * 60_000);
          }
          for (const f of (list.files || [])) {
            if (!q || (f.name || '').toLowerCase().includes(q.toLowerCase())) {
              nameMatches.push({ key: f.key, name: f.name, last_modified: f.last_modified });
            }
          }
        }

        // 상위 일부 파일을 결과로 변환. fast 모드에서는 텍스트 추출 생략
        const top = nameMatches.slice(0, 30);
        for (const f of top) {
          let snippet = 'Figma design';
          if (!fast) {
            try {
              const r = await figmaCollectTextNodes(f.key, figmaToken);
              const texts: Array<{ text: string }> = r.texts || [];
              snippet = texts.map(t => t.text).join('\n').slice(0, 2000) || snippet;
            } catch {}
          }
          collected.push({
            id: f.key,
            platform: 'figma',
            kind: 'design',
            title: f.name,
            snippet,
            url: `https://www.figma.com/file/${f.key}`,
            path: f.name,
            owner: { id: 'figma', name: 'Figma', email: '', role: 'member' },
            updatedAt: f.last_modified || new Date().toISOString(),
            tags: ['figma'],
            score: 1
          });
        }
        debug.figmaCollected = collected.length;
        items = items.concat(collected as any);
      } else {
        debug.figma = 'no_token';
      }
    } catch (e: any) {
      debug.figmaError = e?.message || 'figma failed';
    }
  }

  // source 필터는 상단 분기에서 이미 drive만 로드하므로 생략 가능
  if (filters.platform?.length) items = items.filter((d) => filters.platform!.includes(d.platform));
  if (filters.kind?.length) items = items.filter((d) => filters.kind!.includes(d.kind));
  if (filters.ownerId) items = items.filter((d) => d.owner.id === filters.ownerId);
  if (filters.tags?.length) items = items.filter((d) => d.tags?.some((t) => filters.tags!.includes(t)));
  if (filters && (filters as any).period && (filters as any).period !== 'any') {
    const now = Date.now();
    const days = (filters as any).period === '7d' ? 7 : 30;
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    items = items.filter((d) => +new Date(d.updatedAt) >= cutoff);
  }

  // 정렬은 아래에서 점수 계산 후 수행

  // 로컬 토큰 재필터는 제거: Drive가 이미 name/fullText로 필터함
  if (q) {
    const before = items.length;
    debug.beforeTokenFilter = before;
    debug.afterTokenFilter = items.length;
  }

  // Drive 본문 프리뷰/임베딩 강화를 위해 상위 일부 파일의 본문을 미리 가져와 스니펫 대체 (빠른 모드 제외)
  if (items.length && !fast) {
    try {
      const previewN = Math.min(12, items.length);
      const heads = items.slice(0, previewN);
      const contents = await Promise.all(
        heads.map(async (d) => {
          try {
            return await driveExportPlainText(driveTokens as any, d.id, (d as any)._mimeType || '');
          } catch {
            return '';
          }
        })
      );
      for (let i = 0; i < heads.length; i++) {
        const txt = contents[i] || '';
        if (txt) {
          // 스니펫 교체: 본문 앞부분 200자
          heads[i].snippet = txt.slice(0, 200);
        }
      }
      debug.contentPreviewApplied = true;
      debug.contentPreviewCount = previewN;
    } catch {
      debug.contentPreviewApplied = false;
    }
  }

  // 점수 분해: 제목/본문/임베딩/최신도
  function computeTitleScore(d: DocItem, qStr: string): number {
    if (!qStr) return 0;
    const tokens = qStr.toLowerCase().split(/\s+/).filter(Boolean);
    const title = (d.title || '').toLowerCase();
    let hit = 0;
    for (const tok of tokens) if (title.includes(tok)) hit++;
    const denom = Math.max(1, tokens.length);
    return Math.min(1, hit / denom);
  }
  function computeSnippetScore(d: DocItem, qStr: string): number {
    if (!qStr) return 0;
    const tokens = qStr.toLowerCase().split(/\s+/).filter(Boolean);
    const snippet = (d.snippet || '').toLowerCase();
    let hit = 0;
    for (const tok of tokens) if (snippet.includes(tok)) hit++;
    const denom = Math.max(1, tokens.length);
    return Math.min(1, hit / denom);
  }
  function computeRecency(d: DocItem): number {
    const now = Date.now();
    const t = +new Date(d.updatedAt || now);
    const days = (now - t) / (1000 * 60 * 60 * 24);
    return Math.max(0, Math.min(1, 1 - days / 180));
  }
  // 1차: 개별 점수 계산 및 보관
  items = items.map((d) => ({
    ...d,
    _titleScore: computeTitleScore(d, q),
    _snippetScore: computeSnippetScore(d, q),
    _recencyScore: computeRecency(d)
  }));

  // 2차 점수: Gemini 임베딩 기반 의미 유사도(상위 N개만 재랭킹) - 빠른 모드에서는 생략
  if (!fast && q && (hasGemini() || hasOpenAI()) && items.length) {
    try {
      const topN = Math.min(30, items.length);
      const pool = items.slice(0, topN);
      const [qv] = await embedTexts([q]);
      // 본문 스니펫 + 경로를 함께 사용해 의미 유사도 개선
      const texts = pool.map((d) => {
        const base = (d.snippet && d.snippet.length > 0) ? d.snippet : `${d.title}`;
        const p = (d as any).path ? ` [path: ${(d as any).path}]` : '';
        return `${base}${p}`;
      });
      const evs = await embedTexts(texts);
      const sims: Record<string, number> = {};
      for (let i = 0; i < pool.length; i++) {
        const v = evs[i] || [];
        sims[pool[i].id] = (qv?.length && v?.length) ? cosineSimilarity(qv, v) : 0;
      }
      items = items.map((d) => ({ ...d, _embedScore: (sims[d.id] || 0) }));
      debug.semanticApplied = true;
      debug.semanticCount = Object.keys(sims).length;
    } catch {
      debug.semanticApplied = false;
    }
  }
  // 최종 정렬: 제목 > 본문 > 임베딩 > 최신
  items = items.slice().sort((a: any, b: any) => {
    const t = (b._titleScore || 0) - (a._titleScore || 0);
    if (t !== 0) return t;
    const s = (b._snippetScore || 0) - (a._snippetScore || 0);
    if (s !== 0) return s;
    const e = (b._embedScore || 0) - (a._embedScore || 0);
    if (e !== 0) return e;
    return (b._recencyScore || 0) - (a._recencyScore || 0);
  });

  // 상위 100개만 노출(페이지당 10개)
  const capped = items.slice(0, 100);
  const total = capped.length;
  const start = Math.max(0, (page - 1) * size);
  const paged = capped.slice(start, start + size).map((d) => ({
    ...d,
    highlight: {
      title: matchHighlight(d.title, q),
      snippet: matchHighlight(d.snippet, q)
    }
  }));

  debug.cappedTotal = total;
  debug.page = page;
  debug.size = size;
  return NextResponse.json({ items: paged, total, nextPageToken, debug });
}


