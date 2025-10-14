"use client";

import { useEffect, useState } from 'react';

export function AdminCharts() {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => { fetch('/api/stats/usage').then((r) => r.json()).then(setData); }, []);
  if (!data) return <div>로딩…</div>;
  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border p-4">
        <div className="font-medium mb-2">일별 질의 (최근 3일)</div>
        <div className="flex gap-2 items-end h-32">
          {data.daily.slice(-3).map((d: any) => (
            <div key={d.date} className="bg-zinc-900 text-white text-xs px-2" style={{ height: Math.max(12, d.queries/2) }}>{d.queries}</div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border p-4">
        <div className="font-medium mb-2">플랫폼 비중</div>
        <ul className="text-sm">
          {data.platformShare.map((p: any) => (
            <li key={p.platform} className="flex items-center gap-2"><span className="w-24 capitalize">{p.platform}</span><span className="h-2 bg-zinc-200 flex-1"><span className="block h-2 bg-zinc-900" style={{ width: `${p.ratio*100}%` }} /></span><span className="w-12 text-right">{Math.round(p.ratio*100)}%</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
