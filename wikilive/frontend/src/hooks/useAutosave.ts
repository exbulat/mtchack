import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface UseAutosaveArgs {
  pageId: string | null;
  title: string;
  content: Record<string, unknown>;
  enabled?: boolean;
}

const DEBOUNCE_MS = 1500;
const RETRY_DELAYS = [2000, 5000, 15000]; // 3 retries with backoff

export function useAutosave({ pageId, title, content, enabled = true }: UseAutosaveArgs) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const retryRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const latestRef = useRef({ title, content });

  // Always track latest values for retry
  useEffect(() => {
    latestRef.current = { title, content };
  }, [title, content]);

  const persistLocal = useCallback(
    (t: string, c: Record<string, unknown>) => {
      if (!pageId) return;
      const key = `wikilive-page-${pageId}`;
      try {
        localStorage.setItem(key, JSON.stringify({ title: t, content: c, updatedAt: Date.now() }));
      } catch {
        // localStorage might be full — non-critical
      }
    },
    [pageId]
  );

  const attemptServerSave = useCallback(
    async (t: string, c: Record<string, unknown>): Promise<boolean> => {
      if (!pageId) return true;
      try {
        await api.updatePage(pageId, { title: t, content: c });
        return true;
      } catch {
        return false;
      }
    },
    [pageId]
  );

  const saveNow = useCallback(async () => {
    if (!pageId) return;
    // Cancel any pending retry
    if (retryRef.current) {
      window.clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    retryCountRef.current = 0;

    const { title: t, content: c } = latestRef.current;
    setIsSaving(true);
    setPendingChanges(false);

    // Always save to localStorage first as fast local backup
    persistLocal(t, c);

    const ok = await attemptServerSave(t, c);
    if (ok) {
      setSaveError(false);
      setLastSavedAt(Date.now());
    } else {
      setSaveError(true);
      scheduleRetry();
    }
    setIsSaving(false);
  }, [pageId, persistLocal, attemptServerSave]);

  const scheduleRetry = useCallback(() => {
    const attempt = retryCountRef.current;
    if (attempt >= RETRY_DELAYS.length) return; // gave up after max retries

    const delay = RETRY_DELAYS[attempt];
    retryCountRef.current += 1;

    retryRef.current = window.setTimeout(async () => {
      const { title: t, content: c } = latestRef.current;
      setIsSaving(true);
      persistLocal(t, c);
      const ok = await attemptServerSave(t, c);
      if (ok) {
        setSaveError(false);
        setLastSavedAt(Date.now());
        retryCountRef.current = 0;
      } else {
        scheduleRetry();
      }
      setIsSaving(false);
    }, delay);
  }, [persistLocal, attemptServerSave]);

  // Debounced autosave — triggers on content/title changes
  useEffect(() => {
    if (!pageId || !enabled) return;
    setPendingChanges(true);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => void saveNow(), DEBOUNCE_MS);
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, enabled, title, content]);

  // Cleanup retries on unmount
  useEffect(() => {
    return () => {
      if (retryRef.current) window.clearTimeout(retryRef.current);
    };
  }, []);

  return { isSaving, lastSavedAt, saveError, saveNow, pendingChanges };
}
