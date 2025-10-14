import Link from 'next/link';
import { LoadingIndicator } from '@/components/common/LoadingIndicator';

export function PreviewPane({ data, answer }: { data: any | null; answer?: { question: string; answer: string } | null }) {
  if (!data && !answer) return <div className="rounded-xl border p-4 h-[420px] flex items-center justify-center text-zinc-400">(미리보기가 없습니다)</div>;
  const loading = (data as any)?.loading;
  const doc = (data as any)?.doc;
  const autoSummary = (data as any)?.autoSummary;
  const summaryUnsupported = (data as any)?.summaryUnsupported;
  return (
    <div className="rounded-2xl border p-4 grid gap-4 h-[420px] overflow-hidden">
      {doc && (
        <div className="grid gap-1">
          <div className="text-lg font-semibold">{doc.title}</div>
          <div className="text-xs text-zinc-500">{platformLabel(doc.platform)} • {formatDate(doc.updatedAt)}</div>
          {doc.owner && (
            <div className="text-sm"><span className="text-zinc-500">작성자</span> {doc.owner}</div>
          )}
          {Array.isArray(doc.contributors) && doc.contributors.length > 0 && (
            <div className="text-sm"><span className="text-zinc-500">관련</span> {doc.contributors.join(', ')}</div>
          )}
        </div>
      )}
      <div>
        <div className="font-medium mb-1">요약</div>
        {(loading || !autoSummary) && (
          <div className="grid gap-2">
            <LoadingIndicator label="문서를 분석하고 있습니다" />
          </div>
        )}
        {(!loading && summaryUnsupported) && (
          <div className="text-sm text-zinc-500">(요약이 불가한 형식입니다)</div>
        )}
        {(!loading && !summaryUnsupported && autoSummary) && (
          <div className="text-sm text-zinc-700 whitespace-pre-wrap break-words line-clamp-8" dangerouslySetInnerHTML={{ __html: autoSummary }} />
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
