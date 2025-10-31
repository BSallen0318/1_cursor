import { NextRequest, NextResponse } from 'next/server';
import { figmaExchangeCode } from '@/lib/api';

export async function GET(req: NextRequest) {
	const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state');
	if (!code) return NextResponse.json({ error: 'missing code' }, { status: 400 });
    try {
        const cookieStore = (await import('next/headers')).cookies();
        const expected = cookieStore.get('figma_oauth_state')?.value;
        if (!state || !expected || state !== expected) {
            return NextResponse.json({ error: 'invalid state' }, { status: 400 });
        }
    } catch {}
	try {
		const redirectUri = process.env.FIGMA_REDIRECT_URI || 'http://localhost:3000/api/integrations/figma/callback';
		const tokens = await figmaExchangeCode(code, redirectUri);
		const encoded = Buffer.from(JSON.stringify(tokens), 'utf-8').toString('base64');
		// 실제 요청된 호스트를 사용하여 리다이렉트 URL 구성
		const protocol = req.headers.get('x-forwarded-proto') || 'http';
		const host = req.headers.get('host') || 'localhost:4244';
		const redirectUrl = `${protocol}://${host}/settings/integrations?figma=connected`;
		const res = NextResponse.redirect(redirectUrl);
		res.cookies.set('figma_tokens', encoded, {
			httpOnly: true,
			sameSite: 'lax',
			path: '/',
			secure: false,
			maxAge: 60 * 60 * 24 * 7,
		});
		return res;
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'oauth failed' }, { status: 500 });
	}
}
