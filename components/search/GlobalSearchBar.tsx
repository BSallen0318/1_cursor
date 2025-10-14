'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function GlobalSearchBar() {
  const router = useRouter();
  const { t } = useTranslation();
  const [q, setQ] = useState('');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search_placeholder')} className="w-full h-10 rounded-lg border px-3" />
      <button className="h-10 px-3 rounded-lg border">Go</button>
    </form>
  );
}


