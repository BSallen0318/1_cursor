import Link from 'next/link';
import type { DocItem } from '@/types/platform';

// 플랫폼별 아이콘 매핑
function getPlatformIcon(platform: string): string {
  switch (platform) {
    case 'drive':
      return '📊';
    case 'figma':
      return '🎨';
    case 'jira':
      return '📋';
    default:
      return '📄';
  }
}

// 플랫폼별 배경색
function getPlatformColor(platform: string): string {
  switch (platform) {
    case 'drive':
      return 'bg-blue-100 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400';
    case 'figma':
      return 'bg-purple-100 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400';
    case 'jira':
      return 'bg-orange-100 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400';
    default:
      return 'bg-zinc-100 dark:bg-zinc-950/30 text-zinc-600 dark:text-zinc-400';
  }
}

export function ResultCard({ item, active, onClick }: { item: DocItem; active?: boolean; onClick?: () => void }) {
  const platformIcon = getPlatformIcon(item.platform);
  const platformColor = getPlatformColor(item.platform);
  
  return (
    <li className={`rounded-xl p-4 border ${active ? 'bg-zinc-50 dark:bg-zinc-900/30 border-zinc-400' : ''}`} onClick={onClick}>
      <div className="flex items-start gap-3">
        {/* 플랫폼 아이콘 */}
        <div className={`shrink-0 w-10 h-10 rounded-lg ${platformColor} flex items-center justify-center text-xl font-semibold`}>
          {platformIcon}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="font-semibold" dangerouslySetInnerHTML={{ __html: item.highlight?.title || item.title }} />
          <div className="text-xs text-zinc-500 mt-1">
            <span>{(item as any).owner?.name || (item as any).owner?.id || ''}</span>
            <span className="ml-2">• {new Date(item.updatedAt).toLocaleString()}</span>
          </div>
        </div>
        
        <Link 
          target="_blank" 
          rel="noopener noreferrer" 
          href={(item as any).url || `/docs/${item.id}`} 
          className="shrink-0 px-3 h-8 rounded-lg border hover:bg-zinc-50 dark:hover:bg-zinc-900 flex items-center"
        >
          문서 연결
        </Link>
      </div>
    </li>
  );
}

export function ResultsList({ items, activeId, onSelect }: { items: DocItem[]; activeId?: string; onSelect?: (id: string) => void }) {
  if (!items.length) return <div className="text-zinc-500">검색 결과가 없습니다.</div>;
  return (
    <ul className="grid gap-3">
      {items.map((it) => (
        <ResultCard key={it.id} item={it} active={activeId === it.id} onClick={() => onSelect && onSelect(it.id)} />
      ))}
    </ul>
  );
}
