import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import RequireAuthGuard from './components/RequireAuthGuard';
import RequireSpaceGuard from './components/RequireSpaceGuard';
import PageEditor from './pages/PageEditor';
import CreateSpacePage from './pages/CreateSpacePage';
import WelcomePage from './pages/WelcomePage';
import GraphView from './pages/GraphView';
import TrashView from './pages/TrashView';
import SpaceSettings from './pages/SpaceSettings';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Register from './pages/Register';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { SpaceProvider } from './context/SpaceContext';
import './styles/global.css';

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <SpaceProvider>
            <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route element={<RequireAuthGuard />}>
              <Route element={<Layout />}>
                <Route path="/" element={<CreateSpacePage />} />
                <Route path="/settings" element={<Settings />} />
                <Route element={<RequireSpaceGuard />}>
                  <Route path="/spaces/:spaceId" element={<WelcomePage />} />
                  <Route path="/spaces/:spaceId/page/:id" element={<PageEditor />} />
                  <Route path="/spaces/:spaceId/settings" element={<SpaceSettings />} />
                  <Route path="/new" element={<PageEditor />} />
                  <Route path="/page/:id" element={<PageEditor />} />
                  <Route path="/graph" element={<GraphView />} />
                  <Route path="/trash" element={<TrashView />} />
                </Route>
              </Route>
            </Route>
          </Routes>
          </SpaceProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
