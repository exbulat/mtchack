import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';

interface MwsField {
  id?: string;
  fieldId?: string;
  name?: string;
  fieldName?: string;
  [key: string]: unknown;
}

interface MwsRecord {
  recordId?: string;
  id?: string;
  fields?: Record<string, unknown>;
  [key: string]: unknown;
}

interface TableEmbedProps {
  dstId: string;
  title?: string;
}

const PAGE_SIZE = 50;

/** MWS Fusion часто отдаёт не строку, а объект (rich text, select, ссылка и т.д.). */
function mwsCellDisplayValue(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) {
    return raw.map(mwsCellDisplayValue).filter((s) => s.length > 0).join(', ');
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.name === 'string') return o.name;
    if (typeof o.title === 'string') return o.title;
    if (o.cellValue !== undefined) return mwsCellDisplayValue(o.cellValue);
  }
  return '';
}

export default function TableEmbed({ dstId, title }: TableEmbedProps) {
  const [fields, setFields] = useState<MwsField[]>([]);
  const [records, setRecords] = useState<MwsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [deletingRows, setDeletingRows] = useState<Set<string>>(new Set());
  const [addingRow, setAddingRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
  const [showNewRow, setShowNewRow] = useState(false);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(
    async (currentPage = page) => {
      setLoading(true);
      setError(null);
      try {
        const [fieldsData, recordsData] = await Promise.all([
          api.getFields(dstId),
          api.getRecords(dstId, PAGE_SIZE * currentPage),
        ]);
        const rawFields = (fieldsData?.data?.fields || fieldsData?.fields || []) as MwsField[];
        const rawRecords = (recordsData?.data?.records || recordsData?.records || []) as MwsRecord[];
        setFields(rawFields);
        setRecords(rawRecords);
        setTotalRecords(rawRecords.length);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки');
        setFields([]);
        setRecords([]);
      } finally {
        setLoading(false);
      }
    },
    [dstId, page]
  );

  useEffect(() => {
    load(page);
  }, [dstId, page]);

  // Auto-refresh every 30 seconds to keep the table live
  useEffect(() => {
    refreshTimerRef.current = setInterval(() => load(page), 30_000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [load, page]);

  const normalizedFields = useMemo(
    () =>
      fields
        .map((f) => ({
          id: f.id || f.fieldId || f.name || '',
          name: f.name || f.fieldName || f.id || '',
        }))
        .filter((f) => f.id),
    [fields]
  );

  const filteredRecords = useMemo(() => {
    let result = records.slice(0, PAGE_SIZE * page);
    if (filterText.trim()) {
      const lower = filterText.toLowerCase();
      result = result.filter((r) =>
        Object.values(r.fields || {}).some((v) => mwsCellDisplayValue(v).toLowerCase().includes(lower)
        )
      );
    }
    if (sortField) {
      result = [...result].sort((a, b) => {
        const av = mwsCellDisplayValue((a.fields || {})[sortField]);
        const bv = mwsCellDisplayValue((b.fields || {})[sortField]);
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return result;
  }, [records, page, filterText, sortField, sortAsc]);

  const updateCell = async (recordId: string, fieldId: string, value: string) => {
    const cellKey = `${recordId}:${fieldId}`;
    setSavingCells((prev) => new Set(prev).add(cellKey));
    try {
      await api.updateRecords(dstId, {
        records: [{ recordId, fields: { [fieldId]: value } }],
      });
      setRecords((prev) =>
        prev.map((r) =>
          (r.recordId || r.id) === recordId
            ? { ...r, fields: { ...(r.fields || {}), [fieldId]: value } }
            : r
        )
      );
    } catch {
      // revert on error — refetch this page
      load(page);
    } finally {
      setSavingCells((prev) => {
        const next = new Set(prev);
        next.delete(cellKey);
        return next;
      });
    }
  };

  const deleteRow = async (recordId: string) => {
    setDeletingRows((prev) => new Set(prev).add(recordId));
    try {
      await api.deleteRecords(dstId, [recordId]);
      setRecords((prev) => prev.filter((r) => (r.recordId || r.id) !== recordId));
      setTotalRecords((n) => n - 1);
    } catch {
      /* ignore */
    } finally {
      setDeletingRows((prev) => {
        const next = new Set(prev);
        next.delete(recordId);
        return next;
      });
    }
  };

  const addRow = async () => {
    if (addingRow) return;
    setAddingRow(true);
    try {
      const created = await api.createRecords(dstId, {
        records: [{ fields: newRowValues }],
      });
      // API returns new records; refresh to get server-assigned ID
      await load(page);
      setNewRowValues({});
      setShowNewRow(false);
      void created;
    } catch {
      /* ignore */
    } finally {
      setAddingRow(false);
    }
  };

  const toggleSort = (fieldId: string) => {
    if (sortField === fieldId) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(fieldId);
      setSortAsc(true);
    }
  };

  const hasMore = records.length === PAGE_SIZE * page;

  if (loading && records.length === 0) {
    return (
      <div className="table-embed table-embed--loading">
        <span className="table-embed-spinner" />
        Загрузка таблицы…
      </div>
    );
  }

  return (
    <div className="table-embed">
      <div className="table-embed-header">
        <span className="table-embed-title">{title || `Таблица ${dstId}`}</span>
        <div className="table-embed-controls">
          <input
            className="table-embed-filter"
            type="text"
            placeholder="Фильтр…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
          <button
            className="table-embed-btn"
            onClick={() => load(page)}
            title="Обновить"
            disabled={loading}
          >
            {loading ? '⟳' : '↺'}
          </button>
          <button
            className="table-embed-btn table-embed-btn--add"
            onClick={() => setShowNewRow((v) => !v)}
            title="Добавить строку"
          >
            + Строка
          </button>
        </div>
      </div>

      {error && <div className="table-embed-error">{error}</div>}

      <div className="table-embed-scroll">
        <table>
          <thead>
            <tr>
              {normalizedFields.map((field) => (
                <th
                  key={field.id}
                  className="table-embed-th"
                  onClick={() => toggleSort(field.id)}
                  title="Сортировать"
                >
                  {field.name}
                  {sortField === field.id && (
                    <span className="table-embed-sort-icon">{sortAsc ? ' ↑' : ' ↓'}</span>
                  )}
                </th>
              ))}
              <th className="table-embed-th table-embed-th--actions" />
            </tr>
          </thead>
          <tbody>
            {showNewRow && (
              <tr className="table-embed-new-row">
                {normalizedFields.map((field) => (
                  <td key={field.id}>
                    <input
                      className="table-embed-cell-input"
                      value={newRowValues[field.id] ?? ''}
                      onChange={(e) =>
                        setNewRowValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                      }
                      placeholder={field.name}
                    />
                  </td>
                ))}
                <td className="table-embed-actions">
                  <button
                    className="table-embed-btn table-embed-btn--save"
                    onClick={addRow}
                    disabled={addingRow}
                    title="Сохранить"
                  >
                    {addingRow ? '…' : '✓'}
                  </button>
                  <button
                    className="table-embed-btn table-embed-btn--cancel"
                    onClick={() => { setShowNewRow(false); setNewRowValues({}); }}
                    title="Отмена"
                  >
                  </button>
                </td>
              </tr>
            )}

            {filteredRecords.map((record) => {
              const recordId = record.recordId || record.id || '';
              const rowFields = record.fields || {};
              if (!recordId) return null;
              const isDeleting = deletingRows.has(recordId);
              return (
                <tr key={recordId} className={isDeleting ? 'table-embed-row--deleting' : ''}>
                  {normalizedFields.map((field) => {
                    const cellKey = `${recordId}:${field.id}`;
                    const isSaving = savingCells.has(cellKey);
                    return (
                      <td key={cellKey} className={isSaving ? 'table-embed-cell--saving' : ''}>
                        <input
                          key={`${cellKey}:${mwsCellDisplayValue(rowFields[field.id])}`}
                          className="table-embed-cell-input"
                          defaultValue={mwsCellDisplayValue(rowFields[field.id])}
                          onBlur={(e) => updateCell(recordId, field.id, e.target.value)}
                          disabled={isDeleting}
                        />
                      </td>
                    );
                  })}
                  <td className="table-embed-actions">
                    <button
                      className="table-embed-btn table-embed-btn--delete"
                      onClick={() => deleteRow(recordId)}
                      disabled={isDeleting}
                      title="Удалить строку"
                    >
                      {isDeleting ? '…' : '✕'}
                    </button>
                  </td>
                </tr>
              );
            })}

            {filteredRecords.length === 0 && !showNewRow && (
              <tr>
                <td colSpan={normalizedFields.length + 1} className="table-embed-empty">
                  {filterText ? 'Ничего не найдено' : 'Нет данных'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="table-embed-footer">
        <span className="table-embed-count">
          Показано: {filteredRecords.length}
          {filterText ? ` (из ${records.length})` : ''}
          {totalRecords > 0 ? ` / всего ≥ ${totalRecords}` : ''}
        </span>
        {hasMore && (
          <button
            className="table-embed-btn"
            onClick={() => setPage((p) => p + 1)}
            disabled={loading}
          >
            Загрузить ещё
          </button>
        )}
      </div>
    </div>
  );
}
