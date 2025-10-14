import { NextRequest, NextResponse } from 'next/server';
import { figmaGetFile, figmaListProjectFiles } from '@/lib/api';

export async function GET(req: NextRequest) {
	try {
		const cookies = (await import('next/headers')).cookies();
		const tokCookie = cookies.get('figma_tokens')?.value;
		if (!tokCookie) return NextResponse.json({ error: 'not connected' }, { status: 401 });
		const tokens = JSON.parse(Buffer.from(tokCookie, 'base64').toString('utf-8')) as { access_token: string };
		const token = tokens.access_token;

		const projectId = req.nextUrl.searchParams.get('projectId');
		const fileKey = req.nextUrl.searchParams.get('fileKey');
		if (!projectId && !fileKey) return NextResponse.json({ error: 'missing projectId or fileKey' }, { status: 400 });

		if (projectId) {
			const r = await figmaListProjectFiles(projectId, token);
			return NextResponse.json({ projectId, ...r });
		}
		if (fileKey) {
			const r = await figmaGetFile(fileKey, token);
			return NextResponse.json({ fileKey, file: r });
		}
		return NextResponse.json({});
	} catch (e: any) {
		return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
	}
}
