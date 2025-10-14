"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function ChatPanel({ onOpenDoc, onUseQuestion }: { onOpenDoc?: (id: string) => void; onUseQuestion?: (q: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setLoading(true);
    fetch('/api/queries')
      .then((r) => r.json())
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="rounded-2xl border p-4 grid gap-3">
      <div className="text-sm text-zinc-500">샘플 질문</div>
      {loading && <div>로딩…</div>}
      <ul className="grid gap-3">
        {items.map((q) => (
          <li key={q.id} className="rounded-xl border p-3">
            <div className="font-medium flex items-center justify-between gap-3">
              <span>Q. {q.question}</span>
              {onUseQuestion && (
                <button className="text-xs px-2 h-7 rounded border" onClick={() => onUseQuestion(q.question)}>검색에 반영</button>
              )}
            </div>
            <div className="mt-1">A. <span dangerouslySetInnerHTML={{ __html: q.answer }} /></div>
            <div className="mt-2 text-sm text-zinc-500 flex flex-wrap gap-2">
              {q.citations?.map((c: any) => (
                <button key={c.docId} className="underline" onClick={() => (onOpenDoc ? onOpenDoc(c.docId) : router.push(`/docs/${c.docId}`))}>
                  [{c.docId}] {c.span}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
