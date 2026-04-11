import { useMemo } from 'react';

export interface SlashItem {
  id: string;
  label: string;
  icon: string;
}

interface SlashMenuProps {
  x: number;
  y: number;
  selectedIndex: number;
  onSelect: (item: SlashItem) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'h1', label: 'Заголовок 1', icon: 'H1' },
  { id: 'h2', label: 'Заголовок 2', icon: 'H2' },
  { id: 'h3', label: 'Заголовок 3', icon: 'H3' },
  { id: 'bullet', label: 'Маркированный список', icon: '\u2022' },
  { id: 'ordered', label: 'Нумерованный список', icon: '1.' },
  { id: 'quote', label: 'Цитата', icon: '\u201C' },
  { id: 'code', label: 'Код', icon: '</>' },
  { id: 'divider', label: 'Разделитель', icon: '\u2014' },
  { id: 'simpleTable', label: 'Таблица', icon: '\u25A7' },
  { id: 'mwsTable', label: 'Таблица MWS', icon: '\u{1F4CA}' },
  { id: 'ai', label: 'AI-блок', icon: '\u2728' },
];

export default function SlashMenu({ x, y, selectedIndex, onSelect }: SlashMenuProps) {
  const items = useMemo(() => SLASH_ITEMS, []);

  return (
    <div className="slash-menu" style={{ left: x, top: y }}>
      {items.map((item, idx) => (
        <div
          key={item.id}
          className={`slash-menu-item${selectedIndex === idx ? ' selected' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(item);
          }}
        >
          <span className="slash-menu-item-icon">{item.icon}</span>
          <span className="slash-menu-item-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
