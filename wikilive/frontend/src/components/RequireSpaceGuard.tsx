import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSpaces } from '../context/SpaceContext';

export default function RequireSpaceGuard(): JSX.Element {
  const { spaces, loading } = useSpaces();
  const location = useLocation();

  if (loading) {
    return <div className="loading">Загрузка…</div>;
  }

  if (spaces.length === 0) {
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
