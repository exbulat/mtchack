import { useEffect, useMemo, useRef, useState } from 'react';

export interface SlashItem {
  id: string;
  label: string;
  icon: string;
  description?: string;
  hotkey?: string;
  group?: string;
}

interface SlashMenuProps {
  x: number;
  y: number;
  selectedIndex: number;
  onSelect: (item: SlashItem) => void;
  onClose?: () => void;
  onIndexChange?: (idx: number) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  // Текст
  { id: 'h1', label: 'Заголовок 1', icon: 'H1', description: 'Большой заголовок раздела', hotkey: '#', group: 'Текст' },
  { id: 'h2', label: 'Заголовок 2', icon: 'H2', description: 'Средний заголовок', hotkey: '##', group: 'Текст' },
  { id: 'h3', label: 'Заголовок 3', icon: 'H3', description: 'Малый заголовок', hotkey: '###', group: 'Текст' },
  { id: 'quote', label: 'Цитата', icon: '❝', description: 'Блок цитаты', hotkey: '>', group: 'Текст' },
  { id: 'code', label: 'Код', icon: '</>', description: 'Блок кода с подсветкой синтаксиса', hotkey: '```', group: 'Текст' },
  { id: 'divider', label: 'Разделитель', icon: '—', description: 'Горизонтальная линия', hotkey: '---', group: 'Текст' },
  // Списки
  { id: 'bullet', label: 'Маркированный список', icon: '•', description: 'Простой список с точками', hotkey: '-', group: 'Списки' },
  { id: 'ordered', label: 'Нумерованный список', icon: '1.', description: 'Список с нумерацией', hotkey: '1.', group: 'Списки' },
  // Таблицы
  { id: 'simpleTable', label: 'Таблица', icon: '⊞', description: 'Простая таблица в документе', group: 'Вставка' },
  { id: 'mwsTable', label: 'Таблица MWS', icon: '📊', description: 'Живая таблица из MWS Tables', group: 'Вставка' },
  { id: 'image', label: 'Изображение', icon: '🖼', description: 'Загрузить изображение с компьютера', group: 'Вставка' },
  { id: 'pageLink', label: 'Wiki link', icon: '[[', description: 'Link to another page in the workspace', group: 'Р’СЃС‚Р°РІРєР°' },
  // AI
  { id: 'ai', label: 'AI-блок', icon: '✨', description: 'Сгенерировать текст с помощью ИИ', group: 'Вставка' },
];

export default function SlashMenu({ x, y, selectedIndex, onSelect, onClose, onIndexChange }: SlashMenuProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return SLASH_ITEMS;
    const q = query.toLowerCase();
    return SLASH_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
    );
  }, [query]);

  // Group items
  const grouped = useMemo(() => {
    const groups: Record<string, SlashItem[]> = {};
    for (const item of filtered) {
      const g = item.group || 'Прочее';
      if (!groups[g]) groups[g] = [];
      groups[g].push(item);
    }
    return groups;
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatFiltered = useMemo(() => filtered, [filtered]);

  // Reset index when filter changes
  useEffect(() => {
    onIndexChange?.(0);
  }, [query, onIndexChange]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onIndexChange?.(Math.min(selectedIndex + 1, flatFiltered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onIndexChange?.(Math.max(selectedIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatFiltered[selectedIndex];
      if (item) onSelect(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
    }
  };

  let globalIdx = 0;

  return (
    <div
      className="slash-menu"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="slash-menu-search">
        <input
          ref={inputRef}
          className="slash-menu-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Поиск блока…"
        />
      </div>
      <div ref={listRef} className="slash-menu-list">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group} className="slash-menu-group">
            {!query && <div className="slash-menu-group-label">{group}</div>}
            {items.map((item) => {
              const idx = globalIdx++;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  data-idx={idx}
                  className={`slash-menu-item${isSelected ? ' selected' : ''}`}
                  onMouseEnter={() => onIndexChange?.(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(item);
                  }}
                >
                  <span className="slash-menu-item-icon">{item.icon}</span>
                  <div className="slash-menu-item-body">
                    <span className="slash-menu-item-label">{item.label}</span>
                    {item.description && (
                      <span className="slash-menu-item-desc">{item.description}</span>
                    )}
                  </div>
                  {item.hotkey && (
                    <span className="slash-menu-item-hotkey">{item.hotkey}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {flatFiltered.length === 0 && (
          <div className="slash-menu-empty">Ничего не найдено</div>
        )}
      </div>
    </div>
  );
}
