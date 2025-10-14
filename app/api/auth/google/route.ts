import { NextResponse } from 'next/server';
import { setSession } from '@/lib/session';

export async function POST() {
  const user = { id: 'u1', name: '김개발', role: 'admin' as const };
  setSession(user);
  return NextResponse.json({ ok: true, user });
}


