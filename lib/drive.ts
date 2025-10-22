// googleapis를 선택적으로 로드해 빌드 타임 의존성 오류를 피합니다.
let _google: any;
async function getGoogle() {
  if (_google) return _google;
  try {
    const mod = await import('googleapis');
    _google = (mod as any).google;
    return _google;
  } catch (e) {
    throw new Error("googleapis 모듈이 설치되어 있지 않습니다. 'pnpm add googleapis' 후 다시 시도하세요.");
  }
}

export type DriveTokens = { access_token: string; refresh_token?: string; expiry_date?: number };

export async function createOAuthClient() {
  const google = await getGoogle();
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/integrations/drive/callback';
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function getAuthUrl() {
  const oauth2 = await createOAuthClient();
  const scopes = [
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/drive.readonly'
  ];
  return oauth2.generateAuthUrl({ access_type: 'offline', scope: scopes, prompt: 'consent' });
}

export async function exchangeCode(code: string) {
  const oauth2 = await createOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  return tokens as DriveTokens;
}

export async function driveSearch(tokens: DriveTokens, q: string, pageToken?: string, pageSize: number = 10) {
  const google = await getGoogle();
  const oauth2 = await createOAuthClient();
  oauth2.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2 });
  const escaped = (q || '').replace(/'/g, "\\'");
  const textCond = q ? `(name contains '${escaped}' or fullText contains '${escaped}') and` : '';
  // 최대 호환: 접근 조건은 드라이브별 상속 권한을 포함하도록 제거하고, corpora=allDrives 로 전체 접근 가능한 파일을 대상으로 검색
  // 기본: 전체(내 드라이브 + 공유드라이브 + 나와 공유됨)에서 검색
  const query = `${textCond} trashed = false`;
  const res = await drive.files.list({
    q: query,
    pageSize,
    pageToken,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    corpora: 'allDrives',
    orderBy: 'modifiedTime desc',
    fields: 'files(id,driveId,name,mimeType,modifiedTime,owners(displayName,emailAddress,me,permissionId),webViewLink,iconLink,parents),nextPageToken'
  });
  return res.data;
}

// 공유 드라이브(Shared Drives)만 대상으로 검색
export async function driveSearchSharedDrives(tokens: DriveTokens, q: string, pageSize: number = 10) {
  const google = await getGoogle();
  const oauth2 = await createOAuthClient();
  oauth2.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  // 원격 쿼리는 느슨하게: 전체를 모아온 뒤 서버에서 키워드 필터
  const query = `trashed = false`;

  // 내 접근 가능한 공유 드라이브 목록을 가져와 각각에서 검색 후 합칩니다.
  const drivesRes = await drive.drives.list({ pageSize: 100 }).catch(() => ({ data: { drives: [] } }));
  const drives: Array<{ id: string }> = (drivesRes.data?.drives || []) as any;

  // 공유 드라이브가 없다면 빈 결과
  if (!drives.length) return { files: [], nextPageToken: undefined } as any;

  const results: any[] = [];
  // 각 드라이브에서 최신순으로 일정 개수만 조회하여 합산
  const perDrive = Math.max(1, Math.ceil(pageSize / Math.max(1, drives.length)) + 2);
  for (const d of drives) {
    try {
      const r = await drive.files.list({
        corpora: 'drive',
        driveId: d.id,
        q: query,
        pageSize: perDrive,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        orderBy: 'modifiedTime desc',
        fields: 'files(id,name,mimeType,modifiedTime,owners(displayName,emailAddress,me,permissionId),webViewLink,iconLink,parents)'
      });
      results.push(...(r.data.files || []));
    } catch {}
  }

  // 최신순 정렬 후 상위 pageSize만 반환
  results.sort((a, b) => +new Date(b.modifiedTime) - +new Date(a.modifiedTime));
  return { files: results.slice(0, pageSize), nextPageToken: undefined } as any;
}

// 공유된 항목 전용: "나와 공유됨(sharedWithMe)" + "공유 드라이브(Shared Drives)"를 모두 포함해 검색
export async function driveSearchSharedOnly(tokens: DriveTokens, q: string, pageSize: number = 10) {
  const google = await getGoogle();
  const oauth2 = await createOAuthClient();
  oauth2.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  const escaped = (q || '').replace(/'/g, "\\'");
  const textCond = q ? `(name contains '${escaped}' or fullText contains '${escaped}') and` : '';
  const query = `${textCond} trashed = false`;

  // 1) 나와 공유됨(sharedWithMe = true)
  const sharedWithMePromise = drive.files.list({
    corpora: 'user',
    q: `sharedWithMe = true and ${query}`,
    pageSize,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,mimeType,modifiedTime,owners,webViewLink,iconLink)'
  }).catch(() => ({ data: { files: [] } } as any));

  // 2) 공유 드라이브 목록 → 각 드라이브에서 검색 (병렬)
  const drivesRes = await drive.drives.list({ pageSize: 100 }).catch(() => ({ data: { drives: [] } }));
  const drives: Array<{ id: string }> = (drivesRes.data?.drives || []) as any;
  const perDrive = Math.max(1, Math.ceil(pageSize / Math.max(1, drives.length)) + 2);
  const sharedDrivesPromises = drives.map((d) =>
    drive.files.list({
      corpora: 'drive',
      driveId: d.id,
      q: query,
      pageSize: perDrive,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name,mimeType,modifiedTime,owners(displayName,emailAddress,me,permissionId),webViewLink,iconLink)'
    }).catch(() => ({ data: { files: [] } } as any))
  );

  const settled = await Promise.all([sharedWithMePromise, ...sharedDrivesPromises]);
  const allFiles: any[] = [];
  for (const r of settled) allFiles.push(...(r.data?.files || []));

  // id 기준 dedupe + 최신순 정렬 후 상위 pageSize 반환
  const dedupMap = new Map<string, any>();
  for (const f of allFiles) if (f?.id && !dedupMap.has(f.id)) dedupMap.set(f.id, f);
  const merged = Array.from(dedupMap.values());
  merged.sort((a, b) => +new Date(b.modifiedTime) - +new Date(a.modifiedTime));
  return { files: merged.slice(0, pageSize), nextPageToken: undefined } as any;
}

export type DriveScope = 'both' | 'sharedDrives' | 'sharedWithMe';

// 집계 검색: 공유 드라이브 + 나와공유됨을 범위로 선택하여 최대 limit 만큼 합산 반환
export async function driveSearchAggregate(tokens: DriveTokens, q: string, scope: DriveScope = 'both', limit: number = 100) {
  const google = await getGoogle();
  const oauth2 = await createOAuthClient();
  oauth2.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  const escaped = (q || '').replace(/'/g, "\\'");
  const textCond = q ? `(name contains '${escaped}' or fullText contains '${escaped}') and` : '';
  const query = `${textCond} trashed = false`;

  const parts: Array<any[]> = [];

  // sharedWithMe 집계
  if (scope === 'both' || scope === 'sharedWithMe') {
    const swmLimit = Math.min(Math.max(20, Math.floor(limit * 0.6)), 100);
    const swm = await drive.files
      .list({
        corpora: 'user',
        q: `sharedWithMe = true and ${query}`,
        pageSize: swmLimit,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        orderBy: 'modifiedTime desc',
        fields: 'files(id,driveId,name,mimeType,modifiedTime,owners(displayName,emailAddress,me,permissionId),webViewLink,iconLink)'
      })
      .catch(() => ({ data: { files: [] } } as any));
    parts.push(swm.data?.files || []);
  }

  // shared drives 집계 (드라이브 멤버가 아니어도 접근 가능한 항목까지 포함하기 위해 allDrives에서 검색 후 driveId가 있는 항목만 필터)
  if (scope === 'both' || scope === 'sharedDrives') {
    const all: any[] = [];
    let token: string | undefined = undefined;
    while (all.length < limit) {
      const r = await drive.files
        .list({
          corpora: 'allDrives',
          q: query,
          pageSize: Math.min(100, limit - all.length),
          pageToken: token,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
          orderBy: 'modifiedTime desc',
          fields: 'files(id,driveId,name,mimeType,modifiedTime,owners(displayName,emailAddress,me,permissionId),webViewLink,iconLink),nextPageToken'
        })
        .catch(() => ({ data: { files: [], nextPageToken: undefined } } as any));
      all.push(...((r.data?.files || []).filter((f: any) => !!f.driveId))); // driveId가 있는 항목 = 공유 드라이브 소속
      token = r.data?.nextPageToken as string | undefined;
      if (!token) break;
    }
    parts.push(all);
  }

  // 합치고 정렬/중복제거 후 limit 만큼 자르기
  const allFiles: any[] = ([] as any[]).concat(...parts);
  const dedup = new Map<string, any>();
  for (const f of allFiles) if (f?.id && !dedup.has(f.id)) dedup.set(f.id, f);
  const merged = Array.from(dedup.values());
  merged.sort((a, b) => +new Date(b.modifiedTime) - +new Date(a.modifiedTime));
  const trimmed = merged.slice(0, Math.max(1, limit));
  return { files: trimmed, total: merged.length } as any;
}

// 공유 드라이브 전체를 드라이브별로 페이징 순회해 최대 limit까지 수집
export async function driveSearchSharedDrivesEx(
  tokens: DriveTokens, 
  q: string, 
  limit: number = 300, 
  modifiedTimeAfter?: string,
  modifiedTimeBefore?: string
) {
  const google = await getGoogle();
  const oauth2 = await createOAuthClient();
  oauth2.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  const escaped = (q || '').replace(/'/g, "\\'");
  const textCond = q ? `(name contains '${escaped}' or fullText contains '${escaped}') and` : '';
  let query = `${textCond} trashed = false`;
  
  // 연도 범위 필터 추가
  if (modifiedTimeAfter) {
    query += ` and modifiedTime >= '${modifiedTimeAfter}'`;
  }
  if (modifiedTimeBefore) {
    query += ` and modifiedTime <= '${modifiedTimeBefore}'`;
  }

  console.log(`🔍 공유 드라이브 검색 쿼리: ${query}`);

  const all: any[] = [];
  const drivesRes = await drive.drives.list({ pageSize: 100 }).catch(() => ({ data: { drives: [] } }));
  const drives: Array<{ id: string; name?: string }> = (drivesRes.data?.drives || []) as any;
  
  console.log(`📊 공유 드라이브 ${drives.length}개 발견`);

  for (const d of drives) {
    console.log(`  ↪ 드라이브 "${d.name || d.id}" 검색 중...`);
    let token: string | undefined = undefined;
    let driveFileCount = 0;
    while (all.length < limit) {
      const r = await drive.files
        .list({
          corpora: 'drive',
          driveId: d.id,
          q: query,
          pageSize: Math.min(100, limit - all.length),
          pageToken: token,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
          orderBy: 'modifiedTime desc',
          fields: 'files(id,driveId,name,mimeType,modifiedTime,owners(displayName,emailAddress,me,permissionId),webViewLink,iconLink),nextPageToken'
        })
        .catch(() => ({ data: { files: [], nextPageToken: undefined } } as any));
      const files = r.data?.files || [];
      all.push(...files);
      driveFileCount += files.length;
      token = r.data?.nextPageToken as string | undefined;
      if (!token) break;
    }
    console.log(`  ✓ ${driveFileCount}개 파일 수집`);
    if (all.length >= limit) break;
  }

  // 중복 제거 + 최신순 정렬
  const dedup = new Map<string, any>();
  for (const f of all) if (f?.id && !dedup.has(f.id)) dedup.set(f.id, f);
  const merged = Array.from(dedup.values());
  merged.sort((a, b) => +new Date(b.modifiedTime) - +new Date(a.modifiedTime));
  return { files: merged.slice(0, limit), total: merged.length } as any;
}

// 공유 문서함(sharedWithMe) 전용: 나에게 공유된 항목만 페이징 순회하여 최대 limit까지 수집
export async function driveSearchSharedWithMeEx(tokens: DriveTokens, q: string, limit: number = 1000) {
  const google = await getGoogle();
  const oauth2 = await createOAuthClient();
  oauth2.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  // 원격 쿼리는 느슨하게: 서버에서 키워드 필터
  const query = `sharedWithMe = true and trashed = false`;

  const all: any[] = [];
  let token: string | undefined = undefined;
  while (all.length < limit) {
    const r = await drive.files
      .list({
        corpora: 'user',
        q: query,
        pageSize: Math.min(100, limit - all.length),
        pageToken: token,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        orderBy: 'modifiedTime desc',
        fields: 'files(id,name,mimeType,modifiedTime,owners(displayName,emailAddress,me,permissionId),webViewLink,iconLink),nextPageToken'
      })
      .catch(() => ({ data: { files: [], nextPageToken: undefined } } as any));
    all.push(...(r.data?.files || []));
    token = r.data?.nextPageToken as string | undefined;
    if (!token) break;
  }

  // 최신순 정렬 후 limit만 반환
  all.sort((a, b) => +new Date(b.modifiedTime) - +new Date(a.modifiedTime));
  return { files: all.slice(0, limit), total: all.length } as any;
}

// 공유 문서함 + 텍스트 매칭(name/fullText) 기반 수집
export async function driveSearchSharedWithMeByText(tokens: DriveTokens, q: string, limit: number = 1000) {
  const google = await getGoogle();
  const oauth2 = await createOAuthClient();
  oauth2.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  const escaped = (q || '').replace(/'/g, "\\'");
  const textCond = q ? `(name contains '${escaped}' or fullText contains '${escaped}') and` : '';
  const query = `${textCond} sharedWithMe = true and trashed = false`;

  const all: any[] = [];
  let token: string | undefined = undefined;
  while (all.length < limit) {
    const r = await drive.files
      .list({
        corpora: 'user',
        q: query,
        pageSize: Math.min(100, limit - all.length),
        pageToken: token,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        orderBy: 'modifiedTime desc',
        fields: 'files(id,name,mimeType,modifiedTime,owners(displayName,emailAddress,me,permissionId),webViewLink,iconLink),nextPageToken'
      })
      .catch(() => ({ data: { files: [], nextPageToken: undefined } } as any));
    all.push(...(r.data?.files || []));
    token = r.data?.nextPageToken as string | undefined;
    if (!token) break;
  }
  all.sort((a, b) => +new Date(b.modifiedTime) - +new Date(a.modifiedTime));
  return { files: all.slice(0, limit), total: all.length } as any;
}
export async function driveGetFile(tokens: DriveTokens, fileId: string) {
  const google = await getGoogle();
  const oauth2 = await createOAuthClient();
  oauth2.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2 });
  const { data } = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,modifiedTime,owners(displayName,emailAddress,me,permissionId),webViewLink,iconLink,description,lastModifyingUser(displayName,emailAddress,me)'
  });
  return data;
}

export async function driveExportPlainText(tokens: DriveTokens, fileId: string, mimeType: string) {
  const google = await getGoogle();
  const oauth2 = await createOAuthClient();
  oauth2.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2 });
  try {
    let exportMime = '';
    if (mimeType === 'application/vnd.google-apps.document') exportMime = 'text/plain';
    if (mimeType === 'application/vnd.google-apps.spreadsheet') exportMime = 'text/csv';
    if (mimeType === 'application/vnd.google-apps.presentation') exportMime = 'text/plain';
    if (!exportMime) return '';
    const res = await drive.files.export({ fileId, mimeType: exportMime }, { responseType: 'arraybuffer' });
    const buf = Buffer.from(res.data as ArrayBuffer);
    return buf.toString('utf-8');
  } catch {
    return '';
  }
}

// Google Slides 전용: 페이지 요소/노트에서 텍스트를 모아 상세 추출
export async function driveExportSlidesText(tokens: DriveTokens, fileId: string) {
  const google = await getGoogle();
  const oauth2 = await createOAuthClient();
  oauth2.setCredentials(tokens);
  // slides API 사용
  const slides = google.slides({ version: 'v1', auth: oauth2 as any });
  try {
    const pres = await slides.presentations.get({ presentationId: fileId });
    const doc: any = pres.data || {};
    const pages: any[] = (doc.slides || []); // 전체 페이지 처리
    const chunks: string[] = [];
    // PostgreSQL TEXT는 1GB까지 가능하지만, 검색 성능과 AI 임베딩 효율을 위해 제한
    // 평균 슬라이드 1페이지당 ~500자 기준, 200,000자면 약 400페이지 커버
    const MAX_CONTENT_LENGTH = 200000;
    let totalLength = 0;

    function collectFromPage(page: any): boolean {
      const elems: any[] = (page?.pageElements || []) as any[];
      for (const el of elems) {
        const shape = el?.shape;
        const text = shape?.text;
        const texts: string[] = [];
        const tes: any[] = (text?.textElements || []) as any[];
        for (const te of tes) {
          const run = te?.textRun?.content;
          if (run && run.trim().length) texts.push(run.trim());
        }
        if (texts.length) {
          const pageText = texts.join(' ');
          chunks.push(pageText);
          totalLength += pageText.length;
          // 50,000자 초과 시 중단
          if (totalLength >= MAX_CONTENT_LENGTH) return false;
        }
      }
      return true;
    }

    // 모든 페이지 처리 (길이 제한까지)
    for (const p of pages) {
      if (!collectFromPage(p)) break;
      // 스피커 노트
      const notes = p?.slideProperties?.notesPage || p?.notesPage;
      if (notes && !collectFromPage(notes)) break;
    }

    const joined = chunks.join('\n').replace(/\n{3,}/g, '\n\n');
    return joined;
  } catch {
    return '';
  }
}


// 폴더명 매칭으로 하위 모든 파일(재귀)을 수집합니다. 주로 공유 드라이브에서 사용합니다.
export async function driveSearchByFolderName(tokens: DriveTokens, q: string, limit: number = 300) {
  const google = await getGoogle();
  const oauth2 = await createOAuthClient();
  oauth2.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  const escaped = (q || '').replace(/'/g, "\\'");
  // 1) 이름이 q를 포함하는 폴더를 allDrives에서 탐색 (q가 비어있어도 전체 폴더를 대상으로 함)
  const folders: Array<{ id: string; name: string; driveId?: string }> = [] as any;
  let token: string | undefined = undefined;
  do {
    const res = await drive.files
      .list({
        corpora: 'allDrives',
        q: q
          ? `mimeType = 'application/vnd.google-apps.folder' and name contains '${escaped}' and trashed = false`
          : `mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        pageSize: 100,
        pageToken: token,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id,driveId,name),nextPageToken'
      })
      .catch(() => ({ data: { files: [], nextPageToken: undefined } } as any));
    for (const f of res.data?.files || []) folders.push({ id: f.id, name: f.name, driveId: (f as any).driveId });
    token = res.data?.nextPageToken as string | undefined;
  } while (token && folders.length < 200);

  if (!folders.length) return { files: [], total: 0, matchedFolders: 0 } as any;

  // 2) 각 폴더의 모든 하위 항목을 BFS로 수집(파일만 반환). 전체 limit까지.
  const results: any[] = [];
  const seen = new Set<string>();
  const folderQueue: Array<{ id: string; name: string; driveId?: string }> = folders.slice(0, 50);

  while (folderQueue.length && results.length < limit) {
    const current = folderQueue.shift()!;
    let pageToken: string | undefined = undefined;
    do {
      const r = await drive.files
        .list({
          corpora: 'allDrives',
          q: `'${current.id}' in parents and trashed = false`,
          pageSize: Math.min(100, Math.max(1, limit - results.length)),
          pageToken: pageToken,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
          orderBy: 'modifiedTime desc',
          fields: 'files(id,driveId,name,mimeType,modifiedTime,owners(displayName,emailAddress,me,permissionId),webViewLink,iconLink,parents),nextPageToken'
        })
        .catch(() => ({ data: { files: [], nextPageToken: undefined } } as any));

      for (const it of r.data?.files || []) {
        if (!it || seen.has(it.id)) continue;
        seen.add(it.id);
        if (it.mimeType === 'application/vnd.google-apps.folder') {
          // 하위 폴더는 큐에 추가하여 계속 탐색
          if (folderQueue.length < 2000) folderQueue.push({ id: it.id, name: it.name, driveId: (it as any).driveId });
        } else {
          // 파일에는 폴더 매칭 정보를 주석 속성으로 담아 반환
          const withHint = { ...it, _folderMatchedName: current.name } as any;
          results.push(withHint);
          if (results.length >= limit) break;
        }
      }
      pageToken = r.data?.nextPageToken as string | undefined;
    } while (pageToken && results.length < limit);
  }

  // 최신순 정렬로 반환
  results.sort((a, b) => +new Date(b.modifiedTime) - +new Date(a.modifiedTime));
  return { files: results.slice(0, limit), total: results.length, matchedFolders: folders.length } as any;
}

// 접근 가능한 모든 드라이브(allDrives)를 전수 페이징으로 수집한 뒤 서버에서 필터합니다.
// 멤버가 아닌 공유 드라이브의 깊은 하위 파일을 놓치는 경우의 안전망입니다.
export async function driveCrawlAllAccessibleFiles(
  tokens: DriveTokens, 
  limit: number = 1000, 
  modifiedTimeAfter?: string,
  modifiedTimeBefore?: string
) {
  const google = await getGoogle();
  const oauth2 = await createOAuthClient();
  oauth2.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  // 쿼리 구성: 연도 범위 필터 추가
  let query = 'trashed = false';
  if (modifiedTimeAfter) {
    query += ` and modifiedTime >= '${modifiedTimeAfter}'`;
  }
  if (modifiedTimeBefore) {
    query += ` and modifiedTime <= '${modifiedTimeBefore}'`;
  }

  const results: any[] = [];
  let token: string | undefined = undefined;
  while (results.length < limit) {
    const r = await drive.files
      .list({
        corpora: 'allDrives',
        q: query,
        pageSize: Math.min(100, limit - results.length),
        pageToken: token,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        orderBy: 'modifiedTime desc',
        fields: 'files(id,driveId,name,mimeType,modifiedTime,owners(displayName,emailAddress,me,permissionId),webViewLink,iconLink,parents),nextPageToken'
      })
      .catch(() => ({ data: { files: [], nextPageToken: undefined } } as any));
    results.push(...(r.data?.files || []));
    token = r.data?.nextPageToken as string | undefined;
    if (!token) break;
  }

  // 최신순으로 반환
  results.sort((a, b) => +new Date(b.modifiedTime) - +new Date(a.modifiedTime));
  return { files: results.slice(0, limit), total: results.length } as any;
}

// 파일들의 부모 체인을 조회해 사용자 친화적인 경로 문자열을 구성합니다.
export async function driveResolvePaths(tokens: DriveTokens, files: Array<{ id: string; parents?: string[] }>): Promise<Record<string, string>> {
  const google = await getGoogle();
  const oauth2 = await createOAuthClient();
  oauth2.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  const pathMap: Record<string, string> = {};
  const folderCache = new Map<string, { id: string; name: string; parents?: string[] }>();

  async function getFolder(fid: string) {
    if (folderCache.has(fid)) return folderCache.get(fid)!;
    try {
      const r = await drive.files.get({ fileId: fid, fields: 'id,name,parents' });
      const obj: any = r.data || {};
      folderCache.set(fid, { id: obj.id, name: obj.name, parents: obj.parents });
      return folderCache.get(fid)!;
    } catch {
      const v = { id: fid, name: fid, parents: undefined as string[] | undefined };
      folderCache.set(fid, v);
      return v;
    }
  }

  for (const f of files) {
    const seen = new Set<string>();
    const segments: string[] = [];
    let parents = (f as any).parents as string[] | undefined;
    let depth = 0;
    while (parents && parents.length && depth < 6) {
      const pid = parents[0];
      if (!pid || seen.has(pid)) break;
      seen.add(pid);
      const folder = await getFolder(pid);
      if (folder?.name) segments.unshift(folder.name);
      parents = folder?.parents as string[] | undefined;
      depth++;
    }
    if (segments.length) pathMap[f.id] = segments.join(' / ');
  }

  return pathMap;
}


