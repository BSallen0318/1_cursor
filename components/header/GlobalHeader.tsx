'use client';

import Link from 'next/link';
import { useTheme } from 'next-themes';
import i18next from 'i18next';
import { useAuth } from '@/lib/auth';
import { GlobalSearchBar } from '@/components/search/GlobalSearchBar';

export function GlobalHeader() {
  const { theme, setTheme } = useTheme();
  const { user, role, signOut } = useAuth();

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  const toggleLang = () => i18next.changeLanguage(i18next.language === 'ko' ? 'en' : 'ko');

  return (
    <header className="sticky top-0 z-30 border-b bg-white/70 dark:bg-zinc-900/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
      <div className="h-14 flex items-center gap-4 px-4">
        <Link href="/" className="font-semibold">WorkMind</Link>
        <div className="flex-1 max-w-3xl"><GlobalSearchBar /></div>
        <button aria-label="Toggle theme" onClick={toggleTheme} className="px-2 h-9 rounded-lg border">{theme === 'dark' ? '🌙' : '☀️'}</button>
        <button aria-label="Toggle language" onClick={toggleLang} className="px-2 h-9 rounded-lg border">{i18next.language?.toUpperCase?.() || 'KO'}</button>
        {user ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-600">{user.name} ({role})</span>
            <button onClick={signOut} className="px-3 h-9 rounded-lg border">로그아웃</button>
          </div>
        ) : (
          <Link href="/signin" className="px-3 h-9 rounded-lg border">로그인</Link>
        )}
      </div>
    </header>
  );
}


