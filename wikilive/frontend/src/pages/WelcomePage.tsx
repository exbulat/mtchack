import { useSpaces } from '../context/SpaceContext';

export default function WelcomePage() {
  const { activeSpace } = useSpaces();

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 40,
      gap: 24,
      background: 'var(--bg)',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16, color: 'var(--text-secondary)' }}>◈</div>
        <h1 style={{
          fontFamily: 'var(--font-heading)',
          fontSize: 24,
          fontWeight: 700,
          color: 'var(--text)',
          marginBottom: 8,
          letterSpacing: '-0.02em',
        }}>
          Добро пожаловать в WikiLive
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 360 }}>
          Выберите страницу из списка или создайте новую в пространстве «{activeSpace?.name ?? ''}»
        </p>
      </div>
    </div>
  );
}
