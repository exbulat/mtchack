import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface UseAutosaveArgs {
  pageId: string | null;
  title: string;
  content: Record<string, unknown>;
  enabled?: boolean;
}

const DEBOUNCE_MS = 1500;
const RETRY_DELAYS = [2000, 5000, 15000];
const DRAFT_KEY_PREFIX = 'wikilive-page-draft:';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export function useAutosave({ pageId, title, content, enabled = true }: UseAutosaveArgs) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const retryRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const latestRef = useRef({ title, content });
  const previousPageIdRef = useRef<string | null>(pageId);
  const skipNextAutosaveRef = useRef(false);

  useEffect(() => {
    if (pageId === previousPageIdRef.current) return;

    previousPageIdRef.current = pageId;
    skipNextAutosaveRef.current = true;
    setPendingChanges(false);
    setIsSaving(false);
    setSaveError(false);

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (retryRef.current) {
      window.clearTimeout(retryRef.current);
      retryRef.current = null;
    }

    retryCountRef.current = 0;
  }, [pageId]);

  useEffect(() => {
    latestRef.current = { title, content };
  }, [title, content]);

  const persistLocal = useCallback(
    (t: string, c: Record<string, unknown>) => {
      if (!pageId) return;
      const key = `${DRAFT_KEY_PREFIX}${pageId}`;
      try {
        sessionStorage.setItem(
          key,
          JSON.stringify({
            title: t,
            content: c,
            updatedAt: Date.now(),
            expiresAt: Date.now() + DRAFT_TTL_MS,
          }),
        );
      } catch {
        // sessionStorage might be full or unavailable.
      }
    },
    [pageId],
  );

  useEffect(() => {
    if (!pageId || !enabled) return;
    if (skipNextAutosaveRef.current) return;
    persistLocal(title, content);
  }, [pageId, enabled, title, content, persistLocal]);

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
    [pageId],
  );

  const scheduleRetry = useCallback(() => {
    const attempt = retryCountRef.current;
    if (attempt >= RETRY_DELAYS.length) return;

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

  const saveNow = useCallback(async () => {
    if (!pageId) return;
    if (retryRef.current) {
      window.clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    retryCountRef.current = 0;

    const { title: t, content: c } = latestRef.current;
    setIsSaving(true);
    setPendingChanges(false);

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
  }, [pageId, persistLocal, attemptServerSave, scheduleRetry]);

  useEffect(() => {
    if (!pageId || !enabled) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    setPendingChanges(true);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => void saveNow(), DEBOUNCE_MS);
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [pageId, enabled, title, content, saveNow]);

  useEffect(() => {
    return () => {
      if (retryRef.current) window.clearTimeout(retryRef.current);
    };
  }, []);

  return { isSaving, lastSavedAt, saveError, saveNow, pendingChanges };
}
