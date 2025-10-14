'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const items = [
  { href: '/', label: '홈' },
  { href: '/search', label: '검색' },
  { href: '/settings/integrations', label: '설정' },
  { href: '/admin/usage', label: '관리자' }
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-52 shrink-0 border-r hidden md:block">
      <nav className="p-4 space-y-1">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className={cn('block px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800', pathname === it.href && 'bg-zinc-100 dark:bg-zinc-800 font-medium')}>
            {it.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}


