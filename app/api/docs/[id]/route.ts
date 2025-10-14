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
  // Drive에서 단일 파일을 조회 (데모)
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

  // Auto-summary: 모델 품질 향상 프롬프트 적용
  let autoSummary = doc.snippet;
  const supported = (
    mime === 'application/vnd.google-apps.document' ||
    mime === 'application/vnd.google-apps.spreadsheet' ||
    mime === 'application/vnd.google-apps.presentation'
  );
  const summaryUnsupported = !supported || !plain || plain.trim().length < 10;
  try {
    if (!summaryUnsupported) {
      autoSummary = await summarizeText(`${doc.title}\n${plain.slice(0, 6000)}`, q || undefined);
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


