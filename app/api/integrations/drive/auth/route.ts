import { NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/drive';

export async function GET() {
  const url = await getAuthUrl();
  return NextResponse.redirect(url);
}


