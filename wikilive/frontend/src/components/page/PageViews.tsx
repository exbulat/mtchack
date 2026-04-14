import { useEffect, useMemo, useRef, useState } from 'react';

export type KanbanStatus = 'To Do' | 'In Progress' | 'Done' | 'Other';

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

function statusLabel(status: KanbanStatus): string {
  if (status === 'To Do') return 'К выполнению';
  if (status === 'In Progress') return 'В работе';
  if (status === 'Done') return 'Готово';
  return 'Другое';
}

function statusClassName(status: KanbanStatus): string {
  if (status === 'To Do') return 'todo';
  if (status === 'In Progress') return 'progress';
  if (status === 'Done') return 'done';
  return 'other';
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
  const dragRecordRef = useRef<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => getMonthKey(records.find((record) => record.date)?.date));
  const [ganttMonth, setGanttMonth] = useState(() => getMonthKey(records.find((record) => record.startDate || record.date)?.startDate || records.find((record) => record.date)?.date));
  const [calendarDraft, setCalendarDraft] = useState(() => ({
    title: '',
    date: toDateString(getMonthKey(), 1),
  }));
  const [showGanttCreateModal, setShowGanttCreateModal] = useState(false);
  const [ganttDraft, setGanttDraft] = useState(() => ({
    title: '',
    startDate: toDateString(getMonthKey(), 1),
    endDate: toDateString(getMonthKey(), Math.min(3, getDaysInMonth(getMonthKey()))),
    status: 'To Do' as KanbanStatus,
    notes: '',
  }));
  const [ganttDrag, setGanttDrag] = useState<null | {
    id: string;
    mode: 'move' | 'start' | 'end';
    startX: number;
    pxPerDay: number;
    startDay: number;
    endDay: number;
    daysInMonth: number;
    monthKey: string;
  }>(null);

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru')),
    [records],
  );
  const selectedRecord = sortedRecords.find((record) => record.id === selectedRecordId) ?? null;
  const calendarDays = getDaysInMonth(calendarMonth);
  const ganttDays = getDaysInMonth(ganttMonth);

  useEffect(() => {
    if (!selectedRecordId) return;
    if (sortedRecords.some((record) => record.id === selectedRecordId)) return;
    onSelectRecord(null);
  }, [onSelectRecord, selectedRecordId, sortedRecords]);

  useEffect(() => {
    if (!ganttDrag) return;

    const onMove = (event: MouseEvent) => {
      const deltaDays = Math.round((event.clientX - ganttDrag.startX) / ganttDrag.pxPerDay);
      const span = ganttDrag.endDay - ganttDrag.startDay;

      if (ganttDrag.mode === 'move') {
        const nextStart = clamp(ganttDrag.startDay + deltaDays, 1, Math.max(1, ganttDrag.daysInMonth - span));
        const nextEnd = clamp(nextStart + span, nextStart, ganttDrag.daysInMonth);
        onUpdateRecord(ganttDrag.id, {
          startDate: toDateString(ganttDrag.monthKey, nextStart),
          endDate: toDateString(ganttDrag.monthKey, nextEnd),
          date: toDateString(ganttDrag.monthKey, nextStart),
        });
        return;
      }

      if (ganttDrag.mode === 'start') {
        const nextStart = clamp(ganttDrag.startDay + deltaDays, 1, ganttDrag.endDay);
        onUpdateRecord(ganttDrag.id, {
          startDate: toDateString(ganttDrag.monthKey, nextStart),
          date: toDateString(ganttDrag.monthKey, nextStart),
        });
        return;
      }

      const nextEnd = clamp(ganttDrag.endDay + deltaDays, ganttDrag.startDay, ganttDrag.daysInMonth);
      onUpdateRecord(ganttDrag.id, {
        endDate: toDateString(ganttDrag.monthKey, nextEnd),
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
    const recordId = onCreateRecord({
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
    const recordId = onCreateRecord({
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
    const monthDays = getDaysInMonth(ganttMonth);
    setGanttDraft({
      title: '',
      startDate: toDateString(ganttMonth, 1),
      endDate: toDateString(ganttMonth, Math.min(3, monthDays)),
      status: 'To Do',
      notes: '',
    });
    setShowGanttCreateModal(true);
  }

  function submitGanttDraft(): void {
    const title = ganttDraft.title.trim();
    if (!title || !ganttDraft.startDate || !ganttDraft.endDate) return;

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
    });
    onSelectRecord(recordId);
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
          <button type="button" className="btn btn-primary" onClick={() => onSelectRecord(onCreateRecord({ title: 'Новая запись', typeLabel: 'Запись' }))}>
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
          <button type="button" className="btn btn-primary" onClick={() => onSelectRecord(onCreateRecord({ title: 'Новая карточка', typeLabel: 'Галерея' }))}>
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
                  <div className="page-gallery-meta">{statusLabel(card.status)}</div>
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
    const statuses: KanbanStatus[] = ['To Do', 'In Progress', 'Done', 'Other'];
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
            onClick={() => onSelectRecord(onCreateRecord({ title: 'Новая задача', typeLabel: 'Задача', status: 'To Do' }))}
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

    return (
      <div className="page-grid-view">
        <div className="page-grid-view-head">
          <span className="page-grid-view-title">Гант</span>
          <span className="page-grid-view-note">Полосу можно двигать и растягивать за края</span>
        </div>
        <div className="page-view-toolbar">
          <div className="page-view-month-switcher">
            <button type="button" className="btn btn-ghost" onClick={() => setGanttMonth((prev) => shiftMonth(prev, -1))}>Назад</button>
            <strong>{formatMonthLabel(ganttMonth)}</strong>
            <button type="button" className="btn btn-ghost" onClick={() => setGanttMonth((prev) => shiftMonth(prev, 1))}>Вперёд</button>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={openGanttCreateModal}
          >
            Новый этап
          </button>
        </div>
        <div className="page-gantt-scale">
          {Array.from({ length: ganttDays }, (_, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>
        <div className="page-gantt">
          {ganttRecords.length > 0 ? ganttRecords.map((item) => {
            const start = item.startDate || item.date || toDateString(ganttMonth, 1);
            const end = item.endDate || start;
            const startDay = getDayNumber(start, ganttMonth);
            const endDay = getDayNumber(end, ganttMonth);
            const left = ((startDay - 1) / ganttDays) * 100;
            const width = (Math.max(1, endDay - startDay + 1) / ganttDays) * 100;
            const duration = Math.max(1, endDay - startDay + 1);
            return (
              <div key={item.id} className="page-gantt-row">
                <button
                  type="button"
                  className={`page-gantt-label${selectedRecordId === item.id ? ' is-selected' : ''}`}
                  onClick={() => onSelectRecord(item.id)}
                >
                  <span className={`page-gantt-label-badge is-${statusClassName(item.status)}`}>{statusLabel(item.status)}</span>
                  <span className="page-gantt-label-title">{item.title}</span>
                  <span className="page-gantt-label-meta">
                    {formatShortDate(start)} - {formatShortDate(end)}
                  </span>
                  <span className="page-gantt-label-submeta">
                    {duration} дн. {item.typeLabel ? `• ${item.typeLabel}` : ''}
                  </span>
                </button>
                <div className="page-gantt-track">
                  <div
                    className={`page-gantt-bar${selectedRecordId === item.id ? ' is-selected' : ''}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    onMouseDown={(event) => {
                      setGanttDrag({
                        id: item.id,
                        mode: 'move',
                        startX: event.clientX,
                        pxPerDay: Math.max(8, event.currentTarget.parentElement!.getBoundingClientRect().width / ganttDays),
                        startDay,
                        endDay,
                        daysInMonth: ganttDays,
                        monthKey: ganttMonth,
                      });
                    }}
                    onClick={() => onSelectRecord(item.id)}
                  >
                    <span
                      className="page-gantt-handle is-start"
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        setGanttDrag({
                          id: item.id,
                          mode: 'start',
                          startX: event.clientX,
                          pxPerDay: Math.max(8, event.currentTarget.parentElement!.parentElement!.getBoundingClientRect().width / ganttDays),
                          startDay,
                          endDay,
                          daysInMonth: ganttDays,
                          monthKey: ganttMonth,
                        });
                      }}
                    />
                    <span className="page-gantt-bar-label">{item.title}</span>
                    <span
                      className="page-gantt-handle is-end"
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        setGanttDrag({
                          id: item.id,
                          mode: 'end',
                          startX: event.clientX,
                          pxPerDay: Math.max(8, event.currentTarget.parentElement!.parentElement!.getBoundingClientRect().width / ganttDays),
                          startDay,
                          endDay,
                          daysInMonth: ganttDays,
                          monthKey: ganttMonth,
                        });
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          }) : <div className="page-grid-empty">Нет записей с корректными диапазонами дат</div>}
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
                if (selectedRecord?.source === 'manual') onUpdateRecord(selectedRecord.id, { title: event.target.value });
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
            <select
              className="page-form-input"
              value={selectedRecord?.source === 'manual' ? selectedRecord.status : 'To Do'}
              onChange={(event) => {
                if (selectedRecord?.source === 'manual') onUpdateRecord(selectedRecord.id, { status: event.target.value as KanbanStatus });
              }}
            >
              <option value="To Do">К выполнению</option>
              <option value="In Progress">В работе</option>
              <option value="Done">Готово</option>
              <option value="Other">Другое</option>
            </select>
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
              onClick={() => onSelectRecord(onCreateRecord({ title: 'Новая запись', typeLabel: 'Запись', status: 'To Do' }))}
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
              onChange={(event) => onUpdateRecord(selectedRecord.id, { title: event.target.value })}
            />
          </label>
          <label className="page-view-field">
            <span>Статус</span>
            <select
              className="page-form-input"
              value={selectedRecord.status}
              onChange={(event) => onUpdateRecord(selectedRecord.id, { status: event.target.value as KanbanStatus })}
            >
              <option value="To Do">К выполнению</option>
              <option value="In Progress">В работе</option>
              <option value="Done">Готово</option>
              <option value="Other">Другое</option>
            </select>
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
              <span>Начало</span>
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
              <span>Окончание</span>
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
        </div>
        <div className="page-view-side-section">
          <div className="page-view-image-card">
            {selectedRecord.image ? (
              <img src={selectedRecord.image} alt={selectedRecord.title} className="page-view-image-preview" />
            ) : (
              <div className="page-view-image-empty">Нет изображения</div>
            )}
            <div className="page-view-image-actions">
              <button type="button" className="btn btn-ghost" onClick={() => beginImageUpload(selectedRecord.id)}>
                {selectedRecord.image ? 'Заменить изображение' : 'Прикрепить изображение'}
              </button>
              {selectedRecord.image && (
                <button type="button" className="btn btn-ghost" onClick={() => onUpdateRecord(selectedRecord.id, { image: '' })}>
                  Убрать изображение
                </button>
              )}
            </div>
          </div>
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
        {renderRecordInspector()}
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
                  onChange={(event) => setGanttDraft((prev) => ({ ...prev, title: event.target.value }))}
                />
              </label>
              <label className="page-view-field">
                <span>Статус</span>
                <select
                  className="page-form-input"
                  value={ganttDraft.status}
                  onChange={(event) => setGanttDraft((prev) => ({ ...prev, status: event.target.value as KanbanStatus }))}
                >
                  <option value="To Do">К выполнению</option>
                  <option value="In Progress">В работе</option>
                  <option value="Done">Готово</option>
                  <option value="Other">Другое</option>
                </select>
              </label>
              <label className="page-view-field">
                <span>Начало</span>
                <input
                  className="page-form-input"
                  type="date"
                  value={ganttDraft.startDate}
                  onChange={(event) => setGanttDraft((prev) => ({ ...prev, startDate: event.target.value }))}
                />
              </label>
              <label className="page-view-field">
                <span>Завершение</span>
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
    </>
  );
}