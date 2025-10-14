'use client';

import { useState } from 'react';

export default function SignInPage() {
  const [loading, setLoading] = useState(false);

  const onGoogle = async () => {
    setLoading(true);
    try {
      await fetch('/api/auth/google', { method: 'POST' });
      location.href = '/';
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md w-full rounded-2xl shadow-md p-8 bg-white dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold">WorkMind 로그인</h1>
        <p className="text-sm text-zinc-500 mt-2">Google 계정으로 계속</p>
        <button onClick={onGoogle} disabled={loading} className="mt-6 w-full h-11 rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
          {loading ? '진행 중…' : 'Google로 로그인(목업)'}
        </button>
      </div>
    </main>
  );
}


