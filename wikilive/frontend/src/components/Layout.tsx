import { Link, Outlet } from 'react-router-dom';
import Sidebar, { PagesListProvider } from './Sidebar';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, loading, logout } = useAuth();

  return (
    <PagesListProvider>
      <div className="app-layout">
        <Sidebar />
        <div className="main-column">
          <header className="app-topbar">
            {!loading && user ? (
              <>
                <span className="topbar-user">
                  <span
                    className="topbar-user-dot"
                    style={{ backgroundColor: user.avatarColor }}
                    aria-hidden
                  />
                  {user.name}
                </span>
                <button type="button" className="toolbar-link" onClick={() => void logout()}>
                  Выйти
                </button>
              </>
            ) : !loading ? (
              <>
                <Link to="/login" className="toolbar-link">
                  Войти
                </Link>
                <Link to="/register" className="toolbar-link">
                  Регистрация
                </Link>
              </>
            ) : null}
          </header>
          <main className="main-content">
            <Outlet />
          </main>
        </div>
      </div>
    </PagesListProvider>
  );
}
