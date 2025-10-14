import { NextRequest, NextResponse } from 'next/server';
import { summarizeText } from '@/lib/ai';
import { driveGetFile, driveExportPlainText, driveExportSlidesText } from '@/lib/drive';

function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = new Set([...a].filter((x) => b.has(x))).size;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const q = req.nextUrl.searchParams.get('q') || '';
  
  // ID 패턴으로 플랫폼 판별
  // Jira: PROJ-123 형식
  const isJiraIssue = /^[A-Z]+-\d+$/.test(params.id);
  
  if (isJiraIssue) {
    // Jira 이슈 처리
    return handleJiraIssue(req, params, q);
  }
  
  // Drive에서 단일 파일을 조회
  try {
    const cookieStore = (await import('next/headers')).cookies();
    const driveTokenCookie = cookieStore.get('drive_tokens')?.value;
    if (!driveTokenCookie) return NextResponse.json({ error: 'not connected' }, { status: 401 });
    const tokens = JSON.parse(Buffer.from(driveTokenCookie, 'base64').toString('utf-8')) as any;
    const file = await driveGetFile(tokens, params.id);
    const mime = file.mimeType || '';
    let plain = await driveExportPlainText(tokens, params.id, mime);
    // 슬라이드일 때는 Slides API로 보강 추출
    if ((!plain || plain.trim().length < 50) && mime === 'application/vnd.google-apps.presentation') {
      const richer = await driveExportSlidesText(tokens, params.id);
      if (richer && richer.trim().length > plain.length) plain = richer;
    }
    const platform = 'drive';
    const contributors: string[] = [];
    const owners = Array.isArray((file as any).owners) ? (file as any).owners : [];
    const ownerName = owners?.[0]?.displayName || owners?.[0]?.emailAddress || 'unknown';
    if (owners?.[0]?.displayName) contributors.push(owners[0].displayName);
    const lastUser = (file as any).lastModifyingUser?.displayName || (file as any).lastModifyingUser?.emailAddress;
    if (lastUser && !contributors.includes(lastUser)) contributors.push(lastUser);

    const doc = {
      id: file.id,
      title: file.name,
      platform,
      snippet: plain?.slice(0, 300) || (file.description || file.mimeType),
      path: file.name,
      owner: ownerName,
      updatedAt: file.modifiedTime,
      contributors: contributors.slice(0, 3)
    } as any;

  // Auto-summary: 모델 품질 향상 프롬프트 적용 + 캐싱
  let autoSummary = doc.snippet;
  const supported = (
    mime === 'application/vnd.google-apps.document' ||
    mime === 'application/vnd.google-apps.spreadsheet' ||
    mime === 'application/vnd.google-apps.presentation'
  );
  const summaryUnsupported = !supported || !plain || plain.trim().length < 10;
  try {
    if (!summaryUnsupported) {
      // 캐시 키 생성 (파일 ID + 수정 시간)
      const cacheKey = `summary:${params.id}:${file.modifiedTime}`;
      const { cacheGet, cacheSet } = await import('@/lib/utils');
      
      // 캐시 확인
      const cached = cacheGet<string>(cacheKey);
      if (cached) {
        autoSummary = cached;
      } else {
        // 입력 텍스트 길이 축소: 6000 → 3500자 (속도 2배 향상)
        autoSummary = await summarizeText(`${doc.title}\n${plain.slice(0, 3500)}`, q || undefined);
        // 캐시 저장 (일주일)
        cacheSet(cacheKey, autoSummary, 7 * 24 * 60 * 60 * 1000);
      }
    }
  } catch {
    autoSummary = '(요약 생성 실패 – 원문 발췌)\n' + (plain.slice(0, 800) || doc.snippet);
  }

    // 관련 문서는 간단히 빈 배열 반환(Drive 기반 유사도는 별도 구현 예정)
    return NextResponse.json({ doc, related: [], autoSummary, summaryUnsupported });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}

async function handleJiraIssue(req: NextRequest, params: { id: string }, q: string) {
  try {
    const { getJiraCredentialsFromEnv, extractTextFromJiraDescription } = await import('@/lib/jira');
    const credentials = getJiraCredentialsFromEnv();
    
    if (!credentials) {
      return NextResponse.json({ error: 'Jira not configured' }, { status: 401 });
    }

    // Jira 이슈 상세 조회
    const issueKey = params.id;
    const url = `https://${credentials.domain}/rest/api/3/issue/${issueKey}`;
    
    const authHeader = `Basic ${Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString('base64')}`;
    
    const res = await fetch(url, {
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jira API error: ${res.status} - ${text.slice(0, 200)}`);
    }

    const issue = await res.json();
    
    // 이슈 정보 추출
    const summary = issue.fields.summary || 'Untitled Issue';
    const description = extractTextFromJiraDescription(issue.fields.description);
    const status = issue.fields.status?.name || '';
    const issueType = issue.fields.issuetype?.name || '';
    const assignee = issue.fields.assignee?.displayName || 'Unassigned';
    const reporter = issue.fields.reporter?.displayName || 'Unknown';
    const created = issue.fields.created || new Date().toISOString();
    const updated = issue.fields.updated || new Date().toISOString();
    const projectKey = issue.fields.project?.key || '';
    const projectName = issue.fields.project?.name || '';

    // 전체 텍스트 구성
    const fullText = [
      `제목: ${summary}`,
      `프로젝트: ${projectName} (${projectKey})`,
      `유형: ${issueType}`,
      `상태: ${status}`,
      `담당자: ${assignee}`,
      `보고자: ${reporter}`,
      description ? `\n설명:\n${description}` : ''
    ].join('\n');

    const doc = {
      id: issueKey,
      title: `[${issueKey}] ${summary}`,
      platform: 'jira',
      snippet: description.slice(0, 300) || status,
      path: `${projectKey} / ${issueKey}`,
      owner: assignee,
      updatedAt: updated,
      contributors: [reporter, assignee].filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 3)
    };

    // AI 요약 생성
    let autoSummary = doc.snippet;
    const summaryUnsupported = !fullText || fullText.trim().length < 10;
    
    try {
      if (!summaryUnsupported) {
        // 캐시 키 생성 (이슈 키 + 수정 시간)
        const cacheKey = `summary:${issueKey}:${updated}`;
        const { cacheGet, cacheSet } = await import('@/lib/utils');
        
        // 캐시 확인
        const cached = cacheGet<string>(cacheKey);
        if (cached) {
          autoSummary = cached;
        } else {
          // AI 요약 생성
          autoSummary = await summarizeText(fullText.slice(0, 3500), q || undefined);
          // 캐시 저장 (일주일)
          cacheSet(cacheKey, autoSummary, 7 * 24 * 60 * 60 * 1000);
        }
      }
    } catch (err) {
      console.error('Jira summary error:', err);
      autoSummary = '(요약 생성 실패 – 원문 발췌)\n' + fullText.slice(0, 800);
    }

    return NextResponse.json({ doc, related: [], autoSummary, summaryUnsupported });
  } catch (e: any) {
    console.error('Jira issue fetch error:', e);
    return NextResponse.json({ error: e?.message || 'failed to fetch Jira issue' }, { status: 500 });
  }
}


