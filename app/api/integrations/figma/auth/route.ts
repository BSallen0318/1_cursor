import { NextResponse } from 'next/server';

export async function GET() {
    const clientId = process.env.FIGMA_CLIENT_ID || '';
    const redirectUri = process.env.FIGMA_REDIRECT_URI || 'http://localhost:3000/api/integrations/figma/callback';
    const scopes = ['file_read'].join(' ');
    const state = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
        ? (globalThis.crypto as any).randomUUID()
        : Math.random().toString(36).slice(2);
    const url = new URL('https://www.figma.com/oauth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopes);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    const res = NextResponse.redirect(url);
    res.cookies.set('figma_oauth_state', state, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: false,
        maxAge: 10 * 60
    });
    return res;
}
