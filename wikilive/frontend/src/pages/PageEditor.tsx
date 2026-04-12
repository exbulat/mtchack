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

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
const LAST_SPACE_PAGE_KEY_PREFIX = 'wikilive-last-space-page:';

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

export default function PageEditor() {
  const { id, spaceId } = useParams<{ id?: string; spaceId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const pageId = id && id !== 'new' ? id : null;
  const [title, setTitle] = useState('Без названия');
  const [content, setContent] = useState<JSONContent>(EMPTY_DOC);
  const [loading, setLoading] = useState(true);
  const [showTableModal, setShowTableModal] = useState(false);
  const [spaceNodes, setSpaceNodes] = useState<Array<{ id?: string; nodeId?: string; dstId?: string; name?: string; title?: string }>>([]);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMode, setAiMode] = useState<'page' | 'search'>('page');
  const [aiResult, setAiResult] = useState('');
  const [description, setDescription] = useState('');
  const [showComments, setShowComments] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [revisions, setRevisions] = useState<Array<{ id: string; pageId: string; createdAt: string; content: JSONContent }>>([]);
  const [editorInstance, setEditorInstance] = useState<TiptapEditor | null>(null);
  const [pageMeta, setPageMeta] = useState<{ createdAt?: string; updatedAt?: string }>({});
  const [linkPopover, setLinkPopover] = useState<{
    href: string;
    text: string;
    newTab: boolean;
  } | null>(null);

  const { bumpPagesList } = useContext(PagesListContext);
  const titleDebounceRef = useRef<number | null>(null);
  const skipTitleDebounceRef = useRef(true);

  const [collab, setCollab] = useState<EditorCollab | null>(null);

  const collabUserInfo = useMemo(
    () => (user ? { name: user.name, color: user.avatarColor } : undefined),
    [user?.name, user?.avatarColor],
  );

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
  });

  useEffect(() => {
    skipTitleDebounceRef.current = true;
    let mounted = true;
    async function loadPage() {
      if (!pageId) {
        setLoading(false);
        return;
      }
      try {
        const page = await api.getPage(pageId);
        if (!mounted) return;

        let nextTitle = page.title || 'Без названия';
        let nextContent = normalizeEditorContent(page.content);
        const localRaw = localStorage.getItem(`wikilive-page-${pageId}`);
        if (localRaw) {
          const localData = JSON.parse(localRaw);
          const serverTs = new Date(page.updatedAt).getTime();
          if ((localData.updatedAt || 0) > serverTs) {
            nextTitle = localData.title || nextTitle;
            nextContent = normalizeEditorContent(localData.content) || nextContent;
          }
        }
        setTitle(nextTitle);
        setContent(nextContent);
        setPageMeta({ createdAt: page.createdAt, updatedAt: page.updatedAt });
        skipTitleDebounceRef.current = true;
      } catch {
        /* страница не загрузилась */
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadPage();
    return () => {
      mounted = false;
    };
  }, [pageId]);

  // заголовок сохраняем отдельной задержкой, чтобы не плодить ревизии контента на каждую букву
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

  const ensurePageForBlocks = async () => {
    if (pageId) return pageId;
    const created = spaceId
      ? await api.createSpacePage(spaceId, { title, content })
      : await api.createPage({ title, content });
    bumpPagesList();
    navigate(spaceId ? `/spaces/${spaceId}/page/${created.id}` : `/page/${created.id}`, { replace: true });
    return created.id;
  };

  const openTablePicker = async () => {
    try {
      await ensurePageForBlocks();
      const nodesData = await api.listTables();
      const nodes = (nodesData?.data?.nodes || nodesData?.nodes || []) as Array<{ id?: string; nodeId?: string; dstId?: string; name?: string; title?: string }>;
      setSpaceNodes(nodes);
      setShowTableModal(true);
    } catch {
      setSpaceNodes([]);
      setShowTableModal(true);
    }
  };

  const selectTable = (node: { id?: string; nodeId?: string; dstId?: string; name?: string; title?: string }) => {
    const dstId = node.id || node.nodeId || node.dstId;
    const name = node.name || node.title || dstId;
    if (!dstId) return;
    if (editorInstance) {
      editorInstance
        .chain()
        .focus()
        .insertContent({
          type: 'mwsTable',
          attrs: { dstId, title: name || '' },
        })
        .run();
    }
    setShowTableModal(false);
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
      if (aiMode === 'search') {
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
      } else {
        const text = extractText(content);
        contextForAi = `Файл: ${title}\nОписание: ${description || '-'}\nТекст файла:\n${text}`;
      }

      const res = await api.aiChat(aiPrompt, contextForAi);
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

  const removeLinkFromPopover = () => {
    if (!editorInstance) return;
    editorInstance.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkPopover(null);
  };

  const runToolbarAction = (action: string) => {
    if (!editorInstance) return;
    switch (action) {
      case 'undo':
        editorInstance.chain().focus().undo().run();
        break;
      case 'redo':
        editorInstance.chain().focus().redo().run();
        break;
      case 'bold':
        editorInstance.chain().focus().toggleBold().run();
        break;
      case 'italic':
        editorInstance.chain().focus().toggleItalic().run();
        break;
      case 'underline':
        editorInstance.chain().focus().toggleUnderline().run();
        break;
      case 'h1':
        editorInstance.chain().focus().toggleHeading({ level: 1 }).run();
        break;
      case 'h2':
        editorInstance.chain().focus().toggleHeading({ level: 2 }).run();
        break;
      case 'h3':
        editorInstance.chain().focus().toggleHeading({ level: 3 }).run();
        break;
      case 'bullet':
        editorInstance.chain().focus().toggleBulletList().run();
        break;
      case 'ordered':
        editorInstance.chain().focus().toggleOrderedList().run();
        break;
      case 'quote':
        editorInstance.chain().focus().toggleBlockquote().run();
        break;
      case 'code':
        editorInstance.chain().focus().toggleCodeBlock().run();
        break;
      case 'rule':
        editorInstance.chain().focus().setHorizontalRule().run();
        break;
      case 'link':
        openLinkPopover();
        break;
      default:
        break;
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

  if ((pageId || location.pathname === '/new') && authLoading) {
    return <div className="loading">Загрузка…</div>;
  }

  if (!authLoading && !user && (pageId || location.pathname === '/new')) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (loading) {
    return <div className="loading">Загрузка страницы...</div>;
  }

  if (pageId && user && !collab) {
    return <div className="loading">Подключение совместного редактора…</div>;
  }

  return (
    <div className="editor-shell">
      <div className="editor-toolbar-line">
        <div className="toolbar-group">
          <button className="toolbar-btn" title="undo" onClick={() => runToolbarAction('undo')}>
            ↶
          </button>
          <button className="toolbar-btn" title="redo" onClick={() => runToolbarAction('redo')}>
            ↷
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
            { id: 'bullet', label: '•' },
            { id: 'ordered', label: '1.' },
            { id: 'quote', label: '❝' },
            { id: 'code', label: '</>' },
            { id: 'rule', label: '—' },
            { id: 'link', label: '@' },
          ].map((item) => (
            <button key={item.id} className="toolbar-btn" onClick={() => runToolbarAction(item.id)}>
              {item.label}
            </button>
          ))}
          <button className="toolbar-btn" onClick={openTablePicker} title="Таблица MWS">
            MWS
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
          <div className="page-editor-container">
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
            <Editor
              key={pageId ? `${pageId}-${collab ? 'y' : 'n'}` : 'draft'}
              content={content}
              onUpdate={setContent}
              onSave={saveNow}
              onInsertMwsTable={openTablePicker}
              onInsertAiBlock={insertAiBlock}
              onEditorReady={setEditorInstance}
              onRequestLinkEdit={openLinkPopover}
              collab={pageId ? collab : null}
              collabUser={collabUserInfo}
              currentSpaceId={spaceId ?? null}
            />

            {pageId && <Backlinks pageId={pageId} currentSpaceId={spaceId ?? null} />}
          </div>
        </section>

      </div>

      {/* ── Floating: Комментарии (карточки) ── */}
      {pageId && (
        <FloatingComments
          pageId={pageId}
          currentUserId={user?.id}
          visible={showComments}
          onClose={() => setShowComments(false)}
        />
      )}

      {/* ── Floating: Машина времени ── */}
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
        <div className="modal-overlay" onClick={() => setShowTableModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Выберите таблицу MWS</h3>
            <ul className="modal-list">
              {spaceNodes.map((node) => (
                <li
                  key={node.id || node.nodeId}
                  className="modal-list-item"
                  onClick={() => selectTable(node)}
                >
                  <span>{node.name || node.title || node.id}</span>
                </li>
              ))}
              {spaceNodes.length === 0 && <li className="modal-list-item">Нет доступных таблиц</li>}
            </ul>
            <button className="modal-close" onClick={() => setShowTableModal(false)}>
              Закрыть
            </button>
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

      {showAiPanel && (
        <div className="ai-floating-panel">
          <div className="ai-floating-header">
            <span>AI-помощник</span>
            <button className="ai-floating-close" onClick={() => setShowAiPanel(false)}>×</button>
          </div>
          <div className="ai-floating-body">
            {/* Переключатель режима */}
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
            <div className="ai-block-actions">
              {aiLoading ? (
                <span className="ai-loading-text">Генерация...</span>
              ) : (
                <button className="btn btn-primary" onClick={runAi}>
                  {aiMode === 'search' ? 'Найти' : 'Выполнить'}
                </button>
              )}
            </div>
            {/* Результат поиска по всем документам */}
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

function countWords(content: JSONContent): number {
  const plain = extractText(content).trim();
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}
