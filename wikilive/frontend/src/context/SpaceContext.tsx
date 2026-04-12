import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type SpaceSummary } from '../lib/api';
import { useAuth } from './AuthContext';

export interface SpaceState {
  spaces: SpaceSummary[];
  activeSpace: SpaceSummary | null;
  setActiveSpace: (space: SpaceSummary) => void;
  createSpace: (name: string) => Promise<SpaceSummary>;
  refreshSpaces: () => Promise<void>;
  loading: boolean;
}

const SpaceContext = createContext<SpaceState | null>(null);

const ACTIVE_SPACE_KEY = 'wikilive-active-space';

export function SpaceProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const activeSpaceId = localStorage.getItem(ACTIVE_SPACE_KEY);
  const activeSpace = useMemo(
    () => spaces.find((s) => s.id === activeSpaceId) ?? spaces[0] ?? null,
    [spaces, activeSpaceId],
  );

  const setActiveSpace = useCallback((space: SpaceSummary) => {
    localStorage.setItem(ACTIVE_SPACE_KEY, space.id);
    // force re-render by changing state
    setSpaces((prev) => [...prev]);
  }, []);

  const refreshSpaces = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.getMySpaces();
      setSpaces(data);
    } catch {
      // ignore
    }
  }, [user]);

  const createSpace = useCallback(async (name: string): Promise<SpaceSummary> => {
    const space = await api.createSpace({ name });
    await refreshSpaces();
    localStorage.setItem(ACTIVE_SPACE_KEY, space.id);
    setSpaces((prev) => [...prev]);
    return { ...space, createdAt: new Date().toISOString(), myRole: 'OWNER' };
  }, [refreshSpaces]);

  useEffect(() => {
    if (authLoading || !user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    refreshSpaces().finally(() => setLoading(false));
  }, [user, authLoading, refreshSpaces]);

  const value = useMemo(
    () => ({ spaces, activeSpace, setActiveSpace, createSpace, refreshSpaces, loading }),
    [spaces, activeSpace, setActiveSpace, createSpace, refreshSpaces, loading],
  );

  return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>;
}

export function useSpaces(): SpaceState {
  const ctx = useContext(SpaceContext);
  if (!ctx) throw new Error('useSpaces вне SpaceProvider');
  return ctx;
}
