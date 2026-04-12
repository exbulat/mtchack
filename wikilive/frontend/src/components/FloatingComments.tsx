import { useCallback, useEffect, useRef, useState } from 'react';
import { api, PageComment } from '../lib/api';

interface FloatingCommentCardProps {
  comment: PageComment;
  initialX: number;
  initialY: number;
  onUpdate: (updated: PageComment) => void;
  onDelete: (id: string) => void;
  currentUserId?: string;
}

function FloatingCommentCard({
  comment,
  initialX,
  initialY,
  onUpdate,
  onDelete,
  currentUserId,
}: FloatingCommentCardProps) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.text);
  const [minimized, setMinimized] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, textarea, input')) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
  }, [pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPos({
        x: Math.max(0, dragRef.current.origX + dx),
        y: Math.max(0, dragRef.current.origY + dy),
      });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const saveEdit = async () => {
    const text = editText.trim();
    if (!text) return;
    const updated = await api.updateComment(comment.id, { text });
    onUpdate(updated);
    setEditing(false);
  };

  const toggleResolved = async () => {
    const updated = await api.updateComment(comment.id, { resolved: !comment.resolved });
    onUpdate(updated);
  };

  const initials = (comment.authorName || '?')[0]?.toUpperCase() ?? '?';
  const isOwn = currentUserId === comment.authorId;

  return (
    <div
      ref={cardRef}
      className={`floating-comment${comment.resolved ? ' floating-comment--resolved' : ''}${minimized ? ' floating-comment--minimized' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={onMouseDown}
    >
      <div className="floating-comment-header">
        <div className="floating-comment-user">
          <span
            className="floating-comment-avatar"
            style={{ background: stringToColor(comment.authorName || 'default') }}
          >
            {initials}
          </span>
          <div className="floating-comment-meta">
            <span className="floating-comment-author">{comment.authorName || 'Аноним'}</span>
            <span className="floating-comment-time">
              {new Date(comment.createdAt).toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </div>
        </div>
        <div className="floating-comment-controls">
          <button
            className={`floating-comment-btn${comment.resolved ? ' active' : ''}`}
            title={comment.resolved ? 'Открыть' : 'Закрыть'}
            onClick={toggleResolved}
          >
            {comment.resolved ? '↩' : '✓'}
          </button>
          <button
            className="floating-comment-btn"
            title={minimized ? 'Развернуть' : 'Свернуть'}
            onClick={() => setMinimized((v) => !v)}
          >
            {minimized ? '▲' : '▼'}
          </button>
          <button
            className="floating-comment-btn floating-comment-btn--close"
            title="Закрыть"
            onClick={() => onDelete(comment.id)}
          >
            ×
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="floating-comment-body">
          {editing ? (
            <>
              <textarea
                className="floating-comment-input"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEdit();
                  if (e.key === 'Escape') { setEditing(false); setEditText(comment.text); }
                }}
                autoFocus
              />
              <div className="floating-comment-actions">
                <button className="floating-comment-save" onClick={saveEdit}>Сохранить</button>
                <button className="floating-comment-cancel" onClick={() => { setEditing(false); setEditText(comment.text); }}>
                  Отмена
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="floating-comment-text">{comment.text}</div>
              {isOwn && (
                <div className="floating-comment-actions">
                  <button className="floating-comment-cancel" onClick={() => setEditing(true)}>
                    Редактировать
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface FloatingCommentsProps {
  pageId: string;
  currentUserId?: string;
  visible: boolean;
}

// Случайные начальные позиции с небольшим смещением, чтобы карточки не накладывались
function getInitialPos(index: number) {
  const baseX = window.innerWidth - 320;
  return {
    x: Math.max(100, baseX - (index % 3) * 20),
    y: 120 + index * 30,
  };
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

export default function FloatingComments({ pageId, currentUserId, visible }: FloatingCommentsProps) {
  const [comments, setComments] = useState<PageComment[]>([]);
  const [draft, setDraft] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [composerPos, setComposerPos] = useState({ x: window.innerWidth - 340, y: 80 });
  const composerDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    if (!visible) return;
    api.listComments(pageId)
      .then((data) => setComments(data))
      .catch(() => setComments([]));
  }, [pageId, visible]);

  const addComment = async () => {
    const text = draft.trim();
    if (!text) return;
    const created = await api.createComment(pageId, { text });
    setComments((prev) => [{ ...created }, ...prev]);
    setDraft('');
    setShowComposer(false);
  };

  const onComposerMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, textarea')) return;
    e.preventDefault();
    composerDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: composerPos.x,
      origY: composerPos.y,
    };
  }, [composerPos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!composerDragRef.current) return;
      const dx = e.clientX - composerDragRef.current.startX;
      const dy = e.clientY - composerDragRef.current.startY;
      setComposerPos({
        x: Math.max(0, composerDragRef.current.origX + dx),
        y: Math.max(0, composerDragRef.current.origY + dy),
      });
    };
    const onUp = () => { composerDragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const handleDelete = async (id: string) => {
    await api.deleteComment(id);
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  if (!visible) return null;

  return (
    <>
      {/* Кнопка добавить комментарий */}
      <button
        className="floating-comment-add-btn"
        title="Новый комментарий"
        onClick={() => setShowComposer((v) => !v)}
      >
        + Комментарий
      </button>

      {/* Форма нового комментария */}
      {showComposer && (
        <div
          className="floating-comment floating-comment--composer"
          style={{ left: composerPos.x, top: composerPos.y }}
          onMouseDown={onComposerMouseDown}
        >
          <div className="floating-comment-header">
            <span className="floating-comment-title">Новый комментарий</span>
            <button className="floating-comment-btn floating-comment-btn--close" onClick={() => setShowComposer(false)}>×</button>
          </div>
          <div className="floating-comment-body">
            <textarea
              className="floating-comment-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Введите комментарий..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addComment();
                if (e.key === 'Escape') setShowComposer(false);
              }}
              autoFocus
            />
            <div className="floating-comment-actions">
              <button className="floating-comment-save" onClick={addComment}>
                Добавить
              </button>
              <span className="floating-comment-hint">Ctrl+Enter</span>
            </div>
          </div>
        </div>
      )}

      {/* Карточки комментариев */}
      {comments.map((comment, index) => {
        const pos = getInitialPos(index);
        return (
          <FloatingCommentCard
            key={comment.id}
            comment={comment}
            initialX={pos.x}
            initialY={pos.y}
            onUpdate={(updated) =>
              setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
            }
            onDelete={handleDelete}
            currentUserId={currentUserId}
          />
        );
      })}
    </>
  );
}
