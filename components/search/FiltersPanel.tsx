'use client';

import { useEffect, useState } from 'react';
import type { Platform, DocKind } from '@/types/platform';

type Filters = { source?: 'all'|'drive'|'github'|'figma' };

export function FiltersPanel({ value, onChange }: { value?: Filters; onChange: (f: Filters) => void }) {
  const [source, setSource] = useState<'all'|'drive'|'github'|'figma'>(value?.source || 'all');

  useEffect(() => { onChange({ source }); }, [source, onChange]);

  return (
    <div className="rounded-xl border p-3 grid gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-zinc-500">문서 종류</span>
        {(['all','drive','github','figma'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSource(s)}
            aria-pressed={source === s}
            className={`px-3 h-9 rounded-lg border text-sm ${source === s ? 'bg-zinc-900 text-white' : ''}`}
          >
            {s === 'all' ? '전체' : s === 'drive' ? '구글드라이브' : s === 'github' ? '깃허브' : '피그마'}
          </button>
        ))}
      </div>
    </div>
  );
}
