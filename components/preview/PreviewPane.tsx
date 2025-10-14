import Link from 'next/link';
import { LoadingIndicator } from '@/components/common/LoadingIndicator';

// 요약 내용을 불릿 포인트로 파싱하는 함수
function parseBulletPoints(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  return lines.filter(line => line.startsWith('-') || line.startsWith('•') || line.match(/^\d+\./));
}

export function PreviewPane({ data, answer }: { data: any | null; answer?: { question: string; answer: string } | null }) {
  if (!data && !answer) return <div className="rounded-xl border p-4 h-full flex items-center justify-center text-zinc-400">(미리보기가 없습니다)</div>;
  const loading = (data as any)?.loading;
  const doc = (data as any)?.doc;
  const autoSummary = (data as any)?.autoSummary;
  const summaryUnsupported = (data as any)?.summaryUnsupported;
  
  // 불릿 포인트 파싱
  const bulletPoints = autoSummary ? parseBulletPoints(autoSummary) : [];
  const hasBullets = bulletPoints.length > 0;
  
  return (
    <div className="rounded-2xl border p-4 flex flex-col gap-3 h-full overflow-hidden">
      {doc && (
        <div className="grid gap-0.5 shrink-0">
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
        {(loading || !autoSummary) && (
          <div className="grid gap-2">
            <LoadingIndicator label="문서를 분석하고 있습니다" />
          </div>
        )}
        {(!loading && summaryUnsupported) && (
          <div className="text-xs text-zinc-500">(요약이 불가한 형식입니다)</div>
        )}
        {(!loading && !summaryUnsupported && autoSummary) && (
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
