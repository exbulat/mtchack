import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/core';
import Backlinks from '../components/Backlinks';
import Editor from '../components/Editor';
import SaveStatus from '../components/SaveStatus';
import { api } from '../lib/api';
import { useAutosave } from '../hooks/useAutosave';
import { PagesListContext } from '../components/RightSidebar';
import { useAuth } from '../context/AuthContext';
import type { EditorCollab } from '../components/Editor';
import FloatingComments, { FloatingPanel } from '../components/FloatingComments';
import CanvasComments from '../components/CanvasComments';
import PageViews, { type KanbanStatus, type ViewRecord } from '../components/page/PageViews';

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
const LAST_SPACE_PAGE_KEY_PREFIX = 'wikilive-last-space-page:';
const DRAFT_KEY_PREFIX = 'wikilive-page-draft:';
const PAGE_VIEWS_STATE_KEY_PREFIX = 'wikilive-page-views:';
const DEFAULT_PAGE_TITLE = 'Без названия';
const NEW_PAGE_AUTOCREATE_DEBOUNCE_MS = 1200;
type ChainWithImage = ReturnType<TiptapEditor['chain']> & {
  setImage: (attrs: { src: string }) => ReturnType<TiptapEditor['chain']>;
};

type PageViewId =
  | 'page'
  | 'architecture'
  | 'grid'
  | 'calendar'
  | 'gallery'
  | 'gantt'
  | 'kanban'
  | 'form';

interface PageViewOption {
  id: PageViewId;
  label: string;
  icon: string;
  working: boolean;
}

type MwsTableNode = {
  id?: string;
  nodeId?: string;
  dstId?: string;
  name?: string;
  title?: string;
  type?: string;
  nodeType?: string;
};

type MwsTableView = {
  id?: string;
  viewId?: string;
  name?: string;
  viewName?: string;
  title?: string;
  type?: string;
  viewType?: string;
};

function normalizeViewRecordTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildUniqueViewRecordTitle(title: string, records: ViewRecord[], excludeId?: string): string {
  const baseTitle = title.trim() || 'Новая запись';
  const takenTitles = new Set(
    records
      .filter((record) => record.id !== excludeId)
      .map((record) => normalizeViewRecordTitle(record.title))
  );

  if (!takenTitles.has(normalizeViewRecordTitle(baseTitle))) {
    return baseTitle;
  }

  let suffix = 2;
  let candidate = `${baseTitle} ${suffix}`;
  while (takenTitles.has(normalizeViewRecordTitle(candidate))) {
    suffix += 1;
    candidate = `${baseTitle} ${suffix}`;
  }
  return candidate;
}

const PAGE_VIEW_OPTIONS: PageViewOption[] = [
  { id: 'page', label: 'Страница', icon: 'Pg', working: true },
  { id: 'architecture', label: 'Архитектура', icon: 'Ar', working: true },
  { id: 'calendar', label: 'Календарь', icon: 'Cl', working: true },
  { id: 'gallery', label: 'Галерея', icon: 'Gl', working: true },
  { id: 'gantt', label: 'Гант', icon: 'Gt', working: true },
  { id: 'kanban', label: 'Kanban', icon: 'Kb', working: true },
  { id: 'grid', label: 'Сетка', icon: 'Gr', working: true },
  { id: 'form', label: 'Форма', icon: 'Fm', working: true },
];

function isTiptapNode(value: unknown): value is JSONContent {
  return typeof value === 'object' && value !== null && 'type' in (value as Record<string, unknown>);
}

function normalizeEditorContent(value: unknown): JSONContent {
  if (!isTiptapNode(value) || typeof value.type !== 'string') {
    return EMPTY_DOC;
  }

  if (value.type !== 'doc') {
    return EMPTY_DOC;
  }

  const node = value as JSONContent;
  if (!Array.isArray(node.content)) {
    return EMPTY_DOC;
  }

  return node;
}

function readDraftFromSession(storageKey: string): { updatedAt?: number; title?: string; content?: unknown; expiresAt?: number } | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { updatedAt?: number; title?: string; content?: unknown; expiresAt?: number };
    if (parsed.expiresAt && parsed.expiresAt < Date.now()) {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(storageKey);
    return null;
  }
}

function moveDraftSession(sourceKey: string | null, targetKey: string): void {
  if (!sourceKey || sourceKey === targetKey) return;
  const localData = readDraftFromSession(sourceKey);
  if (!localData) {
    sessionStorage.removeItem(sourceKey);
    return;
  }
  try {
    sessionStorage.setItem(targetKey, JSON.stringify(localData));
  } catch {
    return;
  }
  sessionStorage.removeItem(sourceKey);
}

function readPageViewsState(storageKey: string): {
  enabledViews?: PageViewId[];
  activeView?: PageViewId;
  recordOverrides?: Record<string, Partial<ViewRecord>>;
  manualViewRecords?: ViewRecord[];
} | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as {
      enabledViews?: PageViewId[];
      activeView?: PageViewId;
      recordOverrides?: Record<string, Partial<ViewRecord>>;
      manualViewRecords?: ViewRecord[];
    };
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

function describeTablePickerError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Не удалось загрузить таблицы MWS';
  if (message.includes('Missing MWS Tables token')) {
    return 'Не настроен MWS_TABLES_TOKEN. Добавьте токен в .env, чтобы выбирать живые таблицы прямо из wiki.';
  }
  if (message.includes('Missing MWS Tables space')) {
    return 'Не настроен MWS_TABLES_SPACE_ID. Укажите пространство MWS в .env, чтобы видеть доступные таблицы.';
  }
  if (message.includes('No MWS spaces available')) {
    return 'В MWS Tables не найдено доступных пространств для текущего токена.';
  }
  if (message.includes('Failed to fetch tables')) {
    return 'MWS Tables временно не ответил. Проверьте токен, доступ к API и попробуйте ещё раз.';
  }
  return message;
}

function isDatasheetNode(node: MwsTableNode): boolean {
  const value = node.id || node.nodeId || node.dstId || '';
  return /^dst[a-zA-Z0-9]{10,}$/.test(value);
}

export default function PageEditor() {
  const { id, spaceId } = useParams<{ id?: string; spaceId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const pageId = id && id !== 'new' ? id : null;
  const isNewDraftRoute = !pageId && location.pathname === '/new';
  const draftStorageKey = pageId
    ? `${DRAFT_KEY_PREFIX}${pageId}`
    : isNewDraftRoute
      ? `${DRAFT_KEY_PREFIX}route:${location.pathname}`
      : null;
  const pageViewsStorageKey = pageId
    ? `${PAGE_VIEWS_STATE_KEY_PREFIX}${pageId}`
    : `${PAGE_VIEWS_STATE_KEY_PREFIX}route:${location.pathname}`;
  const [title, setTitle] = useState(DEFAULT_PAGE_TITLE);
  const [content, setContent] = useState<JSONContent>(EMPTY_DOC);
  const [loading, setLoading] = useState(true);
  const [showTableModal, setShowTableModal] = useState(false);
  const [spaceNodes, setSpaceNodes] = useState<MwsTableNode[]>([]);
  const [selectedTableNode, setSelectedTableNode] = useState<MwsTableNode | null>(null);
  const [tableViews, setTableViews] = useState<MwsTableView[]>([]);
  const [tableViewsLoading, setTableViewsLoading] = useState(false);
  const [tableViewsError, setTableViewsError] = useState<string | null>(null);
  const [tableModalLoading, setTableModalLoading] = useState(false);
  const [tableModalError, setTableModalError] = useState<string | null>(null);
  const [tableModalNotice, setTableModalNotice] = useState<string | null>(null);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMode, setAiMode] = useState<'page' | 'search'>('page');
  const [aiResult, setAiResult] = useState('');
  const [aiShareContext, setAiShareContext] = useState(false);
  const [description, setDescription] = useState('');
  const [showComments, setShowComments] = useState(false);
  const [canvasCommentMode, setCanvasCommentMode] = useState(false);
  const [focusedCanvasCommentId, setFocusedCanvasCommentId] = useState<string | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [activeView, setActiveView] = useState<PageViewId>('page');
  const [enabledViews, setEnabledViews] = useState<PageViewId[]>(['page']);
  const [showViewsMenu, setShowViewsMenu] = useState(false);
  const [viewsHint, setViewsHint] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Array<{ id: string; pageId: string; createdAt: string; content: JSONContent }>>([]);
  const [editorInstance, setEditorInstance] = useState<TiptapEditor | null>(null);
  const [linkPopover, setLinkPopover] = useState<{
    href: string;
    text: string;
    newTab: boolean;
  } | null>(null);
  const [showPageLinkModal, setShowPageLinkModal] = useState(false);
  const [pageLinkQuery, setPageLinkQuery] = useState('');
  const [pageLinkLoading, setPageLinkLoading] = useState(false);
  const [pageLinkOptions, setPageLinkOptions] = useState<Array<{ id: string; title: string; spaceId?: string | null }>>([]);
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageDragOver, setImageDragOver] = useState(false);

  const { bumpPagesList } = useContext(PagesListContext);
  const titleDebounceRef = useRef<number | null>(null);
  const skipTitleDebounceRef = useRef(true);
  const canvasSurfaceRef = useRef<HTMLDivElement | null>(null);
  const newPageCreateTimeoutRef = useRef<number | null>(null);
  const creatingPageRef = useRef(false);
  const viewsMenuRef = useRef<HTMLDivElement | null>(null);
  const [recordOverrides, setRecordOverrides] = useState<Record<string, Partial<ViewRecord>>>({});
  const [manualViewRecords, setManualViewRecords] = useState<ViewRecord[]>([]);
  const [selectedViewRecordId, setSelectedViewRecordId] = useState<string | null>(null);

  const [collab, setCollab] = useState<EditorCollab | null>(null);

  const insertEditorBlock = useCallback((node: JSONContent) => {
    if (!editorInstance) return false;
    const editor = editorInstance;
    const { from, to } = editor.state.selection;
    const insertPos = from === to ? to : to;

    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, [
        node,
        { type: 'paragraph' },
      ])
      .run();

    return true;
  }, [editorInstance]);

  const collabUserInfo = useMemo(
    () => (user ? { name: user.name, color: user.avatarColor } : undefined),
    [user?.name, user?.avatarColor],
  );

  const activeViewMeta: PageViewOption = useMemo(
    () =>
      PAGE_VIEW_OPTIONS.find((view) => view.id === activeView) ?? {
        id: 'page',
        label: 'Страница',
        icon: 'Pg',
        working: true,
      },
    [activeView]
  );

  const pageRecords = useMemo(() => buildPageRecords(content), [content]);
  const architectureStats = useMemo(() => buildArchitectureStats(pageRecords), [pageRecords]);
  const viewRecords = useMemo(() => {
    const derivedRecords: ViewRecord[] = pageRecords.map((record, index) => {
      const override = recordOverrides[record.id] || {};
      return {
        id: record.id,
        title: override.title ?? record.title,
        excerpt: override.excerpt ?? record.excerpt,
        notes: override.notes ?? record.excerpt,
        status: (override.status as KanbanStatus | undefined) ?? (record.status as KanbanStatus | undefined) ?? 'Other',
        date: override.date ?? record.date ?? '',
        startDate: override.startDate ?? record.startDate ?? record.date ?? '',
        endDate: override.endDate ?? record.endDate ?? record.startDate ?? record.date ?? '',
        image: override.image ?? record.image,
        typeLabel: override.typeLabel ?? record.typeLabel,
        source: 'page',
        order: override.order ?? index,
      };
    });

    return [...derivedRecords, ...manualViewRecords].sort((left, right) => left.order - right.order);
  }, [manualViewRecords, pageRecords, recordOverrides]);

  useEffect(() => {
    if (!showViewsMenu) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (viewsMenuRef.current?.contains(target)) return;
      setShowViewsMenu(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [showViewsMenu]);

  useEffect(() => {
    if (!selectedViewRecordId) return;
    if (viewRecords.some((record) => record.id === selectedViewRecordId)) return;
    setSelectedViewRecordId(null);
  }, [selectedViewRecordId, viewRecords]);

  useEffect(() => {
    const savedState = readPageViewsState(pageViewsStorageKey);
    const nextEnabledViews: PageViewId[] = savedState?.enabledViews?.length
      ? Array.from(new Set<PageViewId>([
          'page',
          ...savedState.enabledViews.filter((viewId): viewId is PageViewId =>
            PAGE_VIEW_OPTIONS.some((option) => option.id === viewId)
          ),
        ]))
      : ['page'];
    const nextActiveView = savedState?.activeView && nextEnabledViews.includes(savedState.activeView)
      ? savedState.activeView
      : 'page';

    setEnabledViews(nextEnabledViews);
    setActiveView(nextActiveView);
    setRecordOverrides(savedState?.recordOverrides || {});
    setManualViewRecords(savedState?.manualViewRecords || []);
    setSelectedViewRecordId(null);
  }, [pageViewsStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(pageViewsStorageKey, JSON.stringify({
        enabledViews,
        activeView,
        recordOverrides,
        manualViewRecords,
      }));
    } catch {
      // Ignore storage errors and keep local in-memory state.
    }
  }, [activeView, enabledViews, manualViewRecords, pageViewsStorageKey, recordOverrides]);

  const addOrActivateView = useCallback((viewId: PageViewId) => {
    const view = PAGE_VIEW_OPTIONS.find((item) => item.id === viewId);
    if (!view) return;
    setEnabledViews((prev) => (prev.includes(viewId) ? prev : [...prev, viewId]));
    setActiveView(viewId);
    setShowViewsMenu(false);
    setViewsHint(null);
  }, []);

  const removeView = useCallback((viewId: PageViewId) => {
    if (viewId === 'page') return;
    setEnabledViews((prev) => {
      const next: PageViewId[] = prev.filter((id) => id !== viewId);
      const safeNext: PageViewId[] = next.length > 0 ? next : ['page'];
      if (activeView === viewId) {
        setActiveView((safeNext[0] as PageViewId) ?? 'page');
      }
      return safeNext;
    });
    setViewsHint(null);
  }, [activeView]);

  const createViewRecord = useCallback((seed?: Partial<ViewRecord>) => {
    const maxOrder = viewRecords.reduce((max, record) => Math.max(max, record.order), -1);
    const recordId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nextRecord: ViewRecord = {
      id: recordId,
      title: seed?.title?.trim() || 'Новая запись',
      excerpt: seed?.excerpt || '',
      notes: seed?.notes || '',
      status: seed?.status || 'To Do',
      date: seed?.date || '',
      startDate: seed?.startDate || seed?.date || '',
      endDate: seed?.endDate || seed?.startDate || seed?.date || '',
      image: seed?.image,
      typeLabel: seed?.typeLabel || 'Запись',
      source: 'manual',
      order: maxOrder + 1,
    };
    setManualViewRecords((prev) => [...prev, nextRecord]);
    setViewsHint('Запись создана');
    window.setTimeout(() => setViewsHint(null), 1400);
    return recordId;
  }, [viewRecords]);

  const updateViewRecord = useCallback((recordId: string, patch: Partial<ViewRecord>) => {
    setManualViewRecords((prev) => {
      let changed = false;
      const next = prev.map((record) => {
        if (record.id !== recordId) return record;
        changed = true;
        return { ...record, ...patch };
      });
      return changed ? next : prev;
    });

    if (!manualViewRecords.some((record) => record.id === recordId)) {
      setRecordOverrides((prev) => ({
        ...prev,
        [recordId]: {
          ...(prev[recordId] || {}),
          ...patch,
        },
      }));
    }
  }, [manualViewRecords]);

  const deleteViewRecord = useCallback((recordId: string) => {
    setManualViewRecords((prev) => prev.filter((record) => record.id !== recordId));
    if (selectedViewRecordId === recordId) setSelectedViewRecordId(null);
    setViewsHint('Запись удалена');
    window.setTimeout(() => setViewsHint(null), 1400);
  }, [selectedViewRecordId]);

  const reorderViewRecords = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const orderedIds = viewRecords.map((record) => record.id);
    const fromIndex = orderedIds.indexOf(draggedId);
    const toIndex = orderedIds.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    orderedIds.splice(fromIndex, 1);
    orderedIds.splice(toIndex, 0, draggedId);

    setManualViewRecords((prev) =>
      prev
        .map((record) => {
          const nextOrder = orderedIds.indexOf(record.id);
          return nextOrder === -1 ? record : { ...record, order: nextOrder };
        })
        .sort((left, right) => left.order - right.order)
    );

    setRecordOverrides((prev) => {
      const next = { ...prev };
      orderedIds.forEach((id, index) => {
        next[id] = { ...(next[id] || {}), order: index };
      });
      return next;
    });
  }, [viewRecords]);

  useEffect(() => {
    if (!spaceId || !pageId) return;
    localStorage.setItem(`${LAST_SPACE_PAGE_KEY_PREFIX}${spaceId}`, pageId);
  }, [spaceId, pageId]);

  useEffect(() => {
    if (!pageId || !user) {
      setCollab(null);
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const provider = new HocuspocusProvider({
      url,
      name: pageId,
      document: ydoc,
      awareness,
      // We authenticate the websocket with the same session cookie as HTTP.
      token: () => 'cookie-session',
      quiet: true,
    });
    setCollab({ ydoc, provider });
    return () => {
      provider.destroy();
      ydoc.destroy();
      setCollab(null);
    };
  }, [pageId, user?.id]);

  const { isSaving, lastSavedAt, saveError, saveNow, pendingChanges } = useAutosave({
    pageId,
    title,
    content,
    enabled: !loading,
    draftStorageKey,
  });

  useEffect(() => {
    skipTitleDebounceRef.current = true;
    let mounted = true;
    setLoading(true);

    async function loadPage() {
      if (!pageId) {
        const localData = draftStorageKey ? readDraftFromSession(draftStorageKey) : null;
        setTitle(localData?.title || DEFAULT_PAGE_TITLE);
        setContent(normalizeEditorContent(localData?.content));
        setLoading(false);
        return;
      }
      try {
        const page = await api.getPage(pageId);
        if (!mounted) return;

        let nextTitle = page.title || DEFAULT_PAGE_TITLE;
        let nextContent = normalizeEditorContent(page.content);
        const localData = draftStorageKey ? readDraftFromSession(draftStorageKey) : null;
        if (localData) {
          const serverTs = new Date(page.updatedAt).getTime();
          if ((localData.updatedAt || 0) > serverTs) {
            nextTitle = localData.title || nextTitle;
            nextContent = normalizeEditorContent(localData.content) || nextContent;
          }
        }
        setTitle(nextTitle);
        setContent(nextContent);
        skipTitleDebounceRef.current = true;
      } catch {
        /* Ignore load errors and keep the editor in a safe empty state. */
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadPage();
    return () => {
      mounted = false;
    };
  }, [draftStorageKey, pageId]);

  // Debounced title sync keeps sidebar titles fresh without creating a revision on every keystroke.
  useEffect(() => {
    if (!pageId) return;
    if (skipTitleDebounceRef.current) {
      skipTitleDebounceRef.current = false;
      return;
    }
    if (titleDebounceRef.current) window.clearTimeout(titleDebounceRef.current);
    titleDebounceRef.current = window.setTimeout(async () => {
      try {
        await api.updatePage(pageId, { title });
        bumpPagesList();
      } catch { /* ignore */ }
    }, 500);
    return () => {
      if (titleDebounceRef.current) window.clearTimeout(titleDebounceRef.current);
    };
  }, [pageId, title, bumpPagesList]);

  useEffect(() => {
    if (!pageId || !showTimeline) {
      setRevisions([]);
      return;
    }
    let mounted = true;
    api
      .requestRevisions(pageId)
      .then((data) => {
        if (mounted && Array.isArray(data)) setRevisions(data);
      })
      .catch(() => {
        if (mounted) setRevisions([]);
      });
    return () => {
      mounted = false;
    };
  }, [pageId, showTimeline]);


  const onTitleBlur = async () => {
    if (!pageId) return;
    if (titleDebounceRef.current) window.clearTimeout(titleDebounceRef.current);
    try {
      await api.updatePage(pageId, { title });
      bumpPagesList();
    } catch { /* ignore */ }
  };

  const ensurePageForBlocks = useCallback(async () => {
    if (pageId) return pageId;
    const created = spaceId
      ? await api.createSpacePage(spaceId, { title, content })
      : await api.createPage({ title, content });
    moveDraftSession(draftStorageKey, `${DRAFT_KEY_PREFIX}${created.id}`);
    bumpPagesList();
    navigate(spaceId ? `/spaces/${spaceId}/page/${created.id}` : `/page/${created.id}`, { replace: true });
    return created.id;
  }, [bumpPagesList, content, draftStorageKey, navigate, pageId, spaceId, title]);

  const hasMeaningfulDraft = useMemo(() => {
    if (!isNewDraftRoute) return false;
    if (title.trim() && title.trim() !== DEFAULT_PAGE_TITLE) return true;
    return extractText(content).trim().length > 0;
  }, [content, isNewDraftRoute, title]);

  useEffect(() => {
    if (!isNewDraftRoute || loading || !hasMeaningfulDraft || creatingPageRef.current) return;

    if (newPageCreateTimeoutRef.current) {
      window.clearTimeout(newPageCreateTimeoutRef.current);
    }

    newPageCreateTimeoutRef.current = window.setTimeout(() => {
      if (creatingPageRef.current) return;
      creatingPageRef.current = true;
      void ensurePageForBlocks().finally(() => {
        creatingPageRef.current = false;
      });
    }, NEW_PAGE_AUTOCREATE_DEBOUNCE_MS);

    return () => {
      if (newPageCreateTimeoutRef.current) {
        window.clearTimeout(newPageCreateTimeoutRef.current);
        newPageCreateTimeoutRef.current = null;
      }
    };
  }, [ensurePageForBlocks, hasMeaningfulDraft, isNewDraftRoute, loading]);

  const openTablePicker = async () => {
    setShowTableModal(true);
    setTableModalLoading(true);
    setTableModalError(null);
    setTableModalNotice(null);
    setSelectedTableNode(null);
    setTableViews([]);
    setTableViewsError(null);
    setSpaceNodes([]);
    try {
      await ensurePageForBlocks();
      const nodesData = await api.listMwsNodes();
      const nodes = (nodesData?.data?.nodes || nodesData?.nodes || []) as MwsTableNode[];
      setSpaceNodes(nodes);
      if (nodes.length === 0) {
        setTableModalError('В подключённом пространстве MWS пока нет таблиц. Создайте таблицу в MWS Tables и попробуйте снова.');
      }
    } catch (error) {
      setTableModalError(describeTablePickerError(error));
    } finally {
      setTableModalLoading(false);
    }
  };

  const loadTableViews = useCallback(async (node: MwsTableNode) => {
    const dstId = node.id || node.nodeId || node.dstId;
    if (!dstId) return;
    if (!isDatasheetNode(node)) {
      setSelectedTableNode(null);
      setTableViews([]);
      setTableViewsError(null);
      insertEditorBlock({
        type: 'mwsPage',
        attrs: {
          nodeId: dstId,
          title: node.name || node.title || dstId,
        },
      });
      setShowTableModal(false);
      setTableModalError(null);
      setTableModalNotice(null);
      return;
    }
    setSelectedTableNode(node);
    setTableViews([]);
    setTableViewsError(null);
    setTableViewsLoading(true);
    try {
      const viewsData = await api.getViews(dstId);
      const views = (viewsData?.data?.views || viewsData?.views || []) as MwsTableView[];
      setTableViews(views);
    } catch (error) {
      setTableViewsError(error instanceof Error ? error.message : 'Не удалось загрузить представления таблицы');
    } finally {
      setTableViewsLoading(false);
    }
  }, [insertEditorBlock]);

  const selectTable = (node: MwsTableNode, view?: MwsTableView | null) => {
    const dstId = node.id || node.nodeId || node.dstId;
    const name = node.name || node.title || dstId;
    const resolvedViewId = view?.id || view?.viewId || '';
    const resolvedViewName = view?.name || view?.viewName || view?.title || '';
    const resolvedViewType = view?.type || view?.viewType || '';
    if (!dstId) return;
    insertEditorBlock({
      type: 'mwsTable',
      attrs: {
        dstId,
        title: name || '',
        ...(resolvedViewId ? { viewId: resolvedViewId } : {}),
        ...(resolvedViewName ? { viewName: resolvedViewName } : {}),
        ...(resolvedViewType ? { viewType: resolvedViewType } : {}),
      },
    });
    setTableModalError(null);
    setTableModalNotice(
      resolvedViewName
        ? `Добавлено представление "${resolvedViewName}". Можно вставить еще одно.`
        : 'Таблица добавлена. Можно вставить еще одно представление.'
    );
  };

  const insertAiBlock = () => {
    setShowAiPanel(true);
  };

  const runAi = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiResult('');
    try {
      let contextForAi = '';
      if (aiShareContext && aiMode === 'search') {
        try {
          const found = await api.searchPages(aiPrompt, spaceId ?? null);
          const pages = await Promise.all(
            found.slice(0, 3).map((p) => api.getPage(p.id).catch(() => null))
          );
          contextForAi = pages
            .filter(Boolean)
            .map((p) => `=== ${p!.title} ===\n${extractText(p!.content as JSONContent)}`)
            .join('\n\n');
        } catch { /* ignore, use empty context */ }
      } else if (aiShareContext) {
        const text = extractText(content);
        contextForAi = `Файл: ${title}\nОписание: ${description || '-'}\nТекст файла:\n${text}`;
      }

      const res = await api.aiChat(aiPrompt, contextForAi, aiShareContext);
      if (!res.reply) return;

      if (aiMode === 'search') {
        setAiResult(res.reply);
      } else {
        if (editorInstance) {
          editorInstance.chain().focus().insertContent(res.reply).run();
        } else {
          setContent((prev: JSONContent) => ({
            ...prev,
            content: [
              ...(prev.content || []),
              { type: 'paragraph', content: [{ type: 'text', text: res.reply }] },
            ],
          }));
        }
        setAiPrompt('');
      }
    } catch { /* ignore */ } finally {
      setAiLoading(false);
    }
  };

  const openLinkPopover = useCallback(() => {
    if (!editorInstance) return;
    const { from, to } = editorInstance.state.selection;
    const linkAttrs = editorInstance.getAttributes('link');
    const hasLink = !!linkAttrs.href;
    const selectedText = from !== to ? editorInstance.state.doc.textBetween(from, to, '') : '';
    setLinkPopover({
      href: hasLink ? String(linkAttrs.href) : '',
      text: selectedText || (hasLink ? String(linkAttrs.href) : ''),
      newTab: linkAttrs.target === '_blank',
    });
  }, [editorInstance]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'k') return;
      if (!editorInstance?.view?.hasFocus()) return;
      e.preventDefault();
      openLinkPopover();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editorInstance, openLinkPopover]);

  useEffect(() => {
    if (!showPageLinkModal) {
      setPageLinkOptions([]);
      setPageLinkLoading(false);
      return;
    }

    let cancelled = false;
    const query = pageLinkQuery.trim();

    const load = async () => {
      setPageLinkLoading(true);
      try {
        const results = await api.searchPages(query || title, spaceId ?? null);
        if (!cancelled) {
          setPageLinkOptions(results);
        }
      } catch {
        if (!cancelled) {
          setPageLinkOptions([]);
        }
      } finally {
        if (!cancelled) {
          setPageLinkLoading(false);
        }
      }
    };

    const timeoutId = window.setTimeout(load, query ? 150 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [showPageLinkModal, pageLinkQuery, spaceId, title]);

  const applyLink = () => {
    if (!editorInstance || !linkPopover) return;
    const href = linkPopover.href.trim();
    if (!href) {
      editorInstance.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      try {
        const url = new URL(href, 'http://localhost');
        const protocol = url.protocol.toLowerCase();
        const allowedProtocols = ['http:', 'https:', 'mailto:', 'ftp:', 'ftps:'];
        if (!allowedProtocols.includes(protocol) && !href.startsWith('/')) {
          console.warn('[Security] Blocked unsafe URL protocol:', protocol);
          alert('Разрешены только HTTP, HTTPS, mailto и FTP ссылки');
          return;
        }
      } catch {
        if (!href.startsWith('/')) {
          console.warn('[Security] Invalid URL format:', href);
          alert('Введите корректный URL');
          return;
        }
      }
      const chain = editorInstance.chain().focus();
      if (editorInstance.isActive('link')) {
        chain.extendMarkRange('link');
      }
      chain.setLink({ href, target: linkPopover.newTab ? '_blank' : null }).run();
    }
    setLinkPopover(null);
  };

  const openPageLinkModal = useCallback(() => {
    if (!editorInstance) return;
    const { from, to } = editorInstance.state.selection;
    const selectedText = from !== to ? editorInstance.state.doc.textBetween(from, to, '').trim() : '';
    const wikiAttrs = editorInstance.getAttributes('wikiLink');
    setPageLinkQuery(selectedText || String(wikiAttrs.title || ''));
    setShowPageLinkModal(true);
  }, [editorInstance]);

  const insertWikiLink = useCallback((targetTitle: string) => {
    if (!editorInstance) return;
    const editor = editorInstance;
    const { from, to } = editor.state.selection;
    const selectionText = from !== to ? editor.state.doc.textBetween(from, to, '') : '';
    const text = selectionText || targetTitle;

    if (from !== to) {
      editor
        .chain()
        .focus()
        .unsetLink()
        .unsetWikiLink()
        .insertContentAt({ from, to }, text)
        .setTextSelection({ from, to: from + text.length })
        .setWikiLink({ title: targetTitle })
        .run();
      return;
    }

    editor
      .chain()
      .focus()
      .insertContent(text)
      .setTextSelection({ from, to: from + text.length })
      .setWikiLink({ title: targetTitle })
      .run();
  }, [editorInstance]);

  const handleSelectPageLink = useCallback((targetTitle: string) => {
    insertWikiLink(targetTitle);
    setShowPageLinkModal(false);
    setPageLinkQuery('');
  }, [insertWikiLink]);

  const handleCreatePageLink = useCallback(async () => {
    const nextTitle = pageLinkQuery.trim();
    if (!nextTitle) return;

    try {
      const existing = pageLinkOptions.find(
        (item) => item.title.trim().toLowerCase() === nextTitle.toLowerCase()
      );

      if (!existing) {
        if (spaceId) {
          await api.createSpacePage(spaceId, { title: nextTitle });
        } else {
          await api.createPage({ title: nextTitle });
        }
        bumpPagesList();
      }

      handleSelectPageLink(nextTitle);
    } catch {
      alert('Не удалось создать ссылку на страницу');
    }
  }, [pageLinkOptions, pageLinkQuery, spaceId, bumpPagesList, handleSelectPageLink]);

  const removeLinkFromPopover = () => {
    if (!editorInstance) return;
    editorInstance.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkPopover(null);
  };

  const handleImageUpload = async (file: File) => {
    if (imageUploading) return;
    if (!['image/jpeg', 'image/png', 'image/gif'].includes(file.type)) {
      alert('Поддерживаются только JPG, PNG и GIF');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Файл слишком большой. Максимум 5 МБ.');
      return;
    }
    setImageUploading(true);
    try {
      const url = await api.uploadImage(file);
      if (editorInstance) {
        (editorInstance.chain().focus() as ChainWithImage).setImage({ src: url }).run();
      }
      setShowImageModal(false);
    } catch (e) {
      alert('Не удалось загрузить изображение: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setImageUploading(false);
    }
  };

  const handleViewRecordImageUpload = useCallback(async (recordId: string, file: File) => {
    if (!['image/jpeg', 'image/png', 'image/gif'].includes(file.type)) {
      alert('Поддерживаются только JPG, PNG и GIF');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Файл слишком большой. Максимум 5 МБ.');
      return;
    }
    try {
      const url = await api.uploadImage(file);
      updateViewRecord(recordId, { image: url });
    } catch (e) {
      alert('Не удалось загрузить изображение: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [updateViewRecord]);

  const runToolbarAction = (action: string) => {
    if (!editorInstance) return;
    const chain = editorInstance.chain().focus();
    switch (action) {
      case 'undo': chain.undo().run(); break;
      case 'redo': chain.redo().run(); break;
      case 'bold': chain.toggleBold().run(); break;
      case 'italic': chain.toggleItalic().run(); break;
      case 'underline': chain.toggleUnderline().run(); break;
      case 'h1': chain.toggleHeading({ level: 1 }).run(); break;
      case 'h2': chain.toggleHeading({ level: 2 }).run(); break;
      case 'h3': chain.toggleHeading({ level: 3 }).run(); break;
      case 'bullet': chain.toggleBulletList().run(); break;
      case 'ordered': chain.toggleOrderedList().run(); break;
      case 'quote': chain.toggleBlockquote().run(); break;
      case 'code': chain.toggleCodeBlock().run(); break;
      case 'rule': chain.setHorizontalRule().run(); break;
      case 'link': openLinkPopover(); break;
      case 'pageLink': openPageLinkModal(); break;
      default: break;
    }
  };

  const restoreRevision = async (revisionId: string) => {
    if (!pageId) return;
    const updatedPage = await api.restoreRevision(pageId, revisionId);
    setContent(updatedPage.content);
    setTitle(updatedPage.title);
    bumpPagesList();
    const fresh = await api.requestRevisions(pageId);
    setRevisions(fresh);
  };

  const removeRevision = async (revisionId: string) => {
    if (!pageId) return;
    await api.deleteRevision(pageId, revisionId);
    setRevisions((prev) => prev.filter((item) => item.id !== revisionId));
  };

  const handleNavigateToComment = useCallback((comment: { id: string; blockId: string }) => {
    if (!comment.blockId.startsWith('canvas_')) return;
    setCanvasCommentMode(true);
    setFocusedCanvasCommentId(comment.id);
  }, []);

  if ((pageId || location.pathname === '/new') && authLoading) {
    return <div className="loading">Загрузка...</div>;
  }

  if (!authLoading && !user && (pageId || location.pathname === '/new')) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (loading) {
    return <div className="loading">Загрузка страницы...</div>;
  }

  if (pageId && user && !collab) {
    return <div className="loading">Подключение совместного редактора...</div>;
  }

  return (
    <div className="editor-shell">
      <div className="page-views-strip">
        <div className="page-views-tabs">
          {enabledViews.map((viewId) => {
            const view = PAGE_VIEW_OPTIONS.find((item) => item.id === viewId);
            if (!view) return null;
            return (
              <div
                key={viewId}
                className={`page-view-tab${activeView === viewId ? ' active' : ''}`}
              >
                <button
                  type="button"
                  className="page-view-tab-main"
                  onClick={() => setActiveView(viewId)}
                >
                  <span className="page-view-tab-icon">{view.icon}</span>
                  <span className="page-view-tab-label">{view.label}</span>
                </button>
                {viewId !== 'page' && (
                  <button
                    type="button"
                    className="page-view-tab-remove"
                    title="Удалить представление"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeView(viewId);
                    }}
                  >
                    x
                  </button>
                )}
                {viewId === 'page' && <span className="page-view-tab-remove page-view-tab-remove--ghost" aria-hidden="true" />}
              </div>
            );
          })}
        </div>
        <div className="page-views-add" ref={viewsMenuRef}>
          <button
            type="button"
            className="page-views-add-btn"
            onClick={() => setShowViewsMenu((prev) => !prev)}
          >
            + Добавить представление
          </button>
          {showViewsMenu && (
            <div className="page-views-menu">
              <div className="page-views-menu-title">Добавить представление</div>
              {PAGE_VIEW_OPTIONS.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  className={`page-views-menu-item${view.working ? '' : ' is-placeholder'}`}
                  onClick={() => addOrActivateView(view.id)}
                >
                  <span className="page-views-menu-left">
                    <span className="page-views-menu-icon">{view.icon}</span>
                    <span>{view.label}</span>
                  </span>
                  <span className="page-views-menu-plus">
                    {enabledViews.includes(view.id) ? '✓' : '+'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {viewsHint && <div className="page-views-hint">{viewsHint}</div>}

      <div className="editor-toolbar-line">
        <div className="toolbar-group">
          <button className="toolbar-btn" title="Отменить" onClick={() => runToolbarAction('undo')}>
            Undo
          </button>
          <button className="toolbar-btn" title="Повторить" onClick={() => runToolbarAction('redo')}>
            Redo
          </button>
        </div>
        <div className="toolbar-group">
          {[
            { id: 'bold', label: 'B' },
            { id: 'italic', label: 'I' },
            { id: 'underline', label: 'U' },
            { id: 'h1', label: 'H1' },
            { id: 'h2', label: 'H2' },
            { id: 'h3', label: 'H3' },
            { id: 'bullet', label: '*' },
            { id: 'ordered', label: '1.' },
            { id: 'quote', label: '"' },
            { id: 'code', label: '</>' },
            { id: 'rule', label: '-' },
            { id: 'link', label: '@' },
            { id: 'pageLink', label: '[[' },
          ].map((item) => (
            <button key={item.id} className="toolbar-btn" onClick={() => runToolbarAction(item.id)}>
              {item.label}
            </button>
          ))}
          <button className="toolbar-btn" onClick={openTablePicker} title="Таблица MWS">
            MWS
          </button>
          <button
            className={`toolbar-btn${canvasCommentMode ? ' active' : ''}`}
            onClick={() => setCanvasCommentMode((v) => !v)}
            title="Комментарии на канвасе"
          >
            💬
          </button>
          <button className="toolbar-btn" onClick={() => setShowImageModal(true)} title="Вставить изображение">
            Img
          </button>
          <button className="toolbar-btn" onClick={insertAiBlock} title="ai">
            AI
          </button>
        </div>
        <div className="toolbar-right">
          <button
            className={`toolbar-link${showComments ? ' active' : ''}`}
            onClick={() => setShowComments((v) => !v)}
          >
            Комментарии
          </button>
          <button
            className={`toolbar-link${showTimeline ? ' active' : ''}`}
            onClick={() => setShowTimeline((v) => !v)}
          >
            Машина времени
          </button>
        </div>
      </div>

      <div className="editor-stage">
        <section className="doc-column">
          <div ref={canvasSurfaceRef} className={`canvas-surface${canvasCommentMode ? ' canvas-surface--comment-mode' : ''}`}>
            {pageId && (
              <CanvasComments
                pageId={pageId}
                currentUserId={user?.id}
                surfaceRef={canvasSurfaceRef}
                enabled={canvasCommentMode}
                focusCommentId={focusedCanvasCommentId}
                onFocusHandled={() => setFocusedCanvasCommentId(null)}
              />
            )}
            <div className={`page-editor-container${activeView === 'page' ? '' : ' page-editor-container--view'}`}>
            <input
              className="page-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={onTitleBlur}
              placeholder="Новая страница"
            />
            <input
              className="doc-description page-description-under-title"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Краткое описание (необязательно)"
            />
            <SaveStatus isSaving={isSaving} lastSavedAt={lastSavedAt} error={saveError} pendingChanges={pendingChanges} />
            {activeView === 'page' ? (
              <Editor
                key={pageId ? `${pageId}-${collab ? 'y' : 'n'}` : 'draft'}
                content={content}
                onUpdate={setContent}
                onSave={saveNow}
                onInsertMwsTable={openTablePicker}
                onInsertPageLink={openPageLinkModal}
                onInsertAiBlock={insertAiBlock}
                onEditorReady={setEditorInstance}
                onRequestLinkEdit={openLinkPopover}
                collab={pageId ? collab : null}
                collabUser={collabUserInfo}
                currentSpaceId={spaceId ?? null}
              />
            ) : activeView === 'architecture' || activeView === 'grid' || activeView === 'gallery' || activeView === 'kanban' || activeView === 'calendar' || activeView === 'gantt' || activeView === 'form' ? (
              <PageViews
                activeView={activeView}
                activeViewLabel={activeViewMeta.label}
                records={viewRecords}
                selectedRecordId={selectedViewRecordId}
                architectureStats={architectureStats}
                onSelectRecord={setSelectedViewRecordId}
                onCreateRecord={createViewRecord}
                onUpdateRecord={updateViewRecord}
                onDeleteRecord={deleteViewRecord}
                onReorderRecords={reorderViewRecords}
                onUploadRecordImage={handleViewRecordImageUpload}
              />
            ) : (
              <div className="page-grid-view">
                <div className="page-grid-view-head">
                  <span className="page-grid-view-title">{activeViewMeta.label}</span>
                  <span className="page-grid-view-note">Представление</span>
                </div>
                <div className="page-grid-empty">Это представление пока недоступно</div>
              </div>
            )}

            {pageId && <Backlinks pageId={pageId} currentSpaceId={spaceId ?? null} />}
            </div>
          </div>
        </section>

      </div>

      {/* Floating panel: comments */}
      {pageId && (
        <FloatingComments
          pageId={pageId}
          currentUserId={user?.id}
          visible={showComments}
          onClose={() => setShowComments(false)}
          onNavigateToComment={handleNavigateToComment}
        />
      )}

      {/* Floating panel: revision history */}
      {showTimeline && (
        <FloatingPanel
          title="Машина времени"
          initialPos={{ x: Math.max(20, window.innerWidth - 400), y: 80 }}
          onClose={() => setShowTimeline(false)}
        >
          <div className="timeline-list">
            {revisions.length === 0 && (
              <div className="timeline-empty">Пока нет ревизий</div>
            )}
            {revisions.map((rev) => (
              <div key={rev.id} className="timeline-item">
                <div className="timeline-title">Версия</div>
                <div className="timeline-time">
                  {new Date(rev.createdAt).toLocaleString('ru-RU')}
                </div>
                <div className="timeline-actions">
                  <button className="comment-thread-link" onClick={() => restoreRevision(rev.id)}>
                    Восстановить
                  </button>
                  <button className="comment-thread-link" onClick={() => removeRevision(rev.id)}>
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </FloatingPanel>
      )}

      {showTableModal && (
        <div className="modal-overlay" onClick={() => {
          setShowTableModal(false);
          setTableModalError(null);
          setSelectedTableNode(null);
          setTableViews([]);
          setTableViewsError(null);
        }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Выберите таблицу MWS</h3>
            <p className="modal-note">
              Таблица будет встроена прямо в страницу и продолжит синхронизироваться с MWS Tables.
            </p>
            {tableModalNotice && (
              <div className="modal-note" style={{ marginBottom: 10, color: 'var(--success, #15803d)' }}>
                {tableModalNotice}
              </div>
            )}
            {selectedTableNode && (
              <div className="modal-note" style={{ marginBottom: 10 }}>
                Выбрана таблица: <strong>{selectedTableNode.name || selectedTableNode.title || selectedTableNode.id || selectedTableNode.nodeId}</strong>
              </div>
            )}
            <ul className="modal-list">
              {tableModalLoading && <li className="modal-list-item modal-list-item--muted">Загружаем таблицы...</li>}
              {tableModalError && <li className="modal-list-item modal-list-item--muted">{tableModalError}</li>}
              {spaceNodes.map((node) => (
                <li
                  key={node.id || node.nodeId}
                  className="modal-list-item"
                  onClick={() => void loadTableViews(node)}
                >
                  <span>{node.name || node.title || node.id}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                    {isDatasheetNode(node) ? 'таблица' : 'страница'}
                  </span>
                </li>
              ))}
              {!tableModalLoading && !tableModalError && spaceNodes.length === 0 && (
                <li className="modal-list-item">Нет доступных таблиц</li>
              )}
            </ul>
            {selectedTableNode && (
              <>
                <h4 style={{ margin: '16px 0 8px' }}>Представление таблицы</h4>
                <ul className="modal-list">
                  {tableViewsLoading && <li className="modal-list-item modal-list-item--muted">Загружаем представления...</li>}
                  {tableViewsError && <li className="modal-list-item modal-list-item--muted">{tableViewsError}</li>}
                  {!tableViewsLoading && !tableViewsError && tableViews.map((view) => (
                    <li
                      key={view.id || view.viewId || view.name || view.title}
                      className="modal-list-item"
                      onClick={() => selectTable(selectedTableNode, view)}
                    >
                      <span>{view.name || view.viewName || view.title || view.id || view.viewId}</span>
                    </li>
                  ))}
                  {!tableViewsLoading && !tableViewsError && tableViews.length === 0 && (
                    <li className="modal-list-item" onClick={() => selectTable(selectedTableNode, null)}>
                      <span>Таблица</span>
                    </li>
                  )}
                </ul>
              </>
            )}
            <button className="modal-close" onClick={() => void openTablePicker()} disabled={tableModalLoading}>
              Обновить список
            </button>
            <button className="modal-close" onClick={() => {
              setShowTableModal(false);
              setTableModalError(null);
              setTableModalNotice(null);
              setSelectedTableNode(null);
              setTableViews([]);
              setTableViewsError(null);
            }}>
              Закрыть
            </button>
          </div>
        </div>
      )}

      {showPageLinkModal && (
        <div className="modal-overlay" onClick={() => setShowPageLinkModal(false)}>
          <div className="modal link-popover-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Ссылка на страницу</h3>
            <label className="link-field">
              <span>Страница</span>
              <input
                type="text"
                value={pageLinkQuery}
                onChange={(e) => setPageLinkQuery(e.target.value)}
                placeholder="Найдите страницу или создайте новую"
                autoFocus
              />
            </label>
            <div className="modal-list">
              {pageLinkLoading && <div className="modal-list-item modal-list-item--muted">Ищем страницы...</div>}
              {!pageLinkLoading && pageLinkOptions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="modal-list-item"
                  onClick={() => handleSelectPageLink(item.title)}
                >
                  <span>{item.title}</span>
                </button>
              ))}
              {!pageLinkLoading && pageLinkOptions.length === 0 && (
                <div className="modal-list-item modal-list-item--muted">Страницы не найдены</div>
              )}
            </div>
            <div className="link-popover-actions">
              <button type="button" className="btn btn-primary" onClick={() => void handleCreatePageLink()}>
                Создать и связать
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowPageLinkModal(false)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {linkPopover && (
        <div className="modal-overlay" onClick={() => setLinkPopover(null)}>
          <div className="modal link-popover-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Ссылка</h3>
            <label className="link-field">
              <span>Текст</span>
              <input
                type="text"
                value={linkPopover.text}
                onChange={(e) => setLinkPopover((p) => (p ? { ...p, text: e.target.value } : p))}
                placeholder="Отображаемый текст"
              />
            </label>
            <label className="link-field">
              <span>Ссылка</span>
              <input
                type="text"
                value={linkPopover.href}
                onChange={(e) => setLinkPopover((p) => (p ? { ...p, href: e.target.value } : p))}
                placeholder="https://"
              />
            </label>
            <label className="link-check">
              <input
                type="checkbox"
                checked={linkPopover.newTab}
                onChange={(e) =>
                  setLinkPopover((p) => (p ? { ...p, newTab: e.target.checked } : p))
                }
              />
              Открывать в новой вкладке
            </label>
            <div className="link-popover-actions">
              <button type="button" className="btn btn-primary" onClick={applyLink}>
                Сохранить
              </button>
              <button type="button" className="btn btn-ghost" onClick={removeLinkFromPopover}>
                Удалить ссылку
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setLinkPopover(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {showImageModal && (
        <div className="modal-overlay" onClick={() => !imageUploading && setShowImageModal(false)}>
          <div className="modal image-upload-modal" onClick={(e) => e.stopPropagation()}>
            <div className="image-upload-modal-header">
              <h3>Вставить изображение</h3>
              <button
                className="image-upload-modal-close"
                onClick={() => !imageUploading && setShowImageModal(false)}
                disabled={imageUploading}
              >
                x
              </button>
            </div>
            <div
              className={`image-upload-dropzone${imageDragOver ? ' drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setImageDragOver(true); }}
              onDragLeave={() => setImageDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setImageDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void handleImageUpload(file);
              }}
              onClick={() => {
                if (imageUploading) return;
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/jpeg,image/png,image/gif';
                input.onchange = () => {
                  const file = input.files?.[0];
                  if (file) void handleImageUpload(file);
                };
                input.click();
              }}
            >
              {imageUploading ? (
                <div className="image-upload-spinner">Загрузка...</div>
              ) : (
                <>
                  <span className="image-upload-icon">Img</span>
                  <span className="image-upload-hint">
                    <span className="image-upload-link">Выберите файл</span> или перетащите его сюда
                  </span>
                  <span className="image-upload-formats">Формат файла: JPG, PNG, GIF. Не более 5 МБ</span>
                </>
              )}
            </div>
            <div className="image-upload-actions">
              <button
                className="btn btn-ghost"
                onClick={() => !imageUploading && setShowImageModal(false)}
                disabled={imageUploading}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {showAiPanel && (
        <div className="ai-floating-panel">
          <div className="ai-floating-header">
            <span>AI-помощник</span>
            <button className="ai-floating-close" onClick={() => setShowAiPanel(false)}>x</button>
          </div>
          <div className="ai-floating-body">
            {/* AI mode switcher */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <button
                className={`toolbar-btn${aiMode === 'page' ? ' active' : ''}`}
                style={{ flex: 1, height: 30, fontSize: 12 }}
                onClick={() => { setAiMode('page'); setAiResult(''); }}
              >
                Этот файл
              </button>
              <button
                className={`toolbar-btn${aiMode === 'search' ? ' active' : ''}`}
                style={{ flex: 1, height: 30, fontSize: 12 }}
                onClick={() => { setAiMode('search'); setAiResult(''); }}
              >
                Поиск по всем
              </button>
            </div>
            <textarea
              className="ai-block-input"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder={
                aiMode === 'search'
                  ? 'Например: найди где описана интеграция с MWS Tables'
                  : 'Введите промпт для работы с этим файлом...'
              }
              disabled={aiLoading}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={aiShareContext}
                onChange={(e) => setAiShareContext(e.target.checked)}
                disabled={aiLoading}
              />
              Отправлять контекст страницы в AI
            </label>
            <div className="ai-block-actions">
              {aiLoading ? (
                <span className="ai-loading-text">Генерация...</span>
              ) : (
                <button className="btn btn-primary" onClick={runAi}>
                  {aiMode === 'search' ? 'Найти' : 'Выполнить'}
                </button>
              )}
            </div>
            {/* AI response */}
            {aiResult && (
              <div style={{
                marginTop: 10,
                padding: 12,
                background: 'var(--surface)',
                borderRadius: 6,
                fontSize: 13,
                whiteSpace: 'pre-wrap',
                color: 'var(--text)',
                lineHeight: 1.6,
                maxHeight: 300,
                overflowY: 'auto',
              }}>
                {aiResult}
                <div style={{ marginTop: 8 }}>
                  <button
                    style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    onClick={() => setAiResult('')}
                  >
                    Очистить
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function extractText(node: JSONContent | JSONContent[] | string | undefined): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join(' ');
  if (node.text) return String(node.text);
  if (node.content) return extractText(node.content);
  return '';
}

type PageRecord = {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  excerpt: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  image?: string;
  pageLinks: number;
  tableLinks: number;
};

function buildPageRecords(doc: JSONContent): PageRecord[] {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return [];

  const typeLabels: Record<string, string> = {
    heading: 'Заголовок',
    paragraph: 'Текст',
    bulletList: 'Список',
    orderedList: 'Список',
    blockquote: 'Цитата',
    codeBlock: 'Код',
    image: 'Изображение',
    table: 'Таблица',
    mwsTable: 'Таблица MWS',
  };

  const result: PageRecord[] = [];
  for (let index = 0; index < doc.content.length; index += 1) {
    const node = doc.content[index];
    if (!node) continue;
    const type = node.type || 'block';
    const text = extractText(node).replace(/\s+/g, ' ').trim();
    const attrs = (node.attrs || {}) as Record<string, unknown>;
    const imageSrc = type === 'image' && typeof attrs.src === 'string' ? attrs.src : undefined;
    if (!text && !imageSrc && type !== 'mwsTable' && type !== 'table') continue;

    const title =
      type === 'image'
        ? 'Изображение'
        : type === 'mwsTable'
          ? 'Таблица MWS'
          : text.slice(0, 90);
    const excerpt =
      type === 'image' || type === 'mwsTable' || type === 'table'
        ? ''
        : text.length > 90
          ? text.slice(90, 230)
          : '';

    const { date, startDate, endDate } = parseDateFields(text);
    const status = inferStatus(text);
    const pageLinks = (text.match(/\[\[[^\]]+\]\]/g) || []).length;
    const tableLinks = type === 'mwsTable' || type === 'table' ? 1 : 0;

    result.push({
      id: `${type}-${index}`,
      type,
      typeLabel: typeLabels[type] || 'Блок',
      title: title || 'Пустой блок',
      excerpt,
      date,
      startDate,
      endDate,
      status,
      image: imageSrc,
      pageLinks,
      tableLinks,
    });
  }

  return result;
}

function buildArchitectureStats(records: PageRecord[]): { typeCounts: Record<string, number>; pageLinks: number; tableLinks: number } {
  const typeCounts: Record<string, number> = {};
  let pageLinks = 0;
  let tableLinks = 0;
  for (const record of records) {
    typeCounts[record.type] = (typeCounts[record.type] || 0) + 1;
    pageLinks += record.pageLinks;
    tableLinks += record.tableLinks;
  }
  return { typeCounts, pageLinks, tableLinks };
}

function inferStatus(text: string): 'To Do' | 'In Progress' | 'Done' | 'Other' {
  const value = text.toLowerCase();
  if (/(todo|to do|нужно|план|backlog)/.test(value)) return 'To Do';
  if (/(progress|в работе|doing|started)/.test(value)) return 'In Progress';
  if (/(done|готово|завершено|closed|выполнено)/.test(value)) return 'Done';
  return 'Other';
}

function normalizeDate(raw: string): string | undefined {
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dot = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dot) return `${dot[3]}-${dot[2]}-${dot[1]}`;
  return undefined;
}

function parseDateFields(text: string): { date?: string; startDate?: string; endDate?: string } {
  const normalizedText = text.replace(/\s+/g, ' ');
  const range = normalizedText.match(/(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})\s*[-—]\s*(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})/);
  if (range) {
    const startDate = normalizeDate(range[1] || '');
    const endDate = normalizeDate(range[2] || '');
    return { date: startDate, startDate, endDate };
  }
  const single = normalizedText.match(/(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})/);
  if (single) {
    const date = normalizeDate(single[1] || '');
    return { date, startDate: date, endDate: date };
  }
  return {};
}

