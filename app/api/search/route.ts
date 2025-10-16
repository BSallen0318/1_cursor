import { NextResponse } from 'next/server';
import type { DocItem, Platform, DocKind } from '@/types/platform';
import { driveSearchAggregate, driveExportPlainText, driveSearchByFolderName, driveSearchSharedDrivesEx, driveSearchSharedWithMeByText, driveCrawlAllAccessibleFiles, driveResolvePaths } from '@/lib/drive';
import { figmaCollectTextNodes, figmaListProjectFiles, figmaListTeamProjects, figmaAutoDiscoverTeamProjectIds } from '@/lib/api';
import { embedTexts, cosineSimilarity, hasGemini, hasOpenAI } from '@/lib/ai';
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
    q = '',
    filters = {},
    page = 1,
    size = 10,
    sort = 'relevance',
    fast = false,
    rerank = false,
    useIndex = true  // DB 인덱스 사용 여부
  }: {
    q?: string;
    filters?: { platform?: Platform[]; kind?: DocKind[]; ownerId?: string; tags?: string[]; period?: '7d'|'30d'|'any'; source?: 'all'|'drive'|'github'|'figma'|'jira' };
    page?: number;
    size?: number;
    sort?: 'relevance' | 'updatedAt';
    fast?: boolean;
    rerank?: boolean;
    useIndex?: boolean;
  } = body || {};

  const src = (filters as any).source;
  const wantDrive = !src || src === 'all' || src === 'drive';
  const wantFigma = !src || src === 'all' || src === 'figma';
  let debug: any = {};

  // 🚀 DB 인덱스 검색 (우선 시도)
  if (useIndex && q.trim().length > 0) {
    try {
      const totalCount = await getDocumentCount();
      
      // DB에 충분한 데이터가 있으면 DB에서 검색
      if (totalCount > 50) {
        const startTime = Date.now();
        
        let platform: string | undefined = undefined;
        if (src && src !== 'all') {
          platform = src;
        }

        // 검색어가 길면 (복잡한 쿼리) 더 많이 가져와서 Gemini로 필터링
        const isComplexQuery = q.length > 10 || q.split(/\s+/).length > 2;
        const searchLimit = isComplexQuery ? 300 : 100;
        
        // DB에서 검색 (매우 빠름!)
        const dbResults = await searchDocumentsSimple(q, {
          platform,
          limit: searchLimit,
          offset: 0
        });

        debug.dbSearch = true;
        debug.dbCount = dbResults.length;
        debug.dbTime = Date.now() - startTime;
        debug.totalIndexed = totalCount;

        // DocRecord → DocItem 변환
        const items: DocItem[] = dbResults.map((doc: DocRecord) => {
          // content가 있으면 검색어 주변 텍스트를 snippet으로 사용
          let snippet = doc.snippet || '';
          if (doc.content && q) {
            const lowerContent = doc.content.toLowerCase();
            const lowerQuery = q.toLowerCase();
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
            score: 1
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

        // 검색어 관련성 점수 계산 및 정렬
        const computeTitleScore = (title: string, query: string): number => {
          if (!query) return 0;
          const lowerTitle = title.toLowerCase();
          const lowerQuery = query.toLowerCase();
          // 완전 일치
          if (lowerTitle === lowerQuery) return 100;
          // 시작 일치
          if (lowerTitle.startsWith(lowerQuery)) return 50;
          // 포함
          if (lowerTitle.includes(lowerQuery)) return 30;
          // 단어 매칭
          const tokens = lowerQuery.split(/\s+/).filter(Boolean);
          let matchCount = 0;
          for (const tok of tokens) {
            if (lowerTitle.includes(tok)) matchCount++;
          }
          return matchCount * 10;
        };

        const computeContentScore = (snippet: string, query: string): number => {
          if (!query || !snippet) return 0;
          const lowerSnippet = snippet.toLowerCase();
          const lowerQuery = query.toLowerCase();
          if (lowerSnippet.includes(lowerQuery)) return 10;
          return 0;
        };

        // 점수 계산
        filtered = filtered.map((d) => ({
          ...d,
          _titleScore: computeTitleScore(d.title, q),
          _contentScore: computeContentScore(d.snippet, q),
          _recency: new Date(d.updatedAt).getTime()
        }));

        // Gemini 의미 검색 (복잡한 쿼리일 때)
        if (!fast && isComplexQuery && (hasGemini() || hasOpenAI())) {
          try {
            const semanticStartTime = Date.now();
            const [qv] = await embedTexts([q]);
            
            // 결과가 적으면 전체 DB에서 상위 100개를 가져와 검색
            let pool = filtered;
            if (filtered.length < 20) {
              debug.semanticExpandedSearch = true;
              // DB에서 최신 100개 문서 가져오기
              const allDocs = await searchDocumentsSimple('', {
                platform,
                limit: 100,
                offset: 0
              });
              pool = allDocs.map((doc: DocRecord) => {
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
            
            const texts = pool.map((d: any) => {
              const titlePart = d.title || '';
              const snippetPart = d.snippet || '';
              const contentPart = d.content ? d.content.slice(0, 500) : '';
              return `${titlePart} ${snippetPart} ${contentPart}`.trim();
            });
            
            const evs = await embedTexts(texts);
            const sims: Record<string, number> = {};
            for (let i = 0; i < pool.length; i++) {
              const v = evs[i] || [];
              sims[pool[i].id] = (qv?.length && v?.length) ? cosineSimilarity(qv, v) : 0;
            }
            
            // 의미 유사도로 필터링 (0.3 이상만)
            const similarDocs = pool.filter((d: any) => (sims[d.id] || 0) >= 0.3);
            
            // 기존 filtered와 병합
            const mergedMap = new Map();
            for (const d of filtered) {
              mergedMap.set(d.id, { ...d, _embedScore: (sims[d.id] || 0) * 100 });
            }
            for (const d of similarDocs) {
              if (!mergedMap.has(d.id)) {
                mergedMap.set(d.id, { ...d, _embedScore: (sims[d.id] || 0) * 100 });
              }
            }
            
            filtered = Array.from(mergedMap.values());
            
            debug.semanticApplied = true;
            debug.semanticTime = Date.now() - semanticStartTime;
            debug.semanticCount = Object.keys(sims).length;
            debug.semanticMatches = similarDocs.length;
          } catch (e: any) {
            debug.semanticError = e?.message;
          }
        }

        // 정렬: 의미 유사도 > 제목 매칭 > 내용 매칭 > 최신순
        filtered.sort((a: any, b: any) => {
          // 의미 유사도가 있으면 우선
          if (a._embedScore !== undefined && b._embedScore !== undefined) {
            const embedDiff = b._embedScore - a._embedScore;
            if (Math.abs(embedDiff) > 5) return embedDiff;  // 5점 차이 이상이면 의미 유사도 우선
          }
          const titleDiff = b._titleScore - a._titleScore;
          if (titleDiff !== 0) return titleDiff;
          const contentDiff = b._contentScore - a._contentScore;
          if (contentDiff !== 0) return contentDiff;
          return b._recency - a._recency;
        });

        // 페이지네이션
        const total = filtered.length;
        const start = Math.max(0, (page - 1) * size);
        const paged = filtered.slice(start, start + size).map((d) => ({
          ...d,
          highlight: {
            title: matchHighlight(d.title, q),
            snippet: matchHighlight(d.snippet, q)
          }
        }));

        debug.searchTime = Date.now() - startTime;
        debug.source = 'database_index';

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


