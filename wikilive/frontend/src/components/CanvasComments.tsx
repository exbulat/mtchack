import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import {
  api,
  emitPageCommentEvent,
  subscribePageCommentEvents,
  type PageCommentEventDetail,
  type PageComment,
} from '../lib/api';

interface CanvasCommentsProps {
  pageId: string;
  currentUserId?: string;
  surfaceRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  focusCommentId?: string | null;
  onFocusHandled?: () => void;
}

interface CanvasComment extends PageComment {
  x: number;
  y: number;
}

interface DraftComment {
  x: number;
  y: number;
  text: string;
}

interface CanvasThread {
  blockId: string;
  x: number;
  y: number;
  comments: CanvasComment[];
}

const CANVAS_PREFIX = 'canvas';

function parseCanvasComment(comment: PageComment): CanvasComment | null {
  const match = comment.blockId.match(/^canvas_(\d{1,4})_(\d{1,4})$/);
  if (!match) return null;
  return {
    ...comment,
    x: Number(match[1]),
    y: Number(match[2]),
  };
}

function buildCanvasBlockId(x: number, y: number): string {
  return `${CANVAS_PREFIX}_${Math.round(x)}_${Math.round(y)}`;
}

function isConflictingTarget(target: HTMLElement | null): boolean {
  if (!target) return true;

  const hardConflictSelector = [
    'input',
    'textarea',
    'button',
    'a',
    'table',
    'th',
    'td',
    'img',
    'pre',
    'code',
    '.mws-table-node-view',
    '.table-embed',
    '.selection-bubble',
    '.slash-menu',
    '.modal',
    '.backlinks',
    '.canvas-comment-marker',
    '.canvas-comment-card',
    '.canvas-comment-thread',
    '.canvas-comment-composer',
  ].join(', ');

  if (target.closest(hardConflictSelector)) {
    return true;
  }

  const textContentSelector = [
    '.page-title-input',
    '.doc-description',
    '.tiptap p',
    '.tiptap h1',
    '.tiptap h2',
    '.tiptap h3',
    '.tiptap li',
    '.tiptap blockquote',
    '.tiptap pre',
    '.tiptap code',
    '.tiptap hr',
    '.tiptap a',
    '.tiptap img',
    '.tiptap ul',
    '.tiptap ol',
    '.tiptap table',
  ].join(', ');

  return Boolean(target.closest(textContentSelector));
}

function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return 'только что';
  if (diffMinutes < 60) return `${diffMinutes} мин назад`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} ч назад`;
  return new Date(dateStr).toLocaleDateString('ru-RU');
}

function sortCommentsAsc<T extends PageComment>(comments: T[]): T[] {
  return [...comments].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

function applyCommentEvent(current: PageComment[], detail: PageCommentEventDetail): PageComment[] {
  if (detail.type === 'created') {
    if (current.some((comment) => comment.id === detail.comment.id)) {
      return current;
    }
    return [...current, detail.comment];
  }

  if (detail.type === 'updated') {
    return current.map((comment) => (comment.id === detail.comment.id ? detail.comment : comment));
  }

  return current.filter((comment) => comment.id !== detail.commentId);
}

export default function CanvasComments({
  pageId,
  currentUserId,
  surfaceRef,
  enabled,
  focusCommentId,
  onFocusHandled,
}: CanvasCommentsProps) {
  const [comments, setComments] = useState<PageComment[]>([]);
  const [draft, setDraft] = useState<DraftComment | null>(null);
  const [threadDraft, setThreadDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [activeThreadBlockId, setActiveThreadBlockId] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    try {
      const next = await api.listComments(pageId);
      setComments(next);
    } catch {
      setComments([]);
    }
  }, [pageId]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  useEffect(() => {
    return subscribePageCommentEvents((detail) => {
      if (detail.type !== 'deleted' && detail.comment.pageId !== pageId) return;
      if (detail.type === 'deleted' && detail.pageId !== pageId) return;
      setComments((prev) => applyCommentEvent(prev, detail));
    });
  }, [pageId]);

  const canvasThreads = useMemo(() => {
    const grouped = new Map<string, CanvasComment[]>();

    for (const comment of comments) {
      const canvasComment = parseCanvasComment(comment);
      if (!canvasComment) continue;
      const bucket = grouped.get(canvasComment.blockId) || [];
      bucket.push(canvasComment);
      grouped.set(canvasComment.blockId, bucket);
    }

    return Array.from(grouped.entries())
      .map(([blockId, group]) => {
        const ordered = sortCommentsAsc(group);
        const anchor = ordered[0];
        return anchor
          ? {
              blockId,
              x: anchor.x,
              y: anchor.y,
              comments: ordered,
            }
          : null;
      })
      .filter((thread): thread is CanvasThread => thread !== null);
  }, [comments]);

  const activeThread = useMemo(
    () => canvasThreads.find((thread) => thread.blockId === activeThreadBlockId) || null,
    [activeThreadBlockId, canvasThreads],
  );

  useEffect(() => {
    if (!activeThreadBlockId) return;
    if (canvasThreads.some((thread) => thread.blockId === activeThreadBlockId)) return;
    setActiveThreadBlockId(null);
    setThreadDraft('');
  }, [activeThreadBlockId, canvasThreads]);

  useEffect(() => {
    if (!focusCommentId) return;
    const target = comments.find((comment) => comment.id === focusCommentId);
    const canvasComment = target ? parseCanvasComment(target) : null;
    if (!canvasComment) {
      onFocusHandled?.();
      return;
    }

    const surface = surfaceRef.current;
    if (surface) {
      surface.scrollIntoView({ block: 'nearest' });
      const docColumn = surface.closest('.doc-column');
      if (docColumn instanceof HTMLElement) {
        const nextLeft = Math.max(0, canvasComment.x - docColumn.clientWidth / 2);
        const nextTop = Math.max(0, canvasComment.y - docColumn.clientHeight / 2);
        docColumn.scrollTo({ left: nextLeft, top: nextTop, behavior: 'smooth' });
      }
    }

    setActiveThreadBlockId(canvasComment.blockId);
    setHoveredBlockId(canvasComment.blockId);
    onFocusHandled?.();
  }, [comments, focusCommentId, onFocusHandled, surfaceRef]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const handleContextMenu = (event: MouseEvent) => {
      if (!enabled) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (isConflictingTarget(target)) return;

      const rect = surface.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;

      event.preventDefault();
      setDraft({ x, y, text: '' });
      setHoveredBlockId(null);
      setActiveThreadBlockId(null);
      setThreadDraft('');
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target?.closest(
          '.canvas-comment-composer, .canvas-comment-marker, .canvas-comment-card, .canvas-comment-thread',
        )
      ) {
        return;
      }
      setDraft(null);
      setActiveThreadBlockId(null);
      setThreadDraft('');
    };

    surface.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      surface.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [enabled, surfaceRef]);

  const submitDraft = useCallback(async () => {
    if (!draft || !draft.text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const created = await api.createComment(pageId, {
        text: draft.text.trim(),
        blockId: buildCanvasBlockId(draft.x, draft.y),
      });
      emitPageCommentEvent({ type: 'created', comment: created });
      setDraft(null);
      setActiveThreadBlockId(created.blockId);
      setHoveredBlockId(created.blockId);
    } finally {
      setSubmitting(false);
    }
  }, [draft, pageId, submitting]);

  const submitThreadReply = useCallback(async () => {
    if (!activeThread || !threadDraft.trim() || submitting) return;
    setSubmitting(true);
    try {
      const created = await api.createComment(pageId, {
        text: threadDraft.trim(),
        blockId: activeThread.blockId,
      });
      emitPageCommentEvent({ type: 'created', comment: created });
      setThreadDraft('');
      setHoveredBlockId(activeThread.blockId);
    } finally {
      setSubmitting(false);
    }
  }, [activeThread, pageId, submitting, threadDraft]);

  return (
    <div className="canvas-comments-layer" aria-hidden="true">
      {canvasThreads.map((thread) => {
        const rootComment = thread.comments[0];
        if (!rootComment) {
          return null;
        }
        const repliesCount = Math.max(0, thread.comments.length - 1);
        const isOwn = rootComment.authorId === currentUserId;
        const showPreview = hoveredBlockId === thread.blockId && activeThreadBlockId !== thread.blockId;
        const showThread = activeThreadBlockId === thread.blockId;

        return (
          <div
            key={thread.blockId}
            className="canvas-comment-item"
            style={{ left: thread.x, top: thread.y, zIndex: showThread ? 30 : 20 }}
            onMouseEnter={() => setHoveredBlockId(thread.blockId)}
            onMouseLeave={() =>
              setHoveredBlockId((prev) => (prev === thread.blockId && activeThreadBlockId !== thread.blockId ? null : prev))
            }
          >
            <button
              type="button"
              className={`canvas-comment-marker${isOwn ? ' is-own' : ''}${showThread ? ' is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setDraft(null);
                setThreadDraft('');
                setActiveThreadBlockId((prev) => (prev === thread.blockId ? null : thread.blockId));
                setHoveredBlockId(thread.blockId);
              }}
              title="Комментарий"
            >
              <span className="canvas-comment-marker-dot" />
              {thread.comments.length > 1 && (
                <span className="canvas-comment-marker-count">{thread.comments.length}</span>
              )}
            </button>

            {showPreview && (
              <div
                className="canvas-comment-card"
                onClick={() => {
                  setActiveThreadBlockId(thread.blockId);
                  setThreadDraft('');
                }}
              >
                <div className="canvas-comment-card-header">
                  <div className="canvas-comment-avatar">
                    {(rootComment.authorName || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="canvas-comment-meta">
                    <strong>{rootComment.authorName || 'Аноним'}</strong>
                    <span>{formatRelativeTime(rootComment.createdAt)}</span>
                  </div>
                </div>
                <div className="canvas-comment-card-text">{rootComment.text}</div>
                {repliesCount > 0 && (
                  <div className="canvas-comment-card-replies">
                    {repliesCount} {repliesCount === 1 ? 'ответ' : repliesCount < 5 ? 'ответа' : 'ответов'}
                  </div>
                )}
              </div>
            )}

            {showThread && (
              <div className="canvas-comment-thread">
                <div className="canvas-comment-thread-header">
                  <strong>Комментарий</strong>
                  <button
                    type="button"
                    className="canvas-comment-thread-close"
                    onClick={() => {
                      setActiveThreadBlockId(null);
                      setThreadDraft('');
                    }}
                  >
                    ×
                  </button>
                </div>

                <div className="canvas-comment-thread-list">
                  {thread.comments.map((comment) => (
                    <div key={comment.id} className="canvas-comment-thread-item">
                      <div className="canvas-comment-avatar canvas-comment-avatar--thread">
                        {(comment.authorName || '?').slice(0, 1).toUpperCase()}
                      </div>
                      <div className="canvas-comment-thread-body">
                        <div className="canvas-comment-thread-meta">
                          <strong>{comment.authorName || 'Аноним'}</strong>
                          <span>{formatRelativeTime(comment.createdAt)}</span>
                        </div>
                        <div className="canvas-comment-thread-text">{comment.text}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="canvas-comment-thread-reply">
                  <input
                    type="text"
                    value={threadDraft}
                    onChange={(event) => setThreadDraft(event.target.value)}
                    placeholder="Ответить"
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                        event.preventDefault();
                        void submitThreadReply();
                      }
                      if (event.key === 'Escape') {
                        setActiveThreadBlockId(null);
                        setThreadDraft('');
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="canvas-comment-thread-send"
                    disabled={!threadDraft.trim() || submitting}
                    onClick={() => void submitThreadReply()}
                  >
                    ↑
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {draft && (
        <div className="canvas-comment-composer" style={{ left: draft.x, top: draft.y }}>
          <div className="canvas-comment-composer-pin">
            <span className="canvas-comment-marker-dot" />
          </div>
          <textarea
            value={draft.text}
            onChange={(event) => setDraft((prev) => (prev ? { ...prev, text: event.target.value } : prev))}
            placeholder="Оставьте комментарий"
            autoFocus
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                void submitDraft();
              }
              if (event.key === 'Escape') {
                setDraft(null);
              }
            }}
          />
          <div className="canvas-comment-composer-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!draft.text.trim() || submitting}
              onClick={() => void submitDraft()}
            >
              {submitting ? '...' : 'Сохранить'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)} disabled={submitting}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
