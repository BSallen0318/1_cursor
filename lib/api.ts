import { sleep } from './utils';

const BASE = '';

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${url}`);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
  return res.json();
}

export async function withLatency<T>(promise: Promise<T>, ms = 300) {
  await sleep(ms);
  return promise;
}

export type OAuthToken = { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string };

export const COOKIE_KEYS = {
	figma: 'figma_tokens',
	drive: 'drive_tokens',
};

export const FIGMA = {
	OAUTH_AUTHORIZE: 'https://www.figma.com/oauth',
    OAUTH_TOKEN: 'https://www.figma.com/api/oauth/token',
	API_BASE: 'https://api.figma.com/v1',
};

export async function figmaExchangeCode(code: string, redirectUri: string) {
	const clientId = process.env.FIGMA_CLIENT_ID || '';
	const clientSecret = process.env.FIGMA_CLIENT_SECRET || '';
	const params = new URLSearchParams();
	params.set('client_id', clientId);
	params.set('client_secret', clientSecret);
	params.set('grant_type', 'authorization_code');
	params.set('redirect_uri', redirectUri);
	params.set('code', code);
    const res = await fetch(FIGMA.OAUTH_TOKEN, {
		method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
		body: params,
	});
    if (res.ok) {
        return (await res.json()) as OAuthToken;
    }
    // Fallback: try API host variant if www returns 404/NotFound
    if (res.status === 404) {
        const alt = 'https://api.figma.com/v1/oauth/token';
        const res2 = await fetch(alt, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
            body: params,
        });
        if (res2.ok) return (await res2.json()) as OAuthToken;
        const txt2 = await res2.text().catch(() => '');
        throw new Error(`figma token exchange failed (alt): ${res2.status} ${txt2}`);
    }
    const txt = await res.text().catch(() => '');
    throw new Error(`figma token exchange failed: ${res.status} ${txt}`);
}

export async function figmaGet<T>(path: string, token: string, query?: Record<string, string | number>): Promise<T> {
	const url = new URL(FIGMA.API_BASE + path);
	if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
	const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) throw new Error(`figma api failed: ${res.status}`);
	return (await res.json()) as T;
}

async function figmaGetSafe<T>(path: string, token: string, query?: Record<string, string | number>): Promise<T | null> {
    try {
        return await figmaGet<T>(path, token, query);
    } catch {
        return null as any;
    }
}

export type FigmaFile = { key: string; name: string; lastModified: string };
export type FigmaProjectFiles = { files: Array<{ key: string; name: string; last_modified: string }>; error?: boolean };
export type FigmaTeamProjects = { projects: Array<{ id: string; name: string }>; error?: boolean };

export async function figmaListProjectFiles(projectId: string, token: string) {
	return figmaGet<FigmaProjectFiles>(`/projects/${projectId}/files`, token);
}

export async function figmaGetFile(fileKey: string, token: string) {
	return figmaGet<any>(`/files/${fileKey}`, token);
}

export async function figmaListTeamProjects(teamId: string, token: string) {
    return figmaGet<FigmaTeamProjects>(`/teams/${teamId}/projects`, token);
}

export async function figmaGetImages(fileKey: string, token: string, nodeIds: string[], format: 'png'|'jpg'|'svg' = 'png', scale: number = 1) {
    const query: Record<string, string|number> = { ids: nodeIds.join(','), format, scale };
    return figmaGet<{ images: Record<string,string> }>(`/images/${fileKey}`, token, query);
}

export async function figmaCollectTextNodes(fileKey: string, token: string) {
    const file = await figmaGetFile(fileKey, token);
    const pages = file?.document?.children || [];
    const items: Array<{ id: string; name: string; text: string }> = [];
    function walk(node: any) {
        if (!node) return;
        if (node.type === 'TEXT' && typeof node.characters === 'string') {
            items.push({ id: node.id, name: node.name || '', text: node.characters });
        }
        const children = node.children || [];
        for (const c of children) walk(c);
    }
    for (const p of pages) walk(p);
    return { file, texts: items };
}

// Best-effort auto discovery for teams and projects the token can see.
export async function figmaAutoDiscoverTeamProjectIds(token: string): Promise<{ teamIds: string[]; projectIds: string[] }> {
    const teamIds: string[] = [];
    const projectIds: string[] = [];
    // Try hypothetical endpoints in a tolerant manner
    // 1) Known endpoint to list projects from a team requires team id; we'll try to find team ids first.
    // Attempt /me/teams
    const meTeams = await figmaGetSafe<{ teams: Array<{ id: string }> }>(`/me/teams`, token);
    if (meTeams?.teams?.length) for (const t of meTeams.teams) if (t?.id && !teamIds.includes(t.id)) teamIds.push(t.id);
    // Attempt organizations → teams
    const orgs = await figmaGetSafe<{ organizations: Array<{ id: string }> }>(`/organizations`, token);
    if (orgs?.organizations?.length) {
        for (const o of orgs.organizations) {
            const ts = await figmaGetSafe<{ teams: Array<{ id: string }> }>(`/organizations/${o.id}/teams`, token);
            if (ts?.teams?.length) for (const t of ts.teams) if (t?.id && !teamIds.includes(t.id)) teamIds.push(t.id);
        }
    }
    // For all discovered teams, fetch projects
    for (const tid of teamIds) {
        const projs = await figmaGetSafe<FigmaTeamProjects>(`/teams/${tid}/projects`, token);
        if (projs?.projects?.length) {
            for (const p of projs.projects) if (p?.id && !projectIds.includes(p.id)) projectIds.push(p.id);
        }
    }
    return { teamIds, projectIds };
}


