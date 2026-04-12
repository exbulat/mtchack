import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useSpaces } from '../context/SpaceContext';

const AVATAR_COLORS = [
  '#6366f1', '#22c55e', '#f97316', '#ec4899',
  '#14b8a6', '#a855f7', '#eab308', '#ef4444',
  '#3b82f6', '#84cc16',
];

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  EDITOR: 'Редактор',
  READER: 'Читатель',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

export default function Settings() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name ?? '');
  const [nameEditing, setNameEditing] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [colorSaving, setColorSaving] = useState(false);

  const { spaces, loading: spacesLoading } = useSpaces();

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  useEffect(() => {
    if (nameEditing) nameInputRef.current?.focus();
  }, [nameEditing]);

  const saveName = async () => {
    if (!name.trim() || name.trim() === user?.name) {
      setNameEditing(false);
      setName(user?.name ?? '');
      return;
    }
    setNameSaving(true);
    setNameError('');
    try {
      await api.updateMe({ name: name.trim() });
      await refresh();
      setNameEditing(false);
    } catch (e: unknown) {
      setNameError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setNameSaving(false);
    }
  };

  const saveColor = async (color: string) => {
    setColorSaving(true);
    setColorPickerOpen(false);
    try {
      await api.updateMe({ avatarColor: color });
      await refresh();
    } catch {
      // ignore
    } finally {
      setColorSaving(false);
    }
  };

  if (!user) return null;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 24px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 32 }}>Настройки аккаунта</h1>

      {/* Профиль */}
      <section style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Профиль</h2>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
          {/* Аватар */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setColorPickerOpen((v) => !v)}
              title="Сменить цвет аватара"
              style={{
                width: 64, height: 64, borderRadius: '50%',
                backgroundColor: user.avatarColor,
                border: '2px solid var(--border)',
                color: '#fff', fontWeight: 700, fontSize: 26,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {colorSaving ? '…' : user.name[0]?.toUpperCase()}
            </button>
            {colorPickerOpen && (
              <div style={{
                position: 'absolute', top: 70, left: 0, zIndex: 50,
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: 10,
                display: 'grid', gridTemplateColumns: 'repeat(5, 28px)', gap: 6,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              }}>
                {AVATAR_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => saveColor(c)}
                    style={{
                      width: 28, height: 28, borderRadius: '50%', background: c,
                      border: user.avatarColor === c ? '2px solid var(--text)' : '2px solid transparent',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Поля */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Имя */}
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Имя</div>
              {nameEditing ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    ref={nameInputRef}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') { setNameEditing(false); setName(user.name); } }}
                    style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 15, fontFamily: 'var(--font)', flex: 1 }}
                  />
                  <button className="btn btn-primary" onClick={() => void saveName()} disabled={nameSaving} style={{ padding: '6px 14px' }}>
                    {nameSaving ? '…' : 'Сохранить'}
                  </button>
                  <button className="btn btn-ghost" onClick={() => { setNameEditing(false); setName(user.name); }} style={{ padding: '6px 10px' }}>
                    Отмена
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 15 }}>{user.name}</span>
                  <button className="btn btn-ghost" onClick={() => setNameEditing(true)} style={{ padding: '4px 10px', fontSize: 12 }}>
                    Изменить
                  </button>
                </div>
              )}
              {nameError && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{nameError}</div>}
            </div>

            {/* Email */}
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Email</div>
              <span style={{ fontSize: 15, color: 'var(--text-secondary)' }}>{user.email}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Пространства */}
      <section style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Мои пространства</h2>
        {spacesLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Загрузка…</div>
        ) : spaces.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Вы не состоите ни в одном пространстве</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {spaces.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                <NavLink to={`/spaces/${s.id}`} style={{ fontWeight: 500, fontSize: 14 }}>
                  {s.name}
                </NavLink>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: 999 }}>
                    {ROLE_LABELS[s.myRole] ?? s.myRole}
                  </span>
                  {(s.myRole === 'OWNER' || s.myRole === 'ADMIN') && (
                    <NavLink to={`/spaces/${s.id}/settings`} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Управление
                    </NavLink>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Аккаунт */}
      <section style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Аккаунт</h2>
        <button
          className="btn btn-ghost"
          onClick={async () => { await logout(); navigate('/login'); }}
          style={{ color: 'var(--danger)' }}
        >
          Выйти
        </button>
      </section>
    </div>
  );
}
