export type Platform = 'drive' | 'jira' | 'github' | 'figma';
export type DocKind =
  | 'doc'
  | 'sheet'
  | 'slide'
  | 'issue'
  | 'pr'
  | 'commit'
  | 'design'
  | 'pdf'
  | 'image'
  | 'folder'
  | 'file';

export interface UserRef {
  id: string;
  name: string;
  email: string;
  team?: string;
  avatarUrl?: string;
  role: 'admin' | 'member' | 'viewer';
}

export interface DocItem {
  id: string;
  platform: Platform;
  kind: DocKind;
  title: string;
  snippet: string;
  url: string;
  path: string;
  owner: UserRef;
  updatedAt: string;
  tags?: string[];
  score?: number;
  related?: string[];
  highlight?: {
    title?: string;
    snippet?: string;
  };
}

export interface ChatCitation {
  docId: string;
  span: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: ChatCitation[];
  createdAt: string;
}


