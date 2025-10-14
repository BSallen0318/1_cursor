import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/drive';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'missing code' }, { status: 400 });
  try {
    const tokens = await exchangeCode(code);
    // NOTE: 데모 저장 방식 - 실제로는 DB/kv 저장을 권장합니다
    const res = NextResponse.redirect(new URL('/settings/integrations?drive=connected', req.url));
    const encoded = Buffer.from(JSON.stringify(tokens), 'utf-8').toString('base64');
    res.cookies.set('drive_tokens', encoded, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
      maxAge: 60 * 60 * 24 * 7
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'oauth failed' }, { status: 500 });
  }
}


