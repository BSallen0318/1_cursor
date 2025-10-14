import Link from 'next/link';
import { LoadingIndicator } from '@/components/common/LoadingIndicator';

// 요약 내용을 불릿 포인트로 파싱하는 함수
function parseBulletPoints(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  return lines.filter(line => line.startsWith('-') || line.startsWith('•') || line.match(/^\d+\./));
}

export function PreviewPane({ data, answer }: { data: any | null; answer?: { question: string; answer: string } | null }) {
  if (!data && !answer) {
    return (
      <div className="rounded-xl border p-4 h-full flex flex-col items-center justify-center gap-4">
        <div className="text-zinc-400">(미리보기가 없습니다)</div>
        <Link 
          href="/settings/integrations?drive=connected"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
        >
          🔗 연동 설정
        </Link>
      </div>
    );
  }
  
  const loading = (data as any)?.loading;
  const doc = (data as any)?.doc;
  const autoSummary = (data as any)?.autoSummary;
  const summaryUnsupported = (data as any)?.summaryUnsupported;
  const error = (data as any)?.error;
  
  // 불릿 포인트 파싱
  const bulletPoints = autoSummary ? parseBulletPoints(autoSummary) : [];
  const hasBullets = bulletPoints.length > 0;
  
  return (
    <div className="rounded-2xl border p-4 flex flex-col gap-3 h-full overflow-hidden relative">
      {/* 우측 상단 연동 설정 버튼 */}
      <Link 
        href="/settings/integrations?drive=connected"
        className="absolute top-4 right-4 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium transition-colors z-10"
      >
        🔗 연동 설정
      </Link>
      
      {doc && (
        <div className="grid gap-0.5 shrink-0 pr-24">
          <div className="text-base font-semibold">{doc.title}</div>
          <div className="text-xs text-zinc-400">{platformLabel(doc.platform)} • {formatDate(doc.updatedAt)}</div>
          {doc.owner && (
            <div className="text-xs text-zinc-400 mt-1"><span className="text-zinc-400">작성자</span> {doc.owner}</div>
          )}
          {Array.isArray(doc.contributors) && doc.contributors.length > 0 && (
            <div className="text-xs text-zinc-400"><span className="text-zinc-400">관련</span> {doc.contributors.join(', ')}</div>
          )}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {error && (
          <div className="flex flex-col items-center justify-center gap-4 py-8">
            <div className="text-sm text-zinc-500 text-center">
              {error.includes('not connected') || error.includes('OAuth') || error.includes('401') 
                ? '🔐 미리보기를 보려면 Google Drive 연동이 필요합니다. 우측 상단 "연동 설정" 버튼을 클릭하세요.' 
                : '⚠️ 미리보기를 불러올 수 없습니다.'}
            </div>
          </div>
        )}
        {!error && (loading || !autoSummary) && (
          <div className="grid gap-2">
            <LoadingIndicator label="문서를 분석하고 있습니다" />
          </div>
        )}
        {!error && (!loading && summaryUnsupported) && (
          <div className="text-xs text-zinc-500">(요약이 불가한 형식입니다)</div>
        )}
        {!error && (!loading && !summaryUnsupported && autoSummary) && (
          <div className="space-y-2">
            {hasBullets ? (
              bulletPoints.map((bullet, idx) => (
                <div 
                  key={idx}
                  className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed"
                >
                  {bullet.replace(/^[-•]\s*/, '').replace(/^\d+\.\s*/, '')}
                </div>
              ))
            ) : (
              <div className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-words">
                {autoSummary}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function platformLabel(p?: string) {
  if (p === 'drive') return '구글드라이브';
  if (p === 'figma') return '피그마';
  if (p === 'github') return '깃허브';
  if (p === 'jira') return '지라';
  return p || '';
}

function formatDate(s?: string) {
  if (!s) return '';
  try { return new Date(s).toLocaleString(); } catch { return s; }
}
