import { NextResponse } from 'next/server';
import { setSession } from '@/lib/session';

export async function POST() {
  setSession(null);
  return NextResponse.json({ ok: true });
}


