"use client";

import { useEffect, useState } from 'react';
import { RoleGate } from '@/components/auth/RoleGate';

export default function AdminUsagePage() {
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    fetch('/api/stats/usage').then((r) => r.json()).then(setData);
  }, []);

  return (
    <RoleGate allow={['admin']}>
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">관리자 대시보드</h1>
        {!data && <div>로딩…</div>}
        {data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {data.daily.slice(-3).map((d: any) => (
                <div key={d.date} className="rounded-2xl border p-4">
                  <div className="text-sm text-zinc-500">{d.date}</div>
                  <div className="text-2xl font-semibold">{d.queries}</div>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border p-4">
              <div className="font-medium mb-2">Top Queries</div>
              <ul className="list-disc ml-6">
                {data.topQueries.map((t: any) => (
                  <li key={t.q} className="flex justify-between"><span>{t.q}</span><span className="text-zinc-500">{t.count}</span></li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </RoleGate>
  );
}


