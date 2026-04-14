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
  viewType?: string;
}

type ViewMode = 'table' | 'calendar' | 'gallery' | 'kanban' | 'architecture' | 'gantt' | 'grid' | 'form';

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

function normalizeViewMode(viewType?: string, viewName?: string): ViewMode {
  const source = `${viewType || ''} ${viewName || ''}`.toLowerCase();
  if (source.includes('calendar') || source.includes('календар')) return 'calendar';
  if (source.includes('gallery') || source.includes('галере')) return 'gallery';
  if (source.includes('kanban') || source.includes('канбан')) return 'kanban';
  if (source.includes('architecture') || source.includes('архитектур')) return 'architecture';
  if (source.includes('gantt') || source.includes('РіР°РЅС‚')) return 'gantt';
  if (source.includes('grid') || source.includes('СЃРµС‚Рє')) return 'grid';
  if (source.includes('form') || source.includes('С„РѕСЂРј')) return 'form';
  return 'table';
}

function parseDateValue(raw: unknown): string | null {
  const value = mwsCellDisplayValue(raw).trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dotted = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotted) {
    return `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  }
  return null;
}

function formatShortDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function getMonthKey(value?: string | null): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7);
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(monthKey: string, delta: number): string {
  const [yearRaw, monthRaw] = monthKey.split('-');
  const next = new Date(Number(yearRaw), Number(monthRaw) - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

function getDaysInMonth(monthKey: string): number {
  const [yearRaw, monthRaw] = monthKey.split('-');
  return new Date(Number(yearRaw), Number(monthRaw), 0).getDate();
}

function formatMonthLabel(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split('-');
  return new Date(Number(yearRaw), Number(monthRaw) - 1, 1).toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  });
}

export default function TableEmbed({ dstId, title, viewId, viewName, viewType }: TableEmbedProps) {
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
  const [calendarMonth, setCalendarMonth] = useState(() => getMonthKey());
  const viewMode = useMemo(() => normalizeViewMode(viewType, viewName), [viewType, viewName]);

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
          raw: f,
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
  const primaryFieldId = normalizedFields[0]?.id || '';
  const dateFieldId = useMemo(
    () =>
      normalizedFields.find((field) =>
        (field.typeHint || '').includes('date') ||
        field.name.toLowerCase().includes('date') ||
        field.name.toLowerCase().includes('дата')
      )?.id || '',
    [normalizedFields]
  );
  const startDateFieldId = useMemo(
    () =>
      normalizedFields.find((field) => {
        const lowerName = field.name.toLowerCase();
        return (
          lowerName.includes('start') ||
          lowerName.includes('begin') ||
          lowerName.includes('from') ||
          lowerName.includes('РЅР°С‡Р°Р»')
        );
      })?.id || dateFieldId,
    [dateFieldId, normalizedFields]
  );
  const endDateFieldId = useMemo(
    () =>
      normalizedFields.find((field) => {
        const lowerName = field.name.toLowerCase();
        return (
          lowerName.includes('end') ||
          lowerName.includes('finish') ||
          lowerName.includes('due') ||
          lowerName.includes('РєРѕРЅРµС†')
        );
      })?.id || dateFieldId,
    [dateFieldId, normalizedFields]
  );
  const statusFieldId = useMemo(
    () =>
      normalizedFields.find((field) =>
        field.name.toLowerCase().includes('status') ||
        field.name.toLowerCase().includes('статус') ||
        field.name.toLowerCase().includes('этап') ||
        field.name.toLowerCase().includes('stage')
      )?.id || '',
    [normalizedFields]
  );
  const imageFieldId = useMemo(
    () =>
      normalizedFields.find((field) => {
        const lowerName = field.name.toLowerCase();
        return (
          lowerName.includes('image') ||
          lowerName.includes('photo') ||
          lowerName.includes('картин') ||
          lowerName.includes('изображ') ||
          lowerName.includes('cover') ||
          lowerName.includes('attachment')
        );
      })?.id || '',
    [normalizedFields]
  );

  const calendarEntries = useMemo(
    () =>
      filteredRecords
        .map((record) => {
          const recordId = record.recordId || record.id || '';
          const date = dateFieldId ? parseDateValue((record.fields || {})[dateFieldId]) : null;
          if (!recordId || !date) return null;
          return {
            id: recordId,
            title: mwsCellDisplayValue((record.fields || {})[primaryFieldId]) || `Запись ${recordId}`,
            date,
          };
        })
        .filter((entry): entry is { id: string; title: string; date: string } => Boolean(entry)),
    [dateFieldId, filteredRecords, primaryFieldId]
  );

  useEffect(() => {
    if (viewMode !== 'calendar') return;
    setCalendarMonth(getMonthKey(calendarEntries[0]?.date));
  }, [calendarEntries, dstId, viewId, viewMode]);

  if (loading && records.length === 0) {
    return (
      <div className="table-embed table-embed--loading">
        <span className="table-embed-spinner" />
        Загрузка таблицы...
      </div>
    );
  }

  const renderCalendarView = () => {
    if (!dateFieldId || calendarEntries.length === 0) {
      return <div className="table-embed-empty">Для календаря не найдено поле с датой.</div>;
    }

    const daysInMonth = getDaysInMonth(calendarMonth);
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <button className="table-embed-btn" onClick={() => setCalendarMonth((prev) => shiftMonth(prev, -1))}>Назад</button>
          <strong>{formatMonthLabel(calendarMonth)}</strong>
          <button className="table-embed-btn" onClick={() => setCalendarMonth((prev) => shiftMonth(prev, 1))}>Вперёд</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}>
          {Array.from({ length: daysInMonth }, (_, index) => {
            const day = index + 1;
            const date = `${calendarMonth}-${String(day).padStart(2, '0')}`;
            const dayEntries = calendarEntries.filter((entry) => entry.date === date);
            return (
              <div key={date} style={{ minHeight: 92, border: '1px solid var(--border)', borderRadius: 10, padding: 8, background: 'var(--bg)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{day}</div>
                {dayEntries.length > 0 ? dayEntries.map((entry) => (
                  <div key={entry.id} style={{ fontSize: 12, padding: '4px 6px', borderRadius: 6, background: 'var(--surface)', marginBottom: 4 }}>
                    {entry.title}
                  </div>
                )) : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderGalleryView = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
      {filteredRecords.map((record) => {
        const recordId = record.recordId || record.id || '';
        const titleValue = mwsCellDisplayValue((record.fields || {})[primaryFieldId]) || `Запись ${recordId}`;
        const imageValue = imageFieldId ? mwsCellDisplayValue((record.fields || {})[imageFieldId]) : '';
        const previewFields = normalizedFields.slice(0, 3);
        return (
          <article key={recordId} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg)' }}>
            <div style={{ height: 120, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {imageValue ? <img src={imageValue} alt={titleValue} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'var(--text-muted)' }}>Нет превью</span>}
            </div>
            <div style={{ padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{titleValue}</div>
              {previewFields.map((field) => (
                <div key={`${recordId}:${field.id}`} style={{ fontSize: 12, marginBottom: 4, color: 'var(--text-secondary)' }}>
                  {field.name}: {mwsCellDisplayValue((record.fields || {})[field.id]) || '—'}
                </div>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );

  const renderGridView = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
      {filteredRecords.map((record) => {
        const recordId = record.recordId || record.id || '';
        const titleValue = mwsCellDisplayValue((record.fields || {})[primaryFieldId]) || `Р—Р°РїРёСЃСЊ ${recordId}`;
        return (
          <article key={recordId} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--bg)' }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>{titleValue}</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {normalizedFields.slice(1, 5).map((field) => (
                <div key={`${recordId}:${field.id}`} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface)' }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
                    {field.name}
                  </div>
                  <div style={{ fontSize: 13 }}>{mwsCellDisplayValue((record.fields || {})[field.id]) || '—'}</div>
                </div>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );

  const renderKanbanView = () => {
    const grouped = new Map<string, MwsRecord[]>();
    for (const record of filteredRecords) {
      const key = statusFieldId ? (mwsCellDisplayValue((record.fields || {})[statusFieldId]) || 'Без статуса') : 'Записи';
      grouped.set(key, [...(grouped.get(key) || []), record]);
    }
    return (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(grouped.size, 1)}, minmax(220px, 1fr))`, gap: 12 }}>
        {Array.from(grouped.entries()).map(([group, items]) => (
          <section key={group} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--bg)' }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>{group}</div>
            {items.map((record) => {
              const recordId = record.recordId || record.id || '';
              const titleValue = mwsCellDisplayValue((record.fields || {})[primaryFieldId]) || `Запись ${recordId}`;
              return (
                <div key={recordId} style={{ padding: 10, borderRadius: 8, background: 'var(--surface)', marginBottom: 8 }}>
                  {titleValue}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    );
  };

  const renderArchitectureView = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
      {filteredRecords.map((record, index) => {
        const recordId = record.recordId || record.id || '';
        const titleValue = mwsCellDisplayValue((record.fields || {})[primaryFieldId]) || `Узел ${index + 1}`;
        return (
          <article key={recordId} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 14, background: 'var(--bg)' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Узел</div>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>{titleValue}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {normalizedFields.slice(0, 4).map((field) => (
                <span key={`${recordId}:${field.id}`} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, background: 'var(--surface)' }}>
                  {field.name}: {mwsCellDisplayValue((record.fields || {})[field.id]) || '—'}
                </span>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );

  const renderGanttView = () => {
    const ganttRecords = filteredRecords
      .map((record) => {
        const recordId = record.recordId || record.id || '';
        const startDate = startDateFieldId ? parseDateValue((record.fields || {})[startDateFieldId]) : null;
        const fallbackDate = dateFieldId ? parseDateValue((record.fields || {})[dateFieldId]) : null;
        const resolvedStartDate = startDate || fallbackDate;
        const resolvedEndDate = endDateFieldId
          ? parseDateValue((record.fields || {})[endDateFieldId]) || resolvedStartDate
          : resolvedStartDate;
        if (!recordId || !resolvedStartDate) return null;
        return {
          id: recordId,
          title: mwsCellDisplayValue((record.fields || {})[primaryFieldId]) || `Р—Р°РїРёСЃСЊ ${recordId}`,
          startDate: resolvedStartDate,
          endDate: resolvedEndDate || resolvedStartDate,
        };
      })
      .filter((item): item is { id: string; title: string; startDate: string; endDate: string } => Boolean(item));

    if (ganttRecords.length === 0) {
      return <div className="table-embed-empty">Для диаграммы Ганта не найдено полей с датами.</div>;
    }

    const timelineMonth = getMonthKey(ganttRecords[0]?.startDate);
    const timelineDays = getDaysInMonth(timelineMonth);

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: `220px repeat(${timelineDays}, minmax(18px, 1fr))`, gap: 6, marginBottom: 10, fontSize: 11, color: 'var(--text-muted)' }}>
          <span>Этап</span>
          {Array.from({ length: timelineDays }, (_, index) => (
            <span key={index} style={{ textAlign: 'center' }}>{index + 1}</span>
          ))}
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {ganttRecords.map((item) => {
            const startDay = Math.max(1, Number(item.startDate.slice(-2)));
            const endDay = Math.max(startDay, Number(item.endDate.slice(-2)));
            const leftColumn = Math.min(timelineDays, startDay);
            const span = Math.max(1, endDay - startDay + 1);

            return (
              <div key={item.id} style={{ display: 'grid', gridTemplateColumns: `220px repeat(${timelineDays}, minmax(18px, 1fr))`, gap: 6, alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {formatShortDate(item.startDate)} - {formatShortDate(item.endDate)}
                  </div>
                </div>
                <div
                  style={{
                    gridColumn: `${leftColumn + 1} / span ${span}`,
                    background: 'linear-gradient(90deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 70%, white) 100%)',
                    borderRadius: 999,
                    height: 14,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderFormView = () => (
    <div style={{ display: 'grid', gap: 12 }}>
      {filteredRecords.map((record) => {
        const recordId = record.recordId || record.id || '';
        return (
          <article key={recordId} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--bg)' }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>
              {mwsCellDisplayValue((record.fields || {})[primaryFieldId]) || `Р—Р°РїРёСЃСЊ ${recordId}`}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {normalizedFields.map((field) => (
                <label key={`${recordId}:${field.id}`} style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{field.name}</span>
                  {field.editable ? (
                    <input
                      className="table-embed-cell-input"
                      defaultValue={mwsCellDisplayValue((record.fields || {})[field.id])}
                      onBlur={(e) => updateCell(recordId, field.id, e.target.value)}
                    />
                  ) : (
                    <div className="table-embed-cell-readonly" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface)' }}>
                      {mwsCellDisplayValue((record.fields || {})[field.id]) || '—'}
                    </div>
                  )}
                </label>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );

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
            disabled={viewMode !== 'table' || !hasEditableFields}
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

      {viewMode === 'table' && hasReadonlyFields && (
        <div className="table-embed-info">
          Часть колонок доступна только для просмотра: inline-редактирование включено для простых типов полей.
        </div>
      )}

      {viewMode === 'table' && <div className="table-embed-scroll">
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
      </div>}

      {viewMode === 'calendar' && renderCalendarView()}
      {viewMode === 'gallery' && renderGalleryView()}
      {viewMode === 'grid' && renderGridView()}
      {viewMode === 'kanban' && renderKanbanView()}
      {viewMode === 'architecture' && renderArchitectureView()}
      {viewMode === 'gantt' && renderGanttView()}
      {viewMode === 'form' && renderFormView()}

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
