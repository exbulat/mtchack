import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpaces } from '../context/SpaceContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export default function LeftSidebar() {
  const { spaces, activeSpace, setActiveSpace } = useSpaces();
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Закрыть dropdown при клике вне
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSpaceClick = (space: { id: string; name: string; color?: string }) => {
    setActiveSpace(space as typeof activeSpace extends null ? never : NonNullable<typeof activeSpace>);
    setIsOpen(false);
    navigate(`/spaces/${space.id}`);
  };

  const handleCreateSpace = () => {
    setIsOpen(false);
    navigate('/');
  };

  const currentSpace = activeSpace || spaces[0];

  return (
    <nav style={{
      width: 64,
      flexShrink: 0,
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '16px 0',
      gap: 8,
    }}>
      {/* Логотип убран - перенесен в Layout */}

      {/* Главный переключатель пространств с dropdown */}
      <div ref={dropdownRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            background: currentSpace ? 'var(--text)' : 'var(--surface)',
            color: currentSpace ? 'var(--bg)' : 'var(--text)',
            fontWeight: 700,
            fontSize: 15,
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'all 0.15s',
            boxShadow: '0 0 0 2px var(--border-light)',
          }}
          title={currentSpace?.name || 'Выбрать пространство'}
        >
          {currentSpace?.name[0]?.toUpperCase() || '?'}
        </button>

        {/* Стрелочка под квадратом */}
        <div
          onClick={() => setIsOpen(!isOpen)}
          style={{
            marginTop: 4,
            width: 16,
            height: 16,
            background: 'var(--surface)',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            border: '1px solid var(--border)',
            fontSize: 8,
            color: 'var(--text-secondary)',
            transition: 'all 0.15s',
          }}
        >
          {isOpen ? '▲' : '▼'}
        </div>

        {/* Dropdown со списком пространств */}
        {isOpen && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 20px)',
              left: 8,
              width: 200,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              zIndex: 9999,
              overflow: 'hidden',
            }}
          >
            {/* Заголовок */}
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Мои пространства
            </div>

            {/* Список пространств */}
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {spaces.map((s) => {
                const isActive = activeSpace?.id === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => handleSpaceClick(s)}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      background: isActive ? 'var(--surface)' : 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'var(--text)',
                      fontSize: 14,
                      transition: 'background 0.15s',
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        background: 'var(--text)',
                        color: 'var(--bg)',
                        fontWeight: 700,
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {s.name[0]?.toUpperCase()}
                    </div>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      {s.name}
                    </span>
                    {isActive && (
                      <span style={{ marginLeft: 'auto', fontSize: 12 }}>✓</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Кнопка создания нового пространства */}
            <button
              onClick={handleCreateSpace}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--surface)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
              style={{
                width: '100%',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'transparent',
                border: 'none',
                borderTop: '1px solid var(--border)',
                cursor: 'pointer',
                textAlign: 'left',
                color: 'var(--text-secondary)',
                fontSize: 14,
                transition: 'background 0.15s',
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: 'transparent',
                  border: '2px dashed var(--border-light)',
                  color: 'var(--text-muted)',
                  fontWeight: 700,
                  fontSize: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                +
              </div>
              <span>Новое пространство</span>
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Переключатель темы */}
      <button
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          border: 'none',
          background: 'var(--surface)',
          cursor: 'pointer',
          fontSize: 16,
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.15s',
        }}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>

      {/* Настройки */}
      <button
        onClick={() => navigate('/settings')}
        title="Настройки"
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          border: 'none',
          background: 'var(--surface)',
          cursor: 'pointer',
          fontSize: 18,
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.15s',
        }}
      >
        ⚙
      </button>

      {/* Профиль */}
      {user && (
        <button
          onClick={() => navigate('/settings')}
          title={user.name}
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'var(--text)',
            color: 'var(--bg)',
            fontWeight: 700,
            fontSize: 14,
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 8,
          }}
        >
          {user.name[0]?.toUpperCase()}
        </button>
      )}
    </nav>
  );
}
