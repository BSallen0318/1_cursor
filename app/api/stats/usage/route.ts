import { NextResponse } from 'next/server';
import stats from '@/mocks/stats.json';

export async function GET() {
  return NextResponse.json(stats);
}


