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
  viewId?: string;
  viewName?: string;
}

const PAGE_SIZE = 50;
const LIVE_POLL_INTERVAL_MS = 10_000;
const EDITABLE_FIELD_TYPE_HINTS = new Set([
  'text',
  'singletext',
  'single_text',
  'string',
  'number',
  'integer',
  'float',
  'checkbox',
  'bool',
  'boolean',
  'email',
  'url',
  'phone',
  'date',
  'datetime',
  'currency',
  'percent',
]);
const READONLY_FIELD_TYPE_HINTS = new Set([
  'attachment',
  'formula',
  'lookup',
  'rollup',
  'relation',
  'link',
  'linkedrecord',
  'linked_record',
  'member',
  'user',
  'select',
  'multiselect',
  'multi_select',
  'rating',
  'createdtime',
  'created_time',
  'updatedtime',
  'updated_time',
]);

function formatSyncTime(timestamp: number | null): string {
  if (!timestamp) return 'ещё не синхронизировано';
  return new Date(timestamp).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

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

function normalizeFieldId(field: MwsField): string {
  return String(field.id || field.fieldId || field.name || '');
}

function normalizeFieldName(field: MwsField): string {
  return String(field.name || field.fieldName || field.id || '');
}

function getFieldTypeHint(field: MwsField): string | null {
  const directType = field.type ?? field.fieldType;
  if (typeof directType === 'string' && directType.trim()) {
    return directType.trim().toLowerCase().replace(/[\s-]+/g, '_');
  }

  const property = field.property;
  if (property && typeof property === 'object') {
    const typeFromProperty = (property as Record<string, unknown>).type;
    if (typeof typeFromProperty === 'string' && typeFromProperty.trim()) {
      return typeFromProperty.trim().toLowerCase().replace(/[\s-]+/g, '_');
    }
  }

  return null;
}

function isSimpleCellValue(raw: unknown): boolean {
  return raw == null || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean';
}

function canEditField(field: MwsField, records: MwsRecord[]): boolean {
  const typeHint = getFieldTypeHint(field);
  if (typeHint) {
    if (READONLY_FIELD_TYPE_HINTS.has(typeHint)) return false;
    if (EDITABLE_FIELD_TYPE_HINTS.has(typeHint)) return true;
  }

  const fieldId = normalizeFieldId(field);
  const sampleValue = records
    .map((record) => (record.fields || {})[fieldId])
    .find((value) => value !== undefined);

  if (sampleValue === undefined) {
    return true;
  }

  return isSimpleCellValue(sampleValue);
}

export default function TableEmbed({ dstId, title, viewId, viewName }: TableEmbedProps) {
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
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(
    async (currentPage = page) => {
      setLoading(true);
      setError(null);
      try {
        const [fieldsData, recordsData] = await Promise.all([
          api.getFields(dstId, viewId),
          api.getRecords(dstId, PAGE_SIZE * currentPage, viewId),
        ]);
        const rawFields = (fieldsData?.data?.fields || fieldsData?.fields || []) as MwsField[];
        const rawRecords = (recordsData?.data?.records || recordsData?.records || []) as MwsRecord[];
        setFields(rawFields);
        setRecords(rawRecords);
        setTotalRecords(rawRecords.length);
        setLastLoadedAt(Date.now());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки');
        setFields([]);
        setRecords([]);
      } finally {
        setLoading(false);
      }
    },
    [dstId, page, viewId]
  );

  useEffect(() => {
    setPage(1);
  }, [dstId, viewId]);

  useEffect(() => {
    load(page);
  }, [dstId, page, load, viewId]);

  useEffect(() => {
    refreshTimerRef.current = setInterval(() => load(page), LIVE_POLL_INTERVAL_MS);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [load, page]);

  useEffect(() => {
    const syncNow = () => {
      void load(page);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncNow();
      }
    };

    window.addEventListener('focus', syncNow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', syncNow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [load, page]);

  const normalizedFields = useMemo(
    () =>
      fields
        .map((f) => ({
          id: normalizeFieldId(f),
          name: normalizeFieldName(f),
          editable: canEditField(f, records),
          typeHint: getFieldTypeHint(f),
        }))
        .filter((f) => f.id),
    [fields, records]
  );

  const filteredRecords = useMemo(() => {
    let result = records.slice(0, PAGE_SIZE * page);
    if (filterText.trim()) {
      const lower = filterText.toLowerCase();
      result = result.filter((r) =>
        Object.values(r.fields || {}).some((v) => mwsCellDisplayValue(v).toLowerCase().includes(lower))
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
    const targetField = normalizedFields.find((field) => field.id === fieldId);
    if (!targetField?.editable) return;

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
      setLastLoadedAt(Date.now());
    } catch {
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
      setLastLoadedAt(Date.now());
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
    const editableFieldIds = new Set(
      normalizedFields.filter((field) => field.editable).map((field) => field.id)
    );
    const nextRecordFields = Object.fromEntries(
      Object.entries(newRowValues).filter(([fieldId]) => editableFieldIds.has(fieldId))
    );
    if (Object.keys(nextRecordFields).length === 0) return;

    setAddingRow(true);
    try {
      await api.createRecords(dstId, {
        records: [{ fields: nextRecordFields }],
      });
      await load(page);
      setNewRowValues({});
      setShowNewRow(false);
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
  const hasEditableFields = normalizedFields.some((field) => field.editable);
  const hasReadonlyFields = normalizedFields.some((field) => !field.editable);

  if (loading && records.length === 0) {
    return (
      <div className="table-embed table-embed--loading">
        <span className="table-embed-spinner" />
        Загрузка таблицы...
      </div>
    );
  }

  return (
    <div className="table-embed">
      <div className="table-embed-header">
        <div className="table-embed-title-group">
          <span className="table-embed-title">{title || `Таблица ${dstId}`}</span>
          {viewName ? <span className="table-embed-view">Вид: {viewName}</span> : null}
          <span className="table-embed-sync">
            <span className={`table-embed-sync-dot${error ? ' table-embed-sync-dot--error' : ''}`} />
            {error ? 'Синхронизация остановлена' : `Живая синхронизация · ${formatSyncTime(lastLoadedAt)}`}
          </span>
        </div>
        <div className="table-embed-controls">
          <input
            className="table-embed-filter"
            type="text"
            placeholder="Фильтр..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
          <button
            className="table-embed-btn"
            onClick={() => load(page)}
            title="Обновить"
            disabled={loading}
          >
            {loading ? '...' : '↻'}
          </button>
          <button
            className="table-embed-btn table-embed-btn--add"
            onClick={() => setShowNewRow((v) => !v)}
            title="Добавить строку"
            disabled={!hasEditableFields}
          >
            + Строка
          </button>
        </div>
      </div>

      {error && (
        <div className="table-embed-error">
          <div className="table-embed-error-copy">
            <strong>Не удалось обновить таблицу.</strong>
            <span>{error}</span>
          </div>
          <button className="table-embed-btn" onClick={() => load(page)} disabled={loading}>
            Повторить
          </button>
        </div>
      )}

      {hasReadonlyFields && (
        <div className="table-embed-info">
          Часть колонок доступна только для просмотра: inline-редактирование включено для простых типов полей.
        </div>
      )}

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
                    {field.editable ? (
                      <input
                        className="table-embed-cell-input"
                        value={newRowValues[field.id] ?? ''}
                        onChange={(e) =>
                          setNewRowValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                        }
                        placeholder={field.name}
                      />
                    ) : (
                      <span
                        className="table-embed-cell-readonly"
                        title={field.typeHint ? `Поле ${field.typeHint}` : 'Поле только для просмотра'}
                      >
                        Недоступно
                      </span>
                    )}
                  </td>
                ))}
                <td className="table-embed-actions">
                  <button
                    className="table-embed-btn table-embed-btn--save"
                    onClick={addRow}
                    disabled={addingRow}
                    title="Сохранить"
                  >
                    {addingRow ? '...' : '✓'}
                  </button>
                  <button
                    className="table-embed-btn table-embed-btn--cancel"
                    onClick={() => {
                      setShowNewRow(false);
                      setNewRowValues({});
                    }}
                    title="Отмена"
                  >
                    ×
                  </button>
                </td>
              </tr>
            )}

            {!showNewRow && hasEditableFields && (
              <tr className="table-embed-add-row">
                <td colSpan={normalizedFields.length + 1}>
                  <button
                    type="button"
                    className="table-embed-add-row-btn"
                    onClick={() => setShowNewRow(true)}
                  >
                    + Добавить строку
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
                        {field.editable ? (
                          <input
                            key={`${cellKey}:${mwsCellDisplayValue(rowFields[field.id])}`}
                            className="table-embed-cell-input"
                            defaultValue={mwsCellDisplayValue(rowFields[field.id])}
                            onBlur={(e) => updateCell(recordId, field.id, e.target.value)}
                            disabled={isDeleting}
                          />
                        ) : (
                          <span
                            className="table-embed-cell-readonly"
                            title={field.typeHint ? `Поле ${field.typeHint}` : 'Поле только для просмотра'}
                          >
                            {mwsCellDisplayValue(rowFields[field.id]) || '—'}
                          </span>
                        )}
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
                      {isDeleting ? '...' : '✕'}
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
