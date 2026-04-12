import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, PageComment } from '../lib/api';

// ─── FloatingPanel ────────────────────────────────────────────────────────────

interface FloatingPanelProps {
  title: string;
  initialPos: { x: number; y: number };
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}

export function FloatingPanel({ title, initialPos, onClose, children, width = 340 }: FloatingPanelProps) {
  const [pos, setPos] = useState(initialPos);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const onHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: Math.max(0, dragRef.current.origX + ev.clientX - dragRef.current.startX),
        y: Math.max(0, dragRef.current.origY + ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width,
        maxHeight: '70vh',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg, 10px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header — drag handle */}
      <div
        onMouseDown={onHeaderMouseDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          cursor: 'grab',
          userSelect: 'none',
          background: 'var(--bg-secondary)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{title}</span>
        <button
          onClick={onClose}
          style={{
            width: 24, height: 24, borderRadius: 6,
            border: 'none', background: 'transparent',
            color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
          }}
          title="Закрыть"
        >
          ×
        </button>
      </div>
      {/* Content */}
      <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// Разбирает текст комментария на цитату и основной текст.
// Формат хранения: "@Имя: цитата\nтекст ответа"
function parseCommentText(raw: string): { quoteAuthor: string; quoteText: string; bodyText: string } | null {
  // Ищем паттерн: первая строка начинается с @Имя: ...
  const match = raw.match(/^@([^:]+):\s*([\s\S]*?)\n([\s\S]+)$/);
  if (!match) return null;
  return {
    quoteAuthor: match[1]!.trim(),
    quoteText: match[2]!.trim(),
    bodyText: match[3]!.trim(),
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

function formatCommentTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Один комментарий ────────────────────────────────────────────────────────

interface CommentItemProps {
  comment: PageComment;
  isOwn: boolean;
  onUpdate: (updated: PageComment) => void;
  onDelete: (id: string) => void;
  onReply: (comment: PageComment) => void;
}

function CommentItem({ comment, isOwn, onUpdate, onDelete, onReply }: CommentItemProps) {
  const parsed = parseCommentText(comment.text);
  // При редактировании показываем только bodyText (без цитаты)
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(parsed ? parsed.bodyText : comment.text);
  const [likes, setLikes] = useState(0);

  const saveEdit = async () => {
    const body = editText.trim();
    if (!body) return;
    // Сохраняем с цитатой, если она была
    const fullText = parsed
      ? `@${parsed.quoteAuthor}: ${parsed.quoteText}\n${body}`
      : body;
    try {
      const updated = await api.updateComment(comment.id, { text: fullText });
      onUpdate(updated);
      setEditing(false);
    } catch { /* ignore */ }
  };

  const startEdit = () => {
    // Восстанавливаем актуальный parsed при открытии редактора
    const current = parseCommentText(comment.text);
    setEditText(current ? current.bodyText : comment.text);
    setEditing(true);
  };

  const toggleResolved = async () => {
    try {
      const updated = await api.updateComment(comment.id, { resolved: !comment.resolved });
      onUpdate(updated);
    } catch { /* ignore */ }
  };

  const initials = (comment.authorName || '?')[0]?.toUpperCase() ?? '?';
  const avatarBg = stringToColor(comment.authorName || 'default');

  return (
    <div style={{
      padding: '12px 16px',
      borderBottom: '1px solid var(--border)',
      background: comment.resolved ? 'var(--accent-dim)' : 'transparent',
      transition: 'background 0.15s',
    }}>
      {/* Верхняя строка: аватар + имя + время */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: avatarBg,
          color: '#fff',
          fontWeight: 700, fontSize: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {comment.authorName || 'Аноним'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {formatCommentTime(comment.createdAt)}
            </span>
          </div>

          {/* Текст или форма редактирования */}
          {editing ? (
            <div style={{ marginTop: 6 }}>
              {/* Цитата остаётся видимой при редактировании */}
              {parsed && (
                <div style={{
                  marginBottom: 6, padding: '6px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--surface)',
                  fontSize: 12, color: 'var(--text-secondary)',
                  lineHeight: 1.45,
                }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>@{parsed.quoteAuthor}</span>
                  <br />
                  <span>{parsed.quoteText}</span>
                </div>
              )}
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEdit();
                  if (e.key === 'Escape') { setEditing(false); }
                }}
                autoFocus
                style={{
                  width: '100%', minHeight: 60, resize: 'vertical',
                  padding: '6px 8px', borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)', color: 'var(--text)',
                  fontSize: 13, fontFamily: 'var(--font)',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button onClick={saveEdit} style={{
                  padding: '4px 10px', borderRadius: 6, border: 'none',
                  background: 'var(--text)', color: 'var(--bg)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>
                  Сохранить
                </button>
                <button onClick={() => setEditing(false)} style={{
                  padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)',
                  fontSize: 12, cursor: 'pointer',
                }}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 4 }}>
              {/* Цитата — блок с рамкой, как на референсе */}
              {parsed && (
                <div style={{
                  marginBottom: 6, padding: '7px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--surface)',
                  fontSize: 12, color: 'var(--text-secondary)',
                  lineHeight: 1.45,
                }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>@{parsed.quoteAuthor}</span>
                  <br />
                  <span>{parsed.quoteText}</span>
                </div>
              )}
              {/* Основной текст */}
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, wordBreak: 'break-word' }}>
                {parsed ? parsed.bodyText : comment.text}
              </div>
            </div>
          )}

          {/* Действия */}
          {!editing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              {/* Лайк */}
              <button
                onClick={() => setLikes((n) => n + 1)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, color: 'var(--text-muted)', padding: 0,
                }}
                title="Нравится"
              >
                {likes > 0 && <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{likes}</span>}
                <span style={{ fontSize: 14 }}>👍</span>
              </button>

              {/* Ответить */}
              <button
                onClick={() => onReply(comment)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, color: 'var(--text-muted)', padding: 0,
                }}
                title="Ответить"
              >
                ↩ Ответить
              </button>

              {/* Закрыть/открыть (resolved) */}
              <button
                onClick={toggleResolved}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, color: comment.resolved ? 'var(--success, #4ade80)' : 'var(--text-muted)', padding: 0,
                }}
                title={comment.resolved ? 'Открыть снова' : 'Отметить решённым'}
              >
                {comment.resolved ? '✓ Решено' : '○ Закрыть'}
              </button>

              {/* Редактировать / Удалить — только свои */}
              {isOwn && (
                <>
                  <button
                    onClick={startEdit}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12, color: 'var(--text-muted)', padding: 0,
                    }}
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => onDelete(comment.id)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12, color: 'var(--danger, #f87171)', padding: 0,
                    }}
                    title="Удалить"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── FloatingComments — одна панель со всеми комментариями ───────────────────

interface FloatingCommentsProps {
  pageId: string;
  currentUserId?: string;
  visible: boolean;
  onClose?: () => void;
}

export default function FloatingComments({ pageId, currentUserId, visible, onClose }: FloatingCommentsProps) {
  const [comments, setComments] = useState<PageComment[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<PageComment | null>(null);
  const [pos, setPos] = useState({ x: Math.max(20, window.innerWidth - 400), y: 80 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!visible) return;
    api.listComments(pageId)
      .then((data) => setComments(data.slice().reverse())) // хронологический порядок
      .catch(() => setComments([]));
  }, [pageId, visible]);

  const addComment = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      // Для цитаты берём только bodyText (без вложенной цитаты), чтобы не было цепочек
      const replyBodyText = replyTo
        ? (parseCommentText(replyTo.text)?.bodyText ?? replyTo.text)
        : null;
      const replyQuote = replyBodyText
        ? `${replyBodyText.slice(0, 60)}${replyBodyText.length > 60 ? '…' : ''}`
        : null;
      const fullText = replyTo && replyQuote
        ? `@${replyTo.authorName}: ${replyQuote}\n${text}`
        : text;
      const created = await api.createComment(pageId, { text: fullText });
      setComments((prev) => [...prev, { ...created }]);
      setDraft('');
      setReplyTo(null);
      setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteComment(id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch { /* ignore */ }
  };

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: Math.max(0, dragRef.current.origX + ev.clientX - dragRef.current.startX),
        y: Math.max(0, dragRef.current.origY + ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos]);

  const handleReply = (comment: PageComment) => {
    setReplyTo(comment);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      left: pos.x,
      top: pos.y,
      width: 360,
      height: 520,
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* ── Header (drag) ── */}
      <div
        onMouseDown={onHeaderMouseDown}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          cursor: 'grab', userSelect: 'none',
          background: 'var(--bg-secondary)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
          Комментарии {comments.length > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>({comments.length})</span>}
        </span>
        <button
          onClick={onClose}
          style={{
            width: 26, height: 26, borderRadius: 6, border: 'none',
            background: 'transparent', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 18, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          ×
        </button>
      </div>

      {/* ── Список комментариев ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {comments.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: 'var(--text-muted)', fontSize: 13, padding: 24, textAlign: 'center',
          }}>
            Нет комментариев. Оставьте первый!
          </div>
        ) : (
          comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              isOwn={comment.authorId === currentUserId}
              onUpdate={(updated) => setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))}
              onDelete={handleDelete}
              onReply={handleReply}
            />
          ))
        )}
        <div ref={listEndRef} />
      </div>

      {/* ── Composer (reply preview + input) ── */}
      <div style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        flexShrink: 0,
        padding: '10px 14px 12px',
      }}>
        {/* Reply preview */}
        {replyTo && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            background: 'var(--surface)', borderRadius: 6, padding: '6px 10px',
            marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)',
            borderLeft: '3px solid var(--border-light)',
          }}>
            <div style={{ overflow: 'hidden' }}>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>@{replyTo.authorName}</span>
              <span style={{ marginLeft: 6 }}>{replyTo.text.slice(0, 50)}{replyTo.text.length > 50 ? '…' : ''}</span>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              style={{ flexShrink: 0, marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14 }}
            >
              ×
            </button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addComment();
              if (e.key === 'Escape') { setReplyTo(null); setDraft(''); }
            }}
            placeholder="Новый комментарий"
            rows={1}
            style={{
              flex: 1, resize: 'none', padding: '8px 10px',
              borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg)', color: 'var(--text)',
              fontSize: 13, fontFamily: 'var(--font)', outline: 'none',
              lineHeight: 1.5,
              minHeight: 36, maxHeight: 100, overflowY: 'auto',
            }}
            onInput={(e) => {
              // auto-grow
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 100) + 'px';
            }}
          />
          <button
            onClick={addComment}
            disabled={!draft.trim()}
            style={{
              width: 34, height: 34, borderRadius: 8, border: 'none',
              background: draft.trim() ? 'var(--text)' : 'var(--surface)',
              color: draft.trim() ? 'var(--bg)' : 'var(--text-muted)',
              cursor: draft.trim() ? 'pointer' : 'default',
              fontSize: 16, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}
            title="Отправить (Ctrl+Enter)"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}
