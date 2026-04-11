import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api, PageSummary } from '../lib/api';

// счётчик увеличиваем вручную, чтобы сайдбар перезапросил список без лишних подписок
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

export default function Sidebar() {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const navigate = useNavigate();
  const { pagesListVersion } = useContext(PagesListContext);

  const loadPages = async () => {
    try {
      const data = await api.listPages();
      setPages(data);
    } catch {
      /* сеть/бэкенд недоступны */
    }
  };

  useEffect(() => {
    loadPages();
  }, [pagesListVersion]);

  const createPage = async () => {
    try {
      const page = await api.createPage({ title: 'Без названия' });
      await loadPages();
      navigate(`/page/${page.id}`);
    } catch {
      navigate('/new');
    }
  };

  const deletePage = async (e: React.MouseEvent, pageId: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await api.deletePage(pageId);
      await loadPages();
    } catch {}
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>WikiLive</span>
        <button className="btn btn-primary" onClick={createPage} style={{ padding: '4px 10px', fontSize: 13 }}>
          + Новая
        </button>
      </div>
      <div className="sidebar-list">
        {pages.map((p) => (
          <NavLink
            key={p.id}
            to={`/page/${p.id}`}
            className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {p.title || 'Без названия'}
            </span>
            <button
              className="sidebar-item-delete"
              title="Удалить страницу"
              onClick={(e) => deletePage(e, p.id)}
              type="button"
            >
              ×
            </button>
          </NavLink>
        ))}
        {pages.length === 0 && (
          <div style={{ padding: '16px 12px', color: 'var(--text-muted)', fontSize: 13 }}>
            Нет страниц. Создайте первую!
          </div>
        )}
      </div>
      <div className="sidebar-footer">
        <NavLink to="/trash" className="btn btn-ghost btn-full">
          Корзина
        </NavLink>
        <NavLink to="/graph" className="btn btn-ghost btn-full">
          Граф связей
        </NavLink>
      </div>
    </aside>
  );
}
