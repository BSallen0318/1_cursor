import { NextResponse } from 'next/server';

const state: Record<string, { connected: boolean; scopes: string[] }> = {
	drive: { connected: false, scopes: ['read'] },
	jira: { connected: false, scopes: ['read'] },
	github: { connected: true, scopes: ['read'] },
	figma: { connected: false, scopes: ['read'] }
};

export async function POST(_: Request, { params }: { params: { provider: string } }) {
	const { provider } = params;
	if (!state[provider]) return NextResponse.json({ error: 'unknown provider' }, { status: 400 });
	state[provider].connected = !state[provider].connected;
	return NextResponse.json({ provider, ...state[provider] });
}

export async function GET(_: Request, { params }: { params: { provider: string } }) {
	const { provider } = params;
	if (!state[provider]) return NextResponse.json({ error: 'unknown provider' }, { status: 400 });
	// 쿠키의 OAuth 토큰 보유 시 연결됨으로 간주 (데모)
	try {
		const cookies = (await import('next/headers')).cookies();
		if (provider === 'drive') {
			const tokens = cookies.get('drive_tokens');
			state.drive.connected = Boolean(tokens?.value);
		}
		if (provider === 'figma') {
			const tokens = cookies.get('figma_tokens');
			state.figma.connected = Boolean(tokens?.value);
		}
	} catch {}
	return NextResponse.json({ provider, ...state[provider] });
}


