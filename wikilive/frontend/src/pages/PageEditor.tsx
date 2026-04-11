import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Backlinks from '../components/Backlinks';
import Editor from '../components/Editor';
import SaveStatus from '../components/SaveStatus';
import { api, PageComment } from '../lib/api';
import { useAutosave } from '../hooks/useAutosave';
import { PagesListContext } from '../components/Sidebar';

export default function PageEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const pageId = id && id !== 'new' ? id : null;
  const [title, setTitle] = useState('Без названия');
  const [content, setContent] = useState<any>({ type: 'doc', content: [{ type: 'paragraph' }] });
  const [loading, setLoading] = useState(true);
  const [showTableModal, setShowTableModal] = useState(false);
  const [spaceNodes, setSpaceNodes] = useState<any[]>([]);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [description, setDescription] = useState('');
  const [rightMode, setRightMode] = useState<'comments' | 'timeline' | 'info' | null>('timeline');
  const [revisions, setRevisions] = useState<any[]>([]);
  const [comments, setComments] = useState<PageComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editorInstance, setEditorInstance] = useState<any | null>(null);
  const [pageMeta, setPageMeta] = useState<{ createdAt?: string; updatedAt?: string }>({});
  const [linkPopover, setLinkPopover] = useState<{
    href: string;
    text: string;
    newTab: boolean;
  } | null>(null);

  const { bumpPagesList } = useContext(PagesListContext);
  const titleDebounceRef = useRef<number | null>(null);
  const skipTitleDebounceRef = useRef(true);

  const { isSaving, lastSavedAt, saveError, saveNow } = useAutosave({
    pageId,
    title,
    content,
  });

  useEffect(() => {
    skipTitleDebounceRef.current = true;
    let mounted = true;
    const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

    async function loadPage() {
      if (!pageId) {
        setLoading(false);
        return;
      }
      try {
        const page = await api.getPage(pageId);
        if (!mounted) return;

        let nextTitle = page.title || 'Без названия';
        let nextContent = page.content || emptyDoc;
        const localRaw = localStorage.getItem(`wikilive-page-${pageId}`);
        if (localRaw) {
          const localData = JSON.parse(localRaw);
          const serverTs = new Date(page.updatedAt).getTime();
          if ((localData.updatedAt || 0) > serverTs) {
            nextTitle = localData.title || nextTitle;
            nextContent = localData.content || nextContent;
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
      } catch {}
    }, 500);
    return () => {
      if (titleDebounceRef.current) window.clearTimeout(titleDebounceRef.current);
    };
  }, [pageId, title, bumpPagesList]);

  useEffect(() => {
    if (!pageId || rightMode !== 'timeline') {
      setRevisions([]);
      return;
    }
    let mounted = true;
    api
      .requestRevisions(pageId)
      .then((data: any) => {
        if (mounted && Array.isArray(data)) setRevisions(data);
      })
      .catch(() => {
        if (mounted) setRevisions([]);
      });
    return () => {
      mounted = false;
    };
  }, [pageId, rightMode]);

  useEffect(() => {
    if (!pageId || rightMode !== 'comments') {
      setComments([]);
      return;
    }
    let mounted = true;
    api
      .listComments(pageId)
      .then((data) => {
        if (mounted) setComments(data);
      })
      .catch(() => {
        if (mounted) setComments([]);
      });
    return () => {
      mounted = false;
    };
  }, [pageId, rightMode]);

  const onTitleBlur = async () => {
    if (!pageId) return;
    if (titleDebounceRef.current) window.clearTimeout(titleDebounceRef.current);
    try {
      await api.updatePage(pageId, { title });
      bumpPagesList();
    } catch {}
  };

  const ensurePageForBlocks = async () => {
    if (pageId) return pageId;
    const created = await api.createPage({ title, content });
    bumpPagesList();
    navigate(`/page/${created.id}`, { replace: true });
    return created.id;
  };

  const openTablePicker = async () => {
    try {
      await ensurePageForBlocks();
      const nodesData = await api.listTables();
      const nodes = nodesData?.data?.nodes || nodesData?.nodes || [];
      setSpaceNodes(nodes);
      setShowTableModal(true);
    } catch {
      setSpaceNodes([]);
      setShowTableModal(true);
    }
  };

  const selectTable = (node: any) => {
    const dstId = node?.id || node?.nodeId || node?.dstId;
    const name = node?.name || node?.title || dstId;
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
    try {
      const text = extractText(content);
      const scopedContext = `Файл: ${title}\nОписание: ${description || '-'}\nТекст файла:\n${text}`;
      const res = await api.aiChat(aiPrompt, scopedContext);
      if (!res.reply) return;
      if (editorInstance) {
        editorInstance.chain().focus().insertContent(res.reply).run();
      } else {
        setContent((prev: any) => ({
          ...prev,
          content: [
            ...(prev?.content || []),
            { type: 'paragraph', content: [{ type: 'text', text: res.reply }] },
          ],
        }));
      }
      setAiPrompt('');
    } catch {} finally {
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
          alert('Only HTTP, HTTPS, mailto, and FTP links are allowed');
          return;
        }
      } catch {
        if (!href.startsWith('/')) {
          console.warn('[Security] Invalid URL format:', href);
          alert('Please enter a valid URL');
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

  const addComment = async () => {
    const text = commentDraft.trim();
    if (!text) return;
    const targetPageId = await ensurePageForBlocks();
    const created = await api.createComment(targetPageId, { text, authorId: 'Вы' });
    setComments((prev) => [created, ...prev]);
    setCommentDraft('');
  };

  const startEditComment = (comment: PageComment) => {
    setEditingCommentId(comment.id);
    setEditingText(comment.text);
  };

  const saveEditComment = async () => {
    if (!editingCommentId) return;
    const text = editingText.trim();
    if (!text) return;
    const updated = await api.updateComment(editingCommentId, { text });
    setComments((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    setEditingCommentId(null);
    setEditingText('');
  };

  const removeComment = async (commentId: string) => {
    await api.deleteComment(commentId);
    setComments((prev) => prev.filter((item) => item.id !== commentId));
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

  if (loading) {
    return <div className="loading">Загрузка страницы...</div>;
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
            className={`toolbar-link${rightMode === 'comments' ? ' active' : ''}`}
            onClick={() => setRightMode((prev) => (prev === 'comments' ? null : 'comments'))}
          >
            Комментарии
          </button>
          <button
            className={`toolbar-link${rightMode === 'timeline' ? ' active' : ''}`}
            onClick={() => setRightMode((prev) => (prev === 'timeline' ? null : 'timeline'))}
          >
            Машина времени
          </button>
          <button
            className={`toolbar-link${rightMode === 'info' ? ' active' : ''}`}
            onClick={() => setRightMode((prev) => (prev === 'info' ? null : 'info'))}
          >
            Описание файла
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
            <SaveStatus isSaving={isSaving} lastSavedAt={lastSavedAt} error={saveError} />
            <Editor
              content={content}
              onUpdate={setContent}
              onSave={saveNow}
              onInsertMwsTable={openTablePicker}
              onInsertAiBlock={insertAiBlock}
              onEditorReady={setEditorInstance}
              onRequestLinkEdit={openLinkPopover}
            />

            {pageId && <Backlinks pageId={pageId} />}
          </div>
        </section>

        {rightMode && (
          <aside className="right-panel">
            <div className="right-panel-header">
              <h3>
                {rightMode === 'comments'
                  ? 'История комментариев'
                  : rightMode === 'timeline'
                    ? 'Машина времени'
                    : 'Описание файла'}
              </h3>
              <button className="toolbar-btn" onClick={() => setRightMode(null)}>
                ×
              </button>
            </div>
            {rightMode === 'comments' ? (
              <div className="comment-history">
                <div className="comment-composer">
                  <textarea
                    className="comment-input"
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    placeholder="оставить комментарий"
                  />
                  <button className="btn btn-primary" onClick={addComment}>
                    Добавить
                  </button>
                </div>
                {comments.map((comment) => (
                  <div key={comment.id} className="comment-card">
                    <div className="comment-topline">
                      <div className="comment-user">
                        <span className="comment-avatar">{(comment.authorId || 'В')[0]}</span>
                        <div>
                          <div className="comment-author">{comment.authorId || 'Вы'}</div>
                          <div className="comment-time">
                            {new Date(comment.createdAt).toLocaleString('ru-RU')}
                          </div>
                        </div>
                      </div>
                      <span className="comment-badge">{comment.resolved ? 'решено' : 'активно'}</span>
                    </div>
                    {editingCommentId === comment.id ? (
                      <div className="comment-editing">
                        <textarea
                          className="comment-input"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                        />
                        <div className="comment-actions-row">
                          <button className="comment-thread-link" onClick={saveEditComment}>
                            Сохранить
                          </button>
                          <button className="comment-thread-link" onClick={() => setEditingCommentId(null)}>
                            Отмена
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="comment-text">{comment.text}</div>
                        <div className="comment-actions-row">
                          <button className="comment-thread-link" onClick={() => startEditComment(comment)}>
                            Редактировать
                          </button>
                          <button className="comment-thread-link" onClick={() => removeComment(comment.id)}>
                            Удалить
                          </button>
                          <button
                            className="comment-thread-link"
                            onClick={async () => {
                              const updated = await api.updateComment(comment.id, {
                                resolved: !comment.resolved,
                              });
                              setComments((prev) =>
                                prev.map((item) => (item.id === updated.id ? updated : item))
                              );
                            }}
                          >
                            {comment.resolved ? 'Открыть' : 'Закрыть'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : rightMode === 'timeline' ? (
              <div className="timeline-list">
                {revisions.length === 0 && <div className="timeline-empty">Пока нет ревизий</div>}
                {revisions.map((rev) => (
                  <div key={rev.id} className="timeline-item">
                    <div className="timeline-title">Действие</div>
                    <div className="timeline-time">
                      {new Date(rev.createdAt).toLocaleString('ru-RU')}
                    </div>
                    <div className="timeline-actions">
                      <button className="comment-thread-link" onClick={() => restoreRevision(rev.id)}>
                        Перейти
                      </button>
                      <button className="comment-thread-link" onClick={() => removeRevision(rev.id)}>
                        Удалить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="timeline-list">
                <div className="timeline-item">
                  <div className="timeline-title">Файл</div>
                  <div className="timeline-time">{title || 'Без названия'}</div>
                </div>
                <div className="timeline-item">
                  <div className="timeline-title">Описание</div>
                  <div className="timeline-time">{description || 'пока пусто'}</div>
                </div>
                <div className="timeline-item">
                  <div className="timeline-title">Создан</div>
                  <div className="timeline-time">
                    {pageMeta.createdAt
                      ? new Date(pageMeta.createdAt).toLocaleString('ru-RU')
                      : '-'}
                  </div>
                </div>
                <div className="timeline-item">
                  <div className="timeline-title">Обновлен</div>
                  <div className="timeline-time">
                    {pageMeta.updatedAt
                      ? new Date(pageMeta.updatedAt).toLocaleString('ru-RU')
                      : '-'}
                  </div>
                </div>
                <div className="timeline-item">
                  <div className="timeline-title">Слов в заметке</div>
                  <div className="timeline-time">{countWords(content)}</div>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

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
            <textarea
              className="ai-block-input"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Введите промпт..."
              disabled={aiLoading}
            />
            <div className="ai-block-actions">
              {aiLoading ? (
                <span className="ai-loading-text">Генерация...</span>
              ) : (
                <button className="btn btn-primary" onClick={runAi}>
                  Выполнить
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function extractText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join(' ');
  if (node.text) return String(node.text);
  if (node.content) return extractText(node.content);
  return '';
}

function countWords(content: any): number {
  const plain = extractText(content).trim();
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}
