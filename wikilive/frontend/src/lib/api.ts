const API_BASE = '/api';

const fetchDefaults: RequestInit = { credentials: 'include' };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...fetchDefaults,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface PageSummary {
  id: string;
  title: string;
  icon: string;
  updatedAt: string;
}

export interface Page {
  id: string;
  title: string;
  content: Record<string, unknown>;
  icon: string;
  createdAt: string;
  updatedAt: string;
  incomingLinks: Array<{
    source: { id: string; title: string; icon: string };
  }>;
}

export interface BacklinkPage {
  id: string;
  title: string;
  icon: string;
}

export interface PageComment {
  id: string;
  pageId: string;
  text: string;
  authorId: string;
  authorName: string;
  blockId: string;
  resolved: boolean;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
}

export interface SpaceSummary {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  ownerId: string;
  createdAt: string;
  myRole: string;
}

export interface SpaceMemberFull {
  id: string;
  spaceId: string;
  userId: string;
  role: string;
  invitedAt: string;
  user: { id: string; name: string; email: string; avatarColor: string };
}

// MWS tables API: то обёртка `{ data: ... }`, то плоский JSON
type MwsFieldsResponse = { data?: { fields?: unknown[] }; fields?: unknown[] };
type MwsRecordsResponse = { data?: { records?: unknown[] }; records?: unknown[] };
type MwsNodesResponse = { data?: { nodes?: unknown[] }; nodes?: unknown[] };

export const api = {
  authMe: () => request<{ user: AuthUser | null }>('/auth/me'),

  register: (body: { email: string; password: string; name: string }) =>
    request<{ user: AuthUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  login: (body: { email: string; password: string }) =>
    request<{ user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  logout: () =>
    request<{ ok: boolean }>('/auth/logout', {
      method: 'POST',
    }),

  listPages: () => request<PageSummary[]>('/pages'),

  getPage: (id: string) => request<Page>(`/pages/${id}`),

  createPage: (data: { title?: string; content?: Record<string, unknown>; icon?: string }) =>
    request<Page>('/pages', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updatePage: (id: string, data: { title?: string; content?: Record<string, unknown>; icon?: string }) =>
    request<Page>(`/pages/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deletePage: (id: string) =>
    request<{ success: boolean }>(`/pages/${id}`, { method: 'DELETE' }),

  listTrash: () =>
    request<Array<{ id: string; title: string; icon: string; deletedAt: string }>>('/pages/meta/trash'),

  restorePage: (id: string) =>
    request<{ success: boolean }>(`/pages/${id}/restore`, { method: 'POST' }),

  permanentDeletePage: (id: string) =>
    request<{ success: boolean }>(`/pages/${id}/permanent`, { method: 'DELETE' }),

  getBacklinks: (id: string) => request<BacklinkPage[]>(`/pages/${id}/backlinks`),

  searchPages: (q: string) =>
    request<Array<{ id: string; title: string; icon: string }>>(`/pages/meta/search?q=${encodeURIComponent(q)}`),

  getGraph: () =>
    request<{
      nodes: Array<{ id: string; title: string; icon: string }>;
      edges: Array<{ source: string; target: string }>;
    }>('/pages/meta/graph'),

  requestRevisions: (id: string) => request<Array<{ id: string; pageId: string; createdAt: string; content: Record<string, unknown> }>>(`/pages/${id}/revisions`),
  restoreRevision: (id: string, revisionId: string) =>
    request<Page>(`/pages/${id}/revisions/${revisionId}/restore`, {
      method: 'POST',
    }),
  deleteRevision: (id: string, revisionId: string) =>
    request<{ success: boolean }>(`/pages/${id}/revisions/${revisionId}`, {
      method: 'DELETE',
    }),

  listComments: (id: string) => request<PageComment[]>(`/pages/${id}/comments`),
  createComment: (id: string, data: { text: string; blockId?: string }) =>
    request<PageComment>(`/pages/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateComment: (commentId: string, data: { text?: string; resolved?: boolean }) =>
    request<PageComment>(`/pages/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteComment: (commentId: string) =>
    request<{ success: boolean }>(`/pages/comments/${commentId}`, {
      method: 'DELETE',
    }),

  listTables: () => request<MwsNodesResponse>('/tables'),

  getSpaces: () => request<Record<string, unknown>>('/tables/spaces'),

  getSpaceNodes: (spaceId: string) => request<Record<string, unknown>>(`/tables/spaces/${spaceId}/nodes`),

  getNode: (nodeId: string) => request<Record<string, unknown>>(`/tables/nodes/${nodeId}`),

  // fieldKey=id: ключи в record.fields совпадают с id полей из /fields (TableEmbed индексирует ячейки по field.id).
  // При fieldKey=name MWS отдаёт объекты с ключами по имени колонки — тогда rowFields[field.id] всегда пусто.
  getRecords: (dstId: string, pageSize = 100) =>
    request<MwsRecordsResponse>(`/tables/datasheets/${dstId}/records?pageSize=${pageSize}&fieldKey=id`),

  createRecords: (dstId: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/tables/datasheets/${dstId}/records`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateRecords: (dstId: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/tables/datasheets/${dstId}/records`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteRecords: (dstId: string, recordIds: string[]) =>
    request<Record<string, unknown>>(`/tables/datasheets/${dstId}/records?recordIds=${recordIds.join(',')}`, {
      method: 'DELETE',
    }),

  getFields: (dstId: string) => request<MwsFieldsResponse>(`/tables/datasheets/${dstId}/fields`),

  getViews: (dstId: string) => request<Record<string, unknown>>(`/tables/datasheets/${dstId}/views`),

  createDatasheet: (spaceId: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/tables/spaces/${spaceId}/datasheets`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  aiChat: (prompt: string, context?: string) =>
    request<{ reply: string }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt, context }),
    }),

  aiSuggest: (text: string, action: string) =>
    request<{ reply: string }>('/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({ text, action }),
    }),

  createSpace: (data: { name?: string }) =>
    request<{ id: string; name: string; color: string; ownerId: string }>(`/spaces`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSpacePages: (spaceId: string) =>
    request<PageSummary[]>(`/spaces/${spaceId}/pages`),

  createSpacePage: (spaceId: string, data: { title?: string; content?: Record<string, unknown>; icon?: string }) =>
    request<Page>(`/spaces/${spaceId}/pages`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateMe: (data: { name?: string; avatarColor?: string }) =>
    request<{ user: AuthUser }>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getMySpaces: () => request<SpaceSummary[]>('/spaces/mine'),

  getSpaceMembers: (spaceId: string) =>
    request<SpaceMemberFull[]>(`/spaces/${spaceId}/members`),

  inviteMember: (spaceId: string, data: { email: string; role: string }) =>
    request<SpaceMemberFull>(`/spaces/${spaceId}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateMemberRole: (spaceId: string, userId: string, role: string) =>
    request<SpaceMemberFull>(`/spaces/${spaceId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  removeMember: (spaceId: string, userId: string) =>
    request<{ ok: boolean }>(`/spaces/${spaceId}/members/${userId}`, {
      method: 'DELETE',
    }),

  renameSpace: (spaceId: string, name: string) =>
    request<{ id: string; name: string }>(`/spaces/${spaceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  deleteSpace: (spaceId: string) =>
    request<{ ok: boolean }>(`/spaces/${spaceId}`, { method: 'DELETE' }),
};
