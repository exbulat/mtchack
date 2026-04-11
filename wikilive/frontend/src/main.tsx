import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import PageEditor from './pages/PageEditor';
import GraphView from './pages/GraphView';
import TrashView from './pages/TrashView';
import './styles/global.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/new" replace />} />
          <Route path="/new" element={<PageEditor />} />
          <Route path="/page/:id" element={<PageEditor />} />
          <Route path="/graph" element={<GraphView />} />
          <Route path="/trash" element={<TrashView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
