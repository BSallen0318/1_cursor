'use client';

export function Footer() {
  const build = typeof window !== 'undefined' ? new Date().toLocaleString() : '';
  return (
    <footer className="border-t text-sm text-zinc-500 px-4 py-3 flex justify-between">
      <span>WorkMind • v0.1.0</span>
      <span>Build: {build}</span>
      <nav className="flex gap-3">
        <a href="#" className="hover:underline">이용약관</a>
        <a href="#" className="hover:underline">개인정보</a>
      </nav>
    </footer>
  );
}


