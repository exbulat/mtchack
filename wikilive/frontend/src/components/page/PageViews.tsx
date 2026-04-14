import { useEffect, useMemo, useRef, useState } from 'react';

import type { CSSProperties } from 'react';
export type KanbanStatus = string;

export type ViewRecord = {
  id: string;
  title: string;
  excerpt: string;
  notes: string;
  status: KanbanStatus;
  date: string;
  startDate: string;
  endDate: string;
  image?: string;
  color?: string;
  typeLabel: string;
  source: 'page' | 'manual';
  order: number;
};

type PageViewsProps = {
  activeView: 'architecture' | 'grid' | 'calendar' | 'gallery' | 'gantt' | 'kanban' | 'form';
  activeViewLabel: string;
  records: ViewRecord[];
  selectedRecordId: string | null;
  architectureStats: { typeCounts: Record<string, number>; pageLinks: number; tableLinks: number };
  onSelectRecord: (recordId: string | null) => void;
  onCreateRecord: (seed?: Partial<ViewRecord>) => string;
  onUpdateRecord: (recordId: string, patch: Partial<ViewRecord>) => void;
  onDeleteRecord: (recordId: string) => void;
  onReorderRecords: (draggedId: string, targetId: string) => void;
  onUploadRecordImage: (recordId: string, file: File) => Promise<void>;
};

function formatMonthLabel(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  return new Date(year, month - 1, 1).toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  });
}

function getMonthKey(date?: string): string {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date.slice(0, 7);
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(monthKey: string, delta: number): string {
  const [yearRaw, monthRaw] = monthKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const next = new Date(year, month - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

function getDaysInMonth(monthKey: string): number {
  const [yearRaw, monthRaw] = monthKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  return new Date(year, month, 0).getDate();
}

function toDateString(monthKey: string, day: number): string {
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getDayNumber(date: string, fallbackMonthKey: string): number {
  if (!date.startsWith(fallbackMonthKey)) return 1;
  const parsed = Number(date.slice(-2));
  return Number.isFinite(parsed) ? parsed : 1;
}

const BUILTIN_STATUSES = ['To Do', 'In Progress', 'Done'] as const;
const CUSTOM_STATUS_OPTION = '__custom_status__';

function isBuiltInStatus(status: string): status is (typeof BUILTIN_STATUSES)[number] {
  return BUILTIN_STATUSES.includes(status as (typeof BUILTIN_STATUSES)[number]);
}

function statusLabel(status: KanbanStatus): string {
  if (status === 'To Do') return 'К выполнению';
  if (status === 'In Progress') return 'В работе';
  if (status === 'Done') return 'Готово';
  if (status === 'Other') return 'Свой статус';
  return status.trim() || 'Свой статус';
}

function statusClassName(status: KanbanStatus): string {
  if (status === 'To Do') return 'todo';
  if (status === 'In Progress') return 'progress';
  if (status === 'Done') return 'done';
  return 'custom';
}

type StatusFieldProps = {
  value: KanbanStatus;
  onChange: (status: KanbanStatus) => void;
  className?: string;
};

function StatusField({ value, onChange, className = 'page-form-input' }: StatusFieldProps) {
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const isCustom = !isBuiltInStatus(value);
  const customValue = value === 'Other' ? '' : value;

  useEffect(() => {
    if (!isCustom) return;
    customInputRef.current?.focus();
    customInputRef.current?.select();
  }, [isCustom]);

  return (
    <div className="page-status-field">
      <select
        className={className}
        value={isCustom ? CUSTOM_STATUS_OPTION : value}
        onChange={(event) => {
          if (event.target.value === CUSTOM_STATUS_OPTION) {
            onChange(customValue.trim() || 'Новый статус');
            return;
          }
          onChange(event.target.value);
        }}
      >
        <option value="To Do">К выполнению</option>
        <option value="In Progress">В работе</option>
        <option value="Done">Готово</option>
        <option value={CUSTOM_STATUS_OPTION}>Свой статус</option>
      </select>
      {isCustom && (
        <input
          ref={customInputRef}
          className={className}
          type="text"
          value={customValue}
          placeholder="Введите свой статус"
          onChange={(event) => onChange(event.target.value || 'Other')}
        />
      )}
    </div>
  );
}

function formatShortDate(date: string): string {
  if (!date) return '-';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
  });
}

function parseDate(date: string): Date | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: string, delta: number): string {
  const parsed = parseDate(date);
  if (!parsed) return date;
  parsed.setDate(parsed.getDate() + delta);
  return formatIsoDate(parsed);
}

function diffDays(from: string, to: string): number {
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  if (!fromDate || !toDate) return 0;
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function monthKeyFromDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : getMonthKey();
}

function formatWeekdayShort(date: string): string {
  const parsed = parseDate(date);
  if (!parsed) return '';
  return parsed.toLocaleDateString('ru-RU', { weekday: 'short' });
}

const GANTT_COLOR_PRESETS = ['#111111', '#1f2937', '#0f766e', '#1d4ed8', '#7c3aed', '#b91c1c', '#ea580c', '#059669'];

function normalizeRecordTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

export default function PageViews({
  activeView,
  activeViewLabel,
  records,
  selectedRecordId,
  architectureStats,
  onSelectRecord,
  onCreateRecord,
  onUpdateRecord,
  onDeleteRecord,
  onReorderRecords,
  onUploadRecordImage,
}: PageViewsProps) {
  const GANTT_DAY_WIDTH = 56;
  const GANTT_SIDE_WIDTH = 280;
  const GANTT_COLLAPSED_WIDTH = 34;
  const GANTT_VISIBLE_DAYS = 16;
  const GANTT_NAV_STEP = 7;
  const dragRecordRef = useRef<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => getMonthKey(records.find((record) => record.date)?.date));
  const [ganttCenterDate, setGanttCenterDate] = useState(
    () => records.find((record) => record.startDate || record.date)?.startDate || records.find((record) => record.date)?.date || formatIsoDate(new Date())
  );
  const [isGanttSidebarCollapsed, setIsGanttSidebarCollapsed] = useState(false);
  const [calendarDraft, setCalendarDraft] = useState(() => ({
    title: '',
    date: toDateString(getMonthKey(), 1),
  }));
  const [showGanttCreateModal, setShowGanttCreateModal] = useState(false);
  const [showColorModal, setShowColorModal] = useState(false);
  const [customColorDraft, setCustomColorDraft] = useState('#111111');
  const [ganttDraftError, setGanttDraftError] = useState('');
  const [ganttDraft, setGanttDraft] = useState(() => ({
    title: '',
    startDate: formatIsoDate(new Date()),
    endDate: addDays(formatIsoDate(new Date()), 2),
    status: 'To Do' as KanbanStatus,
    notes: '',
  }));
  const [kanbanCustomColumns, setKanbanCustomColumns] = useState<KanbanStatus[]>([]);
  const [showKanbanColumnCreator, setShowKanbanColumnCreator] = useState(false);
  const [newKanbanColumnTitle, setNewKanbanColumnTitle] = useState('');
  const [ganttDrag, setGanttDrag] = useState<null | {
    id: string;
    mode: 'move' | 'start' | 'end';
    startX: number;
    pxPerDay: number;
    startDate: string;
    endDate: string;
  }>(null);

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru')),
    [records],
  );
  const recordCustomStatuses = useMemo(
    () =>
      Array.from(
        new Set(
          sortedRecords
            .map((record) => record.status)
            .filter((status) => status && !isBuiltInStatus(status))
        )
      ),
    [sortedRecords],
  );
  const selectedRecord = sortedRecords.find((record) => record.id === selectedRecordId) ?? null;
  const calendarDays = getDaysInMonth(calendarMonth);

  function hasDuplicateTitle(title: string, excludeId?: string): boolean {
    const normalized = normalizeRecordTitle(title);
    if (!normalized) return false;
    return sortedRecords.some(
      (record) => record.id !== excludeId && normalizeRecordTitle(record.title) === normalized
    );
  }

  function createRecordWithUniqueTitle(seed?: Partial<ViewRecord>): string {
    const requestedTitle = seed?.title?.trim() || 'Новая запись';
    let nextTitle = requestedTitle;
    let suffix = 2;
    while (hasDuplicateTitle(nextTitle)) {
      nextTitle = `${requestedTitle} ${suffix}`;
      suffix += 1;
    }
    return onCreateRecord({ ...seed, title: nextTitle });
  }

  function updateRecordTitle(recordId: string, title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (hasDuplicateTitle(trimmed, recordId)) return;
    onUpdateRecord(recordId, { title: trimmed });
  }

  function createKanbanColumn(): void {
    const title = newKanbanColumnTitle.trim();
    if (!title) return;
    if (isBuiltInStatus(title)) return;
    setKanbanCustomColumns((prev) => (prev.includes(title) ? prev : [...prev, title]));
    setNewKanbanColumnTitle('');
    setShowKanbanColumnCreator(false);
  }

  useEffect(() => {
    if (!selectedRecordId) return;
    if (sortedRecords.some((record) => record.id === selectedRecordId)) return;
    onSelectRecord(null);
  }, [onSelectRecord, selectedRecordId, sortedRecords]);

  useEffect(() => {
    const nextCenter = records.find((record) => record.startDate || record.date)?.startDate || records.find((record) => record.date)?.date;
    if (!nextCenter) return;
    setGanttCenterDate((prev) => prev || nextCenter);
  }, [records]);

  useEffect(() => {
    setCustomColorDraft(selectedRecord?.color || '#111111');
  }, [selectedRecord?.id, selectedRecord?.color]);

  useEffect(() => {
    if (recordCustomStatuses.length === 0) return;
    setKanbanCustomColumns((prev) => {
      const next = [...prev];
      for (const status of recordCustomStatuses) {
        if (!next.includes(status)) next.push(status);
      }
      return next;
    });
  }, [recordCustomStatuses]);

  useEffect(() => {
    if (!ganttDrag) return;

    const onMove = (event: MouseEvent) => {
      const deltaDays = Math.round((event.clientX - ganttDrag.startX) / ganttDrag.pxPerDay);

      if (ganttDrag.mode === 'move') {
        onUpdateRecord(ganttDrag.id, {
          startDate: addDays(ganttDrag.startDate, deltaDays),
          endDate: addDays(ganttDrag.endDate, deltaDays),
          date: addDays(ganttDrag.startDate, deltaDays),
        });
        return;
      }

      if (ganttDrag.mode === 'start') {
        const nextStart = addDays(ganttDrag.startDate, deltaDays);
        if (diffDays(nextStart, ganttDrag.endDate) < 0) return;
        onUpdateRecord(ganttDrag.id, {
          startDate: nextStart,
          date: nextStart,
        });
        return;
      }

      const nextEnd = addDays(ganttDrag.endDate, deltaDays);
      if (diffDays(ganttDrag.startDate, nextEnd) < 0) return;
      onUpdateRecord(ganttDrag.id, {
        endDate: nextEnd,
      });
    };

    const onUp = () => setGanttDrag(null);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [ganttDrag, onUpdateRecord]);

  function beginImageUpload(recordId: string): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void onUploadRecordImage(recordId, file);
    };
    input.click();
  }

  function createCalendarRecord(date: string): void {
    const recordId = createRecordWithUniqueTitle({
      title: 'Новое событие',
      date,
      startDate: date,
      endDate: date,
      status: 'To Do',
      typeLabel: 'Событие',
    });
    onSelectRecord(recordId);
  }

  function submitCalendarDraft(): void {
    if (!calendarDraft.title.trim() || !calendarDraft.date) return;
    const recordId = createRecordWithUniqueTitle({
      title: calendarDraft.title.trim(),
      date: calendarDraft.date,
      startDate: calendarDraft.date,
      endDate: calendarDraft.date,
      status: 'To Do',
      typeLabel: 'Событие',
    });
    onSelectRecord(recordId);
    setCalendarDraft((prev) => ({ ...prev, title: '' }));
  }

  function openGanttCreateModal(): void {
    setGanttDraft({
      title: '',
      startDate: ganttCenterDate,
      endDate: addDays(ganttCenterDate, 2),
      status: 'To Do',
      notes: '',
    });
    setGanttDraftError('');
    setShowGanttCreateModal(true);
  }

  function openColorModal(): void {
    setCustomColorDraft(selectedRecord?.color || '#111111');
    setShowColorModal(true);
  }

  function saveCustomColor(): void {
    if (!selectedRecord) return;
    onUpdateRecord(selectedRecord.id, { color: customColorDraft });
    setShowColorModal(false);
  }

  function submitGanttDraft(): void {
    const title = ganttDraft.title.trim();
    if (!title || !ganttDraft.startDate || !ganttDraft.endDate) return;
    if (hasDuplicateTitle(title)) {
      setGanttDraftError('Задача с таким названием уже есть');
      return;
    }

    const startDate = ganttDraft.startDate <= ganttDraft.endDate ? ganttDraft.startDate : ganttDraft.endDate;
    const endDate = ganttDraft.endDate >= ganttDraft.startDate ? ganttDraft.endDate : ganttDraft.startDate;
    const notes = ganttDraft.notes.trim();

    const recordId = onCreateRecord({
      title,
      typeLabel: 'Этап',
      date: startDate,
      startDate,
      endDate,
      status: ganttDraft.status,
      notes,
      excerpt: notes,
      color: '#111111',
    });
    onSelectRecord(recordId);
    setGanttDraftError('');
    setShowGanttCreateModal(false);
  }

  function renderArchitecture() {
    return (
      <div className="page-grid-view">
        <div className="page-grid-view-head">
          <span className="page-grid-view-title">Архитектура</span>
          <span className="page-grid-view-note">Сводка по структуре страницы без редактирования</span>
        </div>
        <div className="architecture-layout architecture-layout--compact">
          <section className="architecture-card">
            <h4>Распределение типов блоков</h4>
            <div className="architecture-badges">
              {Object.entries(architectureStats.typeCounts).map(([type, count]) => (
                <span key={type} className="architecture-badge">
                  {type} <strong>{count}</strong>
                </span>
              ))}
            </div>
          </section>
          <section className="architecture-card">
            <h4>Связи</h4>
            <p>Ссылок на страницы: <strong>{architectureStats.pageLinks}</strong></p>
            <p>Ссылок на таблицы: <strong>{architectureStats.tableLinks}</strong></p>
            <p>Всего найдено записей: <strong>{sortedRecords.length}</strong></p>
          </section>
        </div>
      </div>
    );
  }

  function renderGrid() {
    return (
      <div className="page-grid-view">
        <div className="page-grid-view-head">
          <span className="page-grid-view-title">Сетка</span>
          <span className="page-grid-view-note">Карточки можно перетаскивать и редактировать</span>
        </div>
        <div className="page-view-actions">
          <button type="button" className="btn btn-primary" onClick={() => onSelectRecord(createRecordWithUniqueTitle({ title: 'Новая запись', typeLabel: 'Запись' }))}>
            Новая запись
          </button>
        </div>
        {sortedRecords.length > 0 ? (
          <div className="page-grid-cards">
            {sortedRecords.map((card) => (
              <article
                key={card.id}
                className={`page-grid-card page-grid-card--interactive${selectedRecordId === card.id ? ' is-selected' : ''}`}
                draggable
                onDragStart={() => {
                  dragRecordRef.current = card.id;
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragRecordRef.current) onReorderRecords(dragRecordRef.current, card.id);
                }}
                onClick={() => onSelectRecord(card.id)}
              >
                <div className="page-grid-card-type">{card.typeLabel}</div>
                <h4>{card.title}</h4>
                {card.excerpt && <p>{card.excerpt}</p>}
              </article>
            ))}
          </div>
        ) : (
          <div className="page-grid-empty">Нет записей для отображения</div>
        )}
      </div>
    );
  }

  function renderGallery() {
    return (
      <div className="page-grid-view">
        <div className="page-grid-view-head">
          <span className="page-grid-view-title">Галерея</span>
          <span className="page-grid-view-note">К карточкам можно прикреплять изображения</span>
        </div>
        <div className="page-view-actions">
          <button type="button" className="btn btn-primary" onClick={() => onSelectRecord(createRecordWithUniqueTitle({ title: 'Новая карточка', typeLabel: 'Галерея' }))}>
            Новая карточка
          </button>
        </div>
        {sortedRecords.length > 0 ? (
          <div className="page-gallery-cards">
            {sortedRecords.map((card) => (
              <article
                key={card.id}
                className={`page-gallery-card${selectedRecordId === card.id ? ' is-selected' : ''}`}
                onClick={() => onSelectRecord(card.id)}
              >
                <div className="page-gallery-preview">
                  {card.image ? (
                    <img src={card.image} alt={card.title} className="page-gallery-image" />
                  ) : (
                    <div className="page-gallery-placeholder">
                      <span className="page-gallery-placeholder-icon">Img</span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="page-gallery-upload-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      beginImageUpload(card.id);
                    }}
                  >
                    {card.image ? 'Заменить' : 'Прикрепить'}
                  </button>
                </div>
                <div className="page-gallery-card-body">
                  <h4>{card.title}</h4>
                  <div className={`page-status-badge page-gallery-meta is-${statusClassName(card.status)}`}>{statusLabel(card.status)}</div>
                  <p>{card.notes || card.excerpt || 'Без описания'}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="page-grid-empty">Нет записей для отображения в галерее</div>
        )}
      </div>
    );
  }

  function renderKanban() {
    const statuses: KanbanStatus[] = [...BUILTIN_STATUSES, ...kanbanCustomColumns];
    return (
      <div className="page-grid-view">
        <div className="page-grid-view-head">
          <span className="page-grid-view-title">Канбан</span>
          <span className="page-grid-view-note">Перетаскивайте карточки между колонками и редактируйте их справа</span>
        </div>
        <div className="page-view-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSelectRecord(createRecordWithUniqueTitle({ title: 'Новая задача', typeLabel: 'Задача', status: 'To Do' }))}
          >
            Новая задача
          </button>
        </div>
        <div className="page-kanban">
          {statuses.map((column) => {
            const cards = sortedRecords.filter((record) => record.status === column);
            return (
              <section
                key={column}
                className="page-kanban-col"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (!dragRecordRef.current) return;
                  onUpdateRecord(dragRecordRef.current, { status: column });
                }}
              >
                <header className={`page-kanban-col-header is-${statusClassName(column)}`}>
                  <div className="page-kanban-col-title-wrap">
                    <span className={`page-kanban-col-dot is-${statusClassName(column)}`} />
                    <span>{statusLabel(column)}</span>
                  </div>
                  <span className="page-kanban-col-count">{cards.length}</span>
                </header>
                {cards.length > 0 ? cards.map((card) => (
                  <article
                    key={card.id}
                    className={`page-kanban-card${selectedRecordId === card.id ? ' is-selected' : ''}`}
                    draggable
                    onDragStart={() => {
                      dragRecordRef.current = card.id;
                    }}
                    onDragEnd={() => {
                      dragRecordRef.current = null;
                    }}
                    onClick={() => onSelectRecord(card.id)}
                  >
                    <div className="page-kanban-card-top">
                      <span className="page-kanban-card-type">{card.typeLabel}</span>
                      {card.date && <span className="page-kanban-card-date">{formatShortDate(card.date)}</span>}
                    </div>
                    <h4>{card.title}</h4>
                    <div className={`page-kanban-card-status is-${statusClassName(card.status)}`}>{statusLabel(card.status)}</div>
                    {card.notes && <p>{card.notes}</p>}
                  </article>
                )) : <div className="page-kanban-empty">Пусто</div>}
              </section>
            );
          })}
          <section className="page-kanban-col page-kanban-col--creator">
            {showKanbanColumnCreator ? (
              <div className="page-kanban-create-group">
                <input
                  className="page-form-input"
                  placeholder="Название группы"
                  value={newKanbanColumnTitle}
                  onChange={(event) => setNewKanbanColumnTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      createKanbanColumn();
                    }
                    if (event.key === 'Escape') {
                      setShowKanbanColumnCreator(false);
                      setNewKanbanColumnTitle('');
                    }
                  }}
                  autoFocus
                />
                <div className="page-kanban-create-actions">
                  <button type="button" className="btn btn-primary" onClick={createKanbanColumn} disabled={!newKanbanColumnTitle.trim()}>
                    Создать
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setShowKanbanColumnCreator(false);
                      setNewKanbanColumnTitle('');
                    }}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="page-kanban-add-col"
                onClick={() => setShowKanbanColumnCreator(true)}
              >
                <span className="page-kanban-add-col-icon">+</span>
                <span>Новая группа</span>
              </button>
            )}
          </section>
        </div>
      </div>
    );
  }

  function renderCalendar() {
    return (
      <div className="page-grid-view">
        <div className="page-grid-view-head">
          <span className="page-grid-view-title">Календарь</span>
          <span className="page-grid-view-note">События по датам, можно перетаскивать и создавать по дню</span>
        </div>
        <div className="page-view-toolbar">
          <div className="page-view-month-switcher">
            <button type="button" className="btn btn-ghost" onClick={() => setCalendarMonth((prev) => shiftMonth(prev, -1))}>Назад</button>
            <strong>{formatMonthLabel(calendarMonth)}</strong>
            <button type="button" className="btn btn-ghost" onClick={() => setCalendarMonth((prev) => shiftMonth(prev, 1))}>Вперёд</button>
          </div>
          <div className="page-calendar-create">
            <input
              className="page-form-input"
              placeholder="Название события"
              value={calendarDraft.title}
              onChange={(event) => setCalendarDraft((prev) => ({ ...prev, title: event.target.value }))}
            />
            <input
              className="page-form-input"
              type="date"
              value={calendarDraft.date}
              onChange={(event) => setCalendarDraft((prev) => ({ ...prev, date: event.target.value }))}
            />
            <button type="button" className="btn btn-primary" onClick={submitCalendarDraft}>
              Создать
            </button>
          </div>
        </div>
        <div className="page-calendar-grid">
          {Array.from({ length: calendarDays }, (_, index) => {
            const day = index + 1;
            const date = toDateString(calendarMonth, day);
            const events = sortedRecords.filter((event) => event.date === date);
            return (
              <div
                key={day}
                className="page-calendar-cell"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (!dragRecordRef.current) return;
                  onUpdateRecord(dragRecordRef.current, { date, startDate: date, endDate: date });
                }}
              >
                <div className="page-calendar-day-row">
                  <div className="page-calendar-day">{day}</div>
                  <button type="button" className="page-calendar-day-add" onClick={() => createCalendarRecord(date)}>+</button>
                </div>
                {events.length > 0 ? events.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className={`page-calendar-entry${selectedRecordId === event.id ? ' is-selected' : ''}`}
                    draggable
                    onDragStart={() => {
                      dragRecordRef.current = event.id;
                    }}
                    onDragEnd={() => {
                      dragRecordRef.current = null;
                    }}
                    onClick={() => onSelectRecord(event.id)}
                  >
                    {event.title}
                  </button>
                )) : <div className="page-calendar-empty">-</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderGantt() {
    const ganttRecords = sortedRecords.filter((record) => record.startDate || record.date);
    const timelineStart = addDays(ganttCenterDate, -Math.floor(GANTT_VISIBLE_DAYS / 2));
    const timelineDays = Array.from({ length: GANTT_VISIBLE_DAYS }, (_, index) =>
      addDays(timelineStart, index)
    );
    const timelineGrid = `repeat(${timelineDays.length}, minmax(0, 1fr))`;
    const timelineBackgroundSize = `calc(100% / ${timelineDays.length}) 100%, 100% 100%`;
    const sidebarWidth = isGanttSidebarCollapsed ? GANTT_COLLAPSED_WIDTH : GANTT_SIDE_WIDTH;
    const monthSegments = timelineDays.reduce<Array<{ key: string; label: string; span: number }>>((segments, day) => {
      const key = monthKeyFromDate(day);
      const last = segments[segments.length - 1];
      if (last && last.key === key) {
        last.span += 1;
      } else {
        segments.push({ key, label: formatMonthLabel(key), span: 1 });
      }
      return segments;
    }, []);

    return (
      <div className="page-grid-view">
        <div className="page-grid-view-head">
          <span className="page-grid-view-title">Гант</span>
          <span className="page-grid-view-note">Левая колонка закреплена, а шкала двигается стрелками по бесконечной ленте дат.</span>
        </div>
        <div className="page-view-toolbar page-gantt-toolbar">
          <div className="page-gantt-nav">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setGanttCenterDate((prev) => addDays(prev, -GANTT_NAV_STEP))}
            >
              ←
            </button>
            <strong>{formatMonthLabel(monthKeyFromDate(ganttCenterDate))}</strong>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setGanttCenterDate((prev) => addDays(prev, GANTT_NAV_STEP))}
            >
              →
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setGanttCenterDate(formatIsoDate(new Date()))}
            >
              Сегодня
            </button>
            <span className="page-gantt-range-label">
              {formatShortDate(timelineStart)} - {formatShortDate(addDays(timelineStart, timelineDays.length - 1))}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={openGanttCreateModal}
          >
            Новый этап
          </button>
        </div>
        <div className="page-gantt-surface">
          <div className="page-gantt-header-row" style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}>
            <div className="page-gantt-header-spacer">
              <div className={`page-gantt-header-spacer-content${isGanttSidebarCollapsed ? ' is-collapsed' : ''}`}>
                <button
                  type="button"
                  className="page-gantt-pane-toggle"
                  onClick={() => setIsGanttSidebarCollapsed((prev) => !prev)}
                  aria-label={isGanttSidebarCollapsed ? 'Открыть список задач' : 'Скрыть список задач'}
                  title={isGanttSidebarCollapsed ? 'Открыть список задач' : 'Скрыть список задач'}
                >
                  {isGanttSidebarCollapsed ? '→' : '←'}
                </button>
                {!isGanttSidebarCollapsed && (
                  <div className="page-gantt-header-caption">
                    <strong>Задачи</strong>
                    <span>Статичный список этапов</span>
                  </div>
                )}
              </div>
            </div>
            <div className="page-gantt-header-timeline">
              <div className="page-gantt-months" style={{ gridTemplateColumns: timelineGrid }}>
                {monthSegments.map((segment) => (
                  <div key={segment.key} className="page-gantt-month-segment" style={{ gridColumn: `span ${segment.span}` }}>
                    {segment.label}
                  </div>
                ))}
              </div>
              <div className="page-gantt-scale" style={{ gridTemplateColumns: timelineGrid }}>
                {timelineDays.map((day) => (
                  <span key={day} className={day === formatIsoDate(new Date()) ? 'is-today' : ''}>
                    <strong>{Number(day.slice(-2))}</strong>
                    <small>{formatWeekdayShort(day)}</small>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="page-gantt">
            {ganttRecords.length > 0 ? ganttRecords.map((item) => {
              const start = item.startDate || item.date || ganttCenterDate;
              const end = item.endDate || start;
              const startOffset = diffDays(timelineStart, start);
              const duration = Math.max(1, diffDays(start, end) + 1);
              const left = `${(startOffset / timelineDays.length) * 100}%`;
              const widthPercent = `${(duration / timelineDays.length) * 100}%`;
              const minBarWidth = Math.round(sidebarWidth * 0.88);
              const barStyle = {
                left,
                width: `max(${widthPercent}, ${minBarWidth}px)`,
                maxWidth: `calc(100% - ${left})`,
                '--gantt-bar-color': item.color || '#111111',
              } as CSSProperties;
              return (
                <div key={item.id} className="page-gantt-row" style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}>
                  {isGanttSidebarCollapsed ? (
                    <div className="page-gantt-collapsed-slot" />
                  ) : (
                    <button
                      type="button"
                      className={`page-gantt-label${selectedRecordId === item.id ? ' is-selected' : ''}`}
                      onClick={() => onSelectRecord(item.id)}
                    >
                      <span className={`page-gantt-label-badge is-${statusClassName(item.status)}`}>{statusLabel(item.status)}</span>
                      <span className="page-gantt-label-title">{item.title}</span>
                    </button>
                  )}
                  <div className="page-gantt-track" style={{ backgroundSize: timelineBackgroundSize }}>
                    <div
                      className={`page-gantt-bar${selectedRecordId === item.id ? ' is-selected' : ''}`}
                      style={barStyle}
                      onMouseDown={(event) => {
                        setGanttDrag({
                          id: item.id,
                          mode: 'move',
                          startX: event.clientX,
                          pxPerDay: GANTT_DAY_WIDTH,
                          startDate: start,
                          endDate: end,
                        });
                      }}
                      onClick={() => onSelectRecord(item.id)}
                    >
                      <span
                        className="page-gantt-handle is-start"
                        title="Растянуть влево"
                        onMouseDown={(event) => {
                          event.stopPropagation();
                          setGanttDrag({
                            id: item.id,
                            mode: 'start',
                            startX: event.clientX,
                            pxPerDay: GANTT_DAY_WIDTH,
                            startDate: start,
                            endDate: end,
                          });
                        }}
                      />
                      <span className="page-gantt-bar-label">{item.title}</span>
                      <span
                        className="page-gantt-handle is-end"
                        title="Растянуть вправо"
                        onMouseDown={(event) => {
                          event.stopPropagation();
                          setGanttDrag({
                            id: item.id,
                            mode: 'end',
                            startX: event.clientX,
                            pxPerDay: GANTT_DAY_WIDTH,
                            startDate: start,
                            endDate: end,
                          });
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            }) : <div className="page-grid-empty">Нет записей с корректными диапазонами дат.</div>}
          </div>
        </div>
      </div>
    );
  }

  function renderForm() {
    const formRecords = sortedRecords.filter((record) => record.source === 'manual');
    return (
      <div className="page-grid-view">
        <div className="page-grid-view-head">
          <span className="page-grid-view-title">Форма</span>
          <span className="page-grid-view-note">Создавайте записи и удаляйте их из списка</span>
        </div>
        <div className="page-form-view">
          <div className="page-form-fields">
            <div className="page-form-section-title">Редактор записи</div>
            <input
              className="page-form-input"
              placeholder="Название записи"
              value={selectedRecord?.source === 'manual' ? selectedRecord.title : ''}
              onChange={(event) => {
                if (selectedRecord?.source === 'manual') updateRecordTitle(selectedRecord.id, event.target.value);
              }}
            />
            <input
              className="page-form-input"
              type="date"
              value={selectedRecord?.source === 'manual' ? selectedRecord.date : ''}
              onChange={(event) => {
                if (selectedRecord?.source === 'manual') {
                  onUpdateRecord(selectedRecord.id, {
                    date: event.target.value,
                    startDate: event.target.value,
                    endDate: event.target.value,
                  });
                }
              }}
            />
            <StatusField
              value={selectedRecord?.source === 'manual' ? selectedRecord.status : 'To Do'}
              onChange={(status) => {
                if (selectedRecord?.source === 'manual') onUpdateRecord(selectedRecord.id, { status });
              }}
            />
            <textarea
              className="page-form-input page-form-textarea"
              placeholder="Заметки"
              value={selectedRecord?.source === 'manual' ? selectedRecord.notes : ''}
              onChange={(event) => {
                if (selectedRecord?.source === 'manual') onUpdateRecord(selectedRecord.id, { notes: event.target.value });
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onSelectRecord(createRecordWithUniqueTitle({ title: 'Новая запись', typeLabel: 'Запись', status: 'To Do' }))}
            >
              Создать запись
            </button>
          </div>
          <div className="page-form-table">
            <div className="page-form-table-head">
              <span>Запись</span>
              <span>Статус</span>
              <span>Дата</span>
              <span>Действие</span>
            </div>
            {formRecords.length > 0 ? formRecords.map((row) => (
              <div key={row.id} className={`page-form-row${selectedRecordId === row.id ? ' is-selected' : ''}`}>
                <button type="button" className="page-form-row-main" onClick={() => onSelectRecord(row.id)}>
                  <div className="page-form-row-title">
                    <strong>{row.title}</strong>
                    {row.notes && <small>{row.notes}</small>}
                  </div>
                  <span className={`page-form-status is-${statusClassName(row.status)}`}>{statusLabel(row.status)}</span>
                  <span>{row.date || '-'}</span>
                </button>
                <button type="button" className="btn btn-ghost page-form-delete" onClick={() => onDeleteRecord(row.id)}>
                  Удалить
                </button>
              </div>
            )) : <div className="page-grid-empty">Записей пока нет, создайте первую через форму</div>}
          </div>
        </div>
      </div>
    );
  }

  function renderRecordInspector() {
    if (!selectedRecord) {
      return (
        <aside className="page-view-side">
          <div className="page-view-side-empty">Выберите запись, чтобы редактировать поля и вложения.</div>
        </aside>
      );
    }

    return (
      <aside className="page-view-side">
        <div className="page-view-side-section">
          <label className="page-view-field">
            <span>Название</span>
            <input
              className="page-form-input"
              value={selectedRecord.title}
              onChange={(event) => updateRecordTitle(selectedRecord.id, event.target.value)}
            />
          </label>
          <label className="page-view-field">
            <span>Статус</span>
            <StatusField
              value={selectedRecord.status}
              onChange={(status) => onUpdateRecord(selectedRecord.id, { status })}
            />
          </label>
          <label className="page-view-field">
            <span>Дата</span>
            <input
              className="page-form-input"
              type="date"
              value={selectedRecord.date}
              onChange={(event) => onUpdateRecord(selectedRecord.id, { date: event.target.value })}
            />
          </label>
          <div className="page-view-field-row">
            <label className="page-view-field">
              <span>Дата начала</span>
              <input
                className="page-form-input"
                type="date"
                value={selectedRecord.startDate}
                onChange={(event) => onUpdateRecord(selectedRecord.id, {
                  startDate: event.target.value,
                  date: event.target.value || selectedRecord.date,
                })}
              />
            </label>
            <label className="page-view-field">
              <span>Дата окончания</span>
              <input
                className="page-form-input"
                type="date"
                value={selectedRecord.endDate}
                onChange={(event) => onUpdateRecord(selectedRecord.id, { endDate: event.target.value })}
              />
            </label>
          </div>
          <label className="page-view-field">
            <span>Описание</span>
            <textarea
              className="page-form-input page-form-textarea"
              value={selectedRecord.notes}
              onChange={(event) => onUpdateRecord(selectedRecord.id, { notes: event.target.value, excerpt: event.target.value })}
            />
          </label>
          <label className="page-view-field">
            <span>Цвет задачи</span>
            <div className="page-gantt-color-editor">
              <div className="page-gantt-color-presets">
                {GANTT_COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`page-gantt-color-swatch${(selectedRecord.color || '#111111') === color ? ' is-selected' : ''}`}
                    style={{ background: color }}
                    onClick={() => onUpdateRecord(selectedRecord.id, { color })}
                    aria-label={`Выбрать цвет ${color}`}
                    title={color}
                  />
                ))}
              </div>
              <label className="page-gantt-color-picker">
                <button
                  type="button"
                  className="page-gantt-color-picker-trigger"
                  onClick={openColorModal}
                >
                  <span
                    className="page-gantt-color-picker-preview"
                    style={{ background: selectedRecord.color || '#111111' }}
                  />
                  <span>{selectedRecord.color || '#111111'}</span>
                </button>
              </label>
            </div>
          </label>
        </div>
        <div className="page-view-side-section">
          {selectedRecord.image ? (
            <div className="page-view-image-card">
              <img src={selectedRecord.image} alt={selectedRecord.title} className="page-view-image-preview" />
              <div className="page-view-image-actions">
                <button type="button" className="btn btn-ghost" onClick={() => beginImageUpload(selectedRecord.id)}>
                  Заменить изображение
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => onUpdateRecord(selectedRecord.id, { image: '' })}>
                  Убрать изображение
                </button>
              </div>
            </div>
          ) : (
            <div className="page-view-image-actions">
              <button type="button" className="btn btn-ghost" onClick={() => beginImageUpload(selectedRecord.id)}>
                Прикрепить изображение
              </button>
            </div>
          )}
          {selectedRecord.source === 'manual' && (
            <button type="button" className="btn btn-ghost page-view-danger" onClick={() => onDeleteRecord(selectedRecord.id)}>
              Удалить запись
            </button>
          )}
        </div>
      </aside>
    );
  }

  if (activeView === 'architecture') return renderArchitecture();

  return (
    <>
      <div className="page-view-shell">
        <div className="page-view-main">
          {activeView === 'grid' && renderGrid()}
          {activeView === 'gallery' && renderGallery()}
          {activeView === 'kanban' && renderKanban()}
          {activeView === 'calendar' && renderCalendar()}
          {activeView === 'gantt' && renderGantt()}
          {activeView === 'form' && renderForm()}
          {!['grid', 'gallery', 'kanban', 'calendar', 'gantt', 'form'].includes(activeView) && (
            <div className="page-grid-view">
              <div className="page-grid-view-head">
                <span className="page-grid-view-title">{activeViewLabel}</span>
                <span className="page-grid-view-note">Представление</span>
              </div>
              <div className="page-grid-empty">Это представление пока недоступно</div>
            </div>
          )}
        </div>
        {(activeView !== 'gantt' || selectedRecord) && renderRecordInspector()}
      </div>
      {showGanttCreateModal && (
        <div className="modal-overlay" onClick={() => setShowGanttCreateModal(false)}>
          <div className="modal page-gantt-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Новый этап</h3>
            <p className="modal-note">Создание записи для диаграммы Ганта вынесено в отдельное окно.</p>
            <div className="page-gantt-modal-fields">
              <label className="page-view-field">
                <span>Название</span>
                <input
                  className="page-form-input"
                  placeholder="Например, дизайн этапа"
                  value={ganttDraft.title}
                  onChange={(event) => {
                    const nextTitle = event.target.value;
                    setGanttDraft((prev) => ({ ...prev, title: nextTitle }));
                    if (!nextTitle.trim() || !hasDuplicateTitle(nextTitle)) {
                      setGanttDraftError('');
                    }
                  }}
                />
              </label>
              <label className="page-view-field">
                <span>Статус</span>
                <StatusField
                  value={ganttDraft.status}
                  onChange={(status) => setGanttDraft((prev) => ({ ...prev, status }))}
                />
              </label>
              <label className="page-view-field">
                <span>Дата начала</span>
                <input
                  className="page-form-input"
                  type="date"
                  value={ganttDraft.startDate}
                  onChange={(event) => setGanttDraft((prev) => ({ ...prev, startDate: event.target.value }))}
                />
              </label>
              <label className="page-view-field">
                <span>Дата окончания</span>
                <input
                  className="page-form-input"
                  type="date"
                  value={ganttDraft.endDate}
                  onChange={(event) => setGanttDraft((prev) => ({ ...prev, endDate: event.target.value }))}
                />
              </label>
              <label className="page-view-field page-gantt-modal-notes">
                <span>Описание</span>
                <textarea
                  className="page-form-input page-form-textarea"
                  placeholder="Коротко опишите этап"
                  value={ganttDraft.notes}
                  onChange={(event) => setGanttDraft((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </label>
            </div>
            {ganttDraftError && <div className="auth-error">{ganttDraftError}</div>}
            <div className="modal-actions">
              <button className="modal-close" onClick={() => setShowGanttCreateModal(false)}>
                Отмена
              </button>
              <button className="modal-close" onClick={submitGanttDraft} disabled={!ganttDraft.title.trim() || !ganttDraft.startDate || !ganttDraft.endDate}>
                Создать
              </button>
            </div>
          </div>
        </div>
      )}
      {showColorModal && selectedRecord && (
        <div className="modal-overlay" onClick={() => setShowColorModal(false)}>
          <div className="modal page-gantt-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Цвет задачи</h3>
            <p className="modal-note">Выберите один из базовых цветов или задайте собственный оттенок.</p>
            <div className="page-gantt-color-modal">
              <div className="page-gantt-color-presets">
                {GANTT_COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`page-gantt-color-swatch${customColorDraft === color ? ' is-selected' : ''}`}
                    style={{ background: color }}
                    onClick={() => setCustomColorDraft(color)}
                    aria-label={`Выбрать цвет ${color}`}
                    title={color}
                  />
                ))}
              </div>
              <label className="page-gantt-color-modal-picker">
                <span>Свой цвет</span>
                <div className="page-gantt-color-modal-input">
                  <input
                    type="color"
                    value={customColorDraft}
                    onChange={(event) => setCustomColorDraft(event.target.value)}
                  />
                  <span>{customColorDraft}</span>
                </div>
              </label>
            </div>
            <div className="modal-actions">
              <button className="modal-close" onClick={() => setShowColorModal(false)}>
                Отмена
              </button>
              <button className="modal-close" onClick={saveCustomColor}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

