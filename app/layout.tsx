import '../styles/globals.css';
import type { Metadata } from 'next';
import { Providers } from './providers';
import { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'WorkMind AI Archive',
  description: 'Search and chat across company knowledge.',
  icons: {
    icon: '/icon.svg'
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <div id="root" className="min-h-screen">
          {/* @ts-expect-error Server Component wrapping Client */}
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}


