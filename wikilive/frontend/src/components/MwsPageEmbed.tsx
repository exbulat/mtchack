import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';

interface MwsPageEmbedProps {
  nodeId: string;
  title?: string;
  onRemove?: () => void;
}

function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function extractText(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => extractText(item, depth + 1))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'content', 'description', 'body', 'value', 'summary', 'props']) {
      const extracted = extractText(record[key], depth + 1);
      if (extracted) return extracted;
    }
  }
  return '';
}

function parseNodePayload(raw: unknown, fallbackTitle?: string): { title: string; body: string } {
  const root = pickObject(raw);
  const candidates = [
    pickObject(root.data),
    pickObject(pickObject(root.data).node),
    pickObject(root.node),
    root,
  ].filter((candidate) => Object.keys(candidate).length > 0);

  for (const node of candidates) {
    const title = String(node.name || node.title || node.nodeName || node.slug || '').trim();
    const body =
      extractText(node.description) ||
      extractText(node.content) ||
      extractText(node.body) ||
      extractText(node.text) ||
      extractText(node.summary) ||
      extractText(node.props);

    if (title || body) {
      return { title: title || fallbackTitle || 'MWS page', body };
    }
  }

  return { title: fallbackTitle || 'MWS page', body: '' };
}

function hasAccessLimitedFlag(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return Boolean((raw as Record<string, unknown>).accessLimited);
}

export default function MwsPageEmbed({ nodeId, title, onRemove }: MwsPageEmbedProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessLimited, setAccessLimited] = useState(false);
  const [pageTitle, setPageTitle] = useState(title || '');
  const [body, setBody] = useState('');
  const savedRef = useRef({ pageTitle: title || '', body: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getNode(nodeId);
      const limited = hasAccessLimitedFlag(response);
      const parsed = parseNodePayload(response, title);
      setAccessLimited(limited);
      setPageTitle(parsed.title);
      setBody(parsed.body);
      savedRef.current = { pageTitle: parsed.title, body: parsed.body };
    } catch (err) {
      setAccessLimited(false);
      setError(err instanceof Error ? err.message : 'Не удалось загрузить страницу MWS');
    } finally {
      setLoading(false);
    }
  }, [nodeId, title]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasChanges = useMemo(
    () => savedRef.current.pageTitle !== pageTitle || savedRef.current.body !== body,
    [pageTitle, body]
  );

  const save = useCallback(async () => {
    if (accessLimited) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateNode(nodeId, {
        name: pageTitle,
        title: pageTitle,
        description: body,
        content: body,
      });
      savedRef.current = { pageTitle, body };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить страницу MWS');
    } finally {
      setSaving(false);
    }
  }, [accessLimited, body, nodeId, pageTitle]);

  if (loading) {
    return <div className="table-embed table-embed--loading">Загрузка страницы MWS...</div>;
  }

  return (
    <section
      style={{
        border: '2px solid var(--border)',
        borderRadius: 14,
        background: 'linear-gradient(180deg, var(--bg) 0%, var(--surface) 100%)',
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
            MWS Page
          </div>
          <input
            value={pageTitle}
            onChange={(event) => setPageTitle(event.target.value)}
            onBlur={() => { if (hasChanges && !accessLimited) void save(); }}
            readOnly={accessLimited}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--text)',
              outline: 'none',
              width: '100%',
            }}
          />
        </div>
        <button className="table-embed-btn" onClick={() => void load()} disabled={loading || saving}>
          {saving ? '...' : '↻'}
        </button>
        {onRemove && (
          <button className="table-embed-btn" onClick={onRemove} disabled={loading || saving} title="Убрать интеграцию">
            ×
          </button>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        {accessLimited
          ? 'Эта страница доступна только для чтения: текущий API MWS не отдает полный контент узла, поэтому мы сохраняем связь и название страницы.'
          : 'Контент ниже синхронизируется с MWS и визуально отделен рамкой от основного текста WikiLive.'}
      </div>

      {body ? (
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onBlur={() => { if (hasChanges && !accessLimited) void save(); }}
          readOnly={accessLimited}
          placeholder="Текст страницы MWS"
          style={{
            width: '100%',
            minHeight: 180,
            resize: 'vertical',
            borderRadius: 12,
            border: '1px solid var(--border)',
            padding: 14,
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 14,
            lineHeight: 1.6,
            fontFamily: 'var(--font)',
            outline: 'none',
          }}
        />
      ) : (
        <div
          style={{
            minHeight: 120,
            borderRadius: 12,
            border: '1px dashed var(--border)',
            padding: 14,
            background: 'var(--bg)',
            color: 'var(--text-muted)',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          Контент страницы MWS не удалось извлечь в текстовом виде. Название и связь с MWS сохранены, страницу можно обновить или отредактировать вручную.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
        <span>
          {error
            ? error
            : accessLimited
              ? 'Контент недоступен по API MWS, открыт безопасный read-only режим'
              : saving
                ? 'Сохраняем...'
                : 'Синхронизация включена'}
        </span>
        {!accessLimited && (
          <button className="table-embed-btn" onClick={() => void save()} disabled={saving}>
            Сохранить
          </button>
        )}
      </div>
    </section>
  );
}
