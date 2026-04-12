import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpaces } from '../context/SpaceContext';

export default function CreateSpacePage() {
  const [spaceName, setSpaceName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const { createSpace } = useSpaces();
  const navigate = useNavigate();

  const handleCreate = async () => {
    if (!spaceName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const space = await createSpace(spaceName.trim());
      navigate(`/spaces/${space.id}`, { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка');
      setCreating(false);
    }
  };

  return (
    <div style={{
      minHeight: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-secondary)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 440,
        padding: 32,
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.06)',
      }}>
        <h1 style={{
          fontFamily: 'var(--font-heading)',
          fontSize: 22,
          fontWeight: 900,
          marginBottom: 8,
          letterSpacing: '-0.02em',
        }}>
          Создайте пространство
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
          Пространство объединяет страницы и участников в одном месте.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            Название пространства
            <input
              placeholder="Например: Моя команда"
              value={spaceName}
              onChange={(e) => setSpaceName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
              autoFocus
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                fontSize: 15,
                fontFamily: 'var(--font)',
                background: 'var(--bg)',
                color: 'var(--text)',
              }}
            />
          </label>
          {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
          <button
            className="btn btn-primary btn-full"
            onClick={() => void handleCreate()}
            disabled={creating || !spaceName.trim()}
            style={{ marginTop: 4 }}
          >
            {creating ? 'Создаём…' : 'Создать пространство'}
          </button>
        </div>
      </div>
    </div>
  );
}
