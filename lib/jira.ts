// Jira API 연동 라이브러리

export type JiraCredentials = {
  domain: string;  // example.atlassian.net
  email: string;
  apiToken: string;
};

export type JiraIssue = {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: any;
    status?: { name: string };
    assignee?: { displayName: string; emailAddress: string; accountId: string };
    reporter?: { displayName: string; emailAddress: string };
    created: string;
    updated: string;
    issuetype?: { name: string };
    project?: { key: string; name: string };
  };
};

function getAuthHeader(credentials: JiraCredentials): string {
  const auth = Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString('base64');
  return `Basic ${auth}`;
}

export async function testJiraConnection(credentials: JiraCredentials): Promise<boolean> {
  try {
    const res = await fetch(`https://${credentials.domain}/rest/api/3/myself`, {
      headers: {
        'Authorization': getAuthHeader(credentials),
        'Accept': 'application/json'
      }
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function searchJiraIssues(
  credentials: JiraCredentials,
  options: {
    jql?: string;
    maxResults?: number;
    fields?: string[];
  } = {}
): Promise<{ issues: JiraIssue[]; total: number }> {
  const {
    jql = 'ORDER BY updated DESC',
    maxResults = 100,
    fields = ['summary', 'description', 'status', 'assignee', 'reporter', 'created', 'updated', 'issuetype', 'project']
  } = options;

  try {
    // 첫 페이지만 호출 (이 Jira 인스턴스는 페이지네이션 불가)
    try {
      // GET /rest/api/3/search/jql (가장 간단한 방식)
      const url = new URL(`https://${credentials.domain}/rest/api/3/search/jql`);
      url.searchParams.set('jql', jql);
      url.searchParams.set('maxResults', '100');
      if (fields.length > 0) {
        url.searchParams.set('fields', fields.join(','));
      }

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': getAuthHeader(credentials),
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Jira API error: ${res.status} - ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      const issues = data.issues || [];
      const total = data.total || 0;
      
      console.log(`✅ Jira API: ${issues.length}개 이슈 수집 완료 (API total: ${total})`);
      
      return {
        issues: issues,
        total: total
      };
    } catch (error: any) {
      console.error('❌ Jira API 호출 실패:', error.message);
      return {
        issues: [],
        total: 0
      };
    }
  } catch (error: any) {
    console.error('Jira search error:', error);
    throw error;
  }
}

export async function searchJiraIssuesByText(
  credentials: JiraCredentials,
  searchText: string,
  options: {
    projectKeys?: string[];
    maxResults?: number;
    daysBack?: number;  // 최근 N일 이내 이슈 검색 (기본: 730일 = 2년)
    updatedAfter?: string;  // ISO 날짜 형식 (예: '2025-10-15T08:00:00Z')
  } = {}
): Promise<{ issues: JiraIssue[]; total: number }> {
  const { projectKeys = [], maxResults = 5000, daysBack = 730, updatedAfter } = options;

  // JQL 쿼리 구성 - 조건과 ORDER BY를 분리
  const conditions: string[] = [];
  
  // 프로젝트 필터
  if (projectKeys.length > 0) {
    conditions.push(`project in (${projectKeys.join(',')})`);
  }

  // 텍스트 검색
  if (searchText && searchText.trim()) {
    const searchQuery = `(summary ~ "${searchText}" OR description ~ "${searchText}" OR comment ~ "${searchText}")`;
    conditions.push(searchQuery);
  }

  // 날짜 범위 필터
  if (updatedAfter) {
    // 특정 날짜 이후 (증분 색인용)
    // JQL 날짜 형식: 'YYYY-MM-DD HH:mm'
    const jiraDate = new Date(updatedAfter).toISOString().replace('T', ' ').slice(0, 16);
    conditions.push(`updated >= '${jiraDate}'`);
  } else if (conditions.length === 0 || projectKeys.length === 0) {
    // 조건이 없거나 프로젝트 필터가 없으면 날짜 범위 추가 (무제한 검색 방지)
    conditions.push(`updated >= -${daysBack}d`);
  }

  // JQL 조합: 조건들 + ORDER BY
  const jql = conditions.join(' AND ') + ' ORDER BY updated DESC';

  return searchJiraIssues(credentials, { jql, maxResults });
}

export async function getJiraProjects(credentials: JiraCredentials): Promise<Array<{ key: string; name: string; id: string }>> {
  try {
    const res = await fetch(`https://${credentials.domain}/rest/api/3/project`, {
      headers: {
        'Authorization': getAuthHeader(credentials),
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch projects: ${res.status}`);
    }

    const projects = await res.json();
    return projects.map((p: any) => ({
      key: p.key,
      name: p.name,
      id: p.id
    }));
  } catch (error: any) {
    console.error('Jira projects error:', error);
    return [];
  }
}

export function extractTextFromJiraDescription(description: any): string {
  if (!description) return '';
  
  // ADF (Atlassian Document Format) 파싱
  if (typeof description === 'object' && description.content) {
    return extractTextFromADF(description);
  }
  
  // Plain text
  if (typeof description === 'string') {
    return description;
  }
  
  return '';
}

function extractTextFromADF(node: any): string {
  if (!node) return '';
  
  let text = '';
  
  if (node.type === 'text' && node.text) {
    text += node.text + ' ';
  }
  
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      text += extractTextFromADF(child);
    }
  }
  
  return text;
}

export function getJiraCredentialsFromEnv(): JiraCredentials | null {
  const domain = process.env.JIRA_DOMAIN;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!domain || !email || !apiToken) {
    return null;
  }

  return { domain, email, apiToken };
}

