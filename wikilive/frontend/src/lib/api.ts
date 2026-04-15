const API_BASE = '/api';

const fetchDefaults: RequestInit = { credentials: 'include' };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...fetchDefaults,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });

  const parseJson = async (): Promise<unknown> =>
    res.json().catch(() => ({ error: res.statusText }));

  if (!res.ok) {
    const err = await parseJson() as { error?: string; message?: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const data = await parseJson() as {
    success?: boolean;
    error?: string;
    message?: string;
  };

  if (data && typeof data === 'object' && 'success' in data && data.success === false) {
    throw new Error(data.message || data.error || 'MWS request failed');
  }

  return data as T;
}

export interface PageSummary {
  id: string;
  title: string;
  icon: string;
  updatedAt: string;
  spaceId?: string | null;
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
  spaceId?: string | null;
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

export type PageCommentEventDetail =
  | { type: 'created'; comment: PageComment }
  | { type: 'updated'; comment: PageComment }
  | { type: 'deleted'; pageId: string; commentId: string };

const PAGE_COMMENT_EVENT = 'wikilive:page-comment';

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
type MwsViewsResponse = { data?: { views?: unknown[] }; views?: unknown[] };

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
    request<Array<{ id: string; title: string; icon: string; deletedAt: string; spaceId?: string | null }>>('/pages/meta/trash'),

  listTrashBySpace: (spaceId: string) =>
    request<Array<{ id: string; title: string; icon: string; deletedAt: string; spaceId?: string | null }>>(
      `/pages/meta/trash?spaceId=${encodeURIComponent(spaceId)}`
    ),

  restorePage: (id: string) =>
    request<{ success: boolean }>(`/pages/${id}/restore`, { method: 'POST' }),

  permanentDeletePage: (id: string) =>
    request<{ success: boolean }>(`/pages/${id}/permanent`, { method: 'DELETE' }),

  getBacklinks: (id: string) => request<BacklinkPage[]>(`/pages/${id}/backlinks`),

  searchPages: (q: string, spaceId?: string | null) =>
    request<Array<{ id: string; title: string; icon: string; spaceId?: string | null }>>(
      `/pages/meta/search?q=${encodeURIComponent(q)}${spaceId ? `&spaceId=${encodeURIComponent(spaceId)}` : ''}`
    ),

  getGraph: (spaceId?: string | null) =>
    request<{
      nodes: Array<{ id: string; title: string; icon: string; spaceId?: string | null }>;
      edges: Array<{ source: string; target: string }>;
    }>(`/pages/meta/graph${spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ''}`),

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

  listMwsNodes: () => request<MwsNodesResponse>('/tables?includeAll=1'),

  getSpaces: () => request<Record<string, unknown>>('/tables/spaces'),

  getSpaceNodes: (spaceId: string) => request<Record<string, unknown>>(`/tables/spaces/${spaceId}/nodes`),

  getNode: (nodeId: string) => request<Record<string, unknown>>(`/tables/nodes/${nodeId}`),

  updateNode: (nodeId: string, data: { name?: string; title?: string; description?: string; content?: string }) =>
    request<Record<string, unknown>>(`/tables/nodes/${nodeId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getRecords: (dstId: string, pageSize = 100, viewId?: string | null) =>
    request<MwsRecordsResponse>(
      `/tables/datasheets/${dstId}/records?pageSize=${pageSize}&fieldKey=id${viewId ? `&viewId=${encodeURIComponent(viewId)}` : ''}`
    ),

  getRecordsPage: (dstId: string, pageSize = 100, pageNum = 1, viewId?: string | null) =>
    request<MwsRecordsResponse>(
      `/tables/datasheets/${dstId}/records?pageSize=${pageSize}&pageNum=${pageNum}&fieldKey=id${viewId ? `&viewId=${encodeURIComponent(viewId)}` : ''}`
    ),

  createRecords: (dstId: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/tables/datasheets/${dstId}/records`, {
      method: 'POST',
      body: JSON.stringify({ fieldKey: 'id', ...body }),
    }),

  updateRecords: (dstId: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/tables/datasheets/${dstId}/records`, {
      method: 'PATCH',
      body: JSON.stringify({ fieldKey: 'id', ...body }),
    }),

  moveRecords: (dstId: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/tables/datasheets/${dstId}/records/move`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteRecords: (dstId: string, recordIds: string[]) =>
    request<Record<string, unknown>>(`/tables/datasheets/${dstId}/records?recordIds=${recordIds.join(',')}`, {
      method: 'DELETE',
    }),

  getFields: (dstId: string, viewId?: string | null) =>
    request<MwsFieldsResponse>(`/tables/datasheets/${dstId}/fields${viewId ? `?viewId=${encodeURIComponent(viewId)}` : ''}`),

  updateFields: (dstId: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/tables/datasheets/${dstId}/fields`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  getViews: (dstId: string) => request<MwsViewsResponse>(`/tables/datasheets/${dstId}/views`),

  createDatasheet: (spaceId: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/tables/spaces/${spaceId}/datasheets`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  aiChat: (prompt: string, context?: string, includeContext: boolean = false) =>
    request<{ reply: string }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt, context, includeContext }),
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

  uploadImage: async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch(`${API_BASE}/files/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { url: string };
    return data.url;
  },
};

export function emitPageCommentEvent(detail: PageCommentEventDetail): void {
  window.dispatchEvent(new CustomEvent<PageCommentEventDetail>(PAGE_COMMENT_EVENT, { detail }));
}

export function subscribePageCommentEvents(
  handler: (detail: PageCommentEventDetail) => void,
): () => void {
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<PageCommentEventDetail>;
    if (!customEvent.detail) return;
    handler(customEvent.detail);
  };

  window.addEventListener(PAGE_COMMENT_EVENT, listener as EventListener);
  return () => window.removeEventListener(PAGE_COMMENT_EVENT, listener as EventListener);
}
