import { NextResponse } from 'next/server';
import queries from '@/mocks/queries.json';

export async function GET() {
  return NextResponse.json(queries);
}


