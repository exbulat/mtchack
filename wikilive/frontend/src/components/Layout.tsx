import { Outlet } from 'react-router-dom';
import LeftSidebar from './LeftSidebar';
import RightSidebar, { PagesListProvider } from './RightSidebar';

export default function Layout() {
  return (
    <PagesListProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
        {/* ── Верхняя панель с логотипом ── */}
        <div style={{
          height: 48,
          flexShrink: 0,
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 12,
        }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: 'var(--text)',
            color: 'var(--bg)',
            fontWeight: 900,
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-heading)',
          }}>
            W
          </div>
          <span style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--text)',
            letterSpacing: '-0.02em',
          }}>
            WikiLive
          </span>
        </div>

        {/* ── Основной контент ── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* ── Левый узкий сайдбар (иконки) ── */}
          <LeftSidebar />

        {/* ── Правый сайдбар (список страниц) ── */}
        <RightSidebar />

        {/* ── Основной контент ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            <Outlet />
          </main>
        </div>
        </div>
      </div>
    </PagesListProvider>
  );
}
