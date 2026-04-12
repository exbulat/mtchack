import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { api, type PageSummary } from '../lib/api';
import { useSpaces } from '../context/SpaceContext';

export const PagesListContext = createContext<{
  pagesListVersion: number;
  bumpPagesList: () => void;
}>({ pagesListVersion: 0, bumpPagesList: () => {} });

export function PagesListProvider({ children }: { children: React.ReactNode }) {
  const [pagesListVersion, setPagesListVersion] = useState(0);
  const bumpPagesList = useCallback(() => setPagesListVersion((v) => v + 1), []);
  return (
    <PagesListContext.Provider value={{ pagesListVersion, bumpPagesList }}>
      {children}
    </PagesListContext.Provider>
  );
}

export default function RightSidebar() {
  const { activeSpace } = useSpaces();
  const navigate = useNavigate();
  const params = useParams<{ spaceId?: string; pageId?: string }>();
  const currentSpaceId = params.spaceId ?? activeSpace?.id;

  const [pages, setPages] = useState<PageSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const { pagesListVersion, bumpPagesList } = useContext(PagesListContext);

  const loadPages = async () => {
    if (!currentSpaceId) return;
    try {
      const data = await api.getSpacePages(currentSpaceId);
      setPages(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadPages();
  }, [pagesListVersion, currentSpaceId]);

  const createPage = async () => {
    if (!currentSpaceId) {
      navigate('/');
      return;
    }
    try {
      const page = await api.createSpacePage(currentSpaceId, { title: 'Без названия' });
      bumpPagesList();
      navigate(`/spaces/${currentSpaceId}/page/${page.id}`);
    } catch {
      // fallback
    }
  };

  const deletePage = async (e: React.MouseEvent, pageId: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await api.deletePage(pageId);
      bumpPagesList();
    } catch {
      // ignore
    }
  };

  const filteredPages = searchQuery
    ? pages.filter((p) => (p.title || 'Без названия').toLowerCase().includes(searchQuery.toLowerCase()))
    : pages;

  if (!currentSpaceId) {
    return (
      <aside style={{
        width: 250, flexShrink: 0,
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 24, gap: 8,
      }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          Выберите или создайте пространство
        </div>
        <button
          className="btn btn-primary"
          onClick={() => navigate('/')}
          style={{ fontSize: 12, padding: '6px 14px', marginTop: 8 }}
        >
          + Создать
        </button>
      </aside>
    );
  }

  return (
    <aside style={{
      width: 250,
      flexShrink: 0,
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      color: 'var(--text)',
      fontSize: 14,
    }}>
      {/* Заголовок: название пространства + поиск */}
      <div style={{
        padding: '14px 14px 10px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{
          fontWeight: 600,
          fontSize: 14,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: '#0e0e18',
        }}>
          {activeSpace?.name ?? 'Пространство'}
        </span>
        <button
          onClick={() => setShowSearch((v) => !v)}
          title="Поиск"
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: 'none',
            background: showSearch ? 'var(--text)' : 'var(--surface)',
            color: showSearch ? 'var(--bg)' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          🔍
        </button>
      </div>

      {/* Поле поиска */}
      {showSearch && (
        <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)' }}>
          <input
            autoFocus
            placeholder="Поиск страниц..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              fontSize: 13,
              fontFamily: 'var(--font)',
              background: 'var(--bg)',
              color: 'var(--text)',
              outline: 'none',
            }}
          />
        </div>
      )}

      {/* Кнопки действий */}
      <div style={{
        padding: '8px 14px',
        display: 'flex',
        gap: 6,
        borderBottom: '1px solid var(--border)',
      }}>
        <button
          onClick={() => void createPage()}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          + Добавить
        </button>
      </div>

      {/* Список страниц */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {filteredPages.length === 0 ? (
          <div style={{ padding: '20px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
            {pages.length === 0 ? 'Нет страниц. Нажмите «+ Добавить»' : 'Ничего не найдено'}
          </div>
        ) : (
          filteredPages.map((p) => {
            const isActive = params.pageId === p.id;
            return (
              <NavLink
                key={p.id}
                to={`/spaces/${currentSpaceId}/page/${p.id}`}
                className={() => `right-sidebar-item${isActive ? ' active' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  color: isActive ? 'var(--text)' : 'var(--text-secondary)',
                  background: isActive ? 'var(--surface)' : 'transparent',
                  textDecoration: 'none',
                  fontSize: 13,
                  borderLeft: isActive ? '2px solid var(--text)' : '2px solid transparent',
                  transition: 'all 0.1s',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1 }}>
                  <span style={{ flexShrink: 0, fontSize: 14 }}>📄</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.title || 'Без названия'}
                  </span>
                </span>
                <button
                  onClick={(e) => void deletePage(e, p.id)}
                  title="Удалить"
                  style={{
                    opacity: 0,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 14,
                    color: 'var(--text-muted)',
                    padding: '2px 4px',
                    borderRadius: 4,
                    flexShrink: 0,
                    transition: 'opacity 0.15s',
                  }}
                  className="right-sidebar-item-delete"
                >
                  🗑
                </button>
              </NavLink>
            );
          })
        )}
      </div>

      {/* Подвал */}
      <div style={{
        padding: '8px 14px',
        borderTop: '1px solid #e0e0e8',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}>
        <NavLink
          to="/trash"
          style={{ fontSize: 12, color: '#8a8aa2', padding: '4px 0', textDecoration: 'none' }}
        >
          Корзина
        </NavLink>
        <NavLink
          to="/graph"
          style={{ fontSize: 12, color: '#8a8aa2', padding: '4px 0', textDecoration: 'none' }}
        >
          Граф связей
        </NavLink>
      </div>
    </aside>
  );
}
