import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  onRemove?: () => void;
}

type ViewMode = 'table' | 'calendar' | 'gallery' | 'kanban' | 'architecture' | 'gantt' | 'grid' | 'form';

type KanbanOptionMeta = {
  value: string;
  color?: string;
  textColor?: string;
  borderColor?: string;
};

type KanbanHistoryEntry = {
  id: string;
  recordId: string;
  action: 'created' | 'updated' | 'moved';
  fieldId?: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  createdAt: number;
};

const PAGE_SIZE = 50;
const LIVE_POLL_INTERVAL_MS = 20_000;
const KANBAN_HISTORY_KEY_PREFIX = 'wikilive-mws-kanban-history:';
const CREATE_OPTION_VALUE = '__create_new_option__';
const EDITABLE_FIELD_TYPE_HINTS = new Set([
  'text',
  'singletext',
  'single_text',
  'select',
  'single_select',
  'multiselect',
  'multi_select',
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

function isOptionFieldCandidate(field: { id: string; name: string }): boolean {
  const source = `${field.id} ${field.name}`.toLowerCase();
  return source.includes('option') || source.includes('опци');
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
  if (source.includes('calendar') || source.includes('календарь')) return 'calendar';
  if (source.includes('gallery') || source.includes('галерея')) return 'gallery';
  if (source.includes('kanban') || source.includes('канбан')) return 'kanban';
  if (source.includes('architecture') || source.includes('архитектура')) return 'table';
  if (source.includes('gantt') || source.includes('гант')) return 'gantt';
  if (source.includes('grid') || source.includes('сетка')) return 'table';
  if (source.includes('form') || source.includes('форм')) return 'form';
  return 'table';
}

function extractFieldOptions(field: MwsField | undefined): string[] {
  if (!field) return [];

  const property = field.property as Record<string, unknown> | undefined;
  const candidates = [field.options, property?.options, property?.selectOptions];
  const values = new Set<string>();

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const option of candidate) {
      if (typeof option === 'string' && option.trim()) {
        values.add(option.trim());
        continue;
      }
      if (!option || typeof option !== 'object' || Array.isArray(option)) continue;
      const record = option as Record<string, unknown>;
      const value =
        typeof record.name === 'string' ? record.name :
        typeof record.label === 'string' ? record.label :
        typeof record.title === 'string' ? record.title :
        typeof record.value === 'string' ? record.value :
        typeof record.text === 'string' ? record.text :
        '';
      if (value.trim()) values.add(value.trim());
    }
  }

  return Array.from(values);
}

type FieldOptionMeta = {
  label: string;
  id?: string;
  raw: unknown;
};

function extractFieldOptionMetas(field: MwsField | undefined): FieldOptionMeta[] {
  if (!field) return [];

  const property = field.property as Record<string, unknown> | undefined;
  const candidates = [field.options, property?.options, property?.selectOptions];
  const metas: FieldOptionMeta[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const option of candidate) {
      if (typeof option === 'string') {
        const label = option.trim();
        if (!label) continue;
        const key = `label:${label.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        metas.push({ label, raw: option });
        continue;
      }
      if (!option || typeof option !== 'object' || Array.isArray(option)) continue;
      const record = option as Record<string, unknown>;
      const label = String(
        record.name ?? record.label ?? record.title ?? record.value ?? record.text ?? ''
      ).trim();
      if (!label) continue;
      const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : undefined;
      const key = `${id || 'label'}:${(id || label).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      metas.push({ label, id, raw: option });
    }
  }

  return metas;
}

function buildFieldUpdateCandidates(field: { typeHint: string | null; raw: MwsField }, value: string): unknown[] {
  const trimmedValue = value.trim();
  if (!trimmedValue) return [''];

  const isSelectTypeField = (field.typeHint || '').includes('select');
  if (!isSelectTypeField) return [trimmedValue];

  const isMultiSelect = (field.typeHint || '').includes('multi');
  const optionMetas = extractFieldOptionMetas(field.raw);
  const matched = optionMetas.find((option) => option.label.toLowerCase() === trimmedValue.toLowerCase());
  const scalarCandidates: unknown[] = [trimmedValue];

  if (matched?.id) {
    scalarCandidates.push(matched.id);
    scalarCandidates.push({ id: matched.id });
    scalarCandidates.push({ id: matched.id, name: matched.label });
  }
  if (matched?.raw && typeof matched.raw === 'object' && !Array.isArray(matched.raw)) {
    scalarCandidates.push(matched.raw);
  }

  const wrapped = isMultiSelect
    ? scalarCandidates.flatMap((candidate) => [candidate, [candidate]])
    : scalarCandidates;

  const unique = new Map<string, unknown>();
  for (const candidate of wrapped) {
    const key = typeof candidate === 'string' ? `s:${candidate}` : `j:${JSON.stringify(candidate)}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return Array.from(unique.values());
}

function sanitizeColor(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  if (
    value.startsWith('#') ||
    value.startsWith('rgb(') ||
    value.startsWith('rgba(') ||
    value.startsWith('hsl(') ||
    value.startsWith('hsla(') ||
    value.startsWith('var(')
  ) {
    return value;
  }
  return undefined;
}

function pickColor(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = sanitizeColor(record[key]);
    if (direct) return direct;
    const nested = record[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const nestedRecord = nested as Record<string, unknown>;
      const nestedColor =
        sanitizeColor(nestedRecord.color) ||
        sanitizeColor(nestedRecord.backgroundColor) ||
        sanitizeColor(nestedRecord.borderColor) ||
        sanitizeColor(nestedRecord.textColor);
      if (nestedColor) return nestedColor;
    }
  }
  return undefined;
}

function extractKanbanOptionMeta(field: MwsField | undefined): KanbanOptionMeta[] {
  if (!field) return [];

  const property = field.property as Record<string, unknown> | undefined;
  const candidates = [field.options, property?.options, property?.selectOptions];
  const metas = new Map<string, KanbanOptionMeta>();

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;

    for (const option of candidate) {
      if (typeof option === 'string') {
        const value = option.trim();
        if (value) metas.set(value, { value });
        continue;
      }
      if (!option || typeof option !== 'object' || Array.isArray(option)) continue;

      const record = option as Record<string, unknown>;
      const value =
        typeof record.name === 'string' ? record.name :
        typeof record.label === 'string' ? record.label :
        typeof record.title === 'string' ? record.title :
        typeof record.value === 'string' ? record.value :
        typeof record.text === 'string' ? record.text :
        '';
      const normalizedValue = value.trim();
      if (!normalizedValue) continue;

      metas.set(normalizedValue, {
        value: normalizedValue,
        color: pickColor(record, ['color', 'bgColor', 'backgroundColor', 'fillColor']),
        textColor: pickColor(record, ['textColor', 'fontColor', 'foregroundColor']),
        borderColor: pickColor(record, ['borderColor', 'strokeColor']),
      });
    }
  }

  return Array.from(metas.values());
}

function formatHistoryTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getKanbanHistoryStorageKey(dstId: string, viewId?: string): string {
  return `${KANBAN_HISTORY_KEY_PREFIX}${dstId}:${viewId || 'default'}`;
}

function readKanbanHistory(storageKey: string): KanbanHistoryEntry[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as KanbanHistoryEntry[] : [];
  } catch {
    localStorage.removeItem(storageKey);
    return [];
  }
}

function extractCreatedRecordId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const buckets = [root, root.data as Record<string, unknown> | undefined];

  for (const bucket of buckets) {
    if (!bucket) continue;
    const records = bucket.records;
    if (!Array.isArray(records) || records.length === 0) continue;
    const first = records[0];
    if (!first || typeof first !== 'object' || Array.isArray(first)) continue;
    const record = first as Record<string, unknown>;
    const recordId = record.recordId || record.id;
    if (typeof recordId === 'string' && recordId.trim()) return recordId;
  }

  return null;
}

function getTaskFieldLabel(field: { id: string; name: string }, statusFieldId: string): string {
  return field.id === statusFieldId ? 'Статус' : field.name;
}

function getFieldValueStats(fieldId: string, records: MwsRecord[]): { uniqueCount: number; nonEmptyCount: number } {
  const values = records
    .map((record) => mwsCellDisplayValue((record.fields || {})[fieldId]).trim())
    .filter((value) => value.length > 0);

  return {
    uniqueCount: new Set(values).size,
    nonEmptyCount: values.length,
  };
}

function getKanbanToneClass(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (!normalized) return 'custom';
  if (
    normalized.includes('cancel') ||
    normalized.includes('canceled') ||
    normalized.includes('cancelled') ||
    normalized.includes('declined') ||
    normalized.includes('rejected')
  ) return 'blocked';
  if (
    normalized.includes('review') ||
    normalized.includes('approve') ||
    normalized.includes('approval') ||
    normalized.includes('qa') ||
    normalized.includes('test')
  ) return 'review';
  if (
    normalized.includes('wait') ||
    normalized.includes('pending') ||
    normalized.includes('hold') ||
    normalized.includes('queue')
  ) return 'waiting';
  if (
    normalized.includes('urgent') ||
    normalized.includes('critical') ||
    normalized.includes('priority') ||
    normalized.includes('asap')
  ) return 'urgent';
  if (normalized.includes('done') || normalized.includes('complete') || normalized.includes('closed')) return 'done';
  if (normalized.includes('progress') || normalized.includes('review') || normalized.includes('active')) return 'progress';
  if (normalized.includes('todo') || normalized.includes('planned') || normalized.includes('to do') || normalized.includes('backlog')) return 'todo';
  return 'custom';
}

function parseDateValue(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const millis = raw > 10_000_000_000 ? raw : raw * 1000;
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
  }
  const value = mwsCellDisplayValue(raw).trim();
  if (!value) return null;
  if (/^\d{13}$/.test(value) || /^\d{10}$/.test(value)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      const millis = value.length === 13 ? numeric : numeric * 1000;
      const parsed = new Date(millis);
      if (!Number.isNaN(parsed.getTime())) {
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
      }
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dotted = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotted) {
    return `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  }
  return null;
}

function formatDateCell(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.replace(/-/g, '/') : value;
}

function formatFieldDisplayValue(field: { typeHint: string | null; name: string }, raw: unknown): string {
  const parsedDate = parseDateValue(raw);
  if (
    parsedDate &&
    (
      (field.typeHint || '').includes('date') ||
      field.name.toLowerCase().includes('date') ||
      field.name.toLowerCase().includes('дата')
    )
  ) {
    return formatDateCell(parsedDate);
  }

  return mwsCellDisplayValue(raw);
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

export default function TableEmbed({ dstId, title, viewId, viewName, viewType, onRemove }: TableEmbedProps) {
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
  const [draggedTableRecordId, setDraggedTableRecordId] = useState<string | null>(null);
  const [tableDropTargetRecordId, setTableDropTargetRecordId] = useState<string | null>(null);
  const [movingRows, setMovingRows] = useState<Set<string>>(new Set());
  const [draggedKanbanRecordId, setDraggedKanbanRecordId] = useState<string | null>(null);
  const [addingKanbanColumn, setAddingKanbanColumn] = useState<string | null>(null);
  const [activeKanbanRecordId, setActiveKanbanRecordId] = useState<string | null>(null);
  const [kanbanHistory, setKanbanHistory] = useState<KanbanHistoryEntry[]>([]);
  const [kanbanTaskDraft, setKanbanTaskDraft] = useState<Record<string, string>>({});
  const [kanbanCustomFieldOptions, setKanbanCustomFieldOptions] = useState<Record<string, string[]>>({});
  const [kanbanCreatingOptionFields, setKanbanCreatingOptionFields] = useState<Record<string, boolean>>({});
  const [kanbanSavingOptionFields, setKanbanSavingOptionFields] = useState<Record<string, boolean>>({});
  const [savingTaskModal, setSavingTaskModal] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => getMonthKey());
  const viewMode = useMemo(() => normalizeViewMode(viewType, viewName), [viewType, viewName]);
  const kanbanHistoryStorageKey = useMemo(
    () => getKanbanHistoryStorageKey(dstId, viewId),
    [dstId, viewId]
  );

  const appendKanbanHistory = useCallback((entry: Omit<KanbanHistoryEntry, 'id' | 'createdAt'>) => {
    setKanbanHistory((prev) => [
      {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
      },
      ...prev,
    ].slice(0, 200));
  }, []);

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
    setKanbanHistory(readKanbanHistory(kanbanHistoryStorageKey));
  }, [kanbanHistoryStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(kanbanHistoryStorageKey, JSON.stringify(kanbanHistory));
    } catch {
      // ignore storage failures
    }
  }, [kanbanHistory, kanbanHistoryStorageKey]);

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

  const activeKanbanRecord = useMemo(
    () => records.find((record) => (record.recordId || record.id || '') === activeKanbanRecordId) || null,
    [activeKanbanRecordId, records]
  );

  useEffect(() => {
    if (!activeKanbanRecordId) return;
    if (activeKanbanRecord) return;
    setActiveKanbanRecordId(null);
  }, [activeKanbanRecord, activeKanbanRecordId]);

  useEffect(() => {
    if (!activeKanbanRecord) {
      setKanbanTaskDraft({});
      return;
    }

    const nextDraft = Object.fromEntries(
      normalizedFields.map((field) => [
        field.id,
        (field.typeHint || '').includes('date')
          ? parseDateValue((activeKanbanRecord.fields || {})[field.id]) || ''
          : formatFieldDisplayValue(field, (activeKanbanRecord.fields || {})[field.id]),
      ])
    );
    setKanbanTaskDraft(nextDraft);
  }, [activeKanbanRecord, normalizedFields]);

  useEffect(() => {
    setKanbanCustomFieldOptions({});
    setKanbanCreatingOptionFields({});
    setKanbanSavingOptionFields({});
  }, [dstId, viewId]);

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

  const canReorderRows = viewMode === 'table' && !sortField && !filterText.trim() && !showNewRow;

  const reorderRecordsLocally = useCallback((sourceRecordId: string, targetRecordId: string) => {
    if (!sourceRecordId || !targetRecordId || sourceRecordId === targetRecordId) return false;

    let didReorder = false;
    setRecords((prev) => {
      const sourceIndex = prev.findIndex((record) => (record.recordId || record.id || '') === sourceRecordId);
      const targetIndex = prev.findIndex((record) => (record.recordId || record.id || '') === targetRecordId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return prev;

      const next = [...prev];
      const [movedRecord] = next.splice(sourceIndex, 1);
      if (!movedRecord) return prev;
      const insertIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      next.splice(insertIndex, 0, movedRecord);
      didReorder = true;
      return next;
    });
    return didReorder;
  }, []);

  const moveRowInMws = useCallback(
    async (sourceRecordId: string, targetRecordId: string) => {
      const payloadCandidates: Record<string, unknown>[] = [
        {
          recordIds: [sourceRecordId],
          anchorRecordId: targetRecordId,
          before: true,
          ...(viewId ? { viewId } : {}),
        },
        {
          recordId: sourceRecordId,
          targetRecordId,
          position: 'before',
          ...(viewId ? { viewId } : {}),
        },
        {
          recordIds: [sourceRecordId],
          beforeRecordId: targetRecordId,
          ...(viewId ? { viewId } : {}),
        },
      ];

      for (const payload of payloadCandidates) {
        try {
          await api.moveRecords(dstId, payload);
          return true;
        } catch {
          // try next payload format for API compatibility
        }
      }

      return false;
    },
    [dstId, viewId]
  );

  const handleTableRowDrop = useCallback(
    async (targetRecordId: string) => {
      const sourceRecordId = draggedTableRecordId;
      setTableDropTargetRecordId(null);
      setDraggedTableRecordId(null);

      if (!canReorderRows || !sourceRecordId || !targetRecordId || sourceRecordId === targetRecordId) return;

      const previousRecords = records;
      const reordered = reorderRecordsLocally(sourceRecordId, targetRecordId);
      if (!reordered) return;

      setMovingRows((prev) => {
        const next = new Set(prev);
        next.add(sourceRecordId);
        next.add(targetRecordId);
        return next;
      });

      const moved = await moveRowInMws(sourceRecordId, targetRecordId);
      if (!moved) {
        setRecords(previousRecords);
        setError('Не удалось изменить порядок строк в MWS Tables');
      } else {
        setLastLoadedAt(Date.now());
      }

      setMovingRows((prev) => {
        const next = new Set(prev);
        next.delete(sourceRecordId);
        next.delete(targetRecordId);
        return next;
      });
    },
    [canReorderRows, draggedTableRecordId, moveRowInMws, records, reorderRecordsLocally]
  );

  const isTableRowDropTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('tr[data-record-id]'));
  }, []);

  const updateCell = async (
    recordId: string,
    fieldId: string,
    value: string,
    force = false,
    historyAction: KanbanHistoryEntry['action'] = 'updated'
  ) => {
    const targetField = normalizedFields.find((field) => field.id === fieldId);
    if (!targetField || (!targetField.editable && !force)) return;
    const previousRecord = records.find((record) => (record.recordId || record.id) === recordId);
    const oldValue = mwsCellDisplayValue((previousRecord?.fields || {})[fieldId]);
    if (oldValue === value) return;

    const cellKey = `${recordId}:${fieldId}`;
    setSavingCells((prev) => new Set(prev).add(cellKey));
    try {
      const updateCandidates = buildFieldUpdateCandidates(targetField, value);
      let persistedRecords: MwsRecord[] | null = null;
      let updateAccepted = false;

      for (const candidateValue of updateCandidates) {
        await api.updateRecords(dstId, {
          records: [{ recordId, fields: { [fieldId]: candidateValue } }],
        });

        const latestRecordsResponse = await api.getRecords(dstId, Math.max(PAGE_SIZE * page, 100), viewId);
        const latestRecords = (latestRecordsResponse?.data?.records || latestRecordsResponse?.records || []) as MwsRecord[];
        const latestRecord = latestRecords.find((record) => (record.recordId || record.id || '') === recordId);
        const persistedValue = mwsCellDisplayValue((latestRecord?.fields || {})[fieldId]).trim();
        if (persistedValue.toLowerCase() === value.trim().toLowerCase()) {
          persistedRecords = latestRecords;
          updateAccepted = true;
          break;
        }
      }

      if (!updateAccepted) {
        throw new Error('MWS did not persist updated value');
      }

      if (persistedRecords) {
        setRecords(persistedRecords);
      } else {
        setRecords((prev) =>
          prev.map((r) =>
            (r.recordId || r.id) === recordId
              ? { ...r, fields: { ...(r.fields || {}), [fieldId]: value } }
              : r
          )
        );
      }
      setLastLoadedAt(Date.now());
      appendKanbanHistory({
        action: historyAction,
        recordId,
        fieldId,
        fieldName: getTaskFieldLabel(targetField, statusFieldId),
        oldValue,
        newValue: value,
      });
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
      const response = await api.createRecords(dstId, {
        records: [{ fields: nextRecordFields }],
      });
      await load(page);
      const createdRecordId = extractCreatedRecordId(response);
      if (createdRecordId) {
        appendKanbanHistory({
          action: 'created',
          recordId: createdRecordId,
          fieldId: primaryFieldId,
          fieldName: normalizedFields.find((field) => field.id === primaryFieldId)?.name || 'Название',
          newValue: typeof nextRecordFields[primaryFieldId] === 'string' ? nextRecordFields[primaryFieldId] : 'Новая запись',
        });
      }
      setNewRowValues({});
      setShowNewRow(false);
    } catch {
      /* ignore */
    } finally {
      setAddingRow(false);
    }
  };

  const addKanbanCard = async (column: string) => {
    if (addingKanbanColumn) return;

    const nextRecordFields: Record<string, string> = {};
    const titleFieldId = primaryEditableFieldId || primaryFieldId;

    if (titleFieldId) {
      nextRecordFields[titleFieldId] = 'Новая запись';
    }
    if (statusFieldId && column !== 'No status') {
      nextRecordFields[statusFieldId] = column;
    }
    if (Object.keys(nextRecordFields).length === 0) return;

    setAddingKanbanColumn(column);
    try {
      const response = await api.createRecords(dstId, {
        records: [{ fields: nextRecordFields }],
      });
      await load(page);
      const createdRecordId = extractCreatedRecordId(response);
      if (createdRecordId) {
        appendKanbanHistory({
          action: 'created',
          recordId: createdRecordId,
          fieldId: primaryFieldId,
          fieldName: normalizedFields.find((field) => field.id === primaryFieldId)?.name || 'Название',
          newValue: nextRecordFields[titleFieldId || primaryFieldId] || 'Новая запись',
        });
        setActiveKanbanRecordId(createdRecordId);
      }
    } catch {
      // ignore
    } finally {
      setAddingKanbanColumn(null);
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
          lowerName.includes('начал')
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
          lowerName.includes('конец')
        );
      })?.id || dateFieldId,
    [dateFieldId, normalizedFields]
  );
  const statusFieldId = useMemo(() => {
    const candidates = normalizedFields
      .filter((field) => field.id && field.id !== normalizedFields[0]?.id)
      .map((field) => {
        const lowerName = field.name.toLowerCase();
        const typeHint = (field.typeHint || '').toLowerCase();
        const options = extractFieldOptions(field.raw);
        const stats = getFieldValueStats(field.id, records);
        let score = 0;

        if (
          lowerName.includes('status') ||
          lowerName.includes('stage') ||
          lowerName.includes('state') ||
          lowerName.includes('option') ||
          lowerName.includes('select') ||
          lowerName.includes('category')
        ) {
          score += 100;
        }
        if (typeHint.includes('select')) score += 80;
        if (options.length > 0) score += 60;
        if (stats.nonEmptyCount > 0 && stats.uniqueCount > 0 && stats.uniqueCount <= 12) {
          score += 40 - stats.uniqueCount;
        }
        if (stats.nonEmptyCount >= Math.max(2, Math.floor(records.length / 2))) {
          score += 20;
        }

        return { fieldId: field.id, score };
      })
      .sort((left, right) => right.score - left.score);

    if (candidates[0] && candidates[0].score > 0) return candidates[0].fieldId;
    return '';
  }, [normalizedFields, records]);
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
  const primaryEditableFieldId = useMemo(
    () => normalizedFields.find((field) => field.editable)?.id || '',
    [normalizedFields]
  );
  const statusField = useMemo(
    () => normalizedFields.find((field) => field.id === statusFieldId)?.raw as MwsField | undefined,
    [normalizedFields, statusFieldId]
  );
  const kanbanOptionMeta = useMemo(
    () => extractKanbanOptionMeta(statusField),
    [statusField]
  );
  const kanbanOptionMetaByValue = useMemo(
    () => new Map(kanbanOptionMeta.map((item) => [item.value, item])),
    [kanbanOptionMeta]
  );
  const kanbanColumns = useMemo(() => {
    if (!statusFieldId) return ['No status'];

    const values = new Set<string>(extractFieldOptions(statusField));
    values.add('No status');

    for (const record of records) {
      const value = mwsCellDisplayValue((record.fields || {})[statusFieldId]).trim() || 'No status';
      values.add(value);
    }

    return Array.from(values);
  }, [records, statusField, statusFieldId]);
  const activeKanbanHistory = useMemo(
    () => kanbanHistory.filter((entry) => entry.recordId === activeKanbanRecordId),
    [activeKanbanRecordId, kanbanHistory]
  );
  const fieldOptionSuggestions = useMemo(() => {
    const map = new Map<string, string[]>();

    for (const field of normalizedFields) {
      const values = new Set<string>(extractFieldOptions(field.raw));
      const isOptionField = isOptionFieldCandidate(field);
      const isSelectTypeField = (field.typeHint || '').includes('select');
      const shouldCollectFromRecords = field.id === statusFieldId || isOptionField || isSelectTypeField;

      if (shouldCollectFromRecords) {
        for (const record of records) {
          const value = mwsCellDisplayValue((record.fields || {})[field.id]).trim();
          if (value) values.add(value);
        }
      }

      if (field.id === statusFieldId) {
        for (const column of kanbanColumns) {
          if (column !== 'No status') values.add(column);
        }
      }

      const customOptions = kanbanCustomFieldOptions[field.id] || [];
      for (const option of customOptions) {
        const normalizedOption = option.trim();
        if (normalizedOption) values.add(normalizedOption);
      }

      map.set(field.id, Array.from(values));
    }

    return map;
  }, [kanbanColumns, kanbanCustomFieldOptions, normalizedFields, records, statusFieldId]);

  const addKanbanFieldOption = useCallback(async (fieldId: string, rawValue: string) => {
    const nextValue = rawValue.trim();
    if (!nextValue) return false;

    const knownOptions = new Set(
      (fieldOptionSuggestions.get(fieldId) || []).map((option) => option.toLowerCase())
    );
    if (knownOptions.has(nextValue.toLowerCase())) return false;

    const targetField = normalizedFields.find((field) => field.id === fieldId);
    if (!targetField) return false;

    const isSelectTypeField = (targetField.typeHint || '').includes('select');
    if (isSelectTypeField) {
      const rawField = targetField.raw as Record<string, unknown>;
      const property = rawField.property && typeof rawField.property === 'object'
        ? (rawField.property as Record<string, unknown>)
        : {};
      const rawOptionsCandidate = [
        rawField.options,
        property.options,
        property.selectOptions,
      ].find((value) => Array.isArray(value)) as unknown[] | undefined;
      const rawOptions = Array.isArray(rawOptionsCandidate) ? rawOptionsCandidate : [];

      const optionLabels = new Set<string>(
        rawOptions
          .map((option) => {
            if (typeof option === 'string') return option.trim();
            if (!option || typeof option !== 'object' || Array.isArray(option)) return '';
            const record = option as Record<string, unknown>;
            return String(record.name || record.label || record.title || record.value || record.text || '').trim();
          })
          .filter((label) => label.length > 0)
          .map((label) => label.toLowerCase())
      );
      if (!optionLabels.has(nextValue.toLowerCase())) {
        const nextOptions = rawOptions.length > 0
          ? [...rawOptions, { name: nextValue }]
          : [{ name: nextValue }];

        setKanbanSavingOptionFields((prev) => ({ ...prev, [fieldId]: true }));
        try {
          await api.updateFields(dstId, {
            fieldKey: 'id',
            fields: [
              {
                id: fieldId,
                fieldId,
                property: {
                  options: nextOptions,
                },
              },
            ],
          });
          const fieldsData = await api.getFields(dstId, viewId);
          const refreshed = (fieldsData?.data?.fields || fieldsData?.fields || []) as MwsField[];
          if (refreshed.length > 0) {
            setFields(refreshed);
          }
        } catch {
          return false;
        } finally {
          setKanbanSavingOptionFields((prev) => ({ ...prev, [fieldId]: false }));
        }
      }
    }

    setKanbanCustomFieldOptions((prev) => ({
      ...prev,
      [fieldId]: [...(prev[fieldId] || []), nextValue],
    }));
    setKanbanTaskDraft((prev) => ({ ...prev, [fieldId]: nextValue }));
    setKanbanCreatingOptionFields((prev) => ({ ...prev, [fieldId]: false }));
    return true;
  }, [dstId, fieldOptionSuggestions, normalizedFields, viewId]);

  function getKanbanOptionStyle(status: string): CSSProperties | undefined {
    const meta = kanbanOptionMetaByValue.get(status);
    if (!meta) return undefined;

    return {
      background: meta.color ? `color-mix(in srgb, ${meta.color} 18%, white 82%)` : undefined,
      color: meta.textColor || meta.color || undefined,
      borderColor: meta.borderColor || meta.color || undefined,
    };
  }

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
                      {field.name}: {formatFieldDisplayValue(field, (record.fields || {})[field.id]) || '—'}
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
        const titleValue = mwsCellDisplayValue((record.fields || {})[primaryFieldId]) || `Запись ${recordId}`;
        return (
          <article key={recordId} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--bg)' }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>{titleValue}</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {normalizedFields.slice(1, 5).map((field) => (
                <div key={`${recordId}:${field.id}`} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface)' }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
                    {field.name}
                  </div>
                  <div style={{ fontSize: 13 }}>{formatFieldDisplayValue(field, (record.fields || {})[field.id]) || '—'}</div>
                </div>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );

  const renderKanbanView = () => {
    if (!statusFieldId) {
      return <div className="table-embed-empty">Status field is missing for this kanban view.</div>;
    }

    const grouped = new Map<string, MwsRecord[]>(kanbanColumns.map((column) => [column, []]));
    for (const record of filteredRecords) {
      const key = mwsCellDisplayValue((record.fields || {})[statusFieldId]).trim() || 'No status';
      grouped.set(key, [...(grouped.get(key) || []), record]);
    }

    return (
      <><div className="table-embed-kanban-view">
        <div className="table-embed-kanban-head">
          <div className="table-embed-kanban-head-main">
            <span className="table-embed-kanban-title">KANBAN</span>
            <span className="table-embed-kanban-note">Перетаскивайте карточки между колонками и редактируйте их справа</span>
            <button type="button"
              className="table-embed-kanban-dismiss"
              onClick={onRemove}
              aria-label="Remove kanban board"
              title="Remove kanban board"
            >
            &times;
            </button>
          </div>
        </div>
        </div>
        <div className="table-embed-kanban-toolbar">
          <button
            type="button"
            className="table-embed-kanban-primary"
            onClick={() => void addKanbanCard(kanbanColumns[0] || 'No status')}
            disabled={Boolean(addingKanbanColumn) || (!primaryEditableFieldId && !statusFieldId)}
          >
            {addingKanbanColumn ? 'Creating...' : 'New task'}
          </button>
        </div><div className="page-kanban table-embed-kanban-board">
          {Array.from(grouped.entries()).map(([group, items]) => {
            const toneClass = getKanbanToneClass(group);
            const optionStyle = getKanbanOptionStyle(group);
            return (
              <section
                key={group}
                className="page-kanban-col table-embed-kanban-col"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                } }
                onDrop={() => {
                  if (!draggedKanbanRecordId) return;
                  void updateCell(draggedKanbanRecordId, statusFieldId, group === 'No status' ? '' : group, true, 'moved');
                  setDraggedKanbanRecordId(null);
                } }
                style={optionStyle?.borderColor ? { borderTop: `3px solid ${optionStyle.borderColor}` } : undefined}
              >
                <header className={`page-kanban-col-header is-${toneClass} table-embed-kanban-col-header`}>
                  <div className="page-kanban-col-title-wrap table-embed-kanban-col-title-wrap">
                    <span
                      className={`page-kanban-col-dot is-${toneClass} table-embed-kanban-col-dot is-${toneClass}`}
                      style={{ background: optionStyle?.borderColor || optionStyle?.color }} />
                    <span className="table-embed-kanban-col-title">{group}</span>
                  </div>
                  <span className="page-kanban-col-count table-embed-kanban-col-count">{items.length}</span>
                </header>
                <div className="table-embed-kanban-col-body">
                  {items.length > 0 ? items.map((record) => {
                    const recordId = record.recordId || record.id || '';
                    const titleValue = mwsCellDisplayValue((record.fields || {})[primaryFieldId]) || `Record ${recordId}`;
                    const previewFields = normalizedFields
                      .filter((field) => field.id !== primaryFieldId && field.id !== statusFieldId)
                      .slice(0, 1);
                    const isDragging = draggedKanbanRecordId === recordId;
                    const cardLabel = previewFields[0] ? formatFieldDisplayValue(previewFields[0], (record.fields || {})[previewFields[0].id]) : title || 'TEXT';

                    return (
                      <article
                        key={recordId}
                        className={`page-kanban-card table-embed-kanban-card${isDragging ? ' is-dragging' : ''}`}
                        draggable
                        onDragStart={() => setDraggedKanbanRecordId(recordId)}
                        onDragEnd={() => setDraggedKanbanRecordId(null)}
                        onClick={() => setActiveKanbanRecordId(recordId)}
                      >
                        <div className="table-embed-kanban-card-type">{cardLabel}</div>
                        <h4>{titleValue}</h4>
                        <span
                          className={`page-kanban-card-status table-embed-kanban-card-status is-${toneClass}`}
                          style={optionStyle}
                        >
                          {group}
                        </span>
                      </article>
                    );
                  }) : <div className="page-kanban-empty table-embed-kanban-empty">Пусто</div>}
                </div>
                <button
                  type="button"
                  className="table-embed-kanban-add-card"
                  onClick={() => void addKanbanCard(group)}
                  disabled={addingKanbanColumn === group || (!primaryEditableFieldId && !statusFieldId)}
                >
                  <span>+</span>
                </button>
              </section>
            );
          })}
          <section className="page-kanban-col page-kanban-col--creator table-embed-kanban-creator">
            <button type="button" className="page-kanban-add-col" disabled title="Группы для MWS пока создаются в самой таблице">
              <span className="page-kanban-add-col-icon">+</span>
              <span>Новая группа</span>
            </button>
          </section>
        </div></>
    );
  };

  const renderKanbanTaskModal = () => {
    if (!activeKanbanRecord || !activeKanbanRecordId) return null;

    const recordFields = activeKanbanRecord.fields || {};
    const titleValue = mwsCellDisplayValue(recordFields[primaryFieldId]) || `Record ${activeKanbanRecordId}`;
    const canDeleteTask = !deletingRows.has(activeKanbanRecordId);
    const currentStatus = kanbanTaskDraft[statusFieldId] || mwsCellDisplayValue(recordFields[statusFieldId]).trim() || 'No status';
    const currentStatusStyle = getKanbanOptionStyle(currentStatus);

    const saveKanbanTask = async () => {
      if (savingTaskModal) return;
      setSavingTaskModal(true);
      try {
        for (const field of normalizedFields) {
          const isStatusField = field.id === statusFieldId;
          if (!field.editable && !isStatusField) continue;

          const nextValue = (kanbanTaskDraft[field.id] || '').trim();
          const currentValue = ((field.typeHint || '').includes('date')
            ? parseDateValue(recordFields[field.id]) || ''
            : formatFieldDisplayValue(field, recordFields[field.id])).trim();

          if (nextValue === currentValue) continue;
          await updateCell(
            activeKanbanRecordId,
            field.id,
            nextValue,
            isStatusField,
            isStatusField ? 'moved' : 'updated'
          );
        }
      } finally {
        setSavingTaskModal(false);
      }
    };

    const removeKanbanTask = async () => {
      if (!canDeleteTask) return;
      await deleteRow(activeKanbanRecordId);
      setActiveKanbanRecordId(null);
    };

    return (
      <div className="modal-overlay" onClick={() => setActiveKanbanRecordId(null)}>
        <div className="modal table-embed-task-modal" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="table-embed-task-modal-close"
            onClick={() => setActiveKanbanRecordId(null)}
            aria-label="Close modal"
          >
            &times;
          </button>
          <div className="table-embed-task-modal-shell">
            <div className="table-embed-task-modal-main">
              <div className="table-embed-task-modal-header">
                <div className="table-embed-task-title-wrap">
                  <h3>{titleValue}</h3>
                  <span className="table-embed-task-status-pill" style={currentStatusStyle}>
                    {currentStatus === 'No status' ? 'Без статуса' : currentStatus}
                  </span>
                </div>
                <button
                  type="button"
                  className="table-embed-task-modal-close table-embed-task-modal-close--header"
                  onClick={() => setActiveKanbanRecordId(null)}
                  aria-label="Close modal"
                  title="Close modal"
                >&times;</button>
              </div>
              <div className="table-embed-task-modal-body">
                <div className="table-embed-task-modal-fields">
              {normalizedFields.map((field) => {
                const displayValue = kanbanTaskDraft[field.id] ?? '';
                const isStatusField = field.id === statusFieldId;
                const fieldOptions = fieldOptionSuggestions.get(field.id) || [];
                const hasSelectableOptions = fieldOptions.length > 0;
                const isOptionField = isOptionFieldCandidate(field);
                const isSelectTypeField = (field.typeHint || '').includes('select');
                const supportsOptionCreation = !isStatusField && (isOptionField || isSelectTypeField);
                const isCreatingOption = supportsOptionCreation && Boolean(kanbanCreatingOptionFields[field.id]);
                const isSavingOption = Boolean(kanbanSavingOptionFields[field.id]);
                const trimmedDisplayValue = displayValue.trim();
                const optionExists = fieldOptions.some((option) => option.toLowerCase() === trimmedDisplayValue.toLowerCase());
                const selectableOptions = optionExists || !trimmedDisplayValue ? fieldOptions : [...fieldOptions, trimmedDisplayValue];
                const selectedOptionValue = isCreatingOption ? CREATE_OPTION_VALUE : (trimmedDisplayValue || '');

                return (
                  <label key={`${activeKanbanRecordId}:${field.id}`} className="table-embed-task-field">
                    <span>{getTaskFieldLabel(field, statusFieldId)}</span>
                    {field.editable || isStatusField ? (
                      hasSelectableOptions || isStatusField || supportsOptionCreation ? (
                        <div className="table-embed-task-option-editor">
                          <select
                            className="table-embed-task-input table-embed-task-select"
                            value={selectedOptionValue}
                            disabled={isSavingOption}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              if (supportsOptionCreation && nextValue === CREATE_OPTION_VALUE) {
                                setKanbanCreatingOptionFields((prev) => ({ ...prev, [field.id]: true }));
                                return;
                              }
                              setKanbanCreatingOptionFields((prev) => ({ ...prev, [field.id]: false }));
                              setKanbanTaskDraft((prev) => ({ ...prev, [field.id]: nextValue }));
                            }}
                          >
                            {!trimmedDisplayValue && !isCreatingOption && (
                              <option value="">Выберите опцию</option>
                            )}
                            {selectableOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                            {supportsOptionCreation && (
                              <option value={CREATE_OPTION_VALUE}>Создать новую опцию</option>
                            )}
                          </select>
                          {isCreatingOption && (
                            <div className="table-embed-task-option-create-row">
                              <input
                                className="table-embed-task-input"
                                type="text"
                                value={displayValue}
                                placeholder="Введите новую опцию"
                                onChange={(event) => {
                                  setKanbanTaskDraft((prev) => ({ ...prev, [field.id]: event.target.value }));
                                }}
                              />
                              <button
                                type="button"
                                className="table-embed-task-option-create"
                                onClick={() => {
                                  void addKanbanFieldOption(field.id, displayValue);
                                }}
                                disabled={!trimmedDisplayValue || optionExists || isSavingOption}
                              >
                              {isSavingOption ? 'Сохранение...' : 'Создать опцию'}
                            </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <input
                          className="table-embed-task-input"
                          type={(field.typeHint || '').includes('date') ? 'date' : 'text'}
                          value={displayValue}
                          onChange={(event) => {
                            setKanbanTaskDraft((prev) => ({ ...prev, [field.id]: event.target.value }));
                          }}
                        />
                      )
                    ) : (
                      <div className="table-embed-task-readonly">{displayValue || '—'}</div>
                    )}
                  </label>
                );
              })}
            </div>
            <div className="table-embed-task-actions">
              <button
                type="button"
                className="table-embed-task-save"
                onClick={() => void saveKanbanTask()}
                disabled={savingTaskModal}
              >
                {savingTaskModal ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button
                type="button"
                className="table-embed-task-delete"
                onClick={() => void removeKanbanTask()}
                disabled={!canDeleteTask}
              >
                {canDeleteTask ? 'Удалить задачу' : 'Удаление...'}
              </button>
                </div>
              </div>
            </div>
          <aside className="table-embed-task-history">
            <div className="table-embed-task-history-head">
              <strong>История</strong>
            </div>
            {activeKanbanHistory.length > 0 ? (
              <div className="table-embed-task-history-list">
                {activeKanbanHistory.map((entry) => (
                  <div key={entry.id} className="table-embed-task-history-item">
                    <div className="table-embed-task-history-title">
                      {entry.action === 'created' && 'Добавлена запись'}
                      {entry.action === 'moved' && 'Перемещена задача'}
                      {entry.action === 'updated' && 'Изменено поле'}
                    </div>
                    <div className="table-embed-task-history-time">{formatHistoryTime(entry.createdAt)}</div>
                    {entry.fieldName && <div className="table-embed-task-history-field">{entry.fieldId === statusFieldId ? 'Статус' : entry.fieldName}</div>}
                    {entry.newValue && entry.action === 'created' ? (
                      <div className="table-embed-task-history-values">
                        <span>{entry.newValue}</span>
                      </div>
                    ) : (
                      <div className="table-embed-task-history-values">
                        <span>{entry.oldValue || '—'}</span>
                        <span>→</span>
                        <span>{entry.newValue || '—'}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="table-embed-task-history-empty">Изменений пока нет.</div>
            )}
          </aside>
          </div>
        </div>
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
                  {field.name}: {formatFieldDisplayValue(field, (record.fields || {})[field.id]) || '—'}
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
          title: mwsCellDisplayValue((record.fields || {})[primaryFieldId]) || `Запись ${recordId}`,
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
              {mwsCellDisplayValue((record.fields || {})[primaryFieldId]) || `Запись ${recordId}`}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {normalizedFields.map((field) => (
                <label key={`${recordId}:${field.id}`} style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{field.name}</span>
                  {field.editable ? (
                    <input
                      className="table-embed-cell-input"
                      defaultValue={formatFieldDisplayValue(field, (record.fields || {})[field.id])}
                      onBlur={(e) => updateCell(recordId, field.id, e.target.value)}
                    />
                  ) : (
                    <div className="table-embed-cell-readonly" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface)' }}>
                      {formatFieldDisplayValue(field, (record.fields || {})[field.id]) || '—'}
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
    <div
      className="table-embed"
      onDragOverCapture={(event) => {
        if (!draggedTableRecordId) return;
        if (isTableRowDropTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onDropCapture={(event) => {
        if (!draggedTableRecordId) return;
        if (isTableRowDropTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        setDraggedTableRecordId(null);
        setTableDropTargetRecordId(null);
      }}
    >
      {viewMode !== 'kanban' && (
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
          {onRemove && (
            <button
              className="table-embed-btn"
              onClick={onRemove}
              title="Убрать интеграцию"
              disabled={loading}
            >&times;</button>
          )}
        </div>
      </div>
      )}

      {error && viewMode !== 'kanban' && (
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
              <th className="table-embed-th table-embed-th--drag" title="Переместить строку" />
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
                <td className="table-embed-drag-cell" />
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
                  >&times;</button>
                </td>
              </tr>
            )}

            {!showNewRow && hasEditableFields && (
              <tr className="table-embed-add-row">
                <td colSpan={normalizedFields.length + 2}>
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
              const isDragging = draggedTableRecordId === recordId;
              const isDropTarget = tableDropTargetRecordId === recordId;
              const isMoving = movingRows.has(recordId);
              return (
                <tr
                  key={recordId}
                  data-record-id={recordId}
                  className={[
                    isDeleting ? 'table-embed-row--deleting' : '',
                    isDragging ? 'table-embed-row--dragging' : '',
                    isDropTarget ? 'table-embed-row--drop-target' : '',
                    isMoving ? 'table-embed-row--moving' : '',
                  ].filter(Boolean).join(' ')}
                  draggable={canReorderRows && !isDeleting}
                  onDragStart={(event) => {
                    if (!canReorderRows || isDeleting) return;
                    event.stopPropagation();
                    setDraggedTableRecordId(recordId);
                    setTableDropTargetRecordId(null);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('application/x-wikilive-record-id', recordId);
                  }}
                  onDragOver={(event) => {
                    if (!canReorderRows || !draggedTableRecordId || draggedTableRecordId === recordId) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = 'move';
                    setTableDropTargetRecordId(recordId);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleTableRowDrop(recordId);
                  }}
                  onDragEnd={() => {
                    // Do not allow table row drags to leak into outer editors/dropzones.
                    setDraggedTableRecordId(null);
                    setTableDropTargetRecordId(null);
                  }}
                >
                  <td className="table-embed-drag-cell">
                    <button
                      type="button"
                      className="table-embed-row-drag-handle"
                      title={canReorderRows ? 'Перетащите для изменения порядка' : 'Сбросьте фильтр и сортировку для перестановки'}
                      disabled={!canReorderRows || isDeleting || isMoving}
                      aria-label="Переместить строку"
                    >
                      ⋮⋮
                    </button>
                  </td>
                  {normalizedFields.map((field) => {
                    const cellKey = `${recordId}:${field.id}`;
                    const isSaving = savingCells.has(cellKey);
                    return (
                      <td key={cellKey} className={isSaving ? 'table-embed-cell--saving' : ''}>
                        {field.editable ? (
                          <input
                            key={`${cellKey}:${formatFieldDisplayValue(field, rowFields[field.id])}`}
                            className="table-embed-cell-input"
                            defaultValue={formatFieldDisplayValue(field, rowFields[field.id])}
                            onBlur={(e) => updateCell(recordId, field.id, e.target.value)}
                            disabled={isDeleting}
                          />
                        ) : (
                          <span
                            className="table-embed-cell-readonly"
                            title={field.typeHint ? `Поле ${field.typeHint}` : 'Поле только для просмотра'}
                          >
                            {formatFieldDisplayValue(field, rowFields[field.id]) || '—'}
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
                <td colSpan={normalizedFields.length + 2} className="table-embed-empty">
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
      {viewMode === 'kanban' && renderKanbanTaskModal()}

      {viewMode !== 'kanban' && <div className="table-embed-footer">
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
      </div>}
    </div>
  );
}

