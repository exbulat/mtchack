import { Outlet } from 'react-router-dom';
import Sidebar, { PagesListProvider } from './Sidebar';

export default function Layout() {
  return (
    <PagesListProvider>
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </PagesListProvider>
  );
}
